/**
 * 同叙事龙头已火检查服务（narrativeLeaderHot 因子）
 *
 * 用户裁定（2026-09-24，嫦娥系列数据分析后）：
 * - 不要求代币是叙事首发（首发无优势——嫦娥案例首发峰值仅 1.5x，第 6 个反而 12.2x）；
 * - 但同叙事（依托同一源推文）下若已有代币"火了"，其余代币买入不通过。
 *
 * 口径：
 * - 同叙事 = 同源推文：experiment_tokens.narrative_material_id（推文语料=裸数字串：
 *   tweet status id 或 community id，两者 eq 兼容）精确匹配，不限代币名——
 *   与叙事 pre-check 规则 0.5/0.55/0.58（均要求同名）互补，"天鹏"型同推文不同名仿盘只有本规则能抓
 * - "火了" = 候选代币自首笔达标 tick 起、截至买入判定时刻 t 的峰值涨幅
 *   max(price_bnb)/first(price_bnb) >= 5x（尘门：price_outlier=false 服务端 +
 *   bnbAmount>=MIN_PRICE_UPDATE_BNB 客户端，首价与峰值同门——防尘 tick 假首价，且倍数偏保守不误杀）
 * - 拒绝窗口 = 龙头首达 5x 时刻起 24h 内（多龙头任一命中即 hot）
 * - 严格事前语义：涨幅只算 block_time <= t 的 ticks，无未来函数，回测可复算
 *   （回测候选集来自当前 material_id 映射，属既有叙事直调同类的已知穿越，涨幅计算本身无前视）
 * - 候选不做 discovered_at 时间过滤：创建晚于 t 的候选 [首tick, t] 窗口自然为空不火，
 *   由 tick 窗口本身做时间过滤（避免 discovered_at 异常值漏龙头）
 *
 * 失败语义（fail-open 漏拦方向，不误杀）：无 tweet id / 查询异常 / 候选单查失败
 * → 因子全 0 放行，异常记录在 detail/日志（不掩盖问题）。
 *
 * 增量缓存（2026-10-12 回测性能案，perf 臂 744c307e 定因）：被 preBuy 拦截的
 * token 在买窗内每个 fire 重走全链，本服务每次 check 全量重查——胖达胖妮案
 * 129 fire × 27 候选 × 3 页 × 2000 行 = 数千次 DB 往返，70-370ms/fire 成回放
 * 阻塞主导项（每 5000 tick 段 12-60s）。回放时钟单调下单候选涨幅是「前缀
 * 函数」，keyset 水位增量与全量重算 bit-identical（等价性论证见
 * _evalCandidateIncremental 注释）。L1 候选集缓存把候选集钉在首次查询时点
 * =消除并发实验写行带来的运行内漂移（更决定性）；cacheEnabled=false 保留
 * 全量路径（对拍/单测对照）。
 *
 * P3d tweet 级聚合批量（2026-10-12 perf2 中期画像定因）：L2 增量把每候选 3 页
 * 削成 1 页，但每次 check 仍「每候选 ≥1 次查询」——50 候选 ÷ 并发 5 × RTT
 * ≈ 241ms/check 实测（龙头 sum 占回放段 57%，仍是阻塞主导）。同 tweet 的
 * hot/maxMultiple 因子与 self 无关（count 仅差自身一行），N 个 token 重复检查
 * 的是同一候选集 → 批量形状：一次 .in(未hardDone候选) + gte(tweet 时间水位)
 * 拉全组增量行，客户端按 token 分组逐行走与 _evalCandidateIncremental 完全
 * 同款的处理（幂等跳过/cap 截断/truncated 语义逐行照搬）；全局 (block_time,
 * log_index) 排序下组内子序列 = 该候选自身升序，等价性同 L2 论证。查询次数
 * 50 RTT → 1 RTT。新候选首查/hardDone 纯函数/checkTime 倒退回退现有路径。
 */

const { MIN_PRICE_UPDATE_BNB } = require('../../../scripts/shared/classifier-constants');

