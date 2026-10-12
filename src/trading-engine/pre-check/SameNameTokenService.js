/**
 * 严格同名代币检查服务
 *
 * 分析目标：
 * 通过搜索相同symbol的代币，使用严格名称匹配规则，
 * 统计真正的同名代币数量，作为购买前检查的参考因子。
 *
 * 数据来源：AVE API /v2/tokens
 * 链限制：固定BSC链
 *
 * 快照存档（2026-10-12 用户裁定，SI 0xbc97c27f 对拍事故）：AVE 实时搜索是
 * 「当前快照」无 as-of 语义——回测两次运行间同名簇漂移会翻转 preBuy 决策
 * （v0 wall 00:58 簇≥3 放行 vs 旧 perf 臂 wall 07:04 簇 2 拦下，同虚拟时刻）。
 * 三条裁定落地的双模式：
 *   1. 实时/实盘引擎每次真调 AVE 成功后把裁剪结果 append 写
 *      ave_same_name_snapshots（全局资产，积累历史）；
 *   2. 回测（asOfMs 传入）：取 searched_at <= asOf 最近快照为主数据源，
 *      miss 时实时调用仅作兜底（日志标 fallback）；
 *   3. 兜底实时调用的行必须过滤到「被检测代币发布之前」
 *      （row.created_at <= targetCreatedAtSec，未来同名盘不计入簇；快照
 *      行同样过滤——快照时刻虽 <= asOf，行内仍可能含被检 token 发布后
 *      才创建的盘）。created_at 无效(0)剔除（fail-closed 偏拦，宁拦不冒充）。
 * 实时引擎路径（无 asOfMs）行为零变化：实时调、不过滤、照写快照。
 */

const { AveTokenAPI } = require('../../core/ave-api');

/** 快照裁剪行字段（过滤/因子计算必需的最小集；其余 AVE 字段不入档） */
const SNAPSHOT_TRIM_FIELDS = ['token', 'name', 'symbol', 'fdv', 'tvl', 'tx_volume_u_24h', 'created_at'];
/** 同 (chain, search_term) 快照写入节流窗（ms）：簇变化频率低，6h 粒度足够 as-of 且控行量 */
const SNAPSHOT_WRITE_THROTTLE_MS = 6 * 60 * 60 * 1000;

class SameNameTokenService {
  /**
   * 构造函数
   * @param {Object} logger - 日志记录器
   * @param {Object} [config] - 配置
   * @param {number} [config.searchCacheTtlSec=0] - AVE 搜索结果缓存 TTL（秒，
   *   默认 0=off 现状零变化；P1-5 bc4f756e 性能案）。回测重复 fire 同 token 时
   *   同 symbol 搜索 ~47:1 重复，缓存省外部 API roundtrip；只缓存搜索原始结果，
   *   selfAddress 排除 / 名称匹配过滤每次重跑（per-token 输入不同）
   * @param {Object} [config.snapshotWriter] - 快照写端（实时+兜底共用；null=不写，
   *   单测/工具路径）。形状 { insert(row): Promise }；PreBuyCheckService 构造时
   *   用 dbManager client 包装注入。写失败 warn 不抛（快照丢失不影响决策路径）
   */
  constructor(logger, config = {}) {
    this.logger = logger;
    const ttl = Number(config.searchCacheTtlSec);
    this._searchCacheTtlMs = Number.isFinite(ttl) && ttl > 0 ? ttl * 1000 : 0;
    /** key = `${chain}:${搜索词}` → { results, cachedAt }（AVE 原始行，只缓存成功结果） */
    this._searchCache = new Map();
    this._snapshotWriter = config.snapshotWriter || null;
    /** key = `${chain}:${搜索词}` → 上次写快照墙钟 ms（进程内 6h 节流，防 TTL 缓存过期重搜炸表） */
    this._lastSnapWriteAt = new Map();
    /** 回测快照索引：key = `${chain}:${搜索词}` → [{searchedAtMs, rowCount, results}] 桶内升序
     *  （BacktestEngine 装载注入；null=未注入（实时引擎/未装载回测） */
    this._historicalSnapshots = null;
    this._stats = { snapshotHits: 0, fallbacks: 0, snapshotWrites: 0 };
  }

