/**
 * BacktestEngine（wss_price_ticks tick 回放版，Phase 4 重写）
 *
 * 数据源：源实验的 wss_price_ticks（全网 tick 留存，按 experiment_id 归属）
 *        + experiment_tokens（代币元数据：created_at / totalSupply / creator）。
 * 回放管线与实时 FourMemeWssTradingEngine 共享同一套组件与语义：
 *   FourMemeFactorAggregator.processTick（因子增量）→ StrategyEngine 分腿评估
 *   （actionFilter）→ PreBuyCheckService → PortfolioManager 虚拟记账 →
 *   TokenPool 状态推进 → TickDebouncer 买评估去抖（virtual 虚拟时钟模式）。
 *
 * 时钟：全程虚拟时钟（tick.block_time 驱动）。debounce 触发、信号/交易时间戳、
 * 持仓时长、组合快照节奏均以回放时点计算，与实时引擎在同一数据上的决策对齐
 * （parity：同 tick 同因子同策略，差异仅剩 debounce 触发边界的采样粒度）。
 *
 * 产物：strategy_signals / trades / experiment_tokens / portfolio_snapshots，
 *       终态 completed（失败 failed）。不写 experiment_time_series_data
 *       （回测从 tick 重算因子，时序表是实时引擎的 30s 快照产物）。
 *
 * 与旧回测引擎（experiment_time_series_data 轮次回放）的差异：
 *   - 数据源换为 tick 级（AVE 时代旧实验的时序数据不再是回测源，历史行不删）
 *   - 叙事评级直调（同实时引擎 narrativeCallCondition）：analyze 用当前语料分析
 *     历史 token（时序穿越），绝对收益不代表当时实时可得，结论看相对增量
 */

const { TradingMode, EngineStatus } = require('../interfaces/ITradingEngine');
const { AbstractTradingEngine } = require('../core/AbstractTradingEngine');
const { ExperimentDataService } = require('../../web/services/ExperimentDataService');
const Logger = require('../../services/logger');
const Decimal = require('decimal.js');

const baseConfig = require('../../../config/default.json');

const TICK_PAGE_SIZE = 500;       // 分页读取页大小（必须 < Supabase 默认 max rows 1000，
                                  // 否则响应被服务端截断、终止条件误判数据到尾）
const MAX_TICK_PAGES = 2000;      // 分页保护上限（全局累计 100 万 tick）
const TOKEN_CHUNK_SIZE = 100;     // .in('token_address') 地址批量护栏（PostgREST URL 长度）
const SNAPSHOT_INTERVAL_MS = 30 * 1000; // 组合快照虚拟时间桶（对齐实时引擎 30s）

class BacktestEngine extends AbstractTradingEngine {
  constructor(options = {}) {
    super({
      id: `backtest_${Date.now()}`,
      name: 'Fourmeme Backtest Engine (tick replay)',
      mode: TradingMode.BACKTEST,
      blockchain: 'bsc',
      ...options
    });

    this._sourceExperimentId = null;
    this._ticks = [];
    this._tokenMeta = new Map();        // tokenAddress → { symbol, name, createdAtSec, totalSupply, creator }
    this._seenTokens = new Set();       // 已落库 experiment_tokens 的 tokenAddress
    this._buyingTokens = new Set();     // 买路径执行中防重入
    this._sellingTokens = new Set();    // 卖路径执行中防重入
    this._tokenBlacklist = new Map();   // 永久阻断
    this._lastSnapshotTs = null;        // 上一个组合快照的虚拟时刻
    this._inflightEvals = new Set();    // 回放中 fire-and-forget 的评估 promise（买评估/卖去抖 fire；drain 用）
    this._finalStatusSet = false;       // 回放终态已写（stop 保护用）

    // pumpfun 回迁批 2 闩锁 + 卖出确认去抖（token 级降维，语义同实时引擎）
    this._tokenLocks = new Set();       // 止损闩锁：lockTokenAfterSell 卖腿成交 → 该 token 永久禁买
    this._cumLossTotals = new Map();    // token → 已平仓轮 profitPercent 累计（盈亏同记）
    this._cumLossLockPct = null;        // 累亏闩锁阈值（卖腿 cumulativeLossLockPct 多腿取最严；null=未配置）
    this._sellDebounceMs = 0;           // 卖出确认去抖窗口（_initializeDataSources 按 wsConfig 重读）
    // E5 多卖腿轮账本：tokenAddress → { buyUsd, sellUsdGross, buyTime, legCount }（记账货币 USD，
    // 与 trades 表同口径）。买入成功登记，每卖腿累计（含回放结束强平腿）；全清时
    // addCompletedPair 一次记整轮 pnl=Σ卖-买
    this._roundLedger = new Map();
    // 卡牌仓位（迁自 rich-js）：addr → 该 token 当前卡数。机制关闭时恒空 Map（零开销）；
    // 买/卖腿只在 positionManagement.perCardBNB 启用时读写（详见 _initializeDataSources）
    this._tokenCards = new Map();
    this._perCardBNB = null;
    this._cardsEnabled = false;

    this.initialBalance = 100;
    this._tradeAmount = 0.1;
    this._permanentBlockCondition = null;

    this.metrics = {
      totalTrades: 0,
      successfulTrades: 0,
      failedTrades: 0,
      totalSignals: 0,
      executedSignals: 0,
      processedDataPoints: 0,
      debounceFired: 0,
      debounceSuppressed: 0,
    };

    this.dataService = new ExperimentDataService();
    this.logger = new Logger({ dir: './logs', experimentId: null });
  }

  // ==================== 抽象方法实现 ====================

  async _updateComponentLoggers() {
    this.logger.setExperimentId(this._experimentId);
  }

  /**
   * 重写：backtest.initialBalance 必须在 base 创建 portfolio（_initializeComponents
   * 内）之前生效——base 用 this.initialBalance 建组合，配置若在 _initializeDataSources
   * 才读则为时已晚（旧回测引擎的既有缺陷，此处修正）。
   */
  async _initializeComponents() {
    const btConfig = this._experiment?.config?.backtest || {};
    if (btConfig.initialBalance) {
      this.initialBalance = btConfig.initialBalance;
    }
    await super._initializeComponents();
  }