const DEFAULT_CONFIG = {
  hotMultipleThreshold: 5,      // 火门槛（倍数）
  rejectWindowSeconds: 86400,   // 龙头首达火门槛后拒绝窗口（24h）
  maxCandidates: 50,            // 去重后候选上限（discovered_at 最早优先——龙头几乎必在最早一批）
  candidateQueryLimit: 500,     // 行级查询上限（含跨实验重复行）
  tickPageSize: 2000,           // ticks 分页大小
  maxTickPages: 3,              // 页数上限：首达 5x 几乎必然在头几页（拉升在早期），截断只影响 maxMultiple 观测精度
  candidateConcurrency: 5,      // 候选间并发拉取上限
  incrementalCache: true,       // L1 候选集 + L2 涨幅 keyset 增量（见头注释；false=原全量路径）
  tweetAggregate: true,         // P3d tweet 级批量聚合（增量之上的批量形状；false=回退逐候选增量）
  aggregateMaxPages: 10,        // 批量分页护栏（正常增量 <100 行；触顶 warn，少算龙头=fail-open 方向）
};

class SameNarrativeLeaderService {
  /**
   * @param {Object} supabase - Supabase 客户端（dbManager.getClient()）
   * @param {Object} logger - 日志记录器
   * @param {Object} config - 覆盖 DEFAULT_CONFIG
   */
  constructor(supabase, logger, config = {}) {
    this.supabase = supabase;
    this.logger = logger;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this._candidateCache = new Map(); // sourceTweetId → 去重后候选数组（含各 token 自身行；排除自身在使用点做）
    this._peakCache = new Map();      // candidate address → L2 增量状态（见 _evalCandidateIncremental）
    this._tweetWm = new Map();        // sourceTweetId → { lastCheckSec, wmIso }（P3d 批量聚合水位）
  }

