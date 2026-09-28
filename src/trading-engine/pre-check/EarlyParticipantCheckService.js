/**
 * 早期参与者检查服务
 * 获取代币早期交易数据，计算时间标准化的参与者指标
 *
 * 数据源（Phase 7）：wss_price_ticks（ankr WSS 四.meme 内盘成交 tick）
 * - 按代币全市场查询（UNIQUE(tx_hash,log_index) 全网去重，多实验竞速归属不影响读侧）
 * - tick 行映射为 AVE trade 兼容形态（time/tx_id/wallet_address/from_usd/...），
 *   下游 WalletCluster/WalletLabel/TokenHolder 消费方零改动
 * - 与 AVE 时代的行为差异：窗口内确认无 tick 时返回真实空统计（拒绝语义），
 *   不再走"可能已出内盘"的通过值兜底——WSS 订阅覆盖内盘全量成交，
 *   查空只可能是 flush 竞态（单 tick 沉寂场景，本就该拒）或真无成交。
 *
 * 职责：
 * 1. 查询 wss_price_ticks 获取早期交易数据
 * 2. 计算时间窗口标准化的指标
 * 3. 分析增长趋势特征
 */

/**
 * 默认配置
 */
const DEFAULT_CONFIG = {
  fixedWindowSeconds: 90,         // 固定回溯窗口（90秒）
  lowValueThreshold: 10,          // 低价值阈值（USD）
  highValueThreshold: 80,         // 高价值阈值（USD）
  calculateGrowthScore: false,    // 是否计算增长评分
  accelerationSegments: 3,        // 加速度计算分段数（已废弃，保留配置兼容性）
  calculateGrowthMetrics: false,  // 是否计算增长特征（分析显示无效，默认关闭）
  maxTickRows: 2000,              // 单次查询最大 tick 行数（90s 窗口防御上限）
  uniformDustThresholdBnb: 0.01   // 同额度簇因子的尘埃钱包门槛（BNB，低于不参与分簇）
};

class EarlyParticipantCheckService {
  /**
   * @param {Object} logger - Logger实例
   * @param {Object} config - 配置对象
   * @param {Object} supabase - Supabase客户端（可选，用于查询与存储）
   */
  constructor(logger, config = {}, supabase = null) {
    this.logger = logger;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.supabase = supabase;
  }

  /**
   * 设置 Supabase 客户端（延迟注入）
   * @param {Object} supabase - Supabase客户端
   */
  setSupabase(supabase) {
    this.supabase = supabase;
  }

  /**
   * 注入回放 ticks 内存索引（回测专属；TPA setHistoricalTicks 同款形态：
   * 引擎启动期一次性注入、查询侧单点切换；实时/虚拟引擎从不注入 → 零变化）
   *
   * bc4f756e 性能案（2026-09-28）：回测期每触发买信号的早期参与者检查原本现查
   * wss_price_ticks（90s 窗，一 signal 一次 DB 往返），回放数据却已全量在内存。
   * 索引 = Map<token_address, tick[]>（tick 为 BacktestEngine._ticks 元素形状，
   * 桶内须按 (timestamp, log_index) 升序——注入方负责排序）。
   *
   * 口径注记（架构性偏离，与决策数据自洽）：索引只含回放窗内 tick（回测加载时
   * 已滤时间窗），DB 直查可含窗外行——checkTime 距回放窗起点 <90s 时两者有差，
   * 以回放口径为准（窗外 tick 不参与任何决策，本就不该进统计）。token 级桶
   * miss = 窗口内确定无成交（等价 SQL 空结果，走真实空统计拒绝语义）。
   *
   * @param {Map<string, Array<Object>>|null} index - 回放 ticks 索引（null = 摘除，回退 DB 路径）
   */
  setReplayTicksIndex(index) {
    this._replayTicksIndex = index || null;
    this._replayHits = 0;
  }

  /** 回放索引累计命中次数（性能探针，回放收尾汇总用） */
  getReplayHits() {
    return this._replayHits || 0;
  }