  /**
   * 注入回测快照索引（BacktestEngine 装载期一次性；形态参照 EarlyParticipant
   * setReplayTicksIndex）。null 摘除。注入与否不改变数据源判定——回测语义由
   * performCheck 的 asOfMs 传入决定（注入索引只是让 as-of 有数据可查）。
   */
  setHistoricalSnapshots(index) {
    this._historicalSnapshots = index;
  }

  /** 回测收尾观测（引擎日志用） */
  getSnapshotStats() {
    return {
      buckets: this._historicalSnapshots ? this._historicalSnapshots.size : 0,
      ...this._stats,
    };
  }

  /**
   * 执行严格同名代币检查
   * @param {string} tokenSymbol - 代币符号
   * @param {string} tokenName - 代币名称
   * @param {Object} options - 可选配置
   * @param {string} [options.selfAddress] - 当前代币地址（从同名候选中排除自己，
   *   防止补买轮次当前盘自身 FDV 已达标造成自我误拦）
   * @param {number|null} [options.asOfMs] - 回测虚拟时刻（ms）。传入=回测语义：
   *   快照 as-of 优先 + miss 兜底实时 + 行级发布前过滤；不传（实时/实盘）=现状零变化
   * @param {number|null} [options.targetCreatedAtSec] - 被检测代币发布时刻（秒，
   *   tokenInfo.launchAt 同源）。仅 asOfMs 路径消费：候选行 created_at 必须有效且
   *   <= 该锚（未来同名盘不计入簇）。锚缺失 → 不过滤 + warn（偏拦方向的对侧，
   *   与实时锚缺失行为一致，不静默全拦）
   * @param {string} [options.sourceExperimentId] - 快照 provenance（写入行携带）
   * @returns {Promise<Object>} 检查结果
   */
  async performCheck(tokenSymbol, tokenName, options = {}) {
    const { chain = 'bsc', timeout = 10000, selfAddress = null,
            asOfMs = null, targetCreatedAtSec = null, sourceExperimentId = null } = options;

    this.logger.debug('开始严格同名代币检查', { symbol: tokenSymbol, name: tokenName, chain });

    try {
      const searchTerm = SameNameTokenService._normalizeName(tokenSymbol) || tokenSymbol;
      const cacheKey = `${chain}:${searchTerm}`;

      let results = null;
      let fromSearchCache = false;
      let snapshotHit = false;
      let rowCount = null;   // 快照命中时的原始搜索行数（searchCount 保真；裁剪行长度同值但显式存）

      // ── 回测 as-of：历史快照优先（决定性主路径）──
      if (asOfMs != null) {
        const snap = this._lookupSnapshot(chain, searchTerm, asOfMs);
        if (snap) {
          results = snap.results.map(r => ({ ...r }));
          rowCount = snap.rowCount;
          snapshotHit = true;
          this._stats.snapshotHits++;
          this.logger.debug('严格同名检查命中历史快照', {
            symbol: tokenSymbol, chain, searchedAt: new Date(snap.searchedAtMs).toISOString(),
            rows: snap.rowCount,
          });
        } else {
          this._stats.fallbacks++;
          this.logger.debug('严格同名检查快照 miss，兜底实时调用', { symbol: tokenSymbol, chain });
        }
      }

      // ── 实时调用（实时引擎主路径 / 回测兜底）──
      if (!results) {
        if (this._searchCacheTtlMs > 0) {
          const cached = this._searchCache.get(cacheKey);
          if (cached && Date.now() - cached.cachedAt < this._searchCacheTtlMs) {
            results = cached.results;
            fromSearchCache = true;
          }
        }

        if (!results) {
          // 初始化AVE API
          const apiKey = process.env.AVE_API_KEY || null;
          const config = require('../../../config/default.json');
          const baseURL = config.ave?.apiUrl || 'https://prod.ave-api.com';

          const api = new AveTokenAPI(baseURL, timeout, apiKey);

          // 搜索同名代币（固定BSC链；归一化 symbol 搜索，避免隐形字符搜不到同名代币）
          results = await api.searchTokens(searchTerm, chain, 300, 'fdv');
          rowCount = results.length;
          if (this._searchCacheTtlMs > 0) {
            this._searchCache.set(cacheKey, { results, cachedAt: Date.now() });
          }
          // 真调成功 → append 快照（实时+回测兜底都写：今天的快照供未来回测 as-of；
          // 6h 节流；写失败 warn 不抛）。缓存命中不写（未发生真实搜索，无新鲜度价值）
          await this._writeSnapshot(chain, searchTerm, results, sourceExperimentId);
        }
      }

      if (fromSearchCache) {
        this.logger.debug('严格同名检查命中搜索缓存', { symbol: tokenSymbol, chain, rows: results.length });
      }

      // ── 行级发布前过滤（仅回测路径；裁定 3）──
      let preLaunchDropped = 0;
      if (asOfMs != null) {
        if (Number.isFinite(targetCreatedAtSec) && targetCreatedAtSec > 0) {
          const before = results.length;
          results = results.filter(r => Number(r.created_at) > 0 && Number(r.created_at) <= targetCreatedAtSec);
          preLaunchDropped = before - results.length;
        } else {
          this.logger.warn('严格同名检查缺发布锚，跳过行级发布前过滤', { symbol: tokenSymbol, chain });
        }
      }

      // 排除自己后做严格名称匹配过滤
      const self = selfAddress ? selfAddress.toLowerCase() : null;
      const strictSameNameTokens = results.filter(t =>
        !(self && (t.token || '').toLowerCase() === self) &&
        this._isSameName(tokenName, tokenSymbol, t.name, t.symbol)
      );

      // 计算因子（searchCount 用原始搜索行数：快照 rowCount 或实时 results.length，
      // 与过滤前口径一致——searchCount 是「搜索结果规模」观察因子，不是簇大小）
      const searchCount = rowCount != null ? rowCount : results.length;
      const factors = {
        strictSameNameTokenCount: strictSameNameTokens.length,
        strictSameNameSearchCount: searchCount,
        strictSameNameFilteredCount: searchCount - strictSameNameTokens.length,
        strictSameNameMaxFDV: this._getMaxFDV(strictSameNameTokens)
      };

      this.logger.debug('严格同名代币检查完成', {
        symbol: tokenSymbol,
        searchCount,
        strictCount: strictSameNameTokens.length,
        filteredCount: searchCount - strictSameNameTokens.length,
        snapshotHit,
        preLaunchDropped
      });

      return {
        success: true,
        factors,
        snapshotHit,
        fallback: asOfMs != null && !snapshotHit,
        preLaunchDropped
      };

    } catch (error) {
      this.logger.error('严格同名代币检查失败', {
        symbol: tokenSymbol,
        error: error.message
      });

      return {
        success: false,
        factors: this.getEmptyFactors(error.message),
        error: error.message
      };
    }
  }