  /**
   * 执行同叙事龙头检查（永不抛错）
   * @param {Object} params
   * @param {string} params.tokenAddress - 当前代币地址
   * @param {string} params.sourceTweetId - 源推文 id（narrative_material_id 同口径裸数字串）
   * @param {number} params.checkTimeSec - 判定时刻（Unix 秒；实时=wall clock，回测=回放时点）
   * @returns {Promise<{success: boolean, factors: {narrativeLeaderHot: number,
   *   narrativeLeaderCount: number, narrativeLeaderMaxMultiple: number}, detail: Object}>}
   */
  async check({ tokenAddress, sourceTweetId, checkTimeSec }) {
    const startedAt = Date.now();
    try {
      if (!tokenAddress || !sourceTweetId || !/^\d+$/.test(String(sourceTweetId)) || !checkTimeSec) {
        return this.getEmptyFactors('no_source_tweet');
      }

      // 1. 候选查询：同 material_id、排除自身，跨实验行客户端去重（表无 (exp,token) 唯一约束）
      //    L1 缓存命中零查询（回测运行内 experiment_tokens 的 material_id 行集钉住
      //    首查时点——并发实验新写行不再进候选，运行内更决定性）。缓存含各 token
      //    自身行（不同调用方在使用点排除各自 token）。与原查询形状的唯一差异：
      //    limit 500 在排除 self 之前应用——self 行占额时边界候选最多少 1 个
      //    （去重后候选 >50 的推文实际不存在），方向 fail-open（少算龙头不误杀）
      let candidates;
      if (this.config.incrementalCache && this._candidateCache.has(String(sourceTweetId))) {
        candidates = this._candidateCache.get(String(sourceTweetId));
      } else {
        const { data: rows, error: queryError } = await this.supabase
          .from('experiment_tokens')
          .select('token_address, token_symbol, discovered_at')
          .eq('narrative_material_id', String(sourceTweetId))
          .order('discovered_at', { ascending: true })
          .limit(this.config.candidateQueryLimit);

        if (queryError) {
          throw new Error(`候选查询失败: ${queryError.message}`);
        }

        const byAddr = new Map();
        for (const r of (rows || [])) {
          const key = String(r.token_address).toLowerCase();
          if (!byAddr.has(key)) byAddr.set(key, r); // 保 earliest discovered_at（已升序）
        }
        candidates = [...byAddr.entries()]
          .map(([addr, r]) => ({ address: addr, symbol: r.token_symbol || '' }));
        if (this.config.incrementalCache) {
          this._candidateCache.set(String(sourceTweetId), candidates);
        }
      }
      // 排除自身统一在使用点做（缓存与 miss 查询共用，miss 查询含各 token 自身行）
      candidates = candidates
        .filter(c => c.address !== String(tokenAddress).toLowerCase())
        .slice(0, this.config.maxCandidates);

      // P3d 批量聚合路由：tweet 水位存在且 checkTime 单调 → 整组一次批量查询
      // （等价性见 _checkAggregated 注释）；倒退 = 弃水位回退逐候选路径（与 L2
      // 单候选倒退语义同构）
      if (this.config.incrementalCache && this.config.tweetAggregate) {
        const agg = this._tweetWm.get(String(sourceTweetId));
        if (agg && checkTimeSec >= agg.lastCheckSec) {
          return await this._checkAggregated(agg, candidates, tokenAddress, sourceTweetId, checkTimeSec, startedAt);
        }
        if (agg) {
          this.logger.warn('[SameNarrativeLeaderService] checkTime 倒退，弃 tweet 批量水位回退逐候选', {
            tweet: String(sourceTweetId), last: agg.lastCheckSec, now: checkTimeSec,
          });
          this._tweetWm.delete(String(sourceTweetId));
        }
      }

      const candidateErrors = [];
      const leaders = [];
      let truncated = false;
      let maxMultiple = 0;

      // 2. 并发池逐候选算峰值（<=5 并发；L2 增量路由在 _evalCandidateRouted）
      for (let i = 0; i < candidates.length; i += this.config.candidateConcurrency) {
        const batch = candidates.slice(i, i + this.config.candidateConcurrency);
        const results = await Promise.all(batch.map(c => this._evalCandidateRouted(c, checkTimeSec)));
        for (let j = 0; j < results.length; j++) {
          const res = results[j];
          if (!res.success) { candidateErrors.push({ address: batch[j].address, error: res.error }); continue; }
          if (res.truncated) truncated = true;
          if (res.peakMultiple > maxMultiple) maxMultiple = res.peakMultiple;
          // leaders 记录所有达标候选（无论窗口内），观测用
          if (res.firstReachAt) {
            leaders.push({
              tokenAddress: batch[j].address,
              symbol: batch[j].symbol,
              firstTickAt: res.firstTickAt,
              firstReachAt: res.firstReachAt,
              peakMultiple: Number(res.peakMultiple.toFixed(1)),
              inWindow: res.inWindow ? 1 : 0,
            });
          }
        }
      }

      // 逐候选路径成功收尾 → 写/推进 tweet 批量水位（下次同 tweet check 走批量）
      if (this.config.incrementalCache && this.config.tweetAggregate) {
        this._tweetWm.set(String(sourceTweetId), {
          lastCheckSec: checkTimeSec,
          wmIso: new Date(checkTimeSec * 1000).toISOString(),
        });
      }

      const hot = leaders.some(l => l.inWindow === 1) ? 1 : 0;
      const detail = {
        sourceTweetId: String(sourceTweetId),
        durationMs: Date.now() - startedAt,
        error: null,
        truncated,
        leaders,
        candidateErrors,
      };
      this.logger.info('[SameNarrativeLeaderService] 同叙事龙头检查完成', {
        token: String(tokenAddress).slice(0, 10),
        tweet: String(sourceTweetId),
        hot, count: candidates.length,
        maxMultiple: Number(maxMultiple.toFixed(1)),
        leaders: leaders.length,
        durationMs: detail.durationMs,
        ...(truncated ? { truncated: true } : {}),
        ...(candidateErrors.length ? { candidateErrors: candidateErrors.length } : {}),
      });
      return {
        success: true,
        factors: {
          narrativeLeaderHot: hot,
          narrativeLeaderCount: candidates.length,
          narrativeLeaderMaxMultiple: Number(maxMultiple.toFixed(1)),
        },
        detail,
      };
    } catch (error) {
      const detail = {
        sourceTweetId: sourceTweetId ? String(sourceTweetId) : null,
        durationMs: Date.now() - startedAt,
        error: error.message,
        truncated: false,
        leaders: [],
        candidateErrors: [],
      };
      this.logger.error('[SameNarrativeLeaderService] 同叙事龙头检查异常(fail-open)', {
        token: tokenAddress, error: error.message,
      });
      return { success: false, factors: this.getEmptyFactors('check_error').factors, detail };
    }
  }