  /**
   * 执行早期参与者检查
   * @param {string} tokenAddress - 代币地址（wss_price_ticks 查询键）
   * @param {string} innerPair - 内盘交易对标识（如 0x..._fo，仅用于日志与 early_participant_trades 存档，不参与查询）
   * @param {string} chain - 区块链（仅用于日志与存档，tick 表已按 BSC 全市场组织）
   * @param {number|null} launchAt - 代币创建时间戳（秒）——净流入因子的创建锚定窗口基准（共合案 2026-09-27 起使用）
   * @param {number} checkTime - 当前检查时间戳（秒）（实时=当前墙钟；回测=回放时钟）
   * @param {number} totalSupply - 代币总供应量（可选，用于计算净持仓占比）
   * @param {Object} options - 可选配置
   * @param {boolean} options.useCache - 是否使用数据库缓存（仅回测使用，虚拟/实盘不缓存）
   * @returns {Promise<Object>} 检查结果
   */
  async performCheck(tokenAddress, innerPair, chain, launchAt, checkTime, totalSupply = 0, options = {}) {
    const startTime = Date.now();

    this.logger.info('[EarlyParticipantCheckService] 开始早期参与者检查', {
      token_address: tokenAddress,
      inner_pair: innerPair,
      chain,
      check_time: checkTime
    });

    try {
      // 0. 尝试从数据库缓存获取（仅回测模式，且时间戳差异不超过2秒时复用）
      let trades = null;
      let fromCache = false;
      if (options.useCache) {
        const cachedTrades = await this._loadTradesFromDB(tokenAddress, checkTime, options.sourceExperimentId);
        if (cachedTrades) {
          trades = cachedTrades;
          fromCache = true;
          this.logger.info('[EarlyParticipantCheckService] 复用数据库缓存的交易数据', {
            token_address: tokenAddress,
            trades_count: trades.length,
            cached_check_time: trades._cachedCheckTime
          });
        }
      }

      // 1. 获取交易数据（固定90秒回溯窗口，wss_price_ticks 源）
      if (!trades) {
        trades = await this._fetchEarlyTrades(tokenAddress, checkTime);
      }

      // WSS 源下查空是真实市场状态（窗口内无成交或 flush 竞态），
      // 走正常空统计（全 0 值 → evaluateBuyEligibility 自然拒绝），
      // 不再抛错走"可能已出内盘"的通过值兜底（该语义仅保留给查询异常路径）
      if (!trades || trades.length === 0) {
        this.logger.info('[EarlyParticipantCheckService] 窗口内无成交 tick，返回空统计', {
          token_address: tokenAddress,
          check_time: checkTime,
          window_seconds: this.config.fixedWindowSeconds
        });
        trades = [];
      }

      // 2. 计算实际数据跨度
      const coverage = this._calculateDataCoverage(trades);

      // 3. 计算基础统计
      const basicStats = this._calculateBasicStats(trades);

      // 3.5 净流入因子（对倒拦截，共合案 2026-09-27）
      const netBuy = this._calculateNetBuyRatio(trades, tokenAddress, launchAt, checkTime);

      // 3.6 同额度买入簇因子（sybil 批量钱包拦截，作弊票案 2026-09-27）
      const uniform = this._calculateUniformBuyCluster(trades, tokenAddress, launchAt, checkTime);

      // 4. 计算速率指标（使用实际数据跨度）
      const rateMetrics = this._calculateRateMetrics(basicStats, coverage);

      const result = {
        // 标记已执行检查
        earlyTradesChecked: 1,
        earlyTradesCheckTimestamp: Date.now(),
        earlyTradesCheckDuration: Date.now() - startTime,

        // 基础信息
        earlyTradesCheckTime: checkTime,
        earlyTradesWindow: this.config.fixedWindowSeconds,

        // 数据范围
        earlyTradesExpectedFirstTime: checkTime - this.config.fixedWindowSeconds,
        earlyTradesExpectedLastTime: checkTime,
        earlyTradesDataFirstTime: coverage.dataFirstTime,
        earlyTradesDataLastTime: coverage.dataLastTime,
        earlyTradesDataCoverage: coverage.coverageRatio,
        // 新增：实际数据跨度
        earlyTradesActualSpan: coverage.actualSpan,
        earlyTradesRateCalcWindow: coverage.rateCalculationWindow,

        // 速率指标（使用实际数据跨度计算）
        earlyTradesVolumePerMin: rateMetrics.volumePerMin,
        earlyTradesCountPerMin: rateMetrics.countPerMin,
        earlyTradesWalletsPerMin: rateMetrics.walletsPerMin,
        earlyTradesHighValuePerMin: rateMetrics.highValuePerMin,

        // 绝对值
        earlyTradesTotalCount: basicStats.totalCount,
        earlyTradesVolume: basicStats.totalVolume,
        earlyTradesUniqueWallets: basicStats.uniqueWallets,
        earlyTradesHighValueCount: basicStats.highValueCount,
        earlyTradesFilteredCount: basicStats.filteredCount,

        // 新增因子
        earlyTradesFinalLiquidity: basicStats.earlyTradesFinalLiquidity,
        earlyTradesDrawdownFromHighest: basicStats.earlyTradesDrawdownFromHighest,

        // 净流入因子（对倒拦截）：(Σ买BNB−Σ卖BNB)/Σ买BNB×100，创建锚定口径
        earlyTradesNetBuyRatio: netBuy.ratio,
        earlyTradesNetBuyCovered: netBuy.covered,

        // 同额度买入簇因子（sybil 拦截）：非尘埃买入钱包按金额 toFixed(2) 分簇，
        // 最大簇钱包数占比——批量独立钱包精确等额买入的团伙指纹
        earlyTradesUniformBuyWallets: uniform.wallets,
        earlyTradesUniformBuyClusterN: uniform.clusterN,
        earlyTradesUniformBuyClusterRatio: uniform.ratio,
        earlyTradesUniformBuyCovered: uniform.covered,

        // 窗口内无成交标记（值为真实空统计，非通过值兜底）
        earlyTradesNoInnerData: trades.length === 0 ? 1 : 0,

        // 内部数据（供钱包簇检查复用）
        _trades: trades,

        // 标记数据来源，缓存数据不重复存储（防止级联缓存）
        _fromCache: fromCache
      };

      this.logger.info('[EarlyParticipantCheckService] 早期参与者检查完成', {
        token_address: tokenAddress,
        trades_count: trades.length,
        net_buy_ratio: netBuy.ratio,
        net_buy_covered: netBuy.covered,
        uniform_buy_wallets: uniform.wallets,
        uniform_cluster_ratio: uniform.ratio,
        actual_span: coverage.actualSpan,
        rate_calc_window: coverage.rateCalculationWindow,
        volume_per_min: rateMetrics.volumePerMin.toFixed(2),
        count_per_min: rateMetrics.countPerMin.toFixed(1),
        wallets_per_min: rateMetrics.walletsPerMin.toFixed(1),
        high_value_per_min: rateMetrics.highValuePerMin.toFixed(1),
        duration: result.earlyTradesCheckDuration
      });

      return result;

    } catch (error) {
      const errorMessage = this._safeGetErrorMessage(error);

      this.logger.error('[EarlyParticipantCheckService] 早期参与者检查失败', {
        token_address: tokenAddress,
        error: errorMessage
      });

      // 出错时返回空结果，不影响整体购买流程
      return this._getEmptyResult();
    }
  }