  /**
   * as-of 快照查找：桶内 searchedAtMs <= asOfMs 的最近一条（桶升序 → 线性从尾
   * 扫或二分；桶行长通常个位数，直接倒序扫）。命中返回 {searchedAtMs, rowCount,
   * results} 浅拷贝不拷行（调用方已 map 拷贝）；miss 返回 null。
   */
  _lookupSnapshot(chain, searchTerm, asOfMs) {
    const bucket = this._historicalSnapshots?.get(`${chain}:${searchTerm}`);
    if (!bucket || bucket.length === 0) return null;
    for (let i = bucket.length - 1; i >= 0; i--) {
      if (bucket[i].searchedAtMs <= asOfMs) return bucket[i];
    }
    return null;
  }

  /**
   * append 快照（真调成功后；6h 进程内节流）。裁剪行 7 字段 + row_count 保真
   * searchCount。失败 warn 不抛——快照写丢只损失未来回测的决定性，不能影响当次决策。
   */
  async _writeSnapshot(chain, searchTerm, results, sourceExperimentId) {
    if (!this._snapshotWriter) return;
    const key = `${chain}:${searchTerm}`;
    const now = Date.now();
    const last = this._lastSnapWriteAt.get(key);
    if (last != null && now - last < SNAPSHOT_WRITE_THROTTLE_MS) return;

    const trimmed = results.map(r => {
      const o = {};
      for (const f of SNAPSHOT_TRIM_FIELDS) o[f] = r[f] ?? 0;
      return o;
    });
    try {
      await this._snapshotWriter.insert({
        chain,
        search_term: searchTerm,
        searched_at: new Date(now).toISOString(),
        row_count: results.length,
        results: trimmed,
        source_experiment_id: sourceExperimentId || null,
      });
      this._lastSnapWriteAt.set(key, now);
      this._stats.snapshotWrites++;
    } catch (e) {
      this.logger.warn('AVE 同名快照写入失败（不影响当次检查）', { searchTerm: searchTerm, error: e.message });
    }
  }