  async _initializeDataSources() {
    // 1. 回测配置
    const backtestConfig = this._experiment.config?.backtest || {};
    this._sourceExperimentId = backtestConfig.sourceExperimentId;
    if (!this._sourceExperimentId) {
      throw new Error('回测实验缺少源实验ID配置 (config.backtest.sourceExperimentId)');
    }
    this._startTimeFilter = backtestConfig.startTime ? new Date(backtestConfig.startTime).getTime() : null;
    this._endTimeFilter = backtestConfig.endTime ? new Date(backtestConfig.endTime).getTime() : null;

    const { ExperimentFactory } = require('../factories/ExperimentFactory');
    const sourceExp = await ExperimentFactory.getInstance().load(this._sourceExperimentId);
    if (!sourceExp) {
      throw new Error(`源实验不存在: ${this._sourceExperimentId}`);
    }
    this.logger.info(this._experimentId, 'BacktestEngine',
      `📊 回测配置: 源实验=${this._sourceExperimentId}, 初始余额=${this.initialBalance}` +
      (this._startTimeFilter ? `, 起点=${new Date(this._startTimeFilter).toISOString()}` : '') +
      (this._endTimeFilter ? `, 终点=${new Date(this._endTimeFilter).toISOString()}` : ''));

    // 2. 代币池（FA 自带趋势序列，无需历史缓存）
    const TokenPool = require('../../core/token-pool');
    this._tokenPool = new TokenPool(this.logger);

    // 3. 因子聚合器（回放不挂 factorsUpdated 事件，轮询 processTick 返回值）
    // 平台由回测实验 config.platform 声明（决定 wsConfig 段；FA 键名固定 fourmemeWs）；
    // 代币级 platform 以源实验 experiment_tokens.platform 为权威（_registerToken 处覆盖）
    const FourMemeFactorAggregator = require('../../services/FourMemeFactorAggregator');
    const { resolvePlatforms } = require('../core/platforms');
    this._platform = this._experiment?.config?.platform || 'fourmeme';
    // 平台集合（'both' → 双平台并集）：ticks .in 过滤 + token 级 fallback 用；
    // wsSection 选择仍用标量（'both' → fourmemeWs，与实时双平台引擎口径一致）
    this._platforms = resolvePlatforms(this._platform);
    this.logger.info(this._experimentId, 'BacktestEngine', `回放平台口径 | platforms=${this._platforms.join(',')}`);
    const wsSection = this._platform === 'flap' ? 'flapWs' : 'fourmemeWs';
    const wsConfig = {
      ...(baseConfig[wsSection] || {}),
      ...(this._experiment?.config?.[wsSection] || {}),
    };
    this._factorAggregator = new FourMemeFactorAggregator({ fourmemeWs: wsConfig }, this.logger);
    // 市场 regime 截面 feed 显式 opt-in（回迁批 2.6 观察版：与 WSS 引擎同入口同截面口径，
    // 回放 tick ts 自动成为决策时钟；回测不落表（不污染观察史）。红线同 WSS 引擎：condition 不引用 market*）
    FourMemeFactorAggregator.setMarketFeedEnabled(true);

    // 名单因子名单加载（回迁批 3.3）：与 WSS 引擎同入口同名单（回测/live 因子同构 parity）。
    // 两加载均 fail-open+warn：smartBotCount 恒 0 / sniperHolderShare 恒 null（fail-closed 门不放行），
    // 后果方向在因子层已定。⚠母版此处 sniper 是 fail-fast（A/B B 臂引用该键，静默 null 的空统计
    // 比死 run 更糟）；richer-js 无 A/B 装置且新键无存量策略引用，统一 fail-open 偏离存案。
    try {
      await FourMemeFactorAggregator.loadSmartBotWallets(this._getClient(),
        (wsConfig.factorParams || {}).smartBotCategory);
    } catch (e) {
      this.logger.warn(this._experimentId, 'BacktestEngine', `smart_bot 名单加载失败(fail-open): ${e.message}`);
    }
    try {
      await FourMemeFactorAggregator.loadSniperWallets(this._getClient());
    } catch (e) {
      this.logger.warn(this._experimentId, 'BacktestEngine', `sniper 名单加载失败(fail-open, sniperHolderShare 将恒 null): ${e.message}`);
    }

    // 4. 策略引擎（buy/sell 扁平化，与实时引擎同构；分腿评估语义）
    const { StrategyEngine } = require('../../strategies/StrategyEngine');
    const strategiesConfig = this._buildStrategyConfig();
    this._strategyEngine = new StrategyEngine({ strategies: strategiesConfig });

    const { getAvailableFactorIds } = require('../core/FactorBuilder');
    const availableFactorIds = getAvailableFactorIds();

    const strategyArray = [];
    for (const [kind, list] of [['buy', strategiesConfig.buyStrategies], ['sell', strategiesConfig.sellStrategies]]) {
      if (!Array.isArray(list)) continue;
      list.forEach((s, idx) => {
        strategyArray.push({
          id: `${kind}_${idx}_${s.priority || 0}`,
          name: `${kind === 'buy' ? '买入' : '卖出'}策略 P${s.priority || 0}`,
          description: s.description || '',
          action: kind,
          condition: s.condition,
          priority: s.priority || 0,
          maxExecutions: s.maxExecutions || null,
          preBuyCheckCondition: s.preBuyCheckCondition || null,
          repeatBuyCheckCondition: s.repeatBuyCheckCondition || null,
          narrativeCallCondition: s.narrativeCallCondition || null,
          // pumpfun 回迁批 2 卖腿机制字段（卖腿消费；买腿携带不生效，与 preBuy* 字段对称）
          bypassDebounce: !!s.bypassDebounce,
          lockTokenAfterSell: !!s.lockTokenAfterSell,
          cumulativeLossLockPct: typeof s.cumulativeLossLockPct === 'number' ? s.cumulativeLossLockPct : null,
          // E5 卖侧：卖出比例（执行时点余仓比例，(0,1]；缺省/非法 → 1=全仓=旧语义）
          sellPercentage: (typeof s.sellPercentage === 'number'
            && s.sellPercentage > 0 && s.sellPercentage <= 1) ? s.sellPercentage : 1,
          // 卡牌仓位（迁自 rich-js）：cards/cooldownSec 原样透传，loadStrategies 内归一化
          //（正整数/卖腿 'all'，脏值 → null=旧语义）；cooldownSec 独立于卡牌机制生效
          cards: s.cards,
          cooldownSec: s.cooldownSec,
          enabled: true,
        });
      });
    }
    this._strategyEngine.loadStrategies(strategyArray, availableFactorIds);

    // 累亏闩锁阈值：取卖腿 cumulativeLossLockPct 最大值（多腿并存最严者先锁，fail-closed 方向）；
    // 未配置任何腿 = null = 机制关闭（存量实验零变化，语义同实时引擎）
    const _cumLocks = this._strategyEngine.getAllStrategies()
      .filter(s => s.action === 'sell' && s.cumulativeLossLockPct != null)
      .map(s => s.cumulativeLossLockPct);
    this._cumLossLockPct = _cumLocks.length > 0 ? Math.max(..._cumLocks) : null;

    this.logger.info(this._experimentId, 'BacktestEngine',
      `✅ 策略引擎初始化完成，加载了 ${this._strategyEngine.getStrategyCount()} 个策略`);

    // 5. 购买前检查服务（与实时引擎同源构建）
    const { PreBuyCheckService } = require('../pre-check/PreBuyCheckService');
    const { dbManager } = require('../../services/dbManager');
    const supabase = dbManager.getClient();
    const preBuyCheckConfig = {
      ...baseConfig.preBuyCheck,
      ...(this._experiment?.config?.preBuyCheck || {}),
    };
    this._preBuyCheckService = new PreBuyCheckService(supabase, this.logger, preBuyCheckConfig);
    await this._preBuyCheckService.initialize('bsc');
    this.logger.info(this._experimentId, 'BacktestEngine',
      `✅ 购买前检查服务初始化完成 (earlyParticipantFilterEnabled=${preBuyCheckConfig.earlyParticipantFilterEnabled})`);

    // 5.5 叙事评级直调（同实时引擎：策略 narrativeCallCondition 触发时同步调
    // NarrativeAnalyzer.analyze，Jev 秒级；失败/超时=9 放行）
    const { NarrativeDirectCaller, mapGmgnRiskFactors } = require('../pre-check/NarrativeDirectCaller');
    this._narrativeCaller = new NarrativeDirectCaller();

    // 5.6 同叙事龙头已火检查（同实时引擎：narrativeLeaderHot 因子，火门槛 5x + 首达后 24h 窗；
    // checkTimeSec 用回放时点，涨幅只算 block_time<=t 的 ticks，无未来函数）
    const { SameNarrativeLeaderService } = require('../pre-check/SameNarrativeLeaderService');
    this._sameNarrativeLeaderService = new SameNarrativeLeaderService(supabase, this.logger);

    // 6. 交易金额 / 永久阻断 / 卡牌仓位
    const experimentConfig = this._experiment?.config || {};
    this._tradeAmount = experimentConfig.tradeAmount || 0.1;
    this._permanentBlockCondition = experimentConfig.strategiesConfig?.permanentBlockCondition || null;
    // 卡牌机制开关（迁自 rich-js）：positionManagement.perCardBNB 存在且 >0 才启用。
    // 启用：买入金额 = perCardBNB × 本腿张数（cards ?? 1），卖腿配 cards 按卡数比例
    // 卖余仓（_emitSellSignal sizing）；未配置 = 全部卡牌字段忽略（存量实验零变化）
    const _pmPerCard = Number((experimentConfig.positionManagement || {}).perCardBNB);
    this._perCardBNB = Number.isFinite(_pmPerCard) && _pmPerCard > 0 ? _pmPerCard : null;
    this._cardsEnabled = this._perCardBNB != null;
    if (this._cardsEnabled) {
      this.logger.info(this._experimentId, 'BacktestEngine',
        `🃏 卡牌仓位模式启用: perCardBNB=${this._perCardBNB}（买入金额=perCardBNB×本腿张数，卖腿按卡数比例卖余仓）`);
    }

    // 7. 批量写入缓冲区
    const { BacktestWriteBuffer } = require('../backtest/BacktestWriteBuffer');
    this._writeBuffer = new BacktestWriteBuffer(supabase, this.logger);
    this._writeBufferEnabled = experimentConfig.backtest?.writeBufferEnabled !== false;

    // 7.5 TPA 触发点持仓分析（回迁批 4 shadow 先行）：opt-in 同实时引擎——实验 config 整段无
    //     tokenPositionAnalyzer → 不构造（存量实验零影响）；段存在才构造（trigger fail-fast）。
    //     回测三点差异：persistSink 走 writeBuffer 攒批（决策不依赖落表，仅写库时机后移）；
    //     _alignClassifiedAsOf=true（防前视：分类可见时刻>asOf 的 token 不计 bad_action）；
    //     启动后预载三连（见 _loadWssTicks 之后）
    this._tokenPositionAnalyzer = null;
    const tpaExpConfig = experimentConfig.tokenPositionAnalyzer;
    if (tpaExpConfig != null) {
      const { TokenPositionAnalyzer } = require('../../services/TokenPositionAnalyzer');
      this._tokenPositionAnalyzer = new TokenPositionAnalyzer(tpaExpConfig, {
        logger: this.logger,
        experimentId: this._experimentId,
        factorAggregator: this._factorAggregator,
        // writeBuffer 关闭（调试模式，_writeBufferEnabled=false 永不 flush）时传 null →
        // TPA._persist 回退单条直写 upsert，行不丢；对齐信号通道 writeBufferEnabled guard 语义
        persistSink: this._writeBufferEnabled
          ? (row) => this._writeBuffer.addAnalysisInsert(row)
          : null,
        alignClassifiedAsOf: true,
      });
      this.logger.info(this._experimentId, 'BacktestEngine',
        `✅ TPA 已构造 (enabled=${this._tokenPositionAnalyzer.isEnabled()} ` +
        `enforce=${this._tokenPositionAnalyzer.isEnforceMode()}, alignClassifiedAsOf=true)`);
    }

    // 8. 买评估去抖（虚拟时钟模式：回放循环每 tick 前 advance 推进）
    const { TickDebouncer } = require('../core/TickDebouncer');
    this._buyDebouncer = new TickDebouncer({
      debounceMs: wsConfig.signalDebounceMs ?? 1500,
      maxWaitMs: wsConfig.signalDebounceMaxWaitMs ?? 5000,
      mode: 'virtual',
      onFire: (tokenAddress, tick, fireTs) => this._runBuyEvaluation(tokenAddress, tick, fireTs),
    });

    // 8.5 卖出确认去抖（虚拟时钟模式：首真 tick 起计不重置；默认 0=关闭=存量实验零变化）
    const { SellConfirmDebouncer } = require('../core/SellConfirmDebouncer');
    this._sellDebounceMs = wsConfig.sellDebounceMs ?? 0;
    this._sellConfirmDebouncer = new SellConfirmDebouncer({
      debounceMs: this._sellDebounceMs,
      mode: 'virtual',
      onFire: (tokenAddress, tick, fireTs) => this._onSellDebounceFire(tokenAddress, tick, fireTs),
    });
    this.logger.info(this._experimentId, 'BacktestEngine',
      `交易金额配置 | tradeAmount=${this._tradeAmount}，debounce=${wsConfig.signalDebounceMs ?? 1500}ms` +
      `，sellDebounce=${this._sellDebounceMs}ms`);

    // 9. 加载回放数据
    await this._loadTokenMetadata();
    await this._loadWssTicks();
    this.logger.info(this._experimentId, 'BacktestEngine',
      `📊 回放数据就绪: ${this._ticks.length} 笔 tick，${this._tokenMeta.size} 个代币元数据`);

    // 9.5 TPA 预载三连（回迁批 4，回测启动期一次性成本换回放期零 DB 往返）：
    //     offline 画像全表预载（内存 Map）→ 本实验全量 ticks 注入 trader→ticks 索引
    //     （miss/stale 路径零查询；口径=注入实验口径 ticks，平台过滤后——架构性偏离 #4
    //     已接受）→ token 分类预载（token_profiles 批量入 cache，运行期触发全命中）
    if (this._tokenPositionAnalyzer) {
      const pre = await this._tokenPositionAnalyzer.preloadOfflineProfiles(supabase);
      this.logger.info(this._experimentId, 'BacktestEngine',
        `TPA offline 画像预载: ${pre.rows} 行 / ${(pre.ms / 1000).toFixed(1)}s (${pre.source || 'fail-open'})`);
      const traders = this._tokenPositionAnalyzer.setHistoricalTicks(this._ticks);
      this.logger.info(this._experimentId, 'BacktestEngine',
        `TPA historical ticks 注入: ${this._ticks.length} 笔 → ${traders} traders`);
      const cachedTps = await this._tokenPositionAnalyzer.preloadTokenProfiles([...this._tokenMeta.keys()], supabase);
      this.logger.info(this._experimentId, 'BacktestEngine',
        `TPA token 分类预载: ${this._tokenMeta.size} token → cache ${cachedTps}`);
    }
  }