  /**
   * 从数据库缓存加载交易数据
   * 同一代币在相近时间（2秒内）已获取过的数据可直接复用（仅回测模式）
   * @private
   */
  async _loadTradesFromDB(tokenAddress, checkTime, sourceExperimentId = null) {
    if (!this.supabase) return null;

    try {
      const query = this.supabase
        .from('early_participant_trades')
        .select('trades_data, check_time')
        .eq('token_address', tokenAddress)
        .gte('check_time', checkTime - 1)
        .lte('check_time', checkTime + 1);
      const { data, error } = await query
        .order('check_time', { ascending: true })
        .limit(1);

      if (error || !data || data.length === 0) return null;

      const cached = data[0];
      if (!cached.trades_data || cached.trades_data.length === 0) return null;

      // 标记缓存来源的 checkTime，供日志使用
      cached.trades_data._cachedCheckTime = cached.check_time;
      return cached.trades_data;
    } catch (e) {
      return null;
    }
  }

  /**
   * 获取早期交易数据
   * 从 wss_price_ticks 表查 checkTime 前 90s 窗口内的成交 tick（按代币全市场查询，
   * 不按 experiment_id 过滤——tick UNIQUE(tx_hash,log_index) 全网去重竞速归属，读侧语义与市场级一致）
   * 过滤口径与 tick-kline-service 一致：price_usd 非 null + price_outlier=false
   * @private
   */
  async _fetchEarlyTrades(tokenAddress, checkTime) {
    // 回放内存索引优先（回测注入后零 DB 往返；语义逐条对齐下方 SQL：
    // 闭区间 [checkTime-90s, checkTime] / price_outlier=false / price_usd 非空 /
    // (block_time, log_index) 升序 / 过滤后截断 maxTickRows）
    if (this._replayTicksIndex) {
      this._replayHits = (this._replayHits || 0) + 1;
      const rows = this._queryReplayWindow(tokenAddress, checkTime);
      return rows.map(row => this._mapTickRow(row, tokenAddress));
    }

    if (!this.supabase) {
      throw new Error('Supabase 客户端未初始化，无法查询 wss_price_ticks');
    }

    const fromIso = new Date((checkTime - this.config.fixedWindowSeconds) * 1000).toISOString();
    const toIso = new Date(checkTime * 1000).toISOString();

    const { data, error } = await this.supabase
      .from('wss_price_ticks')
      .select('token_address, tx_hash, log_index, trade_type, trader_address, price_usd, bnb_amount, token_amount, block_number, block_time')
      .eq('token_address', tokenAddress)
      .gte('block_time', fromIso)
      .lte('block_time', toIso)
      .eq('price_outlier', false)
      .not('price_usd', 'is', null)
      .order('block_time', { ascending: true })
      .order('log_index', { ascending: true })
      .limit(this.config.maxTickRows);

    if (error) {
      throw new Error(`查询 wss_price_ticks 失败: ${error.message}`);
    }

    const rows = data || [];
    if (rows.length >= this.config.maxTickRows) {
      this.logger.warn('[EarlyParticipantCheckService] tick 行数达到上限已截断，统计基于窗口内最早部分', {
        token_address: tokenAddress,
        max_tick_rows: this.config.maxTickRows,
        window_seconds: this.config.fixedWindowSeconds
      });
    }

    this.logger.info('[EarlyParticipantCheckService] 交易数据获取完成（wss_price_ticks）', {
      token_address: tokenAddress,
      total_trades: rows.length,
      window: `${fromIso} ~ ${toIso}`
    });

    return rows.map(row => this._mapTickRow(row, tokenAddress));
  }