  /**
   * 候选评估路由：L2 缓存可用且 checkTime 单调 → 增量；否则全量（成功后写缓存状态）。
   * @private
   */
  async _evalCandidateRouted(candidate, checkTimeSec) {
    if (!this.config.incrementalCache) {
      return this._evalCandidate(candidate, checkTimeSec, null);
    }
    const state = this._peakCache.get(candidate.address);
    if (state && Number.isFinite(state.lastCheckSec) && checkTimeSec >= state.lastCheckSec) {
      return this._evalCandidateIncremental(candidate, state, checkTimeSec);
    }
    if (state && checkTimeSec < state.lastCheckSec) {
      // 回放时钟单调是增量前提；倒退=异常形状，弃缓存走全量重算（fail-loud warn）
      this.logger.warn('[SameNarrativeLeaderService] checkTime 倒退，弃增量缓存全量重算', {
        address: candidate.address, last: state.lastCheckSec, now: checkTimeSec,
      });
      this._peakCache.delete(candidate.address);
    }
    return this._evalCandidate(candidate, checkTimeSec,
      (st) => this._peakCache.set(candidate.address, st));
  }

  /**
   * P3d 批量聚合检查：同 tweet 的未 hardDone 候选合并为一次 .in 批量增量查询，
   * 50 RTT → 1 RTT。等价性（与逐候选 _evalCandidateIncremental bit-identical）：
   *   - 批量查询全局 (block_time, log_index) 升序，按 token 分组后的组内子序列
   *     = 该候选自身升序流 → 逐行处理（首价/峰值/首达）与单候选增量完全同序
   *   - 行级幂等跳过（wmTs/wmIdx）与 cap 截断（rowCount >= maxRowForMax 后新行
   *     不进统计）逐行照搬；truncated 语义同款（未首达 + 行数达 3 满页）
   *   - 查询下界 = tweet 时间水位（上次 check 时刻），上次 check 已处理全部
   *     <= 水位的行（cap 内），本次只需 (水位, t]——无漏行；边界行重拉由幂等跳过吸收
   *   - hardDone 候选零查询（纯函数）；新候选（无 state）单独走全量首查写 state
   * 失败语义：批量查询失败 → 整批进 candidateErrors（fail-open 少算龙头，与
   * 原版单候选失败同向）；**state 与 tweet 水位都不动**（下次从旧水位重拉自愈，
   * 与 L2 单候选「副本不写回」同构——中途页失败不残留半推进状态）；
   * 成功 → 全组 state 推进 + tweet 水位推进。needInit 单候选首查失败不影响
   * tweet 水位（无 state 候选下次聚合仍走全量首查，不依赖水位）。
   * @private
   */
  async _checkAggregated(agg, candidates, tokenAddress, sourceTweetId, checkTimeSec, startedAt) {
    const toIso = new Date(checkTimeSec * 1000).toISOString();
    const candidateErrors = [];
    const leaders = [];
    let truncated = false;
    let maxMultiple = 0;

    // 分流：无 state → 全量首查；有 state 未 hardDone → 批量；hardDone → 零查询
    const needInit = [];
    const batchList = [];
    for (const c of candidates) {
      const st = this._peakCache.get(c.address);
      if (!st) needInit.push(c);
      else if (!st.hardDone) batchList.push({ candidate: c, state: st });
    }

    let batchFailed = false;
    if (batchList.length) {
      const batchError = await this._batchIncremental(batchList, agg.wmIso, toIso);
      if (batchError) {
        batchFailed = true;
        for (const { candidate } of batchList) {
          candidateErrors.push({ address: candidate.address, error: batchError });
        }
      } else {
        // 收尾同 L2：lastCheckSec 推进 + hardDone 标记（rowCount 达封顶边界）
        const maxRows = this.config.maxTickPages * this.config.tickPageSize;
        for (const { state: st } of batchList) {
          st.lastCheckSec = checkTimeSec;
          const cap = st.maxRowForMax || maxRows;
          if (st.rowCount >= cap) st.hardDone = true;
        }
      }
    }
    // 新候选全量首查（复用现有路由：写 state 供下次批量并入）
    for (const c of needInit) {
      const res = await this._evalCandidateRouted(c, checkTimeSec);
      if (!res.success) candidateErrors.push({ address: c.address, error: res.error });
    }

    // 汇总：纯内存从 state 拼（与原版 res 字段同构；首查失败无 state 的候选已进 errors）
    for (const c of candidates) {
      const st = this._peakCache.get(c.address);
      if (!st) continue;
      if (st.truncated) truncated = true;
      const peak = (st.firstPrice > 0) ? st.maxPrice / st.firstPrice : 0;
      if (peak > maxMultiple) maxMultiple = peak;
      if (st.firstReachAt) {
        const inWindow = (checkTimeSec * 1000 - new Date(st.firstReachAt).getTime())
          <= this.config.rejectWindowSeconds * 1000;
        leaders.push({
          tokenAddress: c.address,
          symbol: c.symbol,
          firstTickAt: st.firstTickAt,
          firstReachAt: st.firstReachAt,
          peakMultiple: Number(peak.toFixed(1)),
          inWindow: inWindow ? 1 : 0,
        });
      }
    }

    if (!batchFailed) {
      agg.lastCheckSec = checkTimeSec;
      agg.wmIso = toIso;
    }

    const hot = leaders.some(l => l.inWindow === 1) ? 1 : 0;
    const detail = {
      sourceTweetId: String(sourceTweetId),
      durationMs: Date.now() - startedAt,
      error: null,
      truncated,
      leaders,
      candidateErrors,
      aggregated: true,
    };
    this.logger.info('[SameNarrativeLeaderService] 同叙事龙头检查完成', {
      token: String(tokenAddress).slice(0, 10),
      tweet: String(sourceTweetId),
      hot, count: candidates.length,
      maxMultiple: Number(maxMultiple.toFixed(1)),
      leaders: leaders.length,
      durationMs: detail.durationMs,
      ...(truncated ? { truncated: true } : {}),
      ...(candidateErrors.length ? { candidateErrors: candidateErrors.length } : {}),
    });
    return {
      success: true,
      factors: {
        narrativeLeaderHot: hot,
        narrativeLeaderCount: candidates.length,
        narrativeLeaderMaxMultiple: Number(maxMultiple.toFixed(1)),
      },
      detail,
    };
  }