  /** 源实验 experiment_tokens → 代币元数据（FA registerToken / 落库 / totalSupply 用） */
  async _loadTokenMetadata() {
    const supabase = this._getClient();
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from('experiment_tokens')
        .select('token_address, token_symbol, created_at, raw_api_data, creator_address, platform')
        .eq('experiment_id', this._sourceExperimentId)
        .order('created_at', { ascending: true })
        .range(from, from + TICK_PAGE_SIZE - 1);
      if (error) throw new Error(`读取源实验代币元数据失败: ${error.message}`);
      for (const row of data || []) {
        this._tokenMeta.set(row.token_address, {
          symbol: row.token_symbol || '',
          name: row.raw_api_data?.name || '',
          platform: row.platform || 'fourmeme',
          createdAtSec: row.created_at ? new Date(row.created_at).getTime() / 1000 : null,
          totalSupply: Number(row.raw_api_data?.totalSupply) || 0,
          creator: row.creator_address || row.raw_api_data?.creator || null,
        });
      }
      if (!data || data.length < TICK_PAGE_SIZE) break;
      from += TICK_PAGE_SIZE;
      if (from > MAX_TICK_PAGES * TICK_PAGE_SIZE) throw new Error('源实验代币数超出分页保护上限');
    }
  }

  /**
   * 回放 tick 载入（watcher 架构口径：token 集合 + platform，不再按 experiment_id——
   * 新行 experiment_id=NULL，旧口径会漏掉全部 watcher 写入的行）。
   * token 集来自 _tokenMeta（源实验 experiment_tokens 全量），100 地址/批（PostgREST
   * .in 护栏，参照 build-token-profiles.cjs）+ platform 过滤 + id 升序分页；
   * 分块各自有序但块间无序 → 全部载入后全局按 id 归并排序，再内存过滤时间窗。
   * 全局累计上限 100 万 tick（MAX_TICK_PAGES × TICK_PAGE_SIZE）。
   */
  async _loadWssTicks() {
    const supabase = this._getClient();
    const addresses = [...this._tokenMeta.keys()];
    const raw = [];
    for (let ci = 0; ci < addresses.length; ci += TOKEN_CHUNK_SIZE) {
      const chunk = addresses.slice(ci, ci + TOKEN_CHUNK_SIZE);
      // platform 按单值 .eq 循环（而非 .in 多值）：.in('platform', 两平台全集) 等价于
      // 无 platform 过滤，planner 放弃索引转大范围扫描——62 token 双平台回测即触发
      // statement timeout（2026-09-27 182 实测）；单值 .eq 是存量回测一直走的索引
      // 路径，语义与 .in 并集严格等价（结果合并后同样全局 id 归并）
      for (const platform of this._platforms) {
        let from = 0;
        for (let page = 0; page < MAX_TICK_PAGES; page++) {
          const { data, error } = await supabase
            .from('wss_price_ticks')
            .select('id, token_address, trade_type, trader_address, price_bnb, price_usd, bnb_amount, token_amount, block_number, block_time, tx_hash, log_index, price_outlier, platform')
            .in('token_address', chunk)
            .eq('platform', platform)
            .order('id', { ascending: true })
            .range(from, from + TICK_PAGE_SIZE - 1);
          if (error) throw new Error(`读取 wss_price_ticks 失败: ${error.message}`);
          if (!data || data.length === 0) break;
          raw.push(...data);
          this.metrics.processedDataPoints += data.length;
          if (raw.length > MAX_TICK_PAGES * TICK_PAGE_SIZE) {
            throw new Error('回放 tick 总量超出分页保护上限（100 万）');
          }
          if (data.length < TICK_PAGE_SIZE) break;
          from += TICK_PAGE_SIZE;
        }
      }
    }
    raw.sort((a, b) => a.id - b.id);
    for (const row of raw) {
      const ts = new Date(row.block_time).getTime();
      if (this._startTimeFilter && ts < this._startTimeFilter) continue;
      if (this._endTimeFilter && ts > this._endTimeFilter) continue;
      this._ticks.push({
        token_address: row.token_address,
        trade_type: row.trade_type,
        trader_address: row.trader_address,
        price_bnb: Number(row.price_bnb),
        price_usd: row.price_usd === null ? null : Number(row.price_usd),
        bnb_amount: Number(row.bnb_amount || 0),
        token_amount: Number(row.token_amount || 0),
        block_number: row.block_number,
        timestamp: ts,
        tx_hash: row.tx_hash,
        log_index: row.log_index,
        price_outlier: row.price_outlier || false,
        platform: row.platform,   // token 级 fallback 证据（_registerToken/_evaluateBuyPath）
      });
    }
    // wss_price_ticks 表无 offers/funds_bnb 列：FA 仅在 tick.funds_bnb > 0 时更新
    // lastFundsBnb（回放恒保持 0），tvl 因子因此恒 0——策略 condition 引用 tvl 时需知情
  }

  _getClient() {
    const { dbManager } = require('../../services/dbManager');
    return dbManager.getClient();
  }

  /**
   * 回放主循环：tick 按时间升序逐笔驱动（debounce advance → 首见入池 →
   * FA 增量 → 分腿路由），虚拟 30s 桶写组合快照；结束强平 + 终态。
   */
  async _runMainLoop() {
    const startTime = Date.now();
    let completedSuccessfully = false;

    try {
      this.logger.info(this._experimentId, 'BacktestEngine',
        `📊 开始回放：${this._ticks.length} 笔 tick，${this._strategyEngine.getStrategyCount()} 个策略`);

      let processed = 0;
      for (const tick of this._ticks) {
        const tickTs = tick.timestamp;

        // 虚拟时钟推进：fire 到期的买评估（用截至上一笔 tick 的状态 + 本 tick 时刻）
        await this._advanceDebouncer(tickTs);

        // 组合快照 30s 虚拟桶（loopCount 随桶自增，对齐实时引擎时序轮次语义）
        if (this._lastSnapshotTs === null || tickTs - this._lastSnapshotTs >= SNAPSHOT_INTERVAL_MS) {
          this._lastSnapshotTs = tickTs;
          this._loopCount++;
          await this._createPortfolioSnapshot(tickTs);
        }

        // 首见代币：FA 注册 + 入池 + 落库
        if (!this._seenTokens.has(tick.token_address)) {
          await this._registerToken(tick);
        }

        // 因子增量（emitFactors:false 只推进状态不构建），随后 buildFactorMap 按
        // tick 虚拟时刻取因子快照——与实时引擎 _runBuyEvaluation 同一取数路径
        this._factorAggregator.processTick(tick, { emitFactors: false });
        const factors = this._factorAggregator.buildFactorMap(tick.token_address, tick.timestamp);
        if (!factors) continue;

        // TPA 触发检查（回迁批 4）：await 保证同 tick verdict 就绪（回放串行语义，
        // 后续 buildFactorMap 立即可读 setHoldingFactors 回填的 TPAPre_* 因子；
        // asOf=tick.timestamp，tick 行含 block_number 供 blocks 时间门）
        if (this._tokenPositionAnalyzer) {
          await this._tokenPositionAnalyzer.checkAndTrigger(
            tick.token_address, factors,
            this._factorAggregator.getTokenState(tick.token_address),
            tick, tick.timestamp);
        }

        const token = this._tokenPool.getToken(tick.token_address, 'bsc');
        if (!token) continue;

        // 分腿路由（与实时引擎 _onFactorsUpdated 同构）
        if (token.status === 'bought' && !this._buyingTokens.has(tick.token_address)) {
          await this._evaluateSellPath(token, factors, tick);
        } else if (!this._buyingTokens.has(tick.token_address) && token.status !== 'bought') {
          if (this._buyDebouncer.pending.has(tick.token_address)) this.metrics.debounceSuppressed++;
          this._buyDebouncer.touch(tick.token_address, tick);
        }

        processed++;
        if (processed % 5000 === 0) {
          this.logger.info(this._experimentId, 'BacktestEngine',
            `回放进度: ${processed}/${this._ticks.length}（${(processed / this._ticks.length * 100).toFixed(1)}%）` +
            ` 信号=${this.metrics.totalSignals} 交易=${this.metrics.totalTrades}`);
          // 定期冲刷：长回放不能只在结束时 flush（内存堆积 + 中途崩溃全丢）
          if (this._writeBufferEnabled && this._writeBuffer && this._writeBuffer.pendingCount > 0) {
            await this._writeBuffer.flush(this._experimentId);
          }
        }
      }

      // 冲刷残留 pending：买评估 burst 尾部（maxWait 覆盖，+10min 到期）；卖出去抖按
      // lastTs + sellDebounceMs 精确到期（fire 重评仍真才卖——强平前最后一次策略卖；
      // 强平走 force_sell 不置闩锁——无策略上下文）
      const lastTickTs = this._ticks[this._ticks.length - 1]?.timestamp || Date.now();
      this._buyDebouncer.advance(lastTickTs + 10 * 60 * 1000);
      this._sellConfirmDebouncer.advance(lastTickTs + this._sellDebounceMs + 1);
      if (this._inflightEvals.size > 0) {
        await Promise.all([...this._inflightEvals]);
      }

      // 回放结束：强平所有持仓（沿用旧回测语义）
      await this._forceSellAllRemaining();

      if (this._writeBufferEnabled && this._writeBuffer && this._writeBuffer.pendingCount > 0) {
        await this._writeBuffer.flush(this._experimentId);
      }

      const duration = Date.now() - startTime;
      const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);
      const finalBalance = portfolio?.totalValue || this.initialBalance;
      const finalBalanceValue = typeof finalBalance === 'number' ? finalBalance : finalBalance.toNumber();
      const profit = finalBalanceValue - this.initialBalance;
      const profitPercent = ((profit / this.initialBalance) * 100).toFixed(2);

      this.logger.info(this._experimentId, 'BacktestEngine',
        `✅ 回放完成，耗时 ${duration}ms | 初始 ${this.initialBalance} → 最终 ${finalBalanceValue.toFixed(4)} BNB | ` +
        `收益 ${profit.toFixed(4)} (${profitPercent > 0 ? '+' : ''}${profitPercent}%) | ` +
        `信号 ${this.metrics.totalSignals}/${this.metrics.executedSignals} | 交易 ${this.metrics.totalTrades}` +
        `（成功 ${this.metrics.successfulTrades} 失败 ${this.metrics.failedTrades}）| debounceFired=${this.metrics.debounceFired}` +
        (this._tokenPositionAnalyzer
          ? ` | TPA: ${JSON.stringify(this._tokenPositionAnalyzer.getStats())}` +
            (this._tokenPositionAnalyzer.getProfileStats()
              ? ` | TPA探针: ${JSON.stringify(this._tokenPositionAnalyzer.getProfileStats())}` : '')
          : ''));

      completedSuccessfully = true;
    } catch (error) {
      this.logger.error(this._experimentId, 'BacktestEngine', `❌ 回放执行失败: ${error.message}`);
      this.logger.error(this._experimentId, 'BacktestEngine', 'Stack trace', { stack: error.stack });
    } finally {
      // 市场截面 feed 关闭 + 模块级单例清除（防同进程下一实验继承回放累积的截面）
      require('../../services/FourMemeFactorAggregator').setMarketFeedEnabled(false);

      // TPA 清理（回迁批 4：verdict/画像缓存释放）
      if (this._tokenPositionAnalyzer) {
        this._tokenPositionAnalyzer.destroy();
      }

      const finalStatus = completedSuccessfully ? 'completed' : 'failed';
      try {
        await this._updateExperimentStatus(finalStatus);
        this._finalStatusSet = true;
        this.logger.info(this._experimentId, 'BacktestEngine', `📊 实验终态: ${finalStatus}`);
      } catch (updateError) {
        this.logger.error(this._experimentId, 'BacktestEngine', `更新实验状态失败: ${updateError.message}`);
      }
    }
  }

  async _syncHoldings() {
    // 回测持仓由 PortfolioManager 在回放中记账，无需外部同步
  }

  /**
   * 重写：回放已终态（completed/failed）后到达的停机信号不再覆盖状态、
   * 不补写真实时间快照（回放快照均已按虚拟时间落库）。
   */
  async stop() {
    if (this._finalStatusSet) {
      this._isStopped = true;
      this._status = EngineStatus.STOPPED;
      this.logger.info(this._experimentId, 'BacktestEngine', '回放已终态，停机信号仅置本地标志');
      return;
    }
    await super.stop();
  }

  _shouldRecordTimeSeries() {
    return false; // 回测不写 experiment_time_series_data（tick 重算，时序表是实时引擎产物）
  }

  /**
   * 虚拟时钟推进 + drain：advance 同步触发 onFire → _runBuyEvaluation /
   * _onSellDebounceFire（async fire-and-forget，与实时引擎同构）；回放串行语义
   * 要求评估在下一笔 tick 前完成（含预检查网络调用），drain 后再继续。
   */
  async _advanceDebouncer(tickTs) {
    this._buyDebouncer.advance(tickTs);
    this._sellConfirmDebouncer.advance(tickTs);
    if (this._inflightEvals.size > 0) {
      await Promise.all([...this._inflightEvals]);
    }
  }

  // ==================== 回放代币注册 ====================

  async _registerToken(tick) {
    const tokenAddress = tick.token_address;
    this._seenTokens.add(tokenAddress);
    const meta = this._tokenMeta.get(tokenAddress) || {};
    const createdAtSec = meta.createdAtSec || Math.floor(tick.timestamp / 1000);

    this._factorAggregator.registerToken(tokenAddress, {
      createdAtMs: createdAtSec * 1000,
      totalSupply: meta.totalSupply || 0,
      symbol: meta.symbol || '',
      creatorAddress: meta.creator || null,
    });
    this._tokenPool.addToken({
      token: tokenAddress,
      chain: 'bsc',
      // fallback 链：meta（源实验行级）→ tick 行（源实验缺行的罕见路径）→ 实验主平台；
      // 'both' 不落库——集合首元素 fourmeme 是缺省主平台
      platform: meta.platform || tick.platform || this._platforms[0],
      data_source: 'wss',
      name: meta.name || meta.symbol || '',
      symbol: meta.symbol || '',
      created_at: createdAtSec,
      current_price_usd: null,
      creator_address: meta.creator || null,
    });

    try {
      await this.dataService.saveToken(this._experimentId, {
        token: tokenAddress,
        symbol: meta.symbol || '',
        chain: 'bsc',
        platform: meta.platform || tick.platform || this._platforms[0],
        data_source: 'wss',
        created_at: createdAtSec,
        raw_api_data: { source: 'wss_tick_replay', totalSupply: meta.totalSupply || 0, creator: meta.creator },
        creator_address: meta.creator || null,
        status: 'monitoring',
      });
    } catch (error) {
      this.logger.error(this._experimentId, 'BacktestEngine',
        `回放代币落库失败 | ${tokenAddress} ${error.message}`);
    }
  }

  // ==================== 买路径（虚拟时钟版，结构与实时引擎对齐）====================

  _runBuyEvaluation(tokenAddress, tick, fireTs) {
    this.metrics.debounceFired++;
    const factors = this._factorAggregator.buildFactorMap(tokenAddress, fireTs);
    if (!factors) return Promise.resolve();

    const token = this._tokenPool.getToken(tokenAddress, 'bsc');
    if (!token) return Promise.resolve();
    if (this._buyingTokens.has(tokenAddress)) return Promise.resolve();
    if (token.status === 'bought') return Promise.resolve();
    if (this._tokenBlacklist.has(tokenAddress)) return Promise.resolve();

    // pumpfun 回迁批 2 买腿门：止损闩锁/累亏闩锁（token 级降维，语义同实时引擎；
    // 置锁与记账在 _emitSellSignal 卖出成功处，日志 tag [stopLossLock]/[cumLossLock]）
    if (this._tokenLocks.has(tokenAddress)) return Promise.resolve();
    if (this._cumLossLockPct != null
        && (this._cumLossTotals.get(tokenAddress) ?? 0) <= this._cumLossLockPct) return Promise.resolve();

    const p = this._evaluateBuyPath(token, factors, tick, fireTs)
      .catch(e => this.logger.error(this._experimentId, 'BuyEval',
        `${token.symbol || tokenAddress.slice(0, 10)} 回放买腿评估异常: ${e.message}`));
    // 收集 inflight promise：回放主循环 drain 后才推进下一笔 tick / 强平
    this._inflightEvals.add(p);
    p.finally(() => this._inflightEvals.delete(p));
    return p;
  }

  async _evaluateBuyPath(token, factorResults, tick, fireTs) {
    const tokenAddress = token.token;
    const { buildFactorValuesForTimeSeries, buildPreBuyCheckFactorValues } = require('../core/FactorBuilder');
    const nowTs = fireTs;

    this._buyingTokens.add(tokenAddress);
    try {
      if (!token.strategyExecutions || Object.keys(token.strategyExecutions).length === 0) {
        const strategyIds = this._strategyEngine.getAllStrategies().map(s => s.id);
        this._tokenPool.initStrategyExecutions(token.token, token.chain || 'bsc', strategyIds);
      }

      // 分腿评估（只看买腿）
      const strategy = this._strategyEngine.evaluate(factorResults, token.token, nowTs, token, 'buy');
      if (!strategy) {
        return { success: false, reason: '无触发买入策略' };
      }

      this.logger.info(this._experimentId, 'BuyEval',
        `${token.symbol} 触发买入策略(回放): ${strategy.name} | price=${factorResults.currentPrice?.toExponential(4)}` +
        ` earlyReturn=${factorResults.earlyReturn?.toFixed(1)}% age=${factorResults.age?.toFixed(2)}min tick=y`);

      const latestPrice = factorResults.currentPrice || 0;
      if (!(latestPrice > 0)) {
        return { success: false, reason: '无有效价格' };
      }

      // 信号先落库（预检查失败也留痕），时间戳用回放时点
      const signal = {
        action: 'buy',
        symbol: token.symbol,
        tokenAddress: token.token,
        chain: token.chain || 'bsc',
        price: latestPrice,
        confidence: 80,
        reason: strategy.name,
        strategyId: strategy.id,
        strategyName: strategy.name,
        cards: strategy.cards, // 卡牌（迁自 rich-js）：本腿买入张数（_calculateBuyAmount/_executeBuy 消费）
        factors: { trendFactors: buildFactorValuesForTimeSeries(factorResults) },
        timestamp: new Date(nowTs),
      };

      let signalId = null;
      try {
        const { TradeSignal } = require('../entities');
        const tradeSignal = new TradeSignal({
          experimentId: this._experimentId,
          tokenAddress: signal.tokenAddress,
          tokenSymbol: signal.symbol,
          signalType: 'BUY',
          action: 'buy',
          confidence: signal.confidence,
          reason: signal.reason,
          chain: signal.chain,
          metadata: {
            price: signal.price,
            strategyId: signal.strategyId,
            strategyName: signal.strategyName,
            ...signal.factors,
          },
          createdAt: signal.timestamp,
        });
        signalId = tradeSignal.id;
        if (this._writeBufferEnabled && this._writeBuffer) {
          this._writeBuffer.addSignalInsert(tradeSignal.toDatabaseFormat());
        } else {
          await tradeSignal.save();
        }
        this.metrics.totalSignals++;
      } catch (saveError) {
        this.logger.error(this._experimentId, 'BuyEval', `信号保存失败 | ${token.symbol} ${saveError.message}`);
        return { success: false, reason: `信号保存失败: ${saveError.message}` };
      }

      // ── 购买前检查（与实时引擎同构；checkTime 用回放时点）──
      let preCheckPassed = true;
      let blockReason = null;
      let preBuyCheckResult = null;

      const creatorAddress = token.creator_address || token.creatorAddress || null;
      const currentRound = this._tokenPool.getCurrentRound(token.token, token.chain || 'bsc');
      let shouldPerformPreCheck = false;
      if (currentRound === 0) {
        shouldPerformPreCheck = !!(strategy.preBuyCheckCondition && String(strategy.preBuyCheckCondition).trim() !== '');
      } else {
        shouldPerformPreCheck = !!(strategy.repeatBuyCheckCondition && String(strategy.repeatBuyCheckCondition).trim() !== '');
      }

      if (this._tokenBlacklist.has(token.token)) {
        preCheckPassed = false;
        blockReason = this._tokenBlacklist.get(token.token).reason;
      }

      // ── 叙事评级直调（同实时引擎：narrativeCallCondition 满足才同步调 analyze；
      // 结果为代币级全局缓存（不挂实验名下）；超时挂钟等待 30s，虚拟时钟回放下视为该 tick 时点的决策；
      // 失败/超时=9 放行）──
      let narrativeCallInfo = null;
      let narrativeLeaderInfo = null;
      const narrativeCallCondition = strategy.narrativeCallCondition && String(strategy.narrativeCallCondition).trim() !== ''
        ? String(strategy.narrativeCallCondition).trim() : null;
      if (narrativeCallCondition && preCheckPassed
          && this._strategyEngine.evaluateCondition(narrativeCallCondition, factorResults)) {
        narrativeCallInfo = await this._narrativeCaller.getRating(token.token);
        this.logger.info(this._experimentId, 'BuyEval',
          `叙事评级直调(回放) | ${token.symbol} rating=${narrativeCallInfo.numericRating}(${narrativeCallInfo.rating})` +
          ` ${narrativeCallInfo.durationMs}ms fromCache=${narrativeCallInfo.fromCache}` +
          (narrativeCallInfo.error ? ` error=${narrativeCallInfo.error}` : ''));

        // ── 同叙事龙头已火检查（回放：checkTimeSec 用回放时点，与下方 performAllChecks checkTime 同源；
        // 无 sourceTweetId→因子 0 放行；候选 material_id 映射为当前状态属已知穿越，涨幅计算无前视）──
        if (narrativeCallInfo.sourceTweetId) {
          narrativeLeaderInfo = await this._sameNarrativeLeaderService.check({
            tokenAddress: token.token,
            sourceTweetId: narrativeCallInfo.sourceTweetId,
            checkTimeSec: Math.floor(nowTs / 1000),
          });
          this.logger.info(this._experimentId, 'BuyEval',
            `同叙事龙头检查(回放) | ${token.symbol} hot=${narrativeLeaderInfo.factors.narrativeLeaderHot}` +
            ` count=${narrativeLeaderInfo.factors.narrativeLeaderCount}` +
            ` max=${narrativeLeaderInfo.factors.narrativeLeaderMaxMultiple}x` +
            ` ${narrativeLeaderInfo.detail.durationMs}ms tweet=${narrativeCallInfo.sourceTweetId}` +
            (narrativeLeaderInfo.detail.error ? ` error=${narrativeLeaderInfo.detail.error}` : ''));
        }
      }

      if (preCheckPassed && shouldPerformPreCheck && this._preBuyCheckService) {
        try {
          const tokenPlatform = token.platform || tick.platform || this._platforms[0];
          const tokenInfo = {
            address: token.token,
            symbol: token.symbol,
            name: this._tokenMeta.get(token.token)?.name || token.name || '',
            chain: 'bsc',
            platform: tokenPlatform,
            launchAt: token.createdAt || null,
            innerPair: `${token.token}_${tokenPlatform === 'flap' ? 'fl' : 'fo'}`,
          };
          let preBuyCheckCondition = currentRound === 0
            ? strategy.preBuyCheckCondition
            : strategy.repeatBuyCheckCondition;
          preBuyCheckCondition = String(preBuyCheckCondition).trim();

          const lastPairReturnRate = this._tokenPool.getLastPairReturnRate(token.token, token.chain || 'bsc');
          const meta = this._tokenMeta.get(token.token) || {};
          let totalSupply = meta.totalSupply || 0;
          if (totalSupply <= 0 && factorResults.fdv > 0 && factorResults.currentPrice > 0) {
            totalSupply = factorResults.fdv / factorResults.currentPrice;
          }

          preBuyCheckResult = await this._preBuyCheckService.performAllChecks(
            token.token,
            creatorAddress,
            this._experimentId,
            signalId,
            'bsc',
            tokenInfo,
            preBuyCheckCondition,
            {
              checkTime: Math.floor(nowTs / 1000),
              tokenBuyTime: token.buyTime || null,
              drawdownFromHighest: factorResults.drawdownFromHighest || null,
              buyRound: currentRound + 1,
              lastPairReturnRate: lastPairReturnRate ?? 0,
              narrativeRating: narrativeCallInfo?.numericRating ?? 9, // 直调链路（时序穿越：当前语料分析历史 token）；未配置/未触发/失败/超时=9
              narrativeLeaderHot: narrativeLeaderInfo?.factors?.narrativeLeaderHot ?? 0, // 同叙事龙头链路；无 tweet/失败=0 放行
              narrativeLeaderCount: narrativeLeaderInfo?.factors?.narrativeLeaderCount ?? 0,
              narrativeLeaderMaxMultiple: narrativeLeaderInfo?.factors?.narrativeLeaderMaxMultiple ?? 0,
              // GMGN 风险因子（x-0 案）：同 narrativeRating 直调链路；时序穿越同声明
              // （GMGN 是当前快照——历史 token 的 issuerTokenCount 含其后所有发币，
              // 偏拦方向；bundler 是当前 holder 群体）——只看相对增量，绝对值不代表实时可得
              ...mapGmgnRiskFactors(narrativeCallInfo?.gmgnRisk),
              tweetAuthorType: factorResults.tweetAuthorType ?? 0,
              dataCollectionRound: factorResults.dataCollectionRound ?? 0,
              totalSupply,
            },
          );

          if (!preBuyCheckResult.canBuy) {
            this.logger.warn(this._experimentId, 'BuyEval',
              `购买前检查失败(回放) | ${token.symbol} reason=${preBuyCheckResult.checkReason}`);
            preCheckPassed = false;
            blockReason = preBuyCheckResult.checkReason || 'pre_buy_check_failed';
          }

          if (this._permanentBlockCondition && preBuyCheckResult) {
            const blockResult = this._evaluatePermanentBlock(preBuyCheckResult, this._permanentBlockCondition);
            if (blockResult.blocked) {
              this._tokenBlacklist.set(token.token, { reason: blockResult.reason, timestamp: nowTs });
              if (preCheckPassed) {
                preCheckPassed = false;
                blockReason = blockResult.reason;
              }
            }
          }
        } catch (checkError) {
          this.logger.error(this._experimentId, 'BuyEval',
            `购买前检查异常(回放): ${token.symbol} - ${checkError.message}`);
          preCheckPassed = false;
          blockReason = `购买前检查异常: ${checkError.message}`;
        }
      } else if (!shouldPerformPreCheck) {
        preBuyCheckResult = { canBuy: true, checkReason: '跳过购买前检查' };
      }

      const tokenCreateTime = token.createdAt || null;

      if (!preCheckPassed) {
        if (signalId) {
          this._bufferSignalUpdate(signalId, {
            metadata: {
              tokenCreateTime,
              trendFactors: buildFactorValuesForTimeSeries(factorResults),
              narrativeCall: narrativeCallInfo,
              narrativeLeaderCheck: narrativeLeaderInfo,
              preBuyCheckFactors: {
                ...buildPreBuyCheckFactorValues(preBuyCheckResult || {}),
                permanentBlockTriggered: this._tokenBlacklist.has(token.token),
                permanentBlockCondition: this._permanentBlockCondition || null,
              },
              preBuyCheckResult: {
                canBuy: false,
                reason: blockReason,
              },
              execution_status: 'failed',
            },
            executed: false,
          });
        }
        return { success: false, reason: `预检查失败: ${blockReason}` };
      }

      // 预检查通过：补全元数据后执行
      if (signalId) {
        this._bufferSignalUpdate(signalId, {
          metadata: {
            tokenCreateTime,
            trendFactors: buildFactorValuesForTimeSeries(factorResults),
            narrativeCall: narrativeCallInfo,
            narrativeLeaderCheck: narrativeLeaderInfo,
            preBuyCheckFactors: buildPreBuyCheckFactorValues(preBuyCheckResult),
            preBuyCheckResult: {
              canBuy: true,
              reason: preBuyCheckResult.checkReason || 'passed',
            },
          },
        });
      }

      const metadata = {
        signalId,
        loopCount: this._loopCount,
        timestamp: signal.timestamp.toISOString(),
        factors: signal.factors || null,
      };
      const buyAmt = this._calculateBuyAmount(signal); // 卡牌模式下逐腿金额不同，日志用实际值
      const result = await this._executeBuy(signal, signalId, metadata, nowTs);

      if (result && result.success) {
        this._tokenPool.markAsBought(token.token, token.chain, {
          buyPrice: latestPrice,
          buyTime: nowTs,
        });
        // 虚拟时钟：冷却/次数计数都要记回放时点（挂钟会让回测冷却判据失真）
        this._tokenPool.recordStrategyExecution(token.token, token.chain, strategy.id, nowTs);
        await this.dataService.updateTokenStatus(this._experimentId, token.token, 'bought');

        const faState = this._factorAggregator.getTokenState(token.token);
        this._factorAggregator.setBuyState(token.token, {
          buyPriceBnb: faState?.currentPriceBnb || 0,
          buyPriceUsd: latestPrice,
          buyTime: nowTs,
        });

        this._bufferSignalUpdate(signalId, { executed: true, metadata: { execution_status: 'executed' } });
        this.metrics.executedSignals++;
        this.logger.info(this._experimentId, 'BuyEval',
          `✅ 买入成功(回放) | ${token.symbol} price=${latestPrice.toExponential(4)} amount=${buyAmt}${this._cardsEnabled ? `(${signal.cards ?? 1}卡)` : ''} 余额=${this.currentBalance.toFixed(4)}`);
        return { success: true };
      }

      this._bufferSignalUpdate(signalId, { executed: false, metadata: { execution_status: 'failed', tradeResult: result } });
      return { success: false, reason: result?.reason || result?.message || '交易执行失败' };
    } finally {
      this._buyingTokens.delete(tokenAddress);
    }
  }

  // ==================== 卖路径（虚拟时钟版）====================

  /**
   * 卖腿评估（pumpfun 回迁批 2，与实时引擎同构）：每 tick 实时评估不去抖，
   * hit 后分流——bypassDebounce/去抖关闭 → 立即卖（存量行为）；默认腿 →
   * SellConfirmDebouncer touch（首真起计不重置）；条件 false → clear。
   */
  async _evaluateSellPath(token, factors, tick) {
    const tokenAddress = token.token;
    if (token.status !== 'bought') return { success: false, reason: '非持有状态' };
    if (this._sellingTokens.has(tokenAddress)) return { success: false, reason: '卖出执行中' };

    const nowTs = tick.timestamp;
    const strategy = this._strategyEngine.evaluate(factors, tokenAddress, nowTs, token, 'sell');
    if (!strategy) {
      this._sellConfirmDebouncer.clear(tokenAddress); // 条件 false（趋势恢复）→ 取消 pending
      return { success: false, reason: '无触发卖出策略' };
    }

    if (strategy.bypassDebounce || this._sellDebounceMs <= 0) {
      this._sellConfirmDebouncer.clear(tokenAddress);
      return this._emitSellSignal(token, strategy, factors, nowTs, tick);
    }

    this._sellConfirmDebouncer.touch(tokenAddress, tick);
    return { success: false, reason: '卖出确认去抖中' };
  }

  /** 卖出去抖 fire：fireTs 虚拟时刻重读因子重评（窗口内可能已恢复/sold） */
  _onSellDebounceFire(tokenAddress, tick, fireTs) {
    const factors = this._factorAggregator.buildFactorMap(tokenAddress, fireTs);
    if (!factors) return;
    const token = this._tokenPool.getToken(tokenAddress, 'bsc');
    if (!token || token.status !== 'bought') return;
    if (this._buyingTokens.has(tokenAddress)) return; // 与卖腿路由门同口径

    const p = this._reconfirmAndSell(token, factors, fireTs)
      .catch(e => this.logger.error(this._experimentId, 'SellEval',
        `${token.symbol || tokenAddress.slice(0, 10)} 回放卖出去抖 fire 异常: ${e.message}`));
    this._inflightEvals.add(p);
    p.finally(() => this._inflightEvals.delete(p));
  }

  /** fire 重评：条件仍真才卖（恢复→不卖，等下次触发重新起算） */
  async _reconfirmAndSell(token, factors, nowTs) {
    const tokenAddress = token.token;
    if (this._sellingTokens.has(tokenAddress)) return { success: false, reason: '卖出执行中' };

    const strategy = this._strategyEngine.evaluate(factors, tokenAddress, nowTs, token, 'sell');
    if (!strategy) return { success: false, reason: '条件恢复，不卖' };

    return this._emitSellSignal(token, strategy, factors, nowTs, null);
  }

  /**
   * 构造卖出信号并执行（立即卖 / 去抖 fire 共用；从原 _evaluateSellPath 抽取）。
   * 成功后：累亏闩锁记账（盈亏同记）+ lockTokenAfterSell 止损闩锁置位。
   * @param {Object|null} tick - 触发 tick（去抖 fire 路径为 null）
   */
  async _emitSellSignal(token, strategy, factors, nowTs, tick) {
    const tokenAddress = token.token;
    if (this._sellingTokens.has(tokenAddress)) return { success: false, reason: '卖出执行中' };

    this._sellingTokens.add(tokenAddress);
    try {
      this.logger.info(this._experimentId, 'SellEval',
        `${token.symbol} 触发卖出策略(回放): ${strategy.name}${tick ? '' : '（去抖确认后）'} | ` +
        `profitPercent=${factors.profitPercent?.toFixed(1)}%`);

      const latestPrice = factors.currentPrice || 0;
      if (!(latestPrice > 0)) {
        return { success: false, reason: '无有效价格' };
      }

      const { buildFactorValuesForTimeSeries } = require('../core/FactorBuilder');
      const holding = this._getHolding(tokenAddress);
      const buyPrice = holding?.averagePurchasePrice || token.buyPrice || null;

      // 卡牌 sizing（迁自 rich-js）：机制启用 且 卖腿配 cards 且 token 有卡 → 按卡数比例
      // 卖余仓：soldN = 'all'→全清 / min(cards, 余卡)（超余卡钳制）；soldN>=tokenCards 时
      // sellPct 恒精确 1（IEEE T/T）→ Decimal.mul(1) 精确直通，PM remainingAmount.eq(0)
      // 删仓判据成立（E5d 僵尸仓教训，详见 _executeSell 注释）。不满足任一条件 → 旧
      // sellPercentage 路径（机制关闭/腿未配卡/无卡均不拦截）。cardTrade.after 为信号
      // 构造时点算好的绝对值，随 trade metadata 落库（_executeSell 成功分支写回 Map）
      let cardTrade = null;
      let sellPct = strategy.sellPercentage ?? 1;
      if (this._cardsEnabled && strategy.cards != null) {
        const tokenCards = this._tokenCards.get(tokenAddress) || 0;
        if (tokenCards > 0) {
          const soldN = strategy.cards === 'all' ? tokenCards : Math.min(strategy.cards, tokenCards);
          sellPct = soldN >= tokenCards ? 1 : soldN / tokenCards;
          cardTrade = { cards: soldN, before: tokenCards, after: tokenCards - soldN };
        }
      }

      const signal = {
        action: 'sell',
        symbol: token.symbol,
        tokenAddress: token.token,
        chain: token.chain || 'bsc',
        price: latestPrice,
        confidence: 80,
        reason: strategy.name,
        strategyId: strategy.id,
        strategyName: strategy.name,
        buyPrice,
        profitPercent: buyPrice && latestPrice ? ((latestPrice - buyPrice) / buyPrice * 100) : null,
        holdDuration: token.buyTime ? ((nowTs - token.buyTime) / 1000) : null,
        sellPercentage: sellPct, // E5：本腿卖出比例（执行时点余仓；卡牌模式=卡数比例）
        cardTrade,
        factors: { trendFactors: buildFactorValuesForTimeSeries(factors) },
        timestamp: new Date(nowTs),
      };

      let signalId = null;
      try {
        const { TradeSignal } = require('../entities');
        const tradeSignal = new TradeSignal({
          experimentId: this._experimentId,
          tokenAddress: signal.tokenAddress,
          tokenSymbol: signal.symbol,
          signalType: 'SELL',
          action: 'sell',
          confidence: signal.confidence,
          reason: signal.reason,
          chain: signal.chain,
          metadata: {
            price: signal.price,
            strategyId: signal.strategyId,
            strategyName: signal.strategyName,
            buyPrice: signal.buyPrice,
            profitPercent: signal.profitPercent,
            holdDuration: signal.holdDuration,
            ...signal.factors,
          },
          createdAt: signal.timestamp,
        });
        signalId = tradeSignal.id;
        if (this._writeBufferEnabled && this._writeBuffer) {
          this._writeBuffer.addSignalInsert(tradeSignal.toDatabaseFormat());
        } else {
          await tradeSignal.save();
        }
        this.metrics.totalSignals++;
      } catch (saveError) {
        this.logger.error(this._experimentId, 'SellEval', `信号保存失败 | ${token.symbol} ${saveError.message}`);
        return { success: false, reason: `信号保存失败: ${saveError.message}` };
      }

      const metadata = { signalId, loopCount: this._loopCount, timestamp: signal.timestamp.toISOString() };
      const result = await this._executeSell(signal, signalId, metadata, nowTs);

      if (result && result.success) {
        // 虚拟时钟：冷却判据（lastExecuted）必须记回放时点
        this._tokenPool.recordStrategyExecution(token.token, token.chain, strategy.id, nowTs);
        this._sellConfirmDebouncer.clear(tokenAddress);

        // 累亏闩锁记账：卖出成交 → 该 token 已平仓轮 profitPercent 累计（盈亏同记）。
        // signal.profitPercent 缺失时从 token.buyPrice 现算（双缺失才跳过记账）；
        // E5 部分卖按腿折算（本腿只动了 sellPercentage 比例的仓位）
        let _pct = Number(signal.profitPercent);
        if (!Number.isFinite(_pct) && latestPrice > 0 && token.buyPrice > 0) {
          _pct = (latestPrice - token.buyPrice) / token.buyPrice * 100;
        }
        if (Number.isFinite(_pct)) {
          _pct = _pct * (signal.sellPercentage ?? 1);
          const _cum = (this._cumLossTotals.get(tokenAddress) || 0) + _pct;
          this._cumLossTotals.set(tokenAddress, _cum);
          if (this._cumLossLockPct != null && _cum <= this._cumLossLockPct) {
            this.logger.info(this._experimentId, 'cumLossLock',
              `[cumLossLock] ${token.symbol} 累计盈亏 ${_cum.toFixed(1)}% ≤ ${this._cumLossLockPct}%，该 token 禁买`);
          }
        }

        // 止损闩锁：lockTokenAfterSell 卖腿成交 → 该 token 永久禁买
        if (strategy.lockTokenAfterSell) {
          this._tokenLocks.add(tokenAddress);
          this.logger.info(this._experimentId, 'stopLossLock',
            `[stopLossLock] ${token.symbol} 止损腿[${strategy.id}]成交，该 token 禁买`);
        }

        this._bufferSignalUpdate(signalId, { executed: true, metadata: { execution_status: 'executed' } });
        this.metrics.executedSignals++;
        return { success: true };
      }
      this._bufferSignalUpdate(signalId, { executed: false, metadata: { execution_status: 'failed', tradeResult: result } });
      return { success: false, reason: result?.reason || result?.message || '卖出执行失败' };
    } finally {
      this._sellingTokens.delete(tokenAddress);
    }
  }

  // ==================== 交易执行（历史时间戳落库）====================

  async _executeBuy(signal, signalId = null, metadata = {}, timestamp = null) {
    try {
      const amountInBNB = this._calculateBuyAmount(signal);
      if (amountInBNB <= 0) {
        return { success: false, reason: '余额不足或计算金额为0' };
      }

      // 卡账本（迁自 rich-js）：机制启用时所有买入都是卡牌计价（本腿 cards ?? 1 张）。
      // after 为成交时点绝对值，先写进 trade metadata（重放/诊断），成功才落 Map
      let cardTrade = null;
      if (this._cardsEnabled) {
        const cardsN = signal.cards != null ? signal.cards : 1;
        const before = this._tokenCards.get(signal.tokenAddress) || 0;
        cardTrade = { cards: cardsN, before, after: before + cardsN };
      }

      const price = signal.price || 0;
      const tokenAmount = price > 0 ? new Decimal(amountInBNB).div(price).toNumber() : 0;

      // metadata.timestamp 驱动 Trade.createdAt（历史时间）；executedAt 为回测运行时刻
      const result = await this.executeTrade({
        tokenAddress: signal.tokenAddress,
        symbol: signal.symbol,
        direction: 'buy',
        amount: tokenAmount,
        price,
        signalId,
        metadata: {
          ...metadata,
          timestamp: timestamp !== null ? new Date(timestamp).toISOString() : undefined,
          ...(cardTrade ? { cardTrade } : {}),
        },
      });

      this.metrics.totalTrades++;
      if (result && result.success) {
        this.metrics.successfulTrades++;
        if (cardTrade) {
          this._tokenCards.set(signal.tokenAddress, cardTrade.after);
        }
        // E5 轮账本开轮：买入成功登记成本（记账货币 USD；回测 tradeAmount 即此口径）
        this._roundLedger.set(signal.tokenAddress, {
          buyUsd: amountInBNB,
          sellUsdGross: 0,
          buyTime: timestamp !== null ? timestamp : Date.now(),
          legCount: 0,
        });
      } else {
        this.metrics.failedTrades++;
        this.logger.error(this._experimentId, '_executeBuy',
          `买入失败(回放) | ${signal.symbol} reason=${result?.reason || result?.message || '未知'}`);
      }
      return result || { success: false, reason: 'executeTrade 返回空值' };
    } catch (error) {
      this.metrics.totalTrades++;
      this.metrics.failedTrades++;
      this.logger.error(this._experimentId, '_executeBuy', `异常(回放) | ${error.message}`);
      return { success: false, reason: error.message };
    }
  }

  async _executeSell(signal, signalId = null, metadata = {}, timestamp = null) {
    try {
      const holding = this._getHolding(signal.tokenAddress);
      if (!holding || holding.amount <= 0) {
        return { success: false, reason: '无持仓' };
      }
      const sellPct = (typeof signal.sellPercentage === 'number'
        && signal.sellPercentage > 0 && signal.sellPercentage <= 1) ? signal.sellPercentage : 1;
      // P-3 快照（与实时引擎同构）：PM 部分卖原地改写 holding.amount，成交后此引用即余量
      const qtyBefore = Number(holding.amount);

      // E5d 修复（精度）：amountToSell 保持 Decimal 精确值，不经 Number 往返——
      // 部分卖后 PM 余仓是 20 位精度 Decimal，Number 化可能向上失真，全清腿（sellPct=1）
      // 会以「Insufficient token balance」被 PM 拒绝（E5d BRX1600 实测：P2 每 tick 重触发
      // 40+ 次全失败、强平腿静默跳过、6140 token 成僵尸仓）。executeTrade/PM 均接受
      // Decimal 实例，currentAmount.lt(tradeAmount) 精确相等不再误抛。
      const amountToSell = new Decimal(holding.amount).mul(sellPct);
      const price = signal.price || 0;

      const result = await this.executeTrade({
        tokenAddress: signal.tokenAddress,
        symbol: signal.symbol,
        direction: 'sell',
        amount: amountToSell,
        price,
        signalId,
        metadata: {
          ...metadata,
          timestamp: timestamp !== null ? new Date(timestamp).toISOString() : undefined,
          buyPrice: signal.buyPrice,
          profitPercent: signal.profitPercent,
          holdDuration: signal.holdDuration,
          sellPercentage: sellPct,
          ...(signal.cardTrade ? { cardTrade: signal.cardTrade } : {}),
        },
      });

      this.metrics.totalTrades++;
      if (result && result.success) {
        this.metrics.successfulTrades++;
        const qtySold = amountToSell; // 虚拟成交=请求数量（Decimal，腿所得精确累计）
        const legProceedsUsd = price > 0 ? new Decimal(qtySold).mul(price).toNumber() : 0;

        // 全清判定用 PM 余仓（部分卖保持 bought，卖腿继续评估、FA 锚不清——硬底分母保住）
        const fullyClosed = (Number(this._getHolding(signal.tokenAddress)?.amount ?? 0) <= 0);

        // 卡账本写回（迁自 rich-js）：成交才扣卡（失败腿不烧卡）。配卡腿写 after 绝对值
        //（0 → 删卡）；不带 cardTrade 的腿在全清时也删卡（强平腿/sellPct=1 腿走此处，
        // 仓位清零卡随清，防重买后卡数虚高）；部分比例卖不动卡数（比例/卡数两套口径并行）
        if (signal.cardTrade) {
          if (signal.cardTrade.after > 0) {
            this._tokenCards.set(signal.tokenAddress, signal.cardTrade.after);
          } else {
            this._tokenCards.delete(signal.tokenAddress);
          }
        } else if (fullyClosed) {
          this._tokenCards.delete(signal.tokenAddress);
        }

        // E5 轮账本：每卖腿累计所得；全清时一次记整轮 pnl=Σ卖-买（含回放结束强平腿）
        const ledger = this._roundLedger.get(signal.tokenAddress)
          || { buyUsd: 0, sellUsdGross: 0, buyTime: Date.now(), legCount: 0 };
        ledger.sellUsdGross = new Decimal(ledger.sellUsdGross).plus(legProceedsUsd).toNumber();
        ledger.legCount = (ledger.legCount || 0) + 1;

        const token = this._tokenPool.getToken(signal.tokenAddress, signal.chain || 'bsc');
        if (fullyClosed) {
          if (token && token.buyTime) {
            const sellTime = timestamp !== null ? timestamp : Date.now();
            const returnRate = ledger.buyUsd > 0
              ? (ledger.sellUsdGross - ledger.buyUsd) / ledger.buyUsd * 100 : 0;
            this._tokenPool.addCompletedPair(signal.tokenAddress, signal.chain, {
              buyTime: token.buyTime,
              sellTime,
              returnRate,
              pnl: new Decimal(ledger.sellUsdGross).minus(ledger.buyUsd).toNumber(),
            });
            this.logger.info(this._experimentId, '_executeSell',
              `已完成交易对(回放，全清 ${ledger.legCount} 腿归并) | ${signal.symbol} returnRate=${returnRate.toFixed(2)}%`);
          }
          this._roundLedger.delete(signal.tokenAddress);

          this._tokenPool.markAsSold(signal.tokenAddress, signal.chain);
          await this.dataService.updateTokenStatus(this._experimentId, signal.tokenAddress, 'sold');
          this._factorAggregator.clearBuyState(signal.tokenAddress, 'default');
        } else {
          this._roundLedger.set(signal.tokenAddress, ledger);
          this.logger.info(this._experimentId, '_executeSell',
            `部分卖出(回放) ${(sellPct * 100).toFixed(0)}% | ${signal.symbol} 腿所得=${legProceedsUsd.toFixed(6)} 余仓=${Number(this._getHolding(signal.tokenAddress)?.amount ?? 0).toFixed(4)}${signal.cardTrade ? ` 余卡=${signal.cardTrade.after}` : ''}`);
        }
      } else {
        this.metrics.failedTrades++;
        // E5d 修复（可观测）：卖出失败原为静默（BRX1600 强平腿跳过即由此漏诊）
        this.logger.error(this._experimentId, '_executeSell',
          `卖出失败(回放) | ${signal.symbol} reason=${result?.reason || result?.message || '未知'}`);
      }
      return result;
    } catch (error) {
      this.metrics.totalTrades++;
      this.metrics.failedTrades++;
      this.logger.error(this._experimentId, '_executeSell', `异常(回放) | ${signal.symbol} ${error.message}`);
      return { success: false, reason: error.message };
    }
  }

  _calculateBuyAmount(signal) {
    // 卡牌模式（迁自 rich-js）：金额 = perCardBNB × 本腿张数（cards ?? 1）；
    // 现金不足返 0=买失败，不降张（rich-js 原味语义）
    if (this._cardsEnabled) {
      const amt = new Decimal(this._perCardBNB).mul(signal.cards != null ? signal.cards : 1).toNumber();
      return this.currentBalance >= amt ? amt : 0;
    }
    if (this.currentBalance < this._tradeAmount) {
      return 0;
    }
    return this._tradeAmount;
  }

  /** 当前可用余额 */
  get currentBalance() {
    try {
      const portfolio = this._portfolioManager?.getPortfolio(this._portfolioId);
      if (portfolio) {
        const cashBalance = portfolio.cashBalance;
        return typeof cashBalance === 'number' ? cashBalance : cashBalance?.toNumber?.() ?? this.initialBalance;
      }
    } catch {}
    return this.initialBalance;
  }

  // ==================== 回放收尾 ====================

  /**
   * 回放结束强平所有持仓（沿用旧回测语义）：按 FA 最后价全额卖出，
   * 信号/交易落库（时间=最后一笔 tick），保证组合终值可核算。
   */
  async _forceSellAllRemaining() {
    const holdings = this._getAllHoldings();
    if (!holdings || holdings.length === 0) return;

    const lastTs = this._ticks[this._ticks.length - 1]?.timestamp || Date.now();
    this.logger.info(this._experimentId, 'BacktestEngine', `回放结束，强平 ${holdings.length} 个持仓`);

    const { buildFactorValuesForTimeSeries } = require('../core/FactorBuilder');
    for (const holding of holdings) {
      const tokenAddress = holding.tokenAddress;
      const token = this._tokenPool.getToken(tokenAddress, 'bsc');
      const factors = this._factorAggregator.buildFactorMap(tokenAddress, lastTs);
      const price = factors?.currentPrice || 0;
      if (!(price > 0)) {
        this.logger.warn(this._experimentId, 'BacktestEngine',
          `强平跳过（无价格）| ${token?.symbol || tokenAddress}`);
        continue;
      }

      const buyPrice = holding.averagePurchasePrice || token?.buyPrice || null;
      const signal = {
        action: 'sell',
        // tokenPool 的 symbol 来自 wss_events payload（权威）；holding.tokenSymbol 是
        // PM getTokenSymbol 的降级值（targetTokens 未配置时恒为地址前 8 位+'...'）
        symbol: token?.symbol || holding.tokenSymbol || '',
        tokenAddress,
        chain: 'bsc',
        price,
        confidence: 80,
        reason: '回放结束强平',
        strategyId: 'force_sell',
        strategyName: '回放结束强平',
        buyPrice,
        profitPercent: buyPrice && price ? ((price - buyPrice) / buyPrice * 100) : null,
        holdDuration: token?.buyTime ? ((lastTs - token.buyTime) / 1000) : null,
        sellPercentage: 1, // E5：强平腿=余仓全清（冻结估值口径，analyze 分列）
        factors: factors ? { trendFactors: buildFactorValuesForTimeSeries(factors) } : {},
        timestamp: new Date(lastTs),
      };

      let signalId = null;
      try {
        const { TradeSignal } = require('../entities');
        const tradeSignal = new TradeSignal({
          experimentId: this._experimentId,
          tokenAddress,
          tokenSymbol: signal.symbol,
          signalType: 'SELL',
          action: 'sell',
          confidence: 80,
          reason: signal.reason,
          chain: 'bsc',
          metadata: { price, reason: signal.reason, strategyId: signal.strategyId, strategyName: signal.strategyName, ...signal.factors },
          createdAt: signal.timestamp,
        });
        signalId = tradeSignal.id;
        if (this._writeBufferEnabled && this._writeBuffer) {
          this._writeBuffer.addSignalInsert(tradeSignal.toDatabaseFormat());
        } else {
          await tradeSignal.save();
        }
        this.metrics.totalSignals++;
      } catch (e) {
        this.logger.error(this._experimentId, 'BacktestEngine', `强平信号保存失败 | ${tokenAddress} ${e.message}`);
        continue;
      }

      const result = await this._executeSell(signal, signalId, { signalId, timestamp: signal.timestamp.toISOString() }, lastTs);
      if (result && result.success) {
        this._bufferSignalUpdate(signalId, { executed: true, metadata: { execution_status: 'executed' } });
        this.metrics.executedSignals++;
      }
    }
  }

  // ==================== 快照与交易落库（writeBuffer + 虚拟时间重写）====================

  /**
   * 创建投资组合快照（重写基类：snapshot_time 用回放虚拟时刻，走 writeBuffer 批量）。
   * @param {number} [virtualTs] - 虚拟时刻（ms）；缺省退回当前真实时间（不应发生）
   */
  async _createPortfolioSnapshot(virtualTs) {
    const portfolio = this._portfolioManager?.getPortfolio(this._portfolioId);
    if (!portfolio) {
      return;
    }
    const snapshotTime = new Date(virtualTs ?? Date.now()).toISOString();

    const snapshot = {
      experiment_id: this._experimentId,
      snapshot_time: snapshotTime,
      total_value: String(portfolio.totalValue || 0),
      total_value_change: '0',
      total_value_change_percent: '0',
      cash_balance: String(portfolio.cashBalance || portfolio.availableBalance || 0),
      cash_native_balance: String(portfolio.cashBalance || portfolio.availableBalance || 0),
      total_portfolio_value_native: String(portfolio.totalValue || 0),
      token_positions: '[]',
      positions_count: portfolio.positions ? portfolio.positions.size : 0,
      metadata: JSON.stringify({
        loop_count: this._loopCount,
        availableBalance: String(portfolio.availableBalance || 0),
        totalInvested: String(portfolio.totalInvested || 0),
        totalPnL: String(portfolio.totalPnL || 0),
        timestamp: snapshotTime,
      }),
    };

    if (this._writeBufferEnabled && this._writeBuffer) {
      this._writeBuffer.addSnapshotInsert(snapshot);
    } else {
      // 缓冲关闭（仅调试用）：直写（时间用真实时钟，与基类一致）
      await super._createPortfolioSnapshot();
    }
  }

  /**
   * 执行交易（重写基类：成功后 writeBuffer.addTradeInsert 批量落库，
   * 替代逐条 trade.save()）。Trade.createdAt 经 metadata.timestamp 取回放历史时间。
   */
  async executeTrade(tradeRequest) {
    const { Trade } = require('../entities');

    const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);
    if (!portfolio) {
      throw new Error('投资组合不存在');
    }

    const position = portfolio.positions.get(tradeRequest.tokenAddress.toLowerCase());
    const currentPrice = tradeRequest.price || (position ? position.currentPrice : 0);

    const isBuy = tradeRequest.direction.toLowerCase() === 'buy';
    // amount 可为 Decimal 实例（E5 卖腿精确链）；String() 得精确数字串，parseFloat 仅用于
    // inputAmount/outputAmount 成交记录（double 精度足够，无比较语义）
    const tokenAmount = parseFloat(String(tradeRequest.amount));
    const price = parseFloat(currentPrice);
    const inputAmount = isBuy ? (tokenAmount * price) : tokenAmount;
    const outputAmount = isBuy ? tokenAmount : (tokenAmount * price);

    const trade = new Trade({
      experimentId: this._experimentId,
      signalId: tradeRequest.signalId || null,
      tokenAddress: tradeRequest.tokenAddress,
      tokenSymbol: tradeRequest.symbol,
      direction: tradeRequest.direction.toLowerCase(),
      inputCurrency: isBuy ? 'BNB' : tradeRequest.symbol,
      outputCurrency: isBuy ? tradeRequest.symbol : 'BNB',
      inputAmount: String(inputAmount),
      outputAmount: String(outputAmount),
      unitPrice: String(price),
      txHash: tradeRequest.txHash || null,
      metadata: tradeRequest.metadata || {},
    });

    let result;
    try {
      result = await this._portfolioManager.executeTrade(
        this._portfolioId,
        tradeRequest.tokenAddress,
        tradeRequest.direction.toLowerCase(),
        tradeRequest.amount,
        currentPrice,
      );
    } catch (pmError) {
      // E5d 修复（可观测）：PM 异常原为静默 return（Insufficient 被吞导致漏诊）
      this.logger.error(this._experimentId, 'executeTrade',
        `PM 交易异常(回放) | ${tradeRequest.symbol} ${tradeRequest.direction} ${pmError.message}`);
      trade.markAsFailed(pmError.message || '交易执行异常');
      return {
        success: false,
        message: pmError.message || '交易执行异常',
        reason: pmError.message || '交易执行异常',
        error: pmError.message || '交易执行异常',
      };
    }

    if (!result) {
      return {
        success: false,
        message: 'PortfolioManager.executeTrade 返回空值',
        reason: 'PortfolioManager.executeTrade 返回空值',
      };
    }

    if (result.success) {
      trade.markAsSuccess();

      if (this._writeBufferEnabled && this._writeBuffer) {
        this._writeBuffer.addTradeInsert(trade.toDatabaseFormat());
      } else {
        await trade.save();
      }

      return { success: true, tradeId: trade.id, trade, portfolio: result.portfolio };
    }

    const failureReason = result.message || result.reason || result.error || '未知失败原因';
    trade.markAsFailed(failureReason);
    return { success: false, message: failureReason, reason: failureReason, error: failureReason };
  }

  // ==================== 辅助 ====================

  /** 信号增量更新（走 writeBuffer 批量或直写） */
  _bufferSignalUpdate(signalId, updateData) {
    if (!signalId) return;
    if (this._writeBufferEnabled && this._writeBuffer) {
      this._writeBuffer.addSignalUpdate(signalId, updateData);
    }
    // writeBuffer 关闭时信号已即时落库，此处无直写路径（与旧回测一致：缓冲关闭仅调试用）
  }

  /** 永久阻断条件评估（扁平标量上下文上的 JS 表达式，AND/OR/NOT 语法糖） */
  _evaluatePermanentBlock(preBuyCheckResult, condition) {
    if (!condition || String(condition).trim() === '') {
      return { blocked: false, reason: '' };
    }
    try {
      const context = {};
      for (const [key, value] of Object.entries(preBuyCheckResult)) {
        if (typeof value !== 'object' && typeof value !== 'function') {
          context[key] = value;
        }
      }
      const jsExpr = String(condition)
        .replace(/\bAND\b/gi, '&&')
        .replace(/\bOR\b/gi, '||')
        .replace(/\bNOT\b/gi, '!');
      const keys = Object.keys(context);
      const values = Object.values(context);
      const fn = new Function(...keys, `return ${jsExpr};`);
      const blocked = fn(...values);
      return blocked
        ? { blocked: true, reason: `永久阻断: ${condition}` }
        : { blocked: false, reason: '' };
    } catch (error) {
      this.logger.error(this._experimentId, '_evaluatePermanentBlock', `条件评估失败: ${error.message}`);
      return { blocked: false, reason: '' };
    }
  }

  getStats() {
    return {
      engine: { id: this._id, mode: this._mode, status: this._status, loopCount: this._loopCount },
      metrics: { ...this.metrics },
      replay: {
        sourceExperimentId: this._sourceExperimentId,
        totalTicks: this._ticks.length,
        tokenCount: this._seenTokens.size,
        debouncePending: this._buyDebouncer ? this._buyDebouncer.size : 0,
        sellDebouncePending: this._sellConfirmDebouncer ? this._sellConfirmDebouncer.size : 0,
      },
      tokenPool: this._tokenPool ? this._tokenPool.getStats() : null,
      balance: this.currentBalance,
    };
  }
}

module.exports = { BacktestEngine };