  /**
   * 回放索引窗口查询（语义镜像 _fetchEarlyTrades 的 SQL）
   * 桶按 timestamp 升序 → 二分定位闭区间 [checkTime-90s, checkTime]（毫秒数值
   * 比较与 SQL block_time ISO 字符串比较等价——索引 tick.timestamp 即 DB
   * block_time 经 getTime() 往返所得，毫秒无损）；过滤后截断，产出伪 DB 行
   * （字段形状与 SQL select 列一致，block_time 回填 ISO 串）喂 _mapTickRow
   * ——映射单一代码路径，AVE 兼容形状零漂移。
   * @private
   * @param {string} tokenAddress - 代币地址（桶 key，与 DB 查询同为大小写敏感原样匹配）
   * @param {number} checkTime - 检查时间戳（秒）
   * @returns {Array<Object>} 伪 DB 行数组（可能为空 = 窗口内无成交）
   */
  _queryReplayWindow(tokenAddress, checkTime) {
    const bucket = this._replayTicksIndex.get(tokenAddress);
    if (!bucket || bucket.length === 0) return [];

    const fromMs = (checkTime - this.config.fixedWindowSeconds) * 1000;
    const toMs = checkTime * 1000;
    // lowerBound(fromMs)：首个 timestamp >= fromMs 的下标
    let lo = 0, hi = bucket.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (bucket[mid].timestamp < fromMs) lo = mid + 1; else hi = mid;
    }
    const start = lo;
    // upperBound(toMs)：首个 timestamp > toMs 的下标（闭区间右端）
    lo = start; hi = bucket.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (bucket[mid].timestamp <= toMs) lo = mid + 1; else hi = mid;
    }

    const rows = [];
    for (let i = start; i < lo; i++) {
      const t = bucket[i];
      if (t.price_outlier !== false) continue;          // SQL .eq('price_outlier', false)
      if (t.price_usd === null) continue;               // SQL .not('price_usd', 'is', null)
      if (rows.length >= this.config.maxTickRows) break; // SQL LIMIT（过滤后截断）
      rows.push({
        token_address: t.token_address,
        tx_hash: t.tx_hash,
        log_index: t.log_index,
        trade_type: t.trade_type,
        trader_address: t.trader_address,
        price_usd: t.price_usd,
        bnb_amount: t.bnb_amount,
        token_amount: t.token_amount,
        block_number: t.block_number,
        block_time: new Date(t.timestamp).toISOString(),
      });
    }
    return rows;
  }

  /**
   * WSS tick 行 → AVE trade 兼容形态映射
   * 下游消费方（WalletCluster/WalletLabel/TokenHolder）零改动：
   * - WalletCluster: to_token/to_amount/from_token（买入手数累计）、from_usd、wallet_address
   * - WalletLabel: from_token/from_token_symbol 判 isBuy（BNB 为计价货币方）
   * - TokenHolder: wallet_address/from_address
   * 同时保留 tick 原始字段（trade_type/price_usd/bnb_amount/token_amount），随 trades_data 落 early_participant_trades
   * @private
   */
  _mapTickRow(row, tokenAddress) {
    const isBuy = row.trade_type === 'buy';
    const priceUsd = parseFloat(row.price_usd) || 0;
    const tokenAmount = parseFloat(row.token_amount) || 0;
    const bnbAmount = parseFloat(row.bnb_amount) || 0;
    const usdVolume = priceUsd * tokenAmount;
    // BSC WBNB（four.meme 内盘计价货币）
    const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';

    return {
      // AVE trade 兼容形态
      time: Math.floor(new Date(row.block_time).getTime() / 1000),
      tx_id: `${row.tx_hash}-${row.log_index}`,
      wallet_address: row.trader_address,
      from_address: row.trader_address,
      from_usd: usdVolume,
      to_usd: usdVolume,
      to_token_price_usd: priceUsd,
      from_token_price_usd: priceUsd,
      pair_liquidity_usd: null,
      to_token: isBuy ? tokenAddress : WBNB,
      from_token: isBuy ? WBNB : tokenAddress,
      to_amount: isBuy ? tokenAmount : bnbAmount,
      from_token_symbol: isBuy ? 'BNB' : 'TOKEN',
      block_number: row.block_number,

      // WSS tick 原始字段（裸数据留存）
      trade_type: row.trade_type,
      price_usd: priceUsd,
      bnb_amount: bnbAmount,
      token_amount: tokenAmount
    };
  }

  /**
   * 计算数据覆盖度和实际数据跨度
   * @private
   */
  _calculateDataCoverage(trades) {
    if (!trades || trades.length === 0) {
      return {
        dataFirstTime: null,
        dataLastTime: null,
        coverageRatio: 0,
        actualSpan: 0,
        rateCalculationWindow: 1  // 最小窗口，避免除以0
      };
    }

    const dataFirstTime = trades[0].time;
    const dataLastTime = trades[trades.length - 1].time;
    const actualSpan = dataLastTime - dataFirstTime;

    // 边界情况：只有1笔交易时，actualSpan = 0
    // 使用最小窗口1秒避免除以0
    const rateCalculationWindow = actualSpan > 0 ? actualSpan : 1;

    return {
      dataFirstTime,
      dataLastTime,
      coverageRatio: 1,  // 数据已获取，覆盖度总是1
      actualSpan: parseFloat(actualSpan.toFixed(1)),
      rateCalculationWindow: parseFloat(rateCalculationWindow.toFixed(1))
    };
  }

  /**
   * 计算基础统计
   * @private
   */
  _calculateBasicStats(trades) {
    let totalVolume = 0;
    let filteredCount = 0;
    let highValueCount = 0;
    const uniqueWallets = new Set();

    // 新增：用于计算价格相关因子
    let highestPrice = 0;
    let finalPrice = 0;  // 窗口结束时价格（最后有效价格）
    let finalLiquidity = null;

    trades.forEach(t => {
      const value = t.from_usd || t.to_usd || 0;
      totalVolume += value;

      // 使用 wallet_address（真实用户地址），而非 from_address（可能是路由合约）
      const participant = t.wallet_address || t.from_address;
      if (participant) uniqueWallets.add(participant.toLowerCase());

      if (value >= this.config.lowValueThreshold) filteredCount++;
      if (value >= this.config.highValueThreshold) highValueCount++;

      // 计算价格相关因子
      const toTokenPrice = t.to_token_price_usd || 0;
      const fromTokenPrice = t.from_token_price_usd || 0;

      // 代币价格通常是较小的值（如 8.4e-6），而 WBNB 价格较大（如 670）
      // 通过判断哪个价格小于 1 来确定代币价格
      let price = 0;
      if (toTokenPrice > 0 && toTokenPrice < 1) {
        price = toTokenPrice;
      } else if (fromTokenPrice > 0 && fromTokenPrice < 1) {
        price = fromTokenPrice;
      }

      if (price > 0) {
        if (price > highestPrice) highestPrice = price;
        finalPrice = price;  // 更新最后价格
      }

      // 记录最后一笔交易的流动性
      finalLiquidity = t.pair_liquidity_usd || null;
    });

    // 计算从最高价的跌幅（百分比）
    // 使用窗口结束时的价格（最后价格）vs 最高价，而不是最低价 vs 最高价
    // 这样可以反映购买时刻从历史最高点的实际回撤情况
    let drawdownFromHighest = 0;
    if (highestPrice > 0 && finalPrice > 0) {
      drawdownFromHighest = ((finalPrice - highestPrice) / highestPrice) * 100;
    }

    return {
      totalCount: trades.length,
      totalVolume: parseFloat(totalVolume.toFixed(2)),
      uniqueWallets: uniqueWallets.size,
      filteredCount,
      highValueCount,
      // 新增因子
      earlyTradesFinalLiquidity: finalLiquidity,
      earlyTradesDrawdownFromHighest: parseFloat(drawdownFromHighest.toFixed(2))
    };
  }

  /**
   * 计算窗口净买入占比（对倒拦截因子，共合案 2026-09-27）
   *
   * 口径：(Σ买入BNB − Σ卖出BNB) / Σ买入BNB × 100 —— 对倒盘自买自卖近似等量对冲，
   * 净流入趋近 0；真实抢筹盘买入显著大于卖出。校准（阈值 40，90s 窗）：对倒盘
   * 全 ≤39.8（共合二轮 39.8/孔子AI 36.8/跳舞蛙 39.1），赢家全 ≥58.6。
   *
   * 窗口语义（关键）：仅当 checkTime 距创建 ≤90s（查询窗 [checkTime-90s, checkTime]
   * 覆盖创建时点，trades 即"创建以来全量"）时才与校准口径一致；age>90s 时滚动窗
   * 不含创建段（初期抢筹密集段丢失，净流入被系统性低估——龙布布 fire@103s 实测
   * 滚动窗 34.6% 会被误杀），launchAt 缺失同样无法锚定——两种情况都给通过值 100
   * 放行（fail-open 宁漏拦不误杀，covered=0 标记口径未覆盖供复盘分辨）。
   * 极早 fire（<15s）窗口内 washers 先买后卖净流入虚高（共合 R1@6.6s=63.7% 放行）
   * ——该场景由 holders>5 门拦截（共合 R1 holders=3），本因子只负责二轮/晚 fire。
   * @private
   * @param {Array} trades - _mapTickRow 映射后的窗口交易（尘门已在查询侧过滤）
   * @param {string} tokenAddress - 代币地址
   * @param {number|null} launchAt - 代币创建时间（秒，TokenCreate 块时间）
   * @param {number} checkTime - 检查时间戳（秒）
   * @returns {{ratio: number, covered: number}}
   */
  _calculateNetBuyRatio(trades, tokenAddress, launchAt, checkTime) {
    const validLaunchAt = Number.isFinite(launchAt) && launchAt > 0 ? launchAt : null;
    const covered = validLaunchAt !== null
      && (checkTime - validLaunchAt) <= this.config.fixedWindowSeconds ? 1 : 0;
    if (!covered) {
      return { ratio: 100, covered: 0 };
    }

    let totalBuyBnb = 0;
    let totalSellBnb = 0;
    const tokenLower = String(tokenAddress).toLowerCase();
    for (const t of trades) {
      const amount = t.bnb_amount || 0;
      if (String(t.to_token || '').toLowerCase() === tokenLower) {
        totalBuyBnb += amount;
      } else {
        totalSellBnb += amount;
      }
    }
    if (totalBuyBnb <= 0) {
      // 窗口内无买入（全卖盘流出）：净流入语义取 -100
      return { ratio: totalSellBnb > 0 ? -100 : 0, covered: 1 };
    }
    const ratio = (totalBuyBnb - totalSellBnb) / totalBuyBnb * 100;
    return { ratio: parseFloat(ratio.toFixed(2)), covered: 1 };
  }

  /**
   * 计算同额度买入簇因子（sybil 批量钱包拦截，作弊票案 2026-09-27）
   *
   * 口径：窗口内买入钱包（同一钱包多笔合并）累计 BNB，过滤 <0.01 尘埃后按金额
   * toFixed(2) 分簇，最大簇钱包数 / 非尘埃钱包数 ×100。手法指纹：批量独立钱包
   * 各精确等额买入（0x0e27 案 17 钱包含 0.10×10；0xd8e8 案 14 钱包含 0.12×10）
   * ——链上固定额度下单（amountInExact）无 wei 级滑点离散，簇内金额实测完全相等，
   * 该团伙伪造 holders/多样性/集中度全绿，但同额度比例天然盘不可能出现。
   *
   * 校准（26 样本，90s 创建锚定窗 + 尘埃过滤后）：两张作弊票 58.8%/71.4%
   * （modeN 均 10），赢家全 ≤20.6%、lose 全 ≤30%、共合 25%（8 钱包被 wallets 门
   * 豁免）。拦截门：`wallets >= 10 AND ratio >= 50`——小样本票（bitget被盗 3 钱包、
   * SpaceXAI 6）被 wallets≥10 豁免，天然 bot 整数额（JIBE 0.20×3=20%、
   * BNBMART 0.07×6=20%）远低于门。fire@85s 截断口径实测与全窗一致（簇在 85s 内
   * 已全部完成）。
   *
   * 窗口语义（与净流入因子同构）：仅 age≤90s（查询窗覆盖创建时点）时有效；
   * age>90s 或 launchAt 缺失 → 全 0 放行（fail-open 宁漏拦不误杀，covered=0 标记）
   * ——注意放行值是 0 不是 9999：拦截门是"达到阈值触发"，9999 会误触发。
   *
   * 已知接受面：真有 ≥10 个 bot 同精确额度买入的健康票会误拦——校准集不存在
   * 此结构，且该结构本身即协同买入信号，风险接受。
   * @private
   * @param {Array} trades - _mapTickRow 映射后的窗口交易（尘门已在查询侧过滤）
   * @param {string} tokenAddress - 代币地址
   * @param {number|null} launchAt - 代币创建时间（秒，TokenCreate 块时间）
   * @param {number} checkTime - 检查时间戳（秒）
   * @returns {{wallets: number, clusterN: number, ratio: number, covered: number}}
   */
  _calculateUniformBuyCluster(trades, tokenAddress, launchAt, checkTime) {
    const validLaunchAt = Number.isFinite(launchAt) && launchAt > 0 ? launchAt : null;
    const covered = validLaunchAt !== null
      && (checkTime - validLaunchAt) <= this.config.fixedWindowSeconds ? 1 : 0;
    if (!covered) {
      return { wallets: 0, clusterN: 0, ratio: 0, covered: 0 };
    }

    // 买入钱包累计 BNB（卖单不计；同一钱包多笔合并——簇钱包通常单笔，合并口径更稳）
    const buyByWallet = new Map();
    const tokenLower = String(tokenAddress).toLowerCase();
    for (const t of trades) {
      if (String(t.to_token || '').toLowerCase() !== tokenLower) continue;
      const wallet = t.wallet_address || t.from_address;
      if (!wallet) continue;
      const key = wallet.toLowerCase();
      buyByWallet.set(key, (buyByWallet.get(key) || 0) + (t.bnb_amount || 0));
    }

    // 尘埃过滤：微量买入（<0.01 BNB）不构成簇信号，只稀释分母
    const amounts = [...buyByWallet.values()]
      .filter(a => a >= this.config.uniformDustThresholdBnb);
    const wallets = amounts.length;
    if (wallets < 3) {
      return { wallets, clusterN: 0, ratio: 0, covered: 1 };
    }

    // 同额度分簇：toFixed(2) 分桶（固定额度买入簇内金额精确相等，2 位小数粒度可靠）
    const buckets = new Map();
    for (const a of amounts) {
      const k = a.toFixed(2);
      buckets.set(k, (buckets.get(k) || 0) + 1);
    }
    const clusterN = Math.max(...buckets.values());
    const ratio = clusterN / wallets * 100;
    return { wallets, clusterN, ratio: parseFloat(ratio.toFixed(1)), covered: 1 };
  }

  /**
   * 计算速率指标（使用实际数据跨度）
   * @private
   */
  _calculateRateMetrics(basicStats, coverage) {
    // 使用实际数据跨度计算速率（单位：分钟）
    const windowMinutes = coverage.rateCalculationWindow / 60;

    if (windowMinutes <= 0) {
      return {
        volumePerMin: 0,
        countPerMin: 0,
        walletsPerMin: 0,
        highValuePerMin: 0
      };
    }

    return {
      volumePerMin: parseFloat((basicStats.totalVolume / windowMinutes).toFixed(2)),
      countPerMin: parseFloat((basicStats.totalCount / windowMinutes).toFixed(1)),
      walletsPerMin: parseFloat((basicStats.uniqueWallets / windowMinutes).toFixed(1)),
      highValuePerMin: parseFloat((basicStats.highValueCount / windowMinutes).toFixed(1))
    };
  }

  /**
   * 获取空结果（未获取到交易数据时）
   * @private
   */
  _getEmptyResult() {
    const checkTime = Math.floor(Date.now() / 1000);

    return {
      earlyTradesChecked: 1,
      earlyTradesCheckTimestamp: Date.now(),
      earlyTradesCheckDuration: 0,

      earlyTradesCheckTime: checkTime,
      earlyTradesWindow: this.config.fixedWindowSeconds,

      earlyTradesExpectedFirstTime: checkTime - this.config.fixedWindowSeconds,
      earlyTradesExpectedLastTime: checkTime,
      earlyTradesDataFirstTime: null,
      earlyTradesDataLastTime: null,
      earlyTradesDataCoverage: 0,
      earlyTradesActualSpan: 9999,
      earlyTradesRateCalcWindow: 1,

      // 内盘无数据时给通过值（可能已出内盘），Ratio 类保持 0 自然通过
      earlyTradesVolumePerMin: 9999,
      earlyTradesCountPerMin: 100,
      earlyTradesWalletsPerMin: 9999,
      earlyTradesHighValuePerMin: 9999,

      earlyTradesTotalCount: 9999,
      earlyTradesVolume: 9999,
      earlyTradesUniqueWallets: 9999,
      earlyTradesHighValueCount: 9999,
      earlyTradesFilteredCount: 9999,

      // 新增因子
      earlyTradesFinalLiquidity: 9999,
      earlyTradesDrawdownFromHighest: 0,

      // 净流入因子：查询异常通过值（与 9999 族同方向，covered=0 标记）
      earlyTradesNetBuyRatio: 100,
      earlyTradesNetBuyCovered: 0,

      // 同额度簇因子：查询异常 0 值放行（拦截门 wallets>=10 不触发；
      // 9999 会误触发拦截，与净流入因子的高值放行方向相反）
      earlyTradesUniformBuyWallets: 0,
      earlyTradesUniformBuyClusterN: 0,
      earlyTradesUniformBuyClusterRatio: 0,
      earlyTradesUniformBuyCovered: 0,

      // 标记内盘无交易数据（可能已出内盘）
      earlyTradesNoInnerData: 1,

      // 内部数据（供钱包簇检查复用）
      _trades: []
    };
  }

  /**
   * 获取未执行检查时的默认因子值
   * @returns {Object} 默认因子值
   */
  getEmptyFactorValues() {
    return {
      earlyTradesChecked: 0,
      earlyTradesCheckTimestamp: null,
      earlyTradesCheckDuration: null,

      earlyTradesCheckTime: null,
      earlyTradesWindow: null,

      earlyTradesExpectedFirstTime: null,
      earlyTradesExpectedLastTime: null,
      earlyTradesDataFirstTime: null,
      earlyTradesDataLastTime: null,
      earlyTradesDataCoverage: 0,

      earlyTradesVolumePerMin: 0,
      earlyTradesCountPerMin: 0,
      earlyTradesWalletsPerMin: 0,
      earlyTradesHighValuePerMin: 0,

      earlyTradesTotalCount: 0,
      earlyTradesVolume: 0,
      earlyTradesUniqueWallets: 0,
      earlyTradesHighValueCount: 0,
      earlyTradesFilteredCount: 0,

      // 新增因子
      earlyTradesFinalLiquidity: null,
      earlyTradesDrawdownFromHighest: null,

      // 净流入因子（对倒拦截）：未执行检查时 null（条件表达式不引用即无影响）
      earlyTradesNetBuyRatio: null,
      earlyTradesNetBuyCovered: 0,

      // 同额度簇因子（sybil 拦截）：未执行检查 0 值——null 会让 `<10` 放行写法
      // 恒 false 误拦，0 对「触发拦截门」和「放行写法」双向安全
      earlyTradesUniformBuyWallets: 0,
      earlyTradesUniformBuyClusterN: 0,
      earlyTradesUniformBuyClusterRatio: 0,
      earlyTradesUniformBuyCovered: 0,

      // 内盘无数据标记
      earlyTradesNoInnerData: 0,

      // 内部数据（供钱包簇检查复用）
      _trades: []
    };
  }

  /**
   * 计算钱包累积集中度因子
   * 从早期交易数据中统计每个钱包的买入金额和代币数量，计算集中度指标
   * @param {Array} trades - 交易数据
   * @param {string} tokenAddress - 目标代币地址
   * @param {number} totalSupply - 代币总供应量（0 表示未提供，使用总买入代币数兜底）
   * @returns {Object} 集中度因子
   */
  /**
   * 评估早期参与者数据是否满足购买条件
   *
   * 策略B：高召回率+多因子稳定性
   * 基于全因子分析（102个样本）
   *
   * 核心条件：
   * - highValueCount >= 8     (高价值交易数, AUC: 83.0%)
   * - highValuePerMin >= 5.6  (高价值/分, AUC: 78.5%)
   * - countPerMin >= 10.6     (交易次数/分, AUC: 78.7%)
   *
   * 性能指标：
   * - F1: 0.64
   * - 精确率: 55.6%
   * - 召回率: 75%
   * - 通过率: 26.5%
   *
   * @param {Object} checkResult - performCheck 返回的结果
   * @param {Object} strategyConfig - 策略配置
   * @returns {Object} { canBuy: boolean, reason: string, details: Object }
   */
  evaluateBuyEligibility(checkResult, strategyConfig) {
    if (!checkResult || checkResult.earlyTradesChecked !== 1) {
      // 数据获取失败时，拒绝交易
      return {
        canBuy: false,
        reason: '早期参与者数据未获取到，拒绝交易',
        details: null
      };
    }

    const config = strategyConfig?.earlyParticipants || {};

    // 基于分析的阈值（策略B）
    const highValueCountThreshold = config.highValueCountThreshold ?? 8;
    const highValuePerMinThreshold = config.highValuePerMinThreshold ?? 5.6;
    const countPerMinThreshold = config.countPerMinThreshold ?? 10.6;

    // 检查三个核心条件
    const highValueCountOk = (checkResult.earlyTradesHighValueCount || 0) >= highValueCountThreshold;
    const highValuePerMinOk = (checkResult.earlyTradesHighValuePerMin || 0) >= highValuePerMinThreshold;
    const countPerMinOk = (checkResult.earlyTradesCountPerMin || 0) >= countPerMinThreshold;

    const canBuy = highValueCountOk && highValuePerMinOk && countPerMinOk;

    // 构建失败原因
    const reasons = [];
    if (!highValueCountOk) reasons.push(`高价值交易数(${checkResult.earlyTradesHighValueCount || 0}) < ${highValueCountThreshold}`);
    if (!highValuePerMinOk) reasons.push(`高价值/分(${(checkResult.earlyTradesHighValuePerMin || 0).toFixed(1)}) < ${highValuePerMinThreshold}`);
    if (!countPerMinOk) reasons.push(`交易次数/分(${(checkResult.earlyTradesCountPerMin || 0).toFixed(1)}) < ${countPerMinThreshold}`);

    // 构建通过原因
    const passInfos = [
      `高价值交易数:${checkResult.earlyTradesHighValueCount || 0}`,
      `高价值/分:${(checkResult.earlyTradesHighValuePerMin || 0).toFixed(1)}`,
      `交易次数/分:${(checkResult.earlyTradesCountPerMin || 0).toFixed(1)}`
    ];

    return {
      canBuy,
      reason: canBuy
        ? `早期参与者检查通过 (${passInfos.join(', ')})`
        : `早期参与者检查失败: ${reasons.join(', ')}`,
      details: {
        highValueCountOk,
        highValuePerMinOk,
        countPerMinOk,
        highValueCount: checkResult.earlyTradesHighValueCount || 0,
        highValuePerMin: checkResult.earlyTradesHighValuePerMin || 0,
        countPerMin: checkResult.earlyTradesCountPerMin || 0,
        // 额外信息
        totalCount: checkResult.earlyTradesTotalCount || 0,
        uniqueWallets: checkResult.earlyTradesUniqueWallets || 0,
        volumePerMin: checkResult.earlyTradesVolumePerMin || 0
      }
    };
  }

  /**
   * 存储早期交易者数据（裸数据）
   * @param {string} tokenAddress - 代币地址
   * @param {string} signalId - 信号ID
   * @param {string} experimentId - 实验ID
   * @param {string} innerPair - 内盘交易对
   * @param {string} chain - 区块链
   * @param {Array} tradesData - 原始交易数据（_trades字段）
   * @param {number} checkTime - 检查时间戳（秒）
   * @returns {Promise<boolean>} 是否存储成功
   */
  async storeEarlyParticipantTrades(tokenAddress, signalId, experimentId, innerPair, chain, tradesData, checkTime) {
    if (!this.supabase) {
      this.logger.warn('[EarlyParticipantCheckService] Supabase 客户端未初始化，跳过存储早期交易数据');
      return false;
    }

    if (!signalId) {
      this.logger.warn('[EarlyParticipantCheckService] signalId 为空，跳过存储早期交易数据');
      return false;
    }

    if (!tradesData || tradesData.length === 0) {
      this.logger.debug('[EarlyParticipantCheckService] 早期交易数据为空，跳过存储');
      return false;
    }

    try {
      const { error } = await this.supabase
        .from('early_participant_trades')
        .insert({
          signal_id: signalId,
          token_address: tokenAddress,
          experiment_id: experimentId,
          chain: chain,
          trades_data: tradesData,    // 裸数据，不做任何处理
          inner_pair: innerPair,
          check_time: checkTime,
          window_seconds: this.config.fixedWindowSeconds
        });

      if (error) {
        this.logger.error('[EarlyParticipantCheckService] 存储早期交易数据失败', {
          token_address: tokenAddress,
          signal_id: signalId,
          error: error.message,
          details: error.hint || error.details || error.code
        });
        return false;
      }

      this.logger.info('[EarlyParticipantCheckService] 早期交易数据存储成功', {
        token_address: tokenAddress,
        signal_id: signalId,
        trades_count: tradesData.length
      });

      return true;
    } catch (error) {
      const errorMessage = this._safeGetErrorMessage(error);
      this.logger.error('[EarlyParticipantCheckService] 存储早期交易数据异常', {
        token_address: tokenAddress,
        signal_id: signalId,
        error: errorMessage
      });
      return false;
    }
  }

  /**
   * 安全地获取错误消息
   * @private
   */
  _safeGetErrorMessage(error) {
    if (!error) return '未知错误';
    if (typeof error === 'string') return error;
    if (error.message) return error.message;
    if (error.error) return error.error;
    return String(error);
  }
}

module.exports = { EarlyParticipantCheckService };