  /**
   * 批量增量拉取（P3d）：一次 .in(≤50 地址，URL 8KB 红线内) + gte(tweet 水位) +
   * lte(checkTime)，(block_time, log_index) 升序 limit 分页拉尽（keyset 游标 =
   * 上页末行 block_time；同刻行重拉由行级幂等跳过吸收）。正常增量 <100 行单页
   * 即尽；aggregateMaxPages 护栏触顶 warn（少算龙头=fail-open 方向）。
   * 逐候选 state 在**工作副本**上推进，全部页拉尽无错才写回原缓存对象——中途页
   * 失败不残留半推进状态（下次从旧水位重拉，与 _evalCandidateIncremental 的
   * 副本语义同构）。成功返回 null；失败返回 error 串（调用方整批进
   * candidateErrors，state 不动）。
   * @private
   */
  async _batchIncremental(batchList, fromIso, toIso) {
    const addrs = batchList.map(b => b.candidate.address);
    const work = batchList.map(b => ({ candidate: b.candidate, state: { ...b.state } }));
    const stateByAddr = new Map(work.map(b => [b.candidate.address, b.state]));
    const pageSize = this.config.tickPageSize;
    const maxRows = this.config.maxTickPages * this.config.tickPageSize;
    let cursorTs = null;
    for (let page = 0; page < this.config.aggregateMaxPages; page++) {
      let q = this.supabase
        .from('wss_price_ticks')
        .select('token_address, price_bnb, bnb_amount, block_time, log_index')
        .in('token_address', addrs)
        .eq('price_outlier', false)
        .gte('block_time', cursorTs != null ? cursorTs : fromIso);
      const { data: rows, error } = await q
        .lte('block_time', toIso)
        .order('block_time', { ascending: true })
        .order('log_index', { ascending: true })
        .limit(pageSize);

      if (error) return `批量增量查询失败: ${error.message}`;
      if (!rows || rows.length === 0) break;

      for (const t of rows) {
        const st = stateByAddr.get(String(t.token_address || '').toLowerCase());
        if (!st) continue; // in 限定外的行理论不至（防御）
        const ts = t.block_time;
        const idx = t.log_index ?? 0;
        if (ts < st.wmTs || (ts === st.wmTs && idx <= st.wmIdx)) continue; // 行级幂等跳过
        const cap = st.maxRowForMax || maxRows;
        if (st.rowCount >= cap) continue; // 封顶边界外新行不进统计（=原版页 break）
        st.rowCount++;
        st.wmTs = ts;
        st.wmIdx = idx;
        // truncated 只在未首达 + 3 满页耗尽时成立（rowCount 达 maxRows 即封顶，
        // 后续行由 cap continue 挡——与单候选增量 break 等价）
        if (st.rowCount >= maxRows && !st.firstReachAt) st.truncated = true;
        const price = Number(t.price_bnb);
        const bnbAmount = Number(t.bnb_amount);
        if (!(price > 0) || !(bnbAmount >= MIN_PRICE_UPDATE_BNB)) continue;
        if (st.firstPrice === null || st.firstPrice === undefined) {
          st.firstPrice = price;
          st.firstTickAt = ts;
          st.maxPrice = price;
          continue;
        }
        if (price > st.maxPrice) st.maxPrice = price;
        if (!st.firstReachAt && st.firstPrice > 0
          && price >= this.config.hotMultipleThreshold * st.firstPrice) {
          st.firstReachAt = ts;
          // 首达发生在增量阶段：cap 即时收紧到首达页界（= 全量重查在同数据上的
          // 页 break 点；不收紧会多收首达页界外的行进 max——P3a 遗留缺陷，
          // 由「首达在增量阶段」形状的 bit 对拍抓出）
          st.maxRowForMax = (Math.floor((st.rowCount - 1) / pageSize) + 1) * pageSize;
        }
      }

      if (rows.length < pageSize) break; // 拉尽
      cursorTs = rows[rows.length - 1].block_time; // 续页游标（keyset，同刻行幂等跳过）
      if (page === this.config.aggregateMaxPages - 1) {
        this.logger.warn('[SameNarrativeLeaderService] 批量增量达分页护栏，未拉尽（少算龙头 fail-open）', {
          batch: batchList.length, pages: this.config.aggregateMaxPages,
        });
      }
    }
    for (let i = 0; i < work.length; i++) {
      Object.assign(batchList[i].state, work[i].state); // 无错收尾才写回缓存对象
    }
    return null;
  }