  /**
   * 归一化名称：去除不可见/零宽字符后再 toLowerCase + trim
   * 防止用隐形字符（如韩文填充符 U+3164）规避同名检测（与叙事版 SameNameCheckService 同源）
   * @param {string} str - 原始字符串
   * @returns {string} 归一化后的字符串
   * @private
   */
  static _normalizeName(str) {
    if (!str) return '';
    return str
      .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202F\u2060-\u206F\u3164\uFEFF\uFE00-\uFE0F]/g, '')
      .toLowerCase()
      .trim();
  }

  /**
   * 严格名称匹配判断
   *
   * 匹配规则（只用 name 维度，不用 symbol 相同规则——symbol 同名但 name 完全不同
   * 的是跨语义盘（如 symbol 都叫"人生好物"，name 一个中文一个英文），不属蹭名）：
   * 1. name 完全相同（归一化后）
   * 2. name 互相包含（处理 "BNB STONKS SZN" vs "Stonks" 的蹭名结构）
   *
   * @param {string} name1 - 代币1的名称
   * @param {string} symbol1 - 代币1的符号
   * @param {string} name2 - 代币2的名称
   * @param {string} symbol2 - 代币2的符号
   * @returns {boolean} 是否认为是同名
   * @private
   */
  _isSameName(name1, symbol1, name2, symbol2) {
    if (!name1 || !name2) {
      return false;
    }

    const n1 = SameNameTokenService._normalizeName(name1);
    const n2 = SameNameTokenService._normalizeName(name2);

    // 规则1: name 完全相同（归一化后）
    if (n1 === n2) {
      return true;
    }

    // 规则2: name 互相包含（处理 "Leo" vs "Leo Token" 的情况）
    const shorter = n1.length < n2.length ? n1 : n2;
    const longer = n1.length < n2.length ? n2 : n1;

    if (longer.includes(shorter) && shorter.length >= 3) {
      return true;
    }

    return false;
  }

  /**
   * 获取最大FDV
   *
   * 排除AVE API的虚假数据：
   * 1. TVL < $1000 的代币（缺乏实际流动性）
   * 2. 24h交易量为0的代币（无实际交易）
   * 3. FDV > 20M 的代币（明显异常值）
   *
   * @param {Array} tokens - 代币列表
   * @returns {number} 最大FDV（经过有效性过滤）
   * @private
   */
  _getMaxFDV(tokens) {
    if (!tokens || tokens.length === 0) {
      return 0;
    }

    const MIN_VALID_TVL = 1000;       // TVL至少$1000
    const MAX_VALID_FDV = 20000000;   // FDV超过20M认为是虚假数据

    const validTokens = tokens.filter(t => {
      const fdv = this._parseFDV(t.fdv);
      const tvl = this._parseFDV(t.tvl);
      const txVolume = this._parseFDV(t.tx_volume_u_24h);

      // 过滤条件：必须有合理TVL、有交易量、FDV在合理范围内
      return fdv > 0 &&
             fdv <= MAX_VALID_FDV &&
             tvl >= MIN_VALID_TVL &&
             txVolume > 0;
    });

    if (validTokens.length === 0) {
      return 0;
    }

    const fdvs = validTokens.map(t => this._parseFDV(t.fdv));
    return Math.max(...fdvs);
  }

  /**
   * 解析FDV字符串
   * @param {string} fdvStr - FDV字符串
   * @returns {number} 解析后的数值
   * @private
   */
  _parseFDV(fdvStr) {
    if (!fdvStr || fdvStr === '' || fdvStr === '0') {
      return 0;
    }

    const cleaned = String(fdvStr).replace(/,/g, '').trim();
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }

  /**
   * 获取空因子值（错误时使用）
   * @param {string} error - 错误信息
   * @returns {Object} 空因子值
   */
  getEmptyFactors(error = null) {
    return {
      strictSameNameTokenCount: -1,
      strictSameNameSearchCount: 0,
      strictSameNameFilteredCount: 0,
      strictSameNameMaxFDV: 0,
      _strictSameNameError: error
    };
  }
}

module.exports = { SameNameTokenService };