  /**
   * 单候选峰值评估（全量路径）：分页拉 [首达标tick, t] 窗口，running first/max/firstReach。
   * onState 回调（增量缓存开启时）在成功收尾时接走终态供下次增量。
   * @private
   */
  async _evalCandidate(candidate, checkTimeSec, onState) {
    const toIso = new Date(checkTimeSec * 1000).toISOString();
    const threshold = this.config.hotMultipleThreshold;
    try {
      let firstPrice = null;      // 首个达标 tick 的 price_bnb
      let firstTickAt = null;     // 首个达标 tick 的 block_time
      let maxPrice = 0;           // 窗口内峰值（达标门下）
      let firstReachAt = null;    // 首次 price >= threshold*firstPrice 的 block_time
      let firstReachRowIdx = -1;  // 首达行处理序号（增量 max 封顶页界用）
      let truncated = false;
      let rowCount = 0;           // 已处理行数（增量截断语义对齐用）
      let wmTs = null;            // 水位行 block_time（ISO）
      let wmIdx = -1;             // 水位行 log_index

      for (let page = 0; page < this.config.maxTickPages; page++) {
        const off = page * this.config.tickPageSize;
        const { data: ticks, error } = await this.supabase
          .from('wss_price_ticks')
          .select('price_bnb, bnb_amount, block_time')
          .eq('token_address', candidate.address)
          .eq('price_outlier', false)
          .lte('block_time', toIso)
          .order('block_time', { ascending: true })
          .order('log_index', { ascending: true })
          .range(off, off + this.config.tickPageSize - 1);

        if (error) {
          return { success: false, error: `tick 查询失败: ${error.message}` };
        }
        if (!ticks || ticks.length === 0) break;

        for (const t of ticks) {
          rowCount++;
          wmTs = t.block_time;
          wmIdx = t.log_index ?? 0;
          const price = Number(t.price_bnb);
          const bnbAmount = Number(t.bnb_amount);
          // 尘门：与首价同门（price_outlier 服务端 + 金额门客户端）
          if (!(price > 0) || !(bnbAmount >= MIN_PRICE_UPDATE_BNB)) continue;
          if (firstPrice === null) {
            firstPrice = price;
            firstTickAt = t.block_time;
            maxPrice = price;
            continue;
          }
          if (price > maxPrice) maxPrice = price;
          if (!firstReachAt && firstPrice > 0 && price >= threshold * firstPrice) {
            firstReachAt = t.block_time; // 升序流中的首个达标时刻
            firstReachRowIdx = rowCount - 1;
          }
        }

        // 首达后本页扫描完即可提前收工（后续页只影响 maxMultiple 观测精度）
        if (firstReachAt) break;
        if (ticks.length < this.config.tickPageSize) break; // 末页
        if (page === this.config.maxTickPages - 1) truncated = true; // 页上限耗尽仍未首达
      }

      const peakMultiple = (firstPrice !== null && firstPrice > 0) ? maxPrice / firstPrice : 0;
      // inWindow：首达过火门槛 且 判定时刻在首达后 24h 拒绝窗口内
      const inWindow = firstReachAt
        ? (checkTimeSec * 1000 - new Date(firstReachAt).getTime()) <= this.config.rejectWindowSeconds * 1000
        : false;

      if (onState) {
        // max 封顶边界：原版首达后 break 页循环但**本页剩余行已处理**（页内不 break），
        // 即 max 含「首达行所在页（升序前 N×pageSize）」内全部行——重查时新行只要
        // 还在该页内就继续进 max。故封顶边界 = 首达行的下一页界；未首达 = 页上限。
        // hardDone（此后新行永不进统计，inWindow 成纯函数）：rowCount 达封顶边界。
        // 末页短只是「当时无更多行」，后续 check 仍走增量。
        const pageSize = this.config.tickPageSize;
        const maxRowForMax = firstReachAt != null
          ? (Math.floor(firstReachRowIdx / pageSize) + 1) * pageSize
          : this.config.maxTickPages * pageSize;
        const hardDone = rowCount >= maxRowForMax;
        onState({
          lastCheckSec: checkTimeSec,
          wmTs, wmIdx, rowCount,
          firstPrice, firstTickAt, maxPrice, firstReachAt,
          maxRowForMax, truncated, hardDone,
        });
      }

      return {
        success: true,
        firstTickAt,
        firstReachAt,
        peakMultiple,
        inWindow,
        truncated,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 单候选峰值评估（增量路径，2026-10-12 回测性能案）：从 L2 水位行起拉新行，
   * 前缀状态（first/max/firstReach/rowCount）拼接更新。与全量重算 bit-identical：
   *   - first/firstReach 是升序流前缀函数，一旦确定永不变
   *   - max 是 running max，前缀拼接 = 全量重扫
   *   - rowCount 达 maxTickPages×tickPageSize 即 truncated 封顶（=全量 3 满页截断，
   *     此后无论多少新行都不进统计——增量同样停拉）
   *   - 增量窗口 [水位行, t] 从水位行**含**起拉（gte 边界），水位行重复处理幂等
   *    （max 不受重复影响；first/firstReach 已定不再改）
   * checkTime 倒退由路由层拦截（弃缓存全量重算）。
   * @private
   */
  async _evalCandidateIncremental(candidate, state, checkTimeSec) {
    const toIso = new Date(checkTimeSec * 1000).toISOString();
    const threshold = this.config.hotMultipleThreshold;
    const maxRows = this.config.maxTickPages * this.config.tickPageSize;
    try {
      if (state.hardDone) {
        // 首达已定/行数封顶：inWindow 是 checkTimeSec 的纯函数，零查询直出
        const inWindow = state.firstReachAt
          ? (checkTimeSec * 1000 - new Date(state.firstReachAt).getTime()) <= this.config.rejectWindowSeconds * 1000
          : false;
        return {
          success: true,
          firstTickAt: state.firstTickAt,
          firstReachAt: state.firstReachAt,
          peakMultiple: (state.firstPrice > 0) ? state.maxPrice / state.firstPrice : 0,
          inWindow,
          truncated: state.truncated,
        };
      }
      const st = { ...state };   // 不原地改：本次查询失败时缓存保留旧水位
      // max 封顶边界（首达=页界 / 未首达=3 满页）。比较点每行重取 st.maxRowForMax：
      // 首达发生在增量阶段时页界即时收紧（见行内注释）
      for (let page = 0; page < this.config.maxTickPages && st.rowCount < (st.maxRowForMax || maxRows); page++) {
        const off = page * this.config.tickPageSize;
        // wmTs=null（全量时 0 行——候选 tick 全在 checkTime 之后，后续可能出现）：
        // 无水位可 keyset，从头拉（等价全量形状）
        let q = this.supabase
          .from('wss_price_ticks')
          .select('price_bnb, bnb_amount, block_time, log_index')
          .eq('token_address', candidate.address)
          .eq('price_outlier', false);
        if (st.wmTs != null) q = q.gte('block_time', st.wmTs);  // 含水位行（幂等重处理，见头注释）
        const { data: ticks, error } = await q
          .lte('block_time', toIso)
          .order('block_time', { ascending: true })
          .order('log_index', { ascending: true })
          .range(off, off + this.config.tickPageSize - 1);

        if (error) {
          return { success: false, error: `tick 查询失败: ${error.message}` };
        }
        if (!ticks || ticks.length === 0) break;

        for (const t of ticks) {
          const ts = t.block_time;
          const idx = t.log_index ?? 0;
          // 水位行及之前的行已处理过（gte 含边界），幂等跳过
          if (ts < st.wmTs || (ts === st.wmTs && idx <= st.wmIdx)) continue;
          // cap 每行重取：首达发生在增量阶段时 maxRowForMax 即时收紧（见下）
          if (st.rowCount >= (st.maxRowForMax || maxRows)) break; // 封顶边界外新行不进统计（=原版页 break）
          st.rowCount++;
          st.wmTs = ts;
          st.wmIdx = idx;
          // truncated 只在未首达 + 3 满页耗尽时成立（原版首达 break 先于 truncated 赋值）
          if (st.rowCount >= maxRows && !st.firstReachAt) { st.truncated = true; break; }
          const price = Number(t.price_bnb);
          const bnbAmount = Number(t.bnb_amount);
          if (!(price > 0) || !(bnbAmount >= MIN_PRICE_UPDATE_BNB)) continue;
          if (st.firstPrice === null || st.firstPrice === undefined) {
            st.firstPrice = price;
            st.firstTickAt = ts;
            st.maxPrice = price;
            continue;
          }
          if (price > st.maxPrice) st.maxPrice = price;
          if (!st.firstReachAt && st.firstPrice > 0 && price >= threshold * st.firstPrice) {
            st.firstReachAt = ts;
            // 首达发生在增量阶段：cap 即时收紧到首达页界（= 全量重查在同数据上的
            // 页 break 点；不收紧会多收首达页界外的行进 max——P3a 遗留缺陷，
            // 由「首达在增量阶段」形状的 bit 对拍抓出）
            st.maxRowForMax = (Math.floor((st.rowCount - 1) / this.config.tickPageSize) + 1)
              * this.config.tickPageSize;
          }
        }

        // 首达后本批剩余新行继续进 max（原版页内不 break），拉完本批再停
        if (st.rowCount >= (st.maxRowForMax || maxRows)) break;
        if (ticks.length < this.config.tickPageSize) break; // 增量拉尽
      }
      st.lastCheckSec = checkTimeSec;
      if (st.rowCount >= (st.maxRowForMax || maxRows)) st.hardDone = true;
      this._peakCache.set(candidate.address, st);

      const inWindow = st.firstReachAt
        ? (checkTimeSec * 1000 - new Date(st.firstReachAt).getTime()) <= this.config.rejectWindowSeconds * 1000
        : false;
      return {
        success: true,
        firstTickAt: st.firstTickAt,
        firstReachAt: st.firstReachAt,
        peakMultiple: (st.firstPrice > 0) ? st.maxPrice / st.firstPrice : 0,
        inWindow,
        truncated: st.truncated,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 空/失败因子（fail-open：全 0 放行，原因落 detail）
   */
  getEmptyFactors(reason = null) {
    return {
      success: false,
      factors: {
        narrativeLeaderHot: 0,
        narrativeLeaderCount: 0,
        narrativeLeaderMaxMultiple: 0,
      },
      detail: { reason, error: reason },
    };
  }
}

module.exports = { SameNarrativeLeaderService };
