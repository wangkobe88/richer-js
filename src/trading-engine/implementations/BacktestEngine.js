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
 *   - C84 新模型腿（2026-10-17，narrativeTriggerCondition）：发起/重试轮状态机是
 *     实时引擎语义，回测无状态机——rating 预载为 FA token 常量（同上时序穿越
 *     声明）、retryDue 恒 0、fire 直调仅为取 gmgnRisk 快照
 */

const { TradingMode, EngineStatus } = require('../interfaces/ITradingEngine');
const { AbstractTradingEngine } = require('../core/AbstractTradingEngine');
const { ExperimentDataService } = require('../../web/services/ExperimentDataService');
const { ExperimentStatsService } = require('../../web/services/ExperimentStatsService');
const Logger = require('../../services/logger');
const Decimal = require('decimal.js');

const baseConfig = require('../../../config/default.json');

// 永久阻断条件编译缓存（批次 4c）：key=jsExpr\0keys（形参列表决定 fn），命中免每
// tick new Function。FIFO 1000 上限纯防呆（实际条目数=distinct(条件,键集)，极小）
const _permBlockFnCache = new Map();

const TICK_PAGE_SIZE = 500;       // keyset 分页页大小（单 token 长尾路径；必须 < Supabase
                                  // 默认 max rows 1000，否则响应被服务端截断、终止条件误判）
const TICK_UNORDERED_LIMIT = 1000; // 无序合一拉取上限（对齐 Supabase max rows 硬上限——
                                  // 服务端 max-rows 截断恰在此值，limit 再大也拿不到更多）
const MAX_TICK_PAGES = 2000;      // 分页保护上限（全局累计 100 万 tick）
const TOKEN_CHUNK_SIZE = 50;      // .in 批大小（探针 + 数据装载合一请求共用）。2026-10-09
                                  // 沿革：in(N)+gt(id)+ORDER BY id+limit 形状 planner 稳定选
                                  // id 顺序扫（36a2c12a 四启全死于 8s statement timeout，页级
                                  // 重试 3 次仍死=计划本身坏，与 (token,platform,id) 索引无关）；
                                  // 无序形状（无 ORDER BY）无 top-k 可贪、稳定走 token 索引
                                  //（探针 LIMIT 1 / count exact 实测皆 <100ms），装载已切锚定
                                  // 无序拉取（_fetchPlatformTicksRows）
const PAGE_ATTEMPTS = 3;          // 单页拉取重试上限（探针 PROBE_ATTEMPTS 同款；连续失败 throw）
const LOAD_POOL_CONCURRENCY = 5;  // 装载段批并发（P5，2026-10-12）：探针/fetch 外层 chunk/
                                  // graduation 三处共用（perf6 实测 fourmeme 探针 152s + fetch
                                  // 92s 全是 1915 批串行 RTT，flap 同构；5 与 P3d 龙头
                                  // candidateConcurrency 同值，对同一 Supabase 已实证安全）
const SNAPSHOT_INTERVAL_MS = 30 * 1000; // 组合快照虚拟时间桶（对齐实时引擎 30s）
// ticks 拉取列清单单一事实源：拉取查询与 BacktestTickCache columnsTag 同源
//（列变更时旧缓存自动判废重拉，不静默缺列）
const TICK_SELECT_COLUMNS = 'id, token_address, trade_type, trader_address, sender_address, price_bnb, price_usd, bnb_amount, token_amount, block_number, block_time, tx_hash, log_index, price_outlier, platform';

/**
 * 回放排序比较函数：链上真序 (block_number, log_index)，id 仅作最终 tie-breaker
 * （log_index 是区块内日志索引，(block_number, log_index) 全局唯一；id 只保证排序
 * 确定性）。2026-10-08 凑凑 0x8ea2…7777 案：原 raw.sort(id) 的 bigserial 分配序
 * ≠提交序——watcher 延迟落库让 07:45:38 的峰行 id 反而小于 07:45:35 的行，回放
 * 把未来 3 秒的峰提前喂进 FA 价格史，P11 据此算出回撤 -35% 提前全清（真实时序
 * 该刻峰值利润仅 +8.7% 不触发）。链上真序是回测有效性的前提。
 */
function compareByChainOrder(a, b) {
  return (a.block_number - b.block_number) || (a.log_index - b.log_index) || (a.id - b.id);
}

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
    this._routerGateState = new Map();  // router 门观察史 tokenAddress → { lowSideSeen, outCount }（pre-check/router-gate-state.js；回放逐 fire 累计与实时同源）
    this._lastSnapshotTs = null;        // 上一个组合快照的虚拟时刻
    this._inflightEvals = new Set();    // 回放中 fire-and-forget 的评估 promise（买评估/卖去抖 fire；drain 用）
    this._finalStatusSet = false;       // 回放终态已写（stop 保护用）

    // graduation 事件回放（2026-10-10 虚拟↔回测一致性对齐，a21fa102 CZ 毕业票案）：
    // 毕业后 token ticks 停止，虚拟引擎有事件驱动全清（_handleGraduation →
    // _emitGraduationSell，断流前最后可靠价落袋），回测缺事件流时毕业持仓只能靠
    // 回放结束强平——同 token 同策略下卖出路径系统性分叉。此处从 wss_events
    // kind='graduation' 拉事件，按 tsMs 插入 tick 流回放（消费点/买入补卖/幂等
    // 标记后置三挂点对齐虚拟引擎，见各方法注释）
    this._graduationEvents = [];        // { token, tsMs, fundsBnb } 按 tsMs 升序
    this._gradEvtIdx = 0;               // 消费指针（卖出失败不推进 = 下轮重试，虚拟扫描兜底等价物）
    this._graduationSoldTokens = new Set(); // 幂等标记（后置到卖出成功，虚拟竞态修复同款）
    this._graduatedTokens = new Set();  // 事件已到达集合（买入成功点补卖判据——先于 FA 注册的边缘）

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
    // P2b 死重维护开关（2026-10-12 回测性能案）：回测结构性不嵌 OPB（无写表副作用）→
    // 分类器轨迹（_clsTicks/_lastBigTickAt/afterFirst9s 族/_relHighestPriceUsd）恒零读关闭；
    // TPA 双 map（_walletMaxNetTokens/_walletRoutedBuyBnb）按实验配置判定——与下方 TPA
    // 构造条件（tokenPositionAnalyzer 段存在才构造）同判据
    // P17 虚拟时钟 prune（2026-10-13 OOM 根治）：live 引擎 5min setInterval 调
    // pruneStaleTokens（FourMemeWssTradingEngine._runMainLoop），回测全文无调用——
    // 去世 token 的全史钱包结构（9 Map+3 Set per state）永久驻留，perf3/perf4 双双
    // 死于 2G heap。回测按 tick 虚拟时刻 prune（挂 30s 快照桶内、内部 5min 虚拟节流），
    // 时钟参数对齐 live 30min/5min 缺省。faPruneMaxAgeSec=0 关闭（回滚开关）。
    // ★maxTrackedTokens 必须对齐：live 默认 300 的容量上限淘汰逻辑在 prune 内部，
    // 回测窗口 token 数千起、不对齐会把活票按「最久未动」清掉（构造前注入——
    // FA 构造函数即刻读取该键）
    const btPrune = this._experiment?.config?.backtest || {};
    wsConfig.maxTrackedTokens = btPrune.maxTrackedTokens ?? 100000;
    this._faPruneMaxAgeMs = btPrune.faPruneMaxAgeSec != null ? btPrune.faPruneMaxAgeSec * 1000 : 30 * 60 * 1000;
    this._faPruneIntervalMs = btPrune.faPruneIntervalSec != null ? btPrune.faPruneIntervalSec * 1000 : 5 * 60 * 1000;
    this._lastFaPruneTs = null;
    this._faPrunedTotal = 0;

    this._factorAggregator = new FourMemeFactorAggregator({
      fourmemeWs: wsConfig,
      maintainClassifierTracks: false,
      maintainTpaTracks: this._experiment?.config?.tokenPositionAnalyzer != null,
    }, this.logger);
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
    // 跟单簇名单（2026-10-16 FLY 案）：读文件，与 WSS 引擎同入口同名单（parity）。
    // ⚠回测前视声明：名单是扫描时点的静态快照（含全史跟单关系），历史窗口回测引用
    // 它有前视面——与 sniper 名单「启动加载当前态」同款已接受近似；实盘无此问题。
    try {
      await FourMemeFactorAggregator.loadCopyWalletRoster();
    } catch (e) {
      this.logger.warn(this._experimentId, 'BacktestEngine', `跟单簇名单加载失败(fail-closed, maxCopyWalletHolderCircPct 将恒 null=门拦): ${e.message}`);
    }
    // 极著名钱包子集（famousCopyWalletCircPct 原料）：与 WSS 引擎同入口同集合（parity）；
    // fail-open 同款（加载失败/文件缺失 → 因子恒 0=裸比较放行，快照同形；2026-10-22 去 NULL）
    try {
      await FourMemeFactorAggregator.loadFamousCopyWallets();
    } catch (e) {
      this.logger.warn(this._experimentId, 'BacktestEngine', `极著名钱包名单加载失败(fail-open, famousCopyWalletCircPct 恒 0=裸比较放行): ${e.message}`);
    }
    // sybil 大簇钱包并集（2026-10-20 乌龟案用户裁定）：与 WSS 引擎同入口同集合（parity）；
    // fail-open 同款（加载失败/文件缺失 → 因子恒 0=裸比较放行，2026-10-22 去 NULL 同批）
    try {
      await FourMemeFactorAggregator.loadSybilClusters();
    } catch (e) {
      this.logger.warn(this._experimentId, 'BacktestEngine', `sybil 大簇名单加载失败(fail-open, sybilClusterHolderCircPct 恒 0=裸比较放行): ${e.message}`);
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
          // 买腿第三层 GMGN 条件（FAKER 团伙盘案 2026-10-14；买腿消费，卖腿携带不
          // 生效与 preBuy* 对称）。★此白名单映射漏透传=回测第三层同样静默失效
          //（v15 事故 2026-10-15 与实时引擎同坑，单测已锁两处透传）
          gmgnCheckCondition: s.gmgnCheckCondition || null,
          narrativeCallCondition: s.narrativeCallCondition || null,
          // C84 新模型腿（2026-10-17）：叙事发起条件——与 narrativeCallCondition 同为
          // FA 集条件字段（loadStrategies 第四集校验+互斥）。★此白名单映射漏透传=
          // 回测触发腿失明（v15 GMGN 透传事故同坑，单测锁两处透传）
          narrativeTriggerCondition: s.narrativeTriggerCondition || null,
          // pumpfun 回迁批 2 卖腿机制字段（卖腿消费；买腿携带不生效，与 preBuy* 字段对称）
          bypassDebounce: !!s.bypassDebounce,
          lockTokenAfterSell: !!s.lockTokenAfterSell,
          cumulativeLossLockPct: typeof s.cumulativeLossLockPct === 'number' ? s.cumulativeLossLockPct : null,
          // sellPercentage 已退役（2026-10-24）：刻意原样透传（勿归一化吞掉）——
          // loadStrategies fail-fast 靠它识别携带旧字段的存量实验并拒启（groups/cycle
          // 同款防线；与实时引擎同坑，单测锁两处透传）
          sellPercentage: s.sellPercentage,
          // 卡牌仓位（迁自 rich-js）：cards/cooldownSec 原样透传，loadStrategies 内归一化
          //（正整数/卖腿 'all'，脏值 → null=旧语义）；cooldownSec 独立于卡牌机制生效
          cards: s.cards,
          cooldownSec: s.cooldownSec,
          // 已删除机制的 legacy 字段（cycle 分桶路由 2026-10-15 删除）刻意原样透传：
          // loadStrategies fail-fast 靠它识别携带旧字段的存量实验并拒启（剥掉这里
          // = fail-fast 失明 = 腿静默恒可见，危险方向）
          groups: s.groups,
          cycle: s.cycle,
          enabled: true,
        });
      });
    }
    // 未知因子 fail-fast（2026-10-03 hg55 事故裁定）：condition/narrativeCall 用 FA
    // 因子集校验；preBuy/repeat 买检查用 PreBuyCheckService 评估上下文键集校验；
    // gmgnCheckCondition 用第三层固定三键集校验（FAKER 团伙盘案 2026-10-14）
    //（别名防与第 5 步的 PreBuyCheckService 声明重复）
    const { PreBuyCheckService: _PreBuyCheckService } = require('../pre-check/PreBuyCheckService');
    const { GmgnRiskCheckService: _GmgnRiskCheckService } = require('../pre-check/GmgnRiskCheckService');
    this._strategyEngine.loadStrategies(strategyArray, availableFactorIds,
      new Set(_PreBuyCheckService.getConditionFactorKeys()),
      new Set(_GmgnRiskCheckService.getConditionFactorKeys()));

    // 累亏闩锁阈值：取卖腿 cumulativeLossLockPct 最大值（多腿并存最严者先锁，fail-closed 方向）；
    // 未配置任何腿 = null = 机制关闭（存量实验零变化，语义同实时引擎）
    const _cumLocks = this._strategyEngine.getAllStrategies()
      .filter(s => s.action === 'sell' && s.cumulativeLossLockPct != null)
      .map(s => s.cumulativeLossLockPct);
    this._cumLossLockPct = _cumLocks.length > 0 ? Math.max(..._cumLocks) : null;

    this.logger.info(this._experimentId, 'BacktestEngine',
      `✅ 策略引擎初始化完成，加载了 ${this._strategyEngine.getStrategyCount()} 个策略`);

    // 6.1 FA preFilter（pumpfun 回迁；**默认开**——2026-10-12 用户裁定，显式
    // backtest.faPreFilter===false 关闭）：从每个买腿 condition AST 提取 age 区间
    // （分钟，与 FA age 因子同锚同单位），多策略取【并集】注入 FA——未持仓 token 的
    // age 落在全部区间外 → buildFactorMap 跳过因子构建（纯提效：AND 链 condition 出
    // age 区间必 false，不漏买；持仓票豁免 = 卖腿/止损因子不受影响）。已知代价：跳过
    // 连带跳过超龄未持仓 token 的 TPA checkAndTrigger——仅观察数据损失（该 token
    // 已出买窗永不再买，notpa 消融实测 TPA 机制扰动 −0.80≈0）；双跑
    // 验证臂 pf0（69b43310，faPreFilter=true vs v0 关侧）trades 对拍进行中
    if (backtestConfig.faPreFilter !== false) {
      const { ConditionEvaluator } = require('../../strategies/ConditionEvaluator');
      const ranges = [];
      for (const s of this._strategyEngine.getAllStrategies()) {
        if (s.action !== 'buy') continue;
        // ★s.condition 是 loadStrategies 存的 AST 对象（非字符串）——原 String(s.condition)
        // 化成 "[object Object]" → parse 恒 throw → 提取恒 null，任何 condition 都「无可提取」
        // （e50 3fcea181 三次实测均此形状，preFilter 从未生效）。extractBuyRangeFromCondition
        // 已改双形状入口（string|AST），此处直传
        const pf = s.condition ? ConditionEvaluator.extractBuyRangeFromCondition(s.condition) : null;
        if (pf) ranges.push(pf);
      }
      this._factorAggregator.setPreFilter(ranges.length > 0 ? ranges : null);
      if (ranges.length > 0) {
        const fmt = pf => `age∈[${pf.minAgeMinutes ?? '-∞'},${pf.maxAgeMinutes ?? '∞'})`;
        this.logger.info(this._experimentId, 'preFilter',
          `FA preFilter 已启用（默认开，backtest.faPreFilter=false 可关）：${ranges.length} 个买腿区间并集 ${ranges.map(fmt).join(' | ')}`);
      } else {
        this.logger.info(this._experimentId, 'preFilter',
          'FA preFilter 开启但无可提取 age 区间的买腿（OR 结构/无 age 子句）→ 不过滤');
      }
    }

    // 5. 购买前检查服务（与实时引擎同源构建）
    const { PreBuyCheckService } = require('../pre-check/PreBuyCheckService');
    const { dbManager } = require('../../services/dbManager');
    const supabase = dbManager.getClient();
    const preBuyCheckConfig = {
      ...baseConfig.preBuyCheck,
      ...(this._experiment?.config?.preBuyCheck || {}),
      // P4a 已知因子合取项短路（2026-10-12 回测性能第三层画像）：回测默认开
      // （44.5% 检查 rating=1 恒拦仍走全链 ≈墙钟 23% 纯浪费）；live 默认关
      // 零变化。优先级：backtest.knownFactorShortCircuit > preBuyCheck.
      // knownFactorShortCircuit > 默认 true
      knownFactorShortCircuit: backtestConfig.knownFactorShortCircuit
        ?? this._experiment?.config?.preBuyCheck?.knownFactorShortCircuit ?? true,
    };
    // P1-2 日志降噪（bc4f756e 性能案：PreBuyCheck+EarlyParticipant per-signal 明细
    // 占日志量 73%、其中严格同名 DEBUG 大对象行占墙钟 15.2%）：config.backtest.
    // logMinLevel（'DEBUG'|'INFO'|'WARN'|'ERROR'，默认 null=现状全量）时给 pre-buy
    // 服务链（PreBuyCheck→EarlyParticipant/WalletCluster/SameName 等子服务共用）
    // 传独立降级 Logger——判级短路发生在 JSON.stringify 之前；引擎主日志
    // （BuyEval 触发/否决登记/直调/龙头/成交决策行）不动。两 Logger 写同一文件
    const _logMinLevel = backtestConfig.logMinLevel || null;
    const preBuyLogger = _logMinLevel
      ? new Logger({ dir: './logs', experimentId: this._experimentId, minLevel: _logMinLevel })
      : this.logger;
    this._preBuyCheckService = new PreBuyCheckService(supabase, preBuyLogger, preBuyCheckConfig);
    await this._preBuyCheckService.initialize('bsc');
    this.logger.info(this._experimentId, 'BacktestEngine',
      `✅ 购买前检查服务初始化完成 (earlyParticipantFilterEnabled=${preBuyCheckConfig.earlyParticipantFilterEnabled})`);

    // 5.5 叙事评级直调（同实时引擎：策略 narrativeCallCondition 触发时同步调
    // NarrativeAnalyzer.analyze，Jev 秒级；失败/超时=9 放行）。memoryCacheResults
    // 回测专属开启（bc4f756e 性能案 2026-09-28）：终态 PASS 结果进程内缓存，
    // 消除暖缓存下每次直调的 token_narrative 表 DB 往返；live 构造点不传=零变化
    const { NarrativeDirectCaller, mapGmgnRiskFactors, shouldBlockOnNarrative } = require('../pre-check/NarrativeDirectCaller');
    this._narrativeCaller = new NarrativeDirectCaller({ memoryCacheResults: true });
    // C84：回测无叙事触发状态机（发起/重试轮=实时引擎语义）——FA 叙事因子 config
    // 关死 retry（intervalMs=Infinity/maxAnalyses=0 → narrativeRetryDue 恒 0）。
    // 各键恒全传：防同进程先跑回测再起实时（或反向）时继承对方 config 串台
    // （C162 零语料臂 noCorpus* 两键同批锁死——回测禁补轮=语料前视防线不变）
    require('../../services/FourMemeFactorAggregator')
      .setNarrativeFactorConfig({ intervalMs: Infinity, maxAnalyses: 0, noCorpusIntervalMs: Infinity, noCorpusMaxAnalyses: 0 });
    // 挂 this：解构是函数级作用域，_evaluateBuyPath 裸引用会 ReferenceError（同实时引擎蝴蝶轮回案）
    this._mapGmgnRiskFactors = mapGmgnRiskFactors;
    // 叙事否决短路集（镜像实时引擎 _narrativeBlockedTokens，2026-09-27 用户裁定：
    // 叙事评级 low 终态的代币不再重复生成买信号——检测多少次都没用）。回测此前漏接，
    // 导致已否决 token 每次 fire 重复整链（bc4f756e 实证：222 token 重复 10,564 条
    // BUY 信号，98.9% rating=1，占 67.7min 回放的主导耗时）。内存语义同实时引擎：
    // 重启丢失后首 fire 缓存命中秒回重新登记，代价一条 signal 行
    this._narrativeBlockedTokens = new Set();
    this._shouldBlockOnNarrative = shouldBlockOnNarrative;

    // 5.6 同叙事龙头已火检查（同实时引擎：narrativeLeaderHot 因子，火门槛 5x + 首达后 24h 窗；
    // checkTimeSec 用回放时点，涨幅只算 block_time<=t 的 ticks，无未来函数）
    // P6 回测内存行源（2026-10-13，perf7 画像：龙头 3049 次 sum 178s≈回放段 25%，
    // 其中 ~75% 是 p50 40ms 级纯 RTT 空转）：候选集首次确定时预拉全窗口 ticks 进
    // 内存，此后首查/批量增量零 RTT（行处理循环逐字不动）。装载上界=回放终点；
    // 无终点实验不设上界=装载时点快照（迟到行不可见，fail-open 方向，与叙事预载
    // /负缓存同族口径）。实时引擎不注入=零变化
    const { SameNarrativeLeaderService } = require('../pre-check/SameNarrativeLeaderService');
    this._sameNarrativeLeaderService = new SameNarrativeLeaderService(supabase, this.logger);
    this._sameNarrativeLeaderService.enableReplayRowSource({
      endTimeIso: this._endTimeFilter ? new Date(this._endTimeFilter).toISOString() : null,
    });

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

    // P18 tick 路径 build 条件化（2026-10-13 回测性能案）：未持仓票中「买窗内」票
    // 不再全量 build（buildFactorMap 段主体 ~49 万次全量构建是纯 CPU 大头）。
    // tb0 对拍收口（2026-10-13）后**默认开**：显式 tickBuildSkip:false 恢复恒 build
    // 旧行为；出窗票走 FA.shouldSkipTickBuild（与现状 build-null continue 副作用
    // 序列等价）。旧 cycle 分桶互斥防线已随机制删除（2026-10-15）
    this._tickBuildSkip = backtestConfig.tickBuildSkip !== false;

    // 6.7 引擎级止损双腿（虚拟↔回测一致性 2026-10-10 对齐，a21fa102 配对案）：语义
    //     与实时引擎 FourMemeWssTradingEngine 完全一致——不配 stopLoss 段 = 机制完全
    //     关闭（存量回测实验零变化）。回测形态差异：触发时刻全部用 tick 虚拟时钟
    //     （tick 路径=tickTs；扫描路径=当前回放到的 tickTs，等价实时的墙钟扫描）；
    //     毕业兜底不走扫描（虚拟的扫描挂点在回放里由事件消费指针的重试语义等价
    //     覆盖——卖出失败不推进指针每 tick 重试，见 _consumeGraduationEvents）
    const _sl = experimentConfig.stopLoss || {};
    const _slTimeMin = Number(_sl.timeStopMinutes);
    const _slPricePct = Number(_sl.priceStopPercent);
    this._stopLossTimeSec = Number.isFinite(_slTimeMin) && _slTimeMin > 0 ? _slTimeMin * 60 : null;
    this._stopLossPricePct = Number.isFinite(_slPricePct) && _slPricePct < 0 ? _slPricePct : null;
    const _slScanSec = Number(_sl.scanIntervalSec);
    this._stopLossScanMs = Number.isFinite(_slScanSec) && _slScanSec > 0 ? _slScanSec * 1000 : null;
    this._stopLossEnabled = !!(this._stopLossTimeSec || this._stopLossPricePct);
    this._lastStopLossScanTs = null;
    if (this._stopLossEnabled) {
      this.logger.info(this._experimentId, 'BacktestEngine',
        `🛡️ 止损双腿已启用(回测) | ${this._stopLossTimeSec != null ? `时间止损: 持有>${Math.round(this._stopLossTimeSec / 60)}min仍浮亏或持平全清 ` : ''}` +
        `${this._stopLossPricePct != null ? `价格止损: 现价≤成本${this._stopLossPricePct}%全清 ` : ''}` +
        `| 持仓扫描=${this._stopLossScanMs != null ? this._stopLossScanMs / 1000 + 's(虚拟时钟)' : '未配置（仅 tick 路径）'}`);
    }

    // 7. 批量写入缓冲区
    const { BacktestWriteBuffer } = require('../backtest/BacktestWriteBuffer');
    this._writeBuffer = new BacktestWriteBuffer(supabase, this.logger);
    this._writeBufferEnabled = experimentConfig.backtest?.writeBufferEnabled !== false;

    // 7.5 TPA 触发点持仓分析（回迁批 4 shadow 先行）：opt-in 同实时引擎——实验 config 整段无
    //     tokenPositionAnalyzer → 不构造（存量实验零影响）；段存在才构造（trigger fail-fast）。
    //     回测三点差异：persistSink 走 writeBuffer 攒批（决策不依赖落表，仅写库时机后移）；
    //     _alignClassifiedAsOf=true（防前视：分类可见时刻>asOf 的 token 不计 bad_action）；
    //     启动后预载三连（见 _runLoadPipeline，ticks 装载完成后）
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

    // 8.5 卖出确认去抖（虚拟时钟模式：首真 tick 起计不重置；默认 0=关闭=存量实验零变化；
    // minTicks 双门同键透传——virtual 时钟只在 tick 到达时推进，maxWait 强制门对死票
    // 无法触发（时钟静止），活票 advance 检查等价 real，见 SellConfirmDebouncer 头注）
    const { SellConfirmDebouncer } = require('../core/SellConfirmDebouncer');
    this._sellDebounceMs = wsConfig.sellDebounceMs ?? 0;
    this._sellConfirmDebouncer = new SellConfirmDebouncer({
      debounceMs: this._sellDebounceMs,
      minTicks: wsConfig.sellDebounceMinTicks ?? 0,
      maxWaitMs: wsConfig.sellDebounceMaxWaitMs ?? 120000,
      mode: 'virtual',
      onFire: (tokenAddress, tick, fireTs) => this._onSellDebounceFire(tokenAddress, tick, fireTs),
    });
    this.logger.info(this._experimentId, 'BacktestEngine',
      `交易金额配置 | tradeAmount=${this._tradeAmount}，debounce=${wsConfig.signalDebounceMs ?? 1500}ms` +
      `，sellDebounce=${this._sellDebounceMs}ms`);

    // 9. 加载回放数据 + 预载流水线（P13，2026-10-13 perf13 装载画像定因：9-9.5
    //     预载串行链 74s——叙事 29.7 + graduation 17.1 + 索引/sniper 25.5 + TPA 1.3，
    //     其中三项不依赖 ticks，可与 ticks 拉取 165s 并行藏入）
    await this._loadTokenMetadata();
    await this._runLoadPipeline();
  }

  /**
   * 装载段流水线（P13，2026-10-13）：_loadTokenMetadata 之后的全装载编排。
   * 组 A（不依赖 _ticks：叙事预载 9.1 / AVE 快照 9.3 / sniper 画像 9.4.5 / TPA
   * offline 画像 + token 分类预载——各自方法头有完整背景注释）与 ticks 拉取并行；
   * 组 B（graduation 批间 IO + EarlyParticipant 回放索引纯 CPU，两项互补）在 ticks
   * 完成后并行；TPA historical ticks 注入最后（setHistoricalTicks 消费 _ticks，
   * 纯 CPU 建索引）。失败语义与串行版逐字一致：叙事预载/graduation 失败 throw
   * 阻断启动，AVE/sniper/TPA 预载内部 fail-open 不 reject（preloadOfflineProfiles
   * 内部 catch 回退按需查、preloadTokenProfiles 单批失败 warn 不写 cache——两方法
   * 语义见 TokenPositionAnalyzer）；TPA 三连灌三个独立 Map
   * （_offlineProfilePreloaded/_walletTicksPreloaded/_tokenProfileCache，源码注释
   * 明示互不触碰），tpa1/tpa3 与 tpa2 注入无数据依赖，P14 挪入组 A 安全。
   * Promise.all 对每个输入挂 handler，无 unhandled rejection 面。
   * DB 并发峰值 = ticks 装载（双平台并行后 5+5）+ 五条预载分页流 ≈ 15（全部
   * 只读页查询；P5 实证 5 并发安全、P3d 龙头 5 并发共存，双平台并发翻倍属
   * P14b 实证范围，超时重试 PAGE_ATTEMPTS=3 兜底 fail-loud 不静默）
   */
  async _runLoadPipeline() {
    const tpa = this._tokenPositionAnalyzer;
    const groupA = [
      this._loadWssTicks(),
      this._preloadNarrativeRows(),
      this._loadSameNameSnapshots(),
      this._preloadSniperFlagsSafe(),
    ];
    if (tpa) {
      groupA.push(this._preloadTpaOfflineProfiles(tpa));
      groupA.push(this._preloadTpaTokenProfiles(tpa));
    }
    await Promise.all(groupA);
    this.logger.info(this._experimentId, 'BacktestEngine',
      `📊 回放数据就绪: ${this._ticks.length} 笔 tick，${this._tokenMeta.size} 个代币元数据`);

    await Promise.all([
      this._loadGraduationEvents(),
      this._buildEarlyReplayIndex(),
    ]);

    // TPA historical ticks 注入（回迁批 4，唯一消费 _ticks 的 TPA 步）：本实验全量
    // ticks 建 trader→ticks 索引（miss/stale 路径零查询；口径=注入实验口径 ticks，
    // 平台过滤后——架构性偏离 #4 已接受）
    if (tpa) {
      const traders = tpa.setHistoricalTicks(this._ticks);
      this.logger.info(this._experimentId, 'BacktestEngine',
        `TPA historical ticks 注入: ${this._ticks.length} 笔 → ${traders} traders`);
    }
  }

  /** TPA 预载 ①③（P14 抽方法入组 A）：offline 画像全表预载（内存 Map，启动期一次
   *  SELECT 换回放期零 DB 往返）。失败内部 catch warn 回退运行期按需查（fail-open） */
  async _preloadTpaOfflineProfiles(tpa) {
    const pre = await tpa.preloadOfflineProfiles(this._getClient());
    this.logger.info(this._experimentId, 'BacktestEngine',
      `TPA offline 画像预载: ${pre.rows} 行 / ${(pre.ms / 1000).toFixed(1)}s (${pre.source || 'fail-open'})`);
  }

  /** TPA 预载 ③（P14 抽方法入组 A）：token 分类预载（token_profiles 批量入 cache，
   *  运行期触发全命中）。单批失败 warn 不写 cache 该批运行期按需重查（fail-open） */
  async _preloadTpaTokenProfiles(tpa) {
    const cachedTps = await tpa.preloadTokenProfiles([...this._tokenMeta.keys()], this._getClient());
    this.logger.info(this._experimentId, 'BacktestEngine',
      `TPA token 分类预载: ${this._tokenMeta.size} token → cache ${cachedTps}`);
  }

  /**
   * 9.1 叙事结果预载（回测性能 2026-10-12；P13 抽方法入组 A）：带
   * narrativeCallCondition / narrativeTriggerCondition（C84 触发腿）的实验回放中
   * 每 token 首次直调走 analyze 缓存命中路径 = 2 次 DB 往返（token_narrative 行 +
   * 语料推文缓存行）≈34ms×N 串行（e50 实测 4007 次命中=137s）。装载时按 token
   * 集合批量预拉灌内存层，组装代码不变只换数据源——行为 bit-identical；无叙事
   * 条件字段的实验不预载（无直调 = 预载白拉）
   */
  async _preloadNarrativeRows() {
    if (!this._strategyEngine.getAllStrategies().some(s => s.action === 'buy'
      && (s.narrativeCallCondition || s.narrativeTriggerCondition))) {
      return;
    }
    const _npT0 = Date.now();
    const _np = await this._narrativeCaller.preload([...this._tokenMeta.keys()]);
    // C84 新模型腿：预载行灌 FA 叙事因子常量（单一买 condition 内 narrativeRating
    // 门的数据源）。rating=token 级全局快照——时序穿越与 narrativeRating 直调同
    // 声明（当前语料分析历史 token，结论只看相对增量）；数值链与 caller 命中路径
    // 同源（categoryToRating(resolveFinalRating(row))，非 1/2/3 归 9）。键用
    // _tokenMeta 原键（FA state 键=registerToken 实参原样），rowCache 小写查表。
    // 缺行 token 不注入 → narrativeRating=null → 条件恒 false 不买（fail-closed，
    // 与实时「分析未完成不交易」同向）
    let _injected = 0;
    if (this._strategyEngine.getAllStrategies().some(s => s.action === 'buy' && s.narrativeTriggerCondition)) {
      const FourMemeFactorAggregator = require('../../services/FourMemeFactorAggregator');
      const { deriveSuperIpLabels } = require('../../core/narrative/superip-labels.js');
      const { resolveFinalRating, categoryToRating } = await import('../../narrative/utils/rating-utils.mjs');
      for (const addr of this._tokenMeta.keys()) {
        const row = _np.rowCache.get(String(addr).toLowerCase());
        if (!row) continue;
        const _n = categoryToRating(resolveFinalRating(row));
        // C88 超级IP两标签常量注入（2026-10-18 CZ 出书簇）：rowCache select('*') 已含
        // event/event_score 列零额外查询，superip-labels 零列推导（与实时状态机回填
        // 三态同形；C88 前旧行无 hit 键 → slogan null）
        const _sip = deriveSuperIpLabels(row.event_result, row.event_score_result);
        FourMemeFactorAggregator.setNarrativeFactors(addr, {
          rating: [1, 2, 3].includes(_n) ? _n : 9,
          rounds: 1,
          completedAt: row.analyzed_at ? Date.parse(row.analyzed_at) : null,
          accountOnly: false,
          inFlight: false,
          // 叙事类型常量注入（Nightshift 案 2026-10-17）：rowCache select('*') 已含
          // token_category 列零额外查询；GMGN 条件层 narrativeCategory 因子源
          category: row.token_category ?? null,
          superIp: _sip.narrativeSuperIp ?? null,
          recognizedEntitySlogan: _sip.narrativeSuperIpSlogan ?? null,
        });
        _injected++;
      }
    }
    this.logger.info(this._experimentId, 'BacktestEngine',
      `叙事预载: ${_np.rowCache.size}/${this._tokenMeta.size} 行 + 语料推文 ${_np.tweetRows} 行` +
      `（${Date.now() - _npT0}ms${_injected ? `，FA 叙事常量注入 ${_injected}` : ''}）`);
  }

  /**
   * 9.4.5 sniper 画像全表预载（P12，2026-10-13 perf12 探针定因；P13 抽方法入
   * 组 A）：回放期 early 检查的 sniper 标志 miss 现查是碎 RTT 堆积（perf12
   * 实测 1626 批 / 5072 址 / 52428ms = earlySvc 96.5%，纯 CPU 仅 ~1.2s）。
   * 启动期一次全表 SELECT（TPA preloadOfflineProfiles 同款 cursor 分页形状）
   * 灌 boolean 缓存，运行期 miss 集归零（miss=不在表=无行=非 sniper，与现查
   * 空行 bit 一致）。失败 fail-open 运行期现查（不设全表标志=行为同未优化）；
   * 实时引擎不注入（单 token 低频 miss，实例缓存已够）
   */
  async _preloadSniperFlagsSafe() {
    const _spT0 = Date.now();
    try {
      const _sp = await this._preBuyCheckService.earlyParticipantService.preloadSniperFlags(this._getClient());
      this.logger.info(this._experimentId, 'BacktestEngine',
        `sniper 画像预载: ${_sp.rows} 行（${Date.now() - _spT0}ms）→ 运行期 miss 零查询`);
    } catch (e) {
      this.logger.warn(this._experimentId, 'BacktestEngine',
        `sniper 画像预载失败（fail-open，运行期现查）: ${e.message}`);
    }
  }

  /**
   * 9.4 EarlyParticipant 回放 ticks 索引（bc4f756e 性能案 2026-09-28；P13 抽方法
   * 入组 B）：回测期每触发买信号的早期参与者检查原本现查 wss_price_ticks（90s
   * 窗，一 signal 一次 DB 往返）；回放数据已全量在内存——按 token 分桶预建索引
   * 注入检查服务（TPA setHistoricalTicks 同款形态）。桶内 (timestamp, log_index)
   * 升序对齐 SQL order by block_time, log_index；查询语义（闭区间/outlier=false/
   * usd 非空/过滤后截断/桶 miss=空统计）见服务侧注释
   */
  async _buildEarlyReplayIndex() {
    const _epIdx = new Map();
    for (const t of this._ticks) {
      let arr = _epIdx.get(t.token_address);
      if (!arr) { arr = []; _epIdx.set(t.token_address, arr); }
      arr.push(t);
    }
    for (const arr of _epIdx.values()) {
      arr.sort((a, b) => (a.timestamp - b.timestamp) || ((a.log_index ?? 0) - (b.log_index ?? 0)));
    }
    this._preBuyCheckService.earlyParticipantService.setReplayTicksIndex(_epIdx);
    this.logger.info(this._experimentId, 'BacktestEngine',
      `EarlyParticipant 回放索引注入: ${this._ticks.length} 笔 → ${_epIdx.size} 个 token 桶`);
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
   * raw 行装载走 _loadRawTickRows：默认经 BacktestTickCache 本地缓存（jsonl.gz，
   * (sourceExperimentId, platform) 一文件全时段；配对回测/多轮验证免重复全量拉取，
   * 2026-09-29 参照 pumpfun TickDataCache 机制），backtest.cacheEnabled === false 时
   * 直拉（缓存路径只换数据来源，后续处理零差异）。
   * 全部载入后全局按 id 归并排序，再内存过滤时间窗。
   */
  async _loadWssTicks() {
    const supabase = this._getClient();
    const addresses = [...this._tokenMeta.keys()];
    // 配对回测对照臂开关（2026-10-01 GMGN 案 B 验证，H0/H1）：stripSenderAddress=true →
    // 回放 tick 不透传 sender_address → 消费侧全部 COALESCE 点（FA holders 族 + pre-buy
    // top1/sniper/netBuy）null 回退 trader，与修正前口径 bit-identical（单测 B4 机器证明）。
    // 只剥内存回放对象；BacktestTickCache 存的是 raw DB 行不动 → H0/H1 两臂共用同一缓存文件。
    const stripSender = this._experiment?.config?.backtest?.stripSenderAddress === true;
    const raw = await this._loadRawTickRows(supabase, addresses);
    // 链上真序回放（2026-10-08 凑凑案：id 分配序≠提交序，乱序回放=把未来 tick
    // 提前喂进因子状态的前视，见 compareByChainOrder 注释）
    raw.sort(compareByChainOrder);
    let tsRegressions = 0;
    let prevTs = null;
    for (const row of raw) {
      const ts = new Date(row.block_time).getTime();
      if (this._startTimeFilter && ts < this._startTimeFilter) continue;
      if (this._endTimeFilter && ts > this._endTimeFilter) continue;
      // 链序下 block_time 应非递减（BSC timestamp 协议保证单调）；倒退=数据形状
      // 异常，WARN 留痕不中断（观测口径，非兜底）
      if (prevTs !== null && ts < prevTs) tsRegressions++;
      prevTs = ts;
      this._ticks.push({
        token_address: row.token_address,
        trade_type: row.trade_type,
        trader_address: row.trader_address,
        sender_address: stripSender ? null : (row.sender_address || null),  // 真实买家 tx.from（0x1de460 案 2026-09-30）；NULL 回退 trader（消费侧 COALESCE）；H0 臂剥离复现旧口径
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
    if (tsRegressions > 0) {
      this.logger.warn(this._experimentId, 'BacktestEngine',
        `⚠️ 链上真序下 block_time 倒退 ${tsRegressions} 行（block_number/log_index 序与 block_time 不一致，需排查数据源）`);
    }
    // wss_price_ticks 表无 offers/funds_bnb 列：FA 仅在 tick.funds_bnb > 0 时更新
    // lastFundsBnb（回放恒保持 0），tvl 因子因此恒 0——策略 condition 引用 tvl 时需知情
  }

  /**
   * raw 行装载路由：缓存（默认）或直拉。双平台并行（P14b，2026-10-13 perf14 装载
   * 画像：fourmeme 64s + flap 83s 串行 = ticks 拉取窗 166s，两平台缓存文件/查询
   * 全独立）。开关：config.backtest.cacheEnabled（默认开启，=== false 才直拉）+
   * backtest.forceRefreshCache（默认 false，跳过缓存读强制重拉重建）。
   * 并行护栏口径：maxTickRows 原「全局累计」在双平台并行下退化为「每平台独立
   * 起算」（fetchRows 闭包创建时 raw 尚空）——护栏防「拉错集合」意外非正确性
   * 机制（行数对账保证无重复无遗漏），上限放宽 ×平台数可接受。
   */
  async _loadRawTickRows(supabase, addresses) {
    const btConfig = this._experiment?.config?.backtest || {};
    if (btConfig.cacheEnabled === false) {
      const perPlatform = await Promise.all(this._platforms.map(platform =>
        this._fetchPlatformTicksRows(supabase, addresses, platform, 0, 0)));
      const raw = [];
      for (const rows of perPlatform) for (const r of rows) raw.push(r);   // 禁 spread（大数组展开参数溢出风险）
      return raw;
    }
    if (!this._tickCache) {
      const { BacktestTickCache } = require('../core/BacktestTickCache');
      this._tickCache = new BacktestTickCache({ logger: this.logger, experimentId: this._experimentId });
    }
    const forceRefresh = btConfig.forceRefreshCache === true;
    const perPlatform = await Promise.all(this._platforms.map(async (platform) => {   // both → 两 platform 并行（缓存文件独立）
      const { rows, source } = await this._tickCache.getOrFetch({
        sourceExperimentId: this._sourceExperimentId,
        platform,
        addresses,
        forceRefresh,
        columnsTag: TICK_SELECT_COLUMNS,
        fetchRows: (afterId) => this._fetchPlatformTicksRows(supabase, addresses, platform, afterId, 0),
        probeMaxId: (anchor) => this._probeIncrementalTickId(supabase, addresses, platform, anchor),
        anchorExists: (id) => this._anchorRowExists(supabase, id),
      });
      // FRESH 纯读文件不经过 _fetchPlatformTicksRows（拉取行已在方法内计数），此处补计；
      // miss/stale/bypass 均经过 fetchRows 已计，按 source 区分防双计
      if (source === 'fresh') this.metrics.processedDataPoints += rows.length;
      this.logger.info(this._experimentId, 'BacktestEngine',
        `${platform}: raw ticks 装载 source=${source}, ${rows.length} 行`);
      return rows;
    }));
    const raw = [];
    for (const rows of perPlatform) for (const r of rows) raw.push(r);
    return raw;
  }

  /**
   * 单 platform 锚定无序拉取（2026-10-09 终版，36a2c12a 五连折教训）。
   * MISS 传 afterId=0，STALE 增量传缓存 meta.maxId。
   *
   * 形状沿革：in(N)+gt(id)+ORDER BY id+limit 形状 planner 稳定选 pkey 顺序扫
   * （ORDER BY id 的 top-k 贪心；in(100)/in(50) 皆 8s statement timeout 且页级
   * 重试 3 次仍死=计划本身坏，与 (token,platform,id) 索引无关）；逐 token eq 稳定
   * 但 95k token 串行 ~48min/平台不可接受。无序形状（count exact 79-91ms / 无序
   * limit 49-71ms，182 实测）无 top-k 可贪、planner 稳定走 token 索引——本方法
   * 全部请求无 ORDER BY（唯一例外：单 token eq keyset，等值选择性强制索引）。
   *
   * headAnchor 时变竞态封死：装载开始锚表头 id，全部请求 .lte(id, headAnchor)
   * 闭区间——count 与 fetch 之间采集器新写的行（id > headAnchor）不进区间，
   * 行数对账在固定区间上确定性一致（无序 limit N=count 数学无损）；锚后新行由
   * 下次 STALE 增量正常补齐（探针 gt(meta.maxId)）。
   *
   * 每 chunk(50) 合一请求（count exact + 无序 limit 1000）：count=0 → 跳过；
   * count≤1000 且 len==count → 一次拉全；count>1000（热门聚集）或对账失配 →
   * 拆半递归；单 token（长尾/失配定位）→ eq+keyset 拉全并对账 count，失配
   * throw fail-loud。禁 spread push。
   */
  async _fetchPlatformTicksRows(supabase, addresses, platform, afterId, priorRowCount) {
    // 全局累计护栏上限 config 可配（backtest.maxTickRows）：默认 100 万防「拉错集合」
    // 意外；多天大窗口（36a2c12a 4 天 both 全窗口回测 flap 即 90 万+）按实验显式
    // 放宽——护栏是防意外不是正确性机制（行数对账保证无重复无遗漏）。
    const maxTickRows = this._experiment.config?.backtest?.maxTickRows || MAX_TICK_PAGES * TICK_PAGE_SIZE;
    const rows = [];
    const headAnchor = await this._fetchHeadTickId(supabase);
    this.logger.info(this._experimentId, 'BacktestEngine',
      `${platform} ticks 装载锚定 headId=${headAnchor}（闭区间 (${afterId}, ${headAnchor}]，${addresses.length} token）`);

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const guardMaxRows = () => {
      if (priorRowCount + rows.length > maxTickRows) {
        throw new Error(`回放 tick 总量超出分页保护上限（${maxTickRows}）`);
      }
    };

    // 合一请求：count exact + 无序 limit（无 ORDER BY——planner 无 top-k 可贪）
    const countFetch = async (chunk) => {
      for (let attempt = 1; attempt <= PAGE_ATTEMPTS; attempt++) {
        const res = await supabase
          .from('wss_price_ticks')
          .select(TICK_SELECT_COLUMNS, { count: 'exact' })
          .in('token_address', chunk)
          .eq('platform', platform)
          .gt('id', afterId)
          .lte('id', headAnchor)
          .limit(TICK_UNORDERED_LIMIT);
        if (!res.error) return res;
        if (attempt === PAGE_ATTEMPTS) {
          throw new Error(`读取 wss_price_ticks 失败（连续 ${PAGE_ATTEMPTS} 次）: ${res.error.message}`);
        }
        await sleep(1000);
      }
    };

    // 单 token keyset（eq 等值形状，唯一允许 ORDER BY：等值选择性强制 token 索引）
    const keysetFetchToken = async (token, expectedCount) => {
      let cursor = afterId;
      let got = 0;
      for (let page = 0; page < MAX_TICK_PAGES; page++) {
        let data = null;
        let error = null;
        for (let attempt = 1; attempt <= PAGE_ATTEMPTS; attempt++) {
          const r = await supabase
            .from('wss_price_ticks')
            .select(TICK_SELECT_COLUMNS)
            .eq('token_address', token)
            .eq('platform', platform)
            .gt('id', cursor)
            .lte('id', headAnchor)
            .order('id', { ascending: true })
            .limit(TICK_PAGE_SIZE);
          if (!r.error) { data = r.data; break; }
          error = r.error;
          if (attempt < PAGE_ATTEMPTS) await sleep(1000);
        }
        if (error) throw new Error(`读取 wss_price_ticks 失败（连续 ${PAGE_ATTEMPTS} 次）: ${error.message}`);
        if (!data || data.length === 0) break;
        for (const row of data) rows.push(row);
        got += data.length;
        this.metrics.processedDataPoints += data.length;
        guardMaxRows();
        if (data.length < TICK_PAGE_SIZE) break;
        cursor = data[data.length - 1].id;
      }
      if (got !== expectedCount) {
        throw new Error(`wss_price_ticks 单 token 对账失配（keyset 拉到 ${got} ≠ count ${expectedCount}）: ${token}`);
      }
    };

    // 自适应拆分：count≤limit 且对账一致（len==count）→ 一次拉全（含单 token 小批，
    // 省一次 keyset）；count>limit（热门聚集）或对账失配（闭区间下不该发生）→ 多
    // token 拆半递归 / 单 token 走 keyset 拉全并对账 count，仍失配 throw fail-loud
    const loadChunk = async (chunk) => {
      const res = await countFetch(chunk);
      if (res.count == null) {
        throw new Error(`wss_price_ticks count 形状异常（null）: platform=${platform}${res.error ? ' ' + res.error.message : ''}`);
      }
      const count = res.count;
      if (count === 0) return;
      const data = res.data || [];
      if (count <= TICK_UNORDERED_LIMIT && data.length === count) {
        for (const row of data) rows.push(row);
        this.metrics.processedDataPoints += data.length;
        guardMaxRows();
        return;
      }
      if (chunk.length === 1) {
        await keysetFetchToken(chunk[0], count);
        return;
      }
      const mid = chunk.length >> 1;
      await loadChunk(chunk.slice(0, mid));
      await loadChunk(chunk.slice(mid));
    };

    // 外层 chunk 并发（P5）：chunk 间独立（共享 rows 数组只 push，行序由调用方全局
    // 排序兜底）；单 chunk 内部递归拆分/keyset 仍串行。maxTickRows 护栏在并发下
    // 允许 ≤ limit×1000 行的过冲才触发（护栏防「拉错集合」意外，非正确性机制——
    // 行数对账保证无重复无遗漏，见方法头注释）
    const chunks = [];
    for (let ci = 0; ci < addresses.length; ci += TOKEN_CHUNK_SIZE) {
      chunks.push(addresses.slice(ci, ci + TOKEN_CHUNK_SIZE));
    }
    let doneChunks = 0;
    await this._mapPool(chunks, LOAD_POOL_CONCURRENCY, async (chunk) => {
      await loadChunk(chunk);
      doneChunks++;
      if (doneChunks % 200 === 0) {
        this.logger.info(this._experimentId, 'BacktestEngine',
          `⏳ ${platform} ticks 无序拉取进度: token ${doneChunks * TOKEN_CHUNK_SIZE}/${addresses.length}（已取 ${rows.length} 行）`);
      }
    });
    return rows;
  }

  /**
   * 表头锚（锚定无序拉取配套）：无 where 的 ORDER BY id DESC LIMIT 1，pkey
   * 反向树最右叶子恒毫秒级（死的形状是「IN 列表 + 过滤 + ORDER BY DESC」的
   * top-k 贪心；无过滤表头 top-1 不扫区间）。空表返回 0（lte(id,0) 匹配 0 行
   * = 空装载，空表语义而非兜底）。
   */
  async _fetchHeadTickId(supabase) {
    for (let attempt = 1; attempt <= PAGE_ATTEMPTS; attempt++) {
      const res = await supabase
        .from('wss_price_ticks')
        .select('id')
        .order('id', { ascending: false })
        .limit(1);
      if (!res.error) {
        return res.data && res.data[0] ? Number(res.data[0].id) : 0;
      }
      if (attempt === PAGE_ATTEMPTS) {
        throw new Error(`wss_price_ticks 表头锚获取失败（连续 ${PAGE_ATTEMPTS} 次）: ${res.error.message}`);
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  /**
   * 新鲜度探针（锚定 + 无序形状，2026-10-08 计划翻转事故两轮改造）：
   * chunk × platform 查 `id > afterId` 增量区间**任意一行**（无 ORDER BY 的
   * LIMIT 1 存在性判定）。形状选择依据（182 真实 6f92e2f9 地址集实测）：
   * ① 旧无锚 `IN(N>3) + ORDER BY id DESC LIMIT 1` 表涨 150 万行后 planner 稳定
   *    选 id 反向扫描扫表头无关行 → 8s statement timeout（in20/in50 同死）；
   * ② 锚定 `gt(meta.maxId) + ORDER DESC LIMIT 1` 只救活 token 集仍活跃（锚近表头）
   *    的平台；token 集已死（锚=集内最后行 id，如 fourmeme 10-04 死）时区间
   *    (锚, 表头] 全为无关行，反向扫照样 8s——锚定对死集无效；
   * ③ 无序 LIMIT 1 无排序需求，planner 无 top-k 反向扫可贪，稳定走
   *    (token_address, platform, id) 索引 probe（每 probe O(log n) 与区间长度
   *    无关）——fourmeme 死集旧锚最坏情形 242 批 0 错、最慢 132ms。
   * 返回值：区间有行 → 观测到的行 id（跨批取 max，仅诊断日志用；真实 max 由
   * STALE 增量拉取后 _writeSorted 重算）；无行 → null。afterId 空/0 = 无锚全
   * 区间形状。单批失败重试 2 次（间隔 1s）：491 批长循环里单批撞 DB 负载抖动
   * （实测同形状 47ms~2s 波动、偶发 >8s statement timeout，2026-10-02 d46b1b6c
   * 案）不该让整个探针 throw → bypass 落回 keyset 慢形状直拉（flap 稀疏平台必
   * 超时）；连续 3 次失败仍 throw 保持 bypass 语义（真故障不掩盖）。
   */
  async _probeIncrementalTickId(supabase, addresses, platform, afterId) {
    const anchored = Number.isFinite(afterId) && afterId > 0;
    const PROBE_ATTEMPTS = 3;
    // 单批探测（P5：批间并发，批内重试语义不变——锚定无序 LIMIT 1 形状逐请求不动）
    const probeChunk = async (chunk) => {
      let data = null;
      for (let attempt = 1; attempt <= PROBE_ATTEMPTS; attempt++) {
        let q = supabase
          .from('wss_price_ticks')
          .select('id')
          .in('token_address', chunk)
          .eq('platform', platform);
        if (anchored) q = q.gt('id', afterId);
        const res = await q.limit(1);
        if (!res.error) { data = res.data; break; }
        if (attempt === PROBE_ATTEMPTS) {
          throw new Error(`wss_price_ticks 增量探针失败（连续 ${PROBE_ATTEMPTS} 次）: ${res.error.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      return data && data.length > 0 ? Number(data[0].id) : null;
    };
    const chunks = [];
    for (let ci = 0; ci < addresses.length; ci += TOKEN_CHUNK_SIZE) {
      chunks.push(addresses.slice(ci, ci + TOKEN_CHUNK_SIZE));
    }
    // 聚合取 max 与串行版等价（结果按输入序返回 + max 可交换）
    const observed = await this._mapPool(chunks, LOAD_POOL_CONCURRENCY, probeChunk);
    let maxId = null;
    for (const id of observed) {
      if (id != null && (maxId === null || id > maxId)) maxId = id;
    }
    return maxId;
  }

  /**
   * 锚行 PK 存在性核验（2026-10-08 锚定探针配套）：`where id = meta.maxId limit 1`
   * 主键单行查询恒快。锚定探针返回 null（增量区间无行）时区分 FRESH 与
   * 清表/删行回缩——gt 锚形状下「DB max < 锚」结构性探不到，回缩检测责任在此。
   */
  async _anchorRowExists(supabase, id) {
    const { data, error } = await supabase
      .from('wss_price_ticks')
      .select('id')
      .eq('id', id)
      .limit(1);
    if (error) throw new Error(`wss_price_ticks 锚行核验失败: ${error.message}`);
    return !!(data && data.length > 0);
  }

  _getClient() {
    const { dbManager } = require('../../services/dbManager');
    return dbManager.getClient();
  }

  /**
   * 有界并发池（P5 装载段并发化，2026-10-12）：items 经 fn 逐个处理，任意时刻
   * 在飞任务 ≤ limit；结果按输入序返回（与串行 map 等价，调用方排序/聚合不感知
   * 并发——装载三处全部 order-independent：fetch 行序由 _loadWssTicks 全局排序、
   * 探针聚合取 max、graduation 装载后按 tsMs 排序）。
   * 错误语义对齐串行版 fail-loud：首个错误停止派发新任务、等在飞任务 settle
   * （全部只读请求无副作用需取消）后 rethrow 首错。
   */
  async _mapPool(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    let firstErr = null;
    const worker = async () => {
      while (next < items.length && !firstErr) {
        const i = next++;
        try {
          results[i] = await fn(items[i], i);
        } catch (e) {
          if (!firstErr) firstErr = e;
        }
      }
    };
    const n = Math.max(1, Math.min(limit, items.length));
    await Promise.all(Array.from({ length: n }, () => worker()));
    if (firstErr) throw firstErr;
    return results;
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

      // P1 分段计时探针（2026-10-12 回测性能案）：六段累计定位 130 万 tick 回放的耗时
      // 分布。advance=debounce fire 全链（买/卖评估+叙事直调+preBuy+执行，直调与
      // preBuy 各有子计数器分解，见 NarrativeDirectCaller/PreBuyCheckService）；
      // other=快照/注册/touch/扫描/毕业等主循环杂项；六段总和对账回放总时长。
      // 探针开销：每 tick 6 次 Date.now()（~780 万次 ≈ 0.5s），70min 回放可忽略
      const perf = this._perf = { advance: 0, processTick: 0, buildFactorMap: 0, sell: 0, tpa: 0, other: 0 };
      let _p0;

      let processed = 0;
      for (const tick of this._ticks) {
        const tickTs = tick.timestamp;

        // 虚拟时钟推进：fire 到期的买评估（用截至上一笔 tick 的状态 + 本 tick 时刻）
        _p0 = Date.now();
        await this._advanceDebouncer(tickTs);
        perf.advance += Date.now() - _p0;

        _p0 = Date.now();
        // 组合快照 30s 虚拟桶（loopCount 随桶自增，对齐实时引擎时序轮次语义）
        if (this._lastSnapshotTs === null || tickTs - this._lastSnapshotTs >= SNAPSHOT_INTERVAL_MS) {
          this._lastSnapshotTs = tickTs;
          this._loopCount++;
          await this._createPortfolioSnapshot(tickTs);

          // P17 虚拟时钟 prune（OOM 根治，见 _initializeDataSources 构造注释）：挂 30s
          // 快照桶、内部 _faPruneIntervalMs 虚拟节流（对齐 live 5min setInterval），
          // 判定时钟=tickTs 虚拟时刻（非墙钟——5 天回放窗口若按墙钟 5min 节流会退化成
          // ~10 次 prune 挂一漏万）。失败 fail-open 对齐 live（:809 同款 catch 不中断回放）
          if (this._faPruneMaxAgeMs > 0 &&
              (this._lastFaPruneTs === null || tickTs - this._lastFaPruneTs >= this._faPruneIntervalMs)) {
            this._lastFaPruneTs = tickTs;
            try {
              const pruned = this._factorAggregator.pruneStaleTokens(
                this._faPruneMaxAgeMs, this._buildFaPruneProtectedSet(), tickTs);
              if (pruned > 0) this._faPrunedTotal += pruned;
            } catch (err) {
              this.logger.error(this._experimentId, 'Prune', `FA 清理失败: ${err.message}`);
            }
          }
        }

        // 首见代币：FA 注册 + 入池 + 落库；已见但 FA state 缺失 = prune 后复流首 tick
        //（P17 复流重锚，2026-10-13 pr1 分叉根因修复）：processTick 自动建 state 的锚
        // = 复流 tick 时刻 → age 归零回进买窗（卡骆驰 0x2d145db9 案：46min 断流复流后
        // 14:19:46 出 perf16 没有的信号 +121；且 build 成功不 continue 连带止损扫描
        // 网格相位漂移 → 7 笔时间止损卖出时刻差 2-21s）。此处按源实验 meta 权威锚
        // 重新 registerToken：买窗 max（preFilter 提取，perf16 系 1.5min）≪ prune 窗
        // 30min → 复流票真实 age 恒出窗 → build-null continue → 与无 prune 行为
        // bit 一致。tokenPool/落库不重复（_seenTokens 门）；live 零变化（live 复流票
        // 由 token_create 事件带锚注册，不走本分支）
        if (!this._seenTokens.has(tick.token_address)) {
          await this._registerToken(tick);
        } else if (this._faPruneMaxAgeMs > 0 && !this._factorAggregator.getTokenState(tick.token_address)) {
          const meta = this._tokenMeta.get(tick.token_address) || {};
          this._factorAggregator.registerToken(tick.token_address, {
            createdAtMs: (meta.createdAtSec || Math.floor(tick.timestamp / 1000)) * 1000,
            totalSupply: meta.totalSupply || 0,
            symbol: meta.symbol || '',
            creatorAddress: meta.creator || null,
            platform: tick.platform || null,
          });
        }
        perf.other += Date.now() - _p0;

        // 因子增量（emitFactors:false 只推进状态不构建），随后 buildFactorMap 按
        // tick 虚拟时刻取因子快照——与实时引擎 _runBuyEvaluation 同一取数路径
        _p0 = Date.now();
        this._factorAggregator.processTick(tick, { emitFactors: false });
        perf.processTick += Date.now() - _p0;

        // P18 tick 路径 build 条件化（backtest.tickBuildSkip，默认 false=现状恒
        // build）：held 票恒全量（卖腿/止损/信号快照链）；未持仓票先过
        // shouldSkipTickBuild——出窗票 continue（与现状 build-null 的副作用序列
        // 等价：TPA/touch/止损扫描/graduation 消费全跳），买窗内票不再全量 build
        // （buildFactorMap 段主体 = ~49 万次窗内未持仓全量构建，纯 CPU 大头）。
        // C 类（窗内未持仓）票现状也走 touch/止损扫描/毕业消费（三段均不读
        // factors），下方保留防行为分叉；TPA 唯一 factors 消费是 currentPriceBnb
        // （TokenPositionAnalyzer :780 可选链），喂最小 factors bit 等价。
        // getToken 提前（纯 Map 读，registerToken 保证首见入池；现状在 TPA 后的
        // 防御性 continue 挪前零差异——TPA 不读 tokenPool）
        _p0 = Date.now();
        const token = this._tokenPool.getToken(tick.token_address, 'bsc');
        if (!token) { perf.other += Date.now() - _p0; continue; }
        const heldTick = token.status === 'bought';
        let factors = null;
        if (heldTick || !this._tickBuildSkip) {
          const _b0 = Date.now();
          factors = this._factorAggregator.buildFactorMap(tick.token_address, tick.timestamp);
          perf.buildFactorMap += Date.now() - _b0;
          if (!factors) continue;
        } else if (this._factorAggregator.shouldSkipTickBuild(tick.token_address, tick.timestamp)) {
          perf.other += Date.now() - _p0;
          continue;
        }
        perf.other += Date.now() - _p0;

        // TPA 触发检查（回迁批 4）：await 保证同 tick verdict 就绪（回放串行语义，
        // 后续 buildFactorMap 立即可读 setHoldingFactors 回填的 TPAPre_* 因子；
        // asOf=tick.timestamp，tick 行含 block_number 供 blocks 时间门）
        if (this._tokenPositionAnalyzer) {
          _p0 = Date.now();
          const _st = this._factorAggregator.getTokenState(tick.token_address);
          await this._tokenPositionAnalyzer.checkAndTrigger(
            tick.token_address,
            factors || { currentPriceBnb: _st?.currentPriceBnb || 0 },
            _st,
            tick, tick.timestamp);
          perf.tpa += Date.now() - _p0;
        }

        // 分腿路由（与实时引擎 _onFactorsUpdated 同构）
        _p0 = Date.now();
        if (heldTick && !this._buyingTokens.has(tick.token_address)) {
          // 引擎级止损双腿（tick 即时路径，对齐实时挂点）：命中优先于策略腿——保命腿不等策略评估
          const _slHit = this._stopLossHit(factors);
          if (_slHit) {
            await this._emitStopLossSell(token, factors, _slHit, tickTs, tick);
          } else {
            await this._evaluateSellPath(token, factors, tick);
          }
          perf.sell += Date.now() - _p0;
        } else if (!this._buyingTokens.has(tick.token_address) && token.status !== 'bought') {
          if (this._buyDebouncer.pending.has(tick.token_address)) this.metrics.debounceSuppressed++;
          this._buyDebouncer.touch(tick.token_address, tick);
          perf.other += Date.now() - _p0;
        }

        // 止损持仓扫描（虚拟时钟节流，断流票兜底——对齐实时 setInterval(scanIntervalSec)）：
        // 无 tick 的持仓在 tick 路径永不评估；到达扫描周期时以当前 tickTs 全持仓扫一遍，
        // buildFactorMap(addr, tickTs) 保证断流期 holdDuration 继续走（实时扫描用墙钟，
        // 回放里 tickTs 即墙钟等价物）
        _p0 = Date.now();
        if (this._stopLossEnabled && this._stopLossScanMs != null &&
            (this._lastStopLossScanTs === null || tickTs - this._lastStopLossScanTs >= this._stopLossScanMs)) {
          this._lastStopLossScanTs = tickTs;
          await this._scanHoldingsStopLoss(tickTs);
        }

        // graduation 事件消费（tick 尾部：本 tick 已注册/进 FA，毕业断流前最后价就绪）。
        // 毕业后 ticks 停止 → 下一 tick 可能几小时后或不来，尾部 drain 兜底（见下）
        await this._consumeGraduationEvents(tickTs);
        perf.other += Date.now() - _p0;

        processed++;
        if (processed % 5000 === 0) {
          this.logger.info(this._experimentId, 'BacktestEngine',
            `回放进度: ${processed}/${this._ticks.length}（${(processed / this._ticks.length * 100).toFixed(1)}%）` +
            ` 信号=${this.metrics.totalSignals} 交易=${this.metrics.totalTrades}`);
          // 定期冲刷：长回放不能只在结束时 flush（内存堆积 + 中途崩溃全丢）。
          // P4c 异步化（2026-10-12 perf5 画像）：96 次段边界同步 await flush 等待
          // 254.9s ≈ 有效墙钟 25%——writeBuffer 侧 swap-then-write 后 DB 写入与
          // 回放并行，此处 fire-and-forget 零等待；尾部/停机点的 await flush 兜底
          // 收尾（writeBuffer 内部串行化，inflight 批先落库）。flush 内部已逐批
          // 处理 DB 错误（降级单条+日志），catch 仅兜意外异常防 unhandled rejection
          if (this._writeBufferEnabled && this._writeBuffer && this._writeBuffer.pendingCount > 0) {
            this._writeBuffer.flush(this._experimentId).catch(err => {
              this.logger.error(this._experimentId, 'BacktestEngine',
                `段边界异步 flush 意外异常: ${err.message}`);
            });
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

      // graduation 尾部 drain：毕业后 ticks 停止，尾部事件（tsMs > 最后一笔 tick）
      // 在 tick 循环里永远等不到消费点——窗口内的剩余事件全部处理后再强平
      //（强平前最后一次毕业卖出尝试，语义对齐虚拟「断流前最后可靠价落袋」）
      await this._consumeGraduationEvents(Infinity);

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
        ` | narrativeBlocked=${this._narrativeBlockedTokens.size}` +
        ` | memCacheHit=${this._narrativeCaller.getMemoryCacheHits()}` +
        ` | earlyReplayHit=${this._preBuyCheckService.earlyParticipantService.getReplayHits()}` +
        ` | preFilterSkipped=${this._factorAggregator.getPreFilterSkipped()}` +
        ` | faPruned=${this._faPrunedTotal}` +
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
      // P1 分段计时汇总（2026-10-12 回测性能案）：失败路径也打（半程分布同样有诊断
      // 价值）；直调/preBuy 子计数器从各自服务读——advance 段减去两者 ≈ 策略评估+执行
      if (this._perf) {
        const p = this._perf;
        const nc = this._narrativeCaller.getCallStats();
        const pc = this._preBuyCheckService.getPerfStats();
        // P7 子服务拆分（2026-10-13 preBuy 284s 定因）：earlySvc=早期参与者全链
        //（fetch=回放桶切片+映射，ms-fetch≈因子纯 CPU）/ sameName AVE 真调次数与
        // 耗时（快照 hit/fallback 与 TTL 缓存命中的分布见 _stats）
        const es = this._preBuyCheckService.earlyParticipantService.getPerfStats();
        const ss = this._preBuyCheckService.sameNameTokenService.getSnapshotStats();
        const perfTotal = p.advance + p.processTick + p.buildFactorMap + p.sell + p.tpa + p.other;
        this.logger.info(this._experimentId, 'BacktestEngine',
          `⏱️ 回放耗时分布（段合计 ${perfTotal}ms）: advance=${p.advance}（debounce fire 全链）` +
          ` processTick=${p.processTick} buildFactorMap=${p.buildFactorMap} sell=${p.sell}` +
          ` tpa=${p.tpa} other=${p.other}` +
          ` | 叙事直调 ${nc.calls} 次 ${nc.ms}ms（dbCache ${nc.dbCacheHits || 0} / 真跑 ${nc.realRuns || 0}）` +
          ` | preBuy ${pc.calls} 次 ${pc.ms}ms` +
          `（短路 ${pc.shortCircuits} | early ${pc.earlyMs} | 五项并发 ${pc.parallelMs} | 评估 ${pc.evalMs}）` +
          ` | 五项 holder=${pc.parHolder} cluster=${pc.parCluster} creator=${pc.parCreator}` +
          ` strong=${pc.parStrong} sameName=${pc.parSameName} label=${pc.labelMs}` +
          ` | earlySvc ${es.calls} 次 ${es.ms}ms（fetch ${es.fetchMs} | replayHits ${es.replayHits}）` +
          ` | sniper画像 ${es.sniper.queryMs}ms（批 ${es.sniper.batches} / 址 ${es.sniper.queriedAddrs} / 败 ${es.sniper.failures} / 缓存 ${es.sniper.cached}` +
          `${es.sniper.fullyLoaded ? ` / 预载 ${es.sniper.preloadedRows} 行` : ''}）` +
          ` | sameName AVE ${ss.aveCalls || 0} 次 ${ss.aveMs || 0}ms（snapHit ${ss.snapshotHits} / fallback ${ss.fallbacks}）`);
      }

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

      // 回测结束即算收益（2026-10-01）：completed 后立即计算 stats 写 experiments.stats，
      // 免手动点首页「分析」按钮（analyze-all 见 stats.tokenCount>0 自动跳过，幂等）。
      // 仅 completed 算：failed 时强平腿未执行、尾部 trades 未必 flush，半程数据
      // 算出的收益会误导。失败只记日志不动终态——分析按钮仍是手动补救路径。
      if (finalStatus === 'completed' && this._finalStatusSet) {
        try {
          const statsService = new ExperimentStatsService();
          const stats = await statsService.calculateExperimentStats(this._experimentId);
          const { error: statsError } = await this._getClient()
            .from('experiments')
            .update({ stats })
            .eq('id', this._experimentId);
          if (statsError) throw new Error(statsError.message);
          this.logger.info(this._experimentId, 'BacktestEngine',
            `📊 收益统计已写入: ${stats.tokenCount} 票 | 胜率 ${Number(stats.winRate).toFixed(1)}% | ` +
            `净额 ${stats.bnbChange >= 0 ? '+' : ''}${Number(stats.bnbChange).toFixed(4)} BNB | ` +
            `收益率 ${stats.totalReturn >= 0 ? '+' : ''}${Number(stats.totalReturn).toFixed(2)}%`);
        } catch (statsError) {
          this.logger.error(this._experimentId, 'BacktestEngine',
            `回测结束 stats 计算失败（终态不受影响）: ${statsError.message}`);
        }
      }
    }
  }

  async _syncHoldings() {
    // 回测持仓由 PortfolioManager 在回放中记账，无需外部同步
  }

  // ==================== graduation 事件回放（虚拟↔回测一致性 2026-10-10）====================

  /**
   * 拉取回放 token 集合内的毕业事件（wss_events kind='graduation'，token 级全局
   * 表不挂实验维度；both 采集器写的行全量可见）。行 payload 形状（collector
   * onGraduation info 原样）：{ token, offers, quote, fundsBnb, blockNumber,
   * blockTimeMs, txHash }；block_time 列兜底定时锚。窗口 [startTime, endTime]
   * 过滤后按 tsMs 升序——回放消费按时序插入 tick 流。
   */
  async _loadGraduationEvents() {
    const supabase = this._getClient();
    const addresses = [...this._tokenMeta.keys()];
    // 批 50（对齐 TOKEN_CHUNK_SIZE）：.in() 参数走 URL，批 500 时 500×43 字符 ≈ 21.5KB
    // 超网关 8KB 限制 → fetch failed（74444a0c 首启实证：连续 3 次重试全死）。
    // 批间并发（P5，2026-10-12）：kind 无索引的全局形状 8s 超时毙掉（3.95M 行顺序扫），
    // 现行 .in(50)+kind 形状每批 ~40ms 健康只是串行 RTT 堆积（1915 批 ≈ 85s 取 311 行）
    const BATCH = 50;
    const fetchGradBatch = async (batch) => {
      let data = null;
      for (let attempt = 1; attempt <= PAGE_ATTEMPTS; attempt++) {
        const res = await supabase
          .from('wss_events')
          .select('token_address, payload, block_time')
          .eq('kind', 'graduation')
          .in('token_address', batch);
        if (!res.error) { data = res.data; break; }
        if (attempt === PAGE_ATTEMPTS) {
          throw new Error(`读取 wss_events graduation 失败（连续 ${PAGE_ATTEMPTS} 次）: ${res.error.message}`);
        }
        await new Promise(r => setTimeout(r, 1000));
      }
      return data || [];
    };
    const batches = [];
    for (let i = 0; i < addresses.length; i += BATCH) {
      batches.push(addresses.slice(i, i + BATCH));
    }
    const batchRows = await this._mapPool(batches, LOAD_POOL_CONCURRENCY, fetchGradBatch);
    let total = 0;
    for (const rows of batchRows) {
      for (const row of rows) {
        const payload = row.payload || {};
        const tsMs = Number(payload.blockTimeMs)
          || (row.block_time ? new Date(row.block_time).getTime() : 0);
        if (!tsMs) {
          this.logger.warn(this._experimentId, 'BacktestEngine',
            `graduation 事件缺时间锚，跳过 | ${row.token_address}`);
          continue;
        }
        if (this._startTimeFilter && tsMs < this._startTimeFilter) continue;
        if (this._endTimeFilter && tsMs > this._endTimeFilter) continue;
        this._graduationEvents.push({
          token: row.token_address,
          tsMs,
          fundsBnb: Number(payload.fundsBnb) || null,
          quoteToken: payload.quoteToken ?? null,
        });
        total++;
      }
    }
    this._graduationEvents.sort((a, b) => a.tsMs - b.tsMs);
    this.logger.info(this._experimentId, 'BacktestEngine',
      `🎓 graduation 事件装载: ${total} 个（token 集合 ${addresses.length}，窗口内）`);
  }

  /**
   * AVE 同名快照装载（9.3，2026-10-12 用户裁定）：拉 ave_same_name_snapshots
   * searched_at <= 回放终点的全量行（表级全局资产，与 token 集合无关——兜底实时
   * 调用写入的行同样供未来回测 as-of），(chain, search_term) 分桶、桶内
   * searchedAtMs 升序注入 SameNameTokenService。fail-open：装载失败只 warn
   * （表未建/网络异常 → 同名检查退回兜底实时+发布前过滤，不阻断回测启动）。
   */
  async _loadSameNameSnapshots() {
    const t0 = Date.now();
    try {
      const supabase = this._getClient();
      const untilIso = this._endTimeFilter ? new Date(this._endTimeFilter).toISOString() : null;
      const idx = new Map();
      let from = 0;
      let rows = 0;
      for (;;) {
        // (searched_at, id) 双键稳定排序：同刻多行时分页边界不漂移
        let q = supabase
          .from('ave_same_name_snapshots')
          .select('chain, search_term, searched_at, row_count, results')
          .order('searched_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + 999);
        if (untilIso) q = q.lte('searched_at', untilIso);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        for (const r of data || []) {
          const key = `${r.chain}:${r.search_term}`;
          let arr = idx.get(key);
          if (!arr) { arr = []; idx.set(key, arr); }
          arr.push({
            searchedAtMs: new Date(r.searched_at).getTime(),
            rowCount: r.row_count,
            results: r.results || [],
          });
        }
        rows += (data || []).length;
        if (!data || data.length < 1000) break;
        from += 1000;
      }
      this._preBuyCheckService.sameNameTokenService.setHistoricalSnapshots(idx);
      this.logger.info(this._experimentId, 'BacktestEngine',
        `AVE 同名快照装载: ${rows} 行 → ${idx.size} 桶（${Date.now() - t0}ms` +
        `${untilIso ? `，截止 ${untilIso}` : '，全表'}）`);
    } catch (e) {
      this._preBuyCheckService.sameNameTokenService.setHistoricalSnapshots(null);
      this.logger.warn(this._experimentId, 'BacktestEngine',
        `AVE 同名快照装载失败（fail-open 退回兜底实时调用）: ${e.message}`);
    }
  }

  /**
   * 消费到期毕业事件（主循环每 tick 尾部 + 回放收尾 drain 调用）：
   *   - 事件时刻 ≤ upToTs 的依次处理：noteGraduation（FA 防前视：此后的
   *     graduationProgress 判定不受影响，毕业臂策略腿语义不变）
   *   - 持仓票 → _emitGraduationSell 全清（断流前最后可靠价 = buildFactorMap(evtTs)，
   *     毕业后无新 tick，evtTs 时刻取值即最后价格史——虚拟引擎同款）
   *   - 未持仓 → 仅标记推进（后续买入由买入成功点补卖覆盖）
   *   - 卖出失败不推进指针（每 tick 重试，虚拟「扫描兜底」的回放等价物）；
   *     持续失败最终由回放结束强平收尾
   * 消费点在 tick 处理之后：同块「首 tick + 毕业事件」时首见注册已完成
   * （noteGraduation 需要 FA state 存在）。
   */
  async _consumeGraduationEvents(upToTs) {
    while (this._gradEvtIdx < this._graduationEvents.length) {
      const evt = this._graduationEvents[this._gradEvtIdx];
      if (evt.tsMs > upToTs) break;
      // noteGraduation（2026-10-24 资金口径）：置 graduated + 学习 per-quote 毕业阈值
      //（回放内 as-of 合法——事件按时间序消费，后续同 quote 池用学习值）。
      // fundsBnb 缺失（quote 盘换算不可得行）只标记不学习
      this._factorAggregator.noteGraduation({ token: evt.token, fundsBnb: evt.fundsBnb, quoteToken: evt.quoteToken });
      // 事件到达标记在消费点填充（74444a0c 数据点 B 前视事故：装载即填会把「未来
      // 毕业」提前暴露给买入成功点补卖判据——CZ 买入 fireTs 16:39:04 查到 14s 后
      // 才毕业的标记直接补卖@买价 0%，虚拟引擎对应标记是事件墙钟到达才置。
      // 挪到消费点后「事件先于首 tick」边缘仍覆盖：集合独立于 FA state 存在性）
      this._graduatedTokens.add(evt.token);
      const token = this._tokenPool.getToken(evt.token, 'bsc');
      if (token && token.status === 'bought' && !this._graduationSoldTokens.has(evt.token)) {
        const result = await this._emitGraduationSell(token, evt);
        if (!result || !result.success) break;   // 失败不推进指针，下轮重试
      }
      this._gradEvtIdx++;
    }
  }

  /**
   * 毕业事件驱动全清（虚拟引擎 _emitGraduationSell 的回放版，语义逐字对齐）：
   * 构造等价 strategy（与止损腿同构：cards='all'/sellPercentage=1/bypassDebounce）
   * 走 _emitSellSignal 全清链——signals/trades/卡账本/累亏记账副作用全复用。
   * 卖出价 = 断流前最后可靠价（buildFactorMap(evtTs)）。幂等标记后置到卖出成功；
   * 并发双调被 _emitSellSignal 内 _sellingTokens 挡住。
   */
  async _emitGraduationSell(token, evt) {
    const tokenAddress = token.token;
    if (this._graduationSoldTokens.has(tokenAddress)) return { success: true };
    const factors = this._factorAggregator.buildFactorMap(tokenAddress, evt.tsMs);
    if (!factors) return { success: false, reason: '无因子（价格史空）' };
    const strategy = {
      id: 'graduationSell', name: '毕业事件全清',
      action: 'sell', sellPercentage: 1, cards: 'all', bypassDebounce: true,
      priority: 0, lockTokenAfterSell: false, maxExecutions: null, cumulativeLossLockPct: null,
    };
    this.logger.info(this._experimentId, 'Graduation',
      `${token.symbol || tokenAddress.slice(0, 10)} 毕业事件驱动全清(回放) | funds=${evt.fundsBnb} BNB ` +
      `余仓按断流前最后可靠价落袋 graduationProgress=${factors.graduationProgress?.toFixed(3)}`);
    const result = await this._emitSellSignal(token, strategy, factors, evt.tsMs, null);
    if (result && result.success) this._graduationSoldTokens.add(tokenAddress);
    return result;
  }

  /**
   * 重写：回放已终态（completed/failed）后到达的停机信号不再覆盖状态、
   * 不补写真实时间快照（回放快照均已按虚拟时间落库）。
   * 中途停机（finalStatusSet=false，回放进行中）：先刷残留写缓冲（周期 flush
   * 间隔内积累的 pending 行，随进程退出即丢）再走基类写 stopped——信号处理器
   * 在回放期间即已注册（run-engine.js 2026-10-11 修复，此前注册在 start()
   * 之后，回测回放期间形同虚设）。flush 失败原样上抛（fail-loud，由信号
   * 处理器留痕后退出，stopped 不落库提示停机不完整）。
   */
  async stop() {
    if (this._finalStatusSet) {
      this._isStopped = true;
      this._status = EngineStatus.STOPPED;
      this.logger.info(this._experimentId, 'BacktestEngine', '回放已终态，停机信号仅置本地标志');
      return;
    }
    if (this._writeBufferEnabled && this._writeBuffer && this._writeBuffer.pendingCount > 0) {
      await this._writeBuffer.flush(this._experimentId);
    }
    // C84：清 FA 叙事常量注入（模块级 Map 单例，防同进程下一引擎继承上轮回测的
    // 预载 rating；与实时引擎 stop 清 _narrativeTriggerStates 同族防线）
    const FourMemeFactorAggregator = require('../../services/FourMemeFactorAggregator');
    for (const addr of this._tokenMeta.keys()) FourMemeFactorAggregator.clearNarrativeFactors(addr);
    await super.stop();
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
      // 平台透传（FA platform 因子 + preBuy 分门）：tick 行级权威（分平台 .eq 装载
      // 恒有值）。刻意不兜 meta.platform——_loadTokenMetadata 是 `row.platform ||
      // 'fourmeme'` 兜底，并集容器行 platform 多为 null 时会把 flap 票错标
      // fourmeme = 豁免 router 门 = 漏拦（危险方向）；null 时分门走 fail-closed
      // （platform != 'flap' null 比较 false → 落回 router 区间门）
      platform: tick.platform || null,
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
      if (this._writeBufferEnabled && this._writeBuffer) {
        // P1-3（bc4f756e 性能案）：experiment_tokens 逐 token 直写（5,495 次 roundtrip）
        // 改 buffer 批量。行构造镜像 ExperimentDataService.saveToken 字段组装；
        // narrative_material_id 提取省略——回放 raw_api_data 无 URL 字段，提取恒 null
        // （语义安全，plan 已核）；唯一冲突（--force 重跑残留旧行）走 _batchInsert
        // 降级路径记日志跳过，与直写 saveToken 的 23505 吞掉语义等价
        const tokenRow = {
          experiment_id: this._experimentId,
          token_address: tokenAddress,
          token_symbol: meta.symbol || '',
          blockchain: 'bsc',
          platform: meta.platform || tick.platform || this._platforms[0],
          data_source: 'wss',
          discovered_at: new Date(createdAtSec * 1000).toISOString(),
          status: 'monitoring',
          raw_api_data: { source: 'wss_tick_replay', totalSupply: meta.totalSupply || 0, creator: meta.creator },
        };
        if (meta.creator) tokenRow.creator_address = meta.creator;
        this._writeBuffer.addTokenInsert(tokenRow);
      } else {
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
      }
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
    const { buildFactorValuesForTimeSeries, buildPreBuyCheckFactorValues, buildTpaFactorSnapshot } = require('../core/FactorBuilder');
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

      // ── 叙事否决短路（镜像实时引擎，2026-09-27 用户裁定）──
      // 叙事评级已确认为 low（终态，检测多少次都没用）的代币不再生成买信号——
      // 不落 signal 行、不跑叙事直调/preBuyCheck；仅对配置了 narrativeCallCondition
      // （叙事直调链路启用）的策略生效，未配叙事的策略零影响。address-fail 宣告
      // 竞态盘的豁免在登记侧把关（shouldBlockOnNarrative，重试窗内不登记）
      const narrativeGateEnabled = !!(strategy.narrativeCallCondition && String(strategy.narrativeCallCondition).trim() !== '');
      if (narrativeGateEnabled && this._narrativeBlockedTokens.has(tokenAddress)) {
        return { success: false, reason: '叙事否决短路（评级 low 终态，不再生成信号）' };
      }

      const latestPrice = factorResults.currentPrice || 0;
      if (!(latestPrice > 0)) {
        return { success: false, reason: '无有效价格' };
      }

      // 双口径对称（2026-10-15）：fire 时刻标记 pending 峰——串行回放 mark 与
      // setBuyState 之间零 tick（inflight evals await 后才进下一 processTick），
      // pending 峰恒=fire 价 → setBuyState 回填 max(fire,current)=旧行为 bit 一致
      this._factorAggregator.markBuyFire(token.token, factorResults.currentPriceBnb || 0);

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
      // P4b 单源上移（2026-10-12）：lastPairReturnRate / 早晚票语料滞后秒的计算从
      // preBuy options 组装处上移——引擎层短路判定与 preBuy options 两处消费同一份
      // （纯内存读，上移零行为差异；防两处计算逻辑漂移）。narrativeCorpusLagSec
      // 依赖直调结果，直调块内赋值，preBuy 块消费；直调未进/缺锚保持 null 同原版
      const lastPairReturnRate = this._tokenPool.getLastPairReturnRate(token.token, token.chain || 'bsc');
      const faBirthMs = this._factorAggregator.getTokenState(token.token)?.createdAtMs ?? null;
      let narrativeCorpusLagSec = null;
      const narrativeCallCondition = strategy.narrativeCallCondition && String(strategy.narrativeCallCondition).trim() !== ''
        ? String(strategy.narrativeCallCondition).trim() : null;
      // C84 新模型腿（2026-10-17）：narrativeTriggerCondition 触发腿——发起/重试轮由
      // 实时引擎状态机驱动，回测无状态机；narrativeRating 门在单一买 condition 内由
      // FA 预载常量承担（_preloadNarrativeRows 注入）。fire 链不评触发条件直接
      // getRating（预载后 memoryCache≈0ms）仅为取 gmgnRisk 供 GMGN 快照层——刻意
      // 不登记拉黑/不算 lag/不跑 P4b 与同叙事龙头检查（新条件未引用这些键；拉黑语义
      // =条件即门、重试预算=轮次状态机，回测均无对应物）
      const narrativeTriggerCondition = strategy.narrativeTriggerCondition && String(strategy.narrativeTriggerCondition).trim() !== ''
        ? String(strategy.narrativeTriggerCondition).trim() : null;
      if (preCheckPassed && narrativeTriggerCondition) {
        narrativeCallInfo = await this._narrativeCaller.getRating(token.token);
        this.logger.info(this._experimentId, 'BuyEval',
          `叙事直调(触发腿,回放) | ${token.symbol} rating=${narrativeCallInfo.numericRating}(${narrativeCallInfo.rating})` +
          ` ${narrativeCallInfo.durationMs}ms fromCache=${narrativeCallInfo.fromCache}` +
          (narrativeCallInfo.error ? ` error=${narrativeCallInfo.error}` : ''));
      } else if (narrativeCallCondition && preCheckPassed
          && this._strategyEngine.evaluateCondition(narrativeCallCondition, factorResults)) {
        narrativeCallInfo = await this._narrativeCaller.getRating(token.token);
        this.logger.info(this._experimentId, 'BuyEval',
          `叙事评级直调(回放) | ${token.symbol} rating=${narrativeCallInfo.numericRating}(${narrativeCallInfo.rating})` +
          ` ${narrativeCallInfo.durationMs}ms fromCache=${narrativeCallInfo.fromCache}` +
          (narrativeCallInfo.error ? ` error=${narrativeCallInfo.error}` : ''));

        // ── 叙事否决短路登记（镜像实时引擎）──
        // rating=low（终态）→ 登记短路集，本 token 后续 fire 不再生成买信号；
        // address-fail（宣告竞态，重试窗内可能被 PrecheckFailRetryService 翻正）豁免；
        // age 取 fire 因子（分钟、锚 token 创建时刻，与实时引擎同源同单位）
        if (this._shouldBlockOnNarrative(
          narrativeCallInfo.numericRating,
          narrativeCallInfo.precheckStage,
          factorResults.age ?? null,
        )) {
          this._narrativeBlockedTokens.add(tokenAddress);
          this.logger.info(this._experimentId, 'BuyEval',
            `叙事否决登记(回放) | ${token.symbol} rating=low${narrativeCallInfo.precheckStage ? `(${narrativeCallInfo.precheckStage})` : ''}` +
            ' → 后续买信号短路（address-fail 重试窗内已豁免的除外）');
        }

        // 早晚票语料滞后秒（0fed29f9 案，与实时引擎同口径）：FA 出生锚（回测 =
        // discovered_at）− corpusTs。时序穿越声明同 narrativeRating：语料是当前
        // 快照分析历史 token，lag 只看相对增量。null = 晚票门 fail-closed
        narrativeCorpusLagSec = faBirthMs && narrativeCallInfo.corpusTs
          ? Math.round((faBirthMs - narrativeCallInfo.corpusTs) / 1000)
          : null;

        // ── P4b 引擎层已知因子恒假短路（2026-10-12，龙头检查之前）──
        // P4a 短路在 performAllChecks 内部，挡不住引擎层同叙事龙头检查（perf4 实测
        // 龙头 6767 次与 perf3 全等 avg 72ms ≈ 段墙钟 23% 纯浪费）。此处判定上移到
        // 龙头之前：命中恒假项 → 跳过龙头+preBuy 直接拒绝。等价性：判定所用键值
        // 全部在直调后定型（narrativeRating/lag/GMGN=直调产物、fire 因子快照、
        // router 观察史本 fire 内无回填），龙头检查只读不写这些键 → 此处评估与
        // performAllChecks 处评估 bit 相同。龙头三键此时无值——从已知集排除
        // （含龙头键的项不评 fail-open 走全链，由 P4a 内层在龙头跑完后接管），
        // 防 narrativeLeaderHot == 0 类条件被默认值 0 误短路。直调块内判定恰好
        // 与龙头检查的先行条件对齐（有直调才有龙头检查）
        if (shouldPerformPreCheck && this._preBuyCheckService) {
          const { routerGateFactors } = require('../pre-check/router-gate-state');
          const engineShortCircuitTerm = this._preBuyCheckService._evaluateKnownFalseTerm(
            String(currentRound === 0
              ? strategy.preBuyCheckCondition
              : strategy.repeatBuyCheckCondition || '').trim(),
            {
              drawdownFromHighest: factorResults.drawdownFromHighest || null,
              buyRound: currentRound + 1,
              lastPairReturnRate: lastPairReturnRate ?? 0,
              narrativeRating: narrativeCallInfo.numericRating,
              narrativeCorpusLagSec,
              earlyReturn: factorResults.earlyReturn ?? null,
              // gmgnUserPct（2026-10-16 u40 门挪层）：P4b 判定与 performAllChecks 必须
              // 同值透传——漏传则恒取 ?? null 默认，gmgnUserPct >= 40 单项恒假会在
              // 回测侧误触发引擎层短路（单测第 6 节源码防线防此漏）
              gmgnUserPct: factorResults.gmgnUserPct ?? null,
              ...this._mapGmgnRiskFactors(narrativeCallInfo.gmgnRisk),
              tweetAuthorType: factorResults.tweetAuthorType ?? 0,
              dataCollectionRound: factorResults.dataCollectionRound ?? 0,
              platform: token.platform || factorResults.platform || null,
              ...routerGateFactors(this._routerGateState.get(token.token)),
            },
            ['narrativeLeaderHot', 'narrativeLeaderCount', 'narrativeLeaderMaxMultiple'],
          );
          if (engineShortCircuitTerm) {
            preCheckPassed = false;
            blockReason = `已知因子恒假短路(引擎层): ${engineShortCircuitTerm}`;
            this.logger.info(this._experimentId, 'BuyEval',
              `已知因子恒假短路(引擎层,跳过龙头+preBuy) | ${token.symbol} term=${engineShortCircuitTerm}`);
          }
        }

        // ── 同叙事龙头已火检查（回放：checkTimeSec 用回放时点，与下方 performAllChecks checkTime 同源；
        // 无 sourceTweetId→因子 0 放行；候选 material_id 映射为当前状态属已知穿越，涨幅计算无前视）──
        if (preCheckPassed && narrativeCallInfo.sourceTweetId) {
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
          const { updateRouterGateState, routerGateFactors } = require('../pre-check/router-gate-state');
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
              narrativeCorpusLagSec, // 早晚票分级（上方注释）；null=晚票门 fail-closed
              // earlyReturn 注入 preBuy context（实时引擎同款；晚票门右臂证据）
              earlyReturn: factorResults.earlyReturn ?? null,
              // gmgnUserPct 注入（2026-10-16 u40 门挪层，实时引擎同款 fire 时点快照）
              gmgnUserPct: factorResults.gmgnUserPct ?? null,
              narrativeLeaderHot: narrativeLeaderInfo?.factors?.narrativeLeaderHot ?? 0, // 同叙事龙头链路；无 tweet/失败=0 放行
              narrativeLeaderCount: narrativeLeaderInfo?.factors?.narrativeLeaderCount ?? 0,
              narrativeLeaderMaxMultiple: narrativeLeaderInfo?.factors?.narrativeLeaderMaxMultiple ?? 0,
              // GMGN 风险因子（x-0 案）：同 narrativeRating 直调链路；时序穿越同声明
              // （GMGN 是当前快照——历史 token 的 issuerTokenCount 含其后所有发币，
              // 偏拦方向；bundler 是当前 holder 群体）——只看相对增量，绝对值不代表实时可得
              ...this._mapGmgnRiskFactors(narrativeCallInfo?.gmgnRisk),
              tweetAuthorType: factorResults.tweetAuthorType ?? 0,
              dataCollectionRound: factorResults.dataCollectionRound ?? 0,
              totalSupply,
              // 平台标签（router 平台分门）：tick 行级真值（同 _registerToken 口径）
              platform: token.platform || factorResults.platform || null,
              // router 门观察史（2026-10-03）：截至上次 fire 的状态——本次 fire 的 rp
              // 由下方回填进状态、本次评估不消费（本次出界由区间门拦，无双计数）
              ...routerGateFactors(this._routerGateState.get(token.token)),
            },
          );

          // router 门观察史回填（fire 后）：flap 且 rp 非空才累计（宁漏不误）
          if (preBuyCheckResult && preBuyCheckResult.earlyTradesRouterPct != null) {
            this._routerGateState.set(token.token, updateRouterGateState(
              this._routerGateState.get(token.token),
              tokenPlatform,
              preBuyCheckResult.earlyTradesRouterPct,
            ));
          }

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
              tpaFactors: buildTpaFactorSnapshot(factorResults),
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

      // ── 第三层：GMGN 条件（FAKER 0xc6ee…7777 团伙盘案，同实时引擎 2026-10-14；
      // 2026-10-20 乌龟案改 fail-open）：回测**不真调 API**——数据=叙事直调
      // gmgnRisk 快照映射（预载行 gmgn_info 优先、缺行时直调链路已真打且有既有时序
      // 穿越声明）；直调未触发/GMGN 未拿到 → covered=0 同款 fail-open 放行。回放
      // 同一管线：同层同键同判语义，差异仅「实时多一次新鲜调用」。repeat 轮与首轮
      // 统一同一条件串 ──
      let gmgnCheckInfo = null;
      const gmgnCheckCondition = String(strategy.gmgnCheckCondition || '').trim();
      if (gmgnCheckCondition) {
        const { GmgnRiskCheckService } = require('../pre-check/GmgnRiskCheckService');
        const { GmgnWalletStatsService } = require('../pre-check/GmgnWalletStatsService');
        gmgnCheckInfo = {
          ...GmgnRiskCheckService.evaluateFactors(
            {
              ...this._mapGmgnRiskFactors(narrativeCallInfo?.gmgnRisk),
              // 叙事类型从 fire 因子表透传（Nightshift 案 2026-10-17）：与实时引擎
              // checkAndEvaluate 第四参同刻同源——preload 注入的 token 级常量
              narrativeCategory: factorResults?.narrativeCategory ?? null,
              // gwp 钱包画像键显式 null（2026-10-18）：回测不接线——gwp 动态计数
              //（buy_7d 等）是今日取值，对历史 fire 时刻是已知时序穿越，跳过比
              // 穿越诚实（IS NULL 臂放行；结论口径=「不含 gwp 门的相对增量」）
              ...GmgnWalletStatsService.emptyFactors(),
              // T76 2026-10-27 注意力空转四键：与实时 checkAndEvaluate 第六参同构
              //（快照 vc 是 token 级常量=已知时序穿越，与 narrativeCategory 同款
              // 声明——比值结论只看相对增量；buyWallets/buyVolumeBnb 回测 FA 同源
              // 重放=fire 时刻真值无穿越）
              ...GmgnRiskCheckService.computeGmgnAttentionFactors(
                this._mapGmgnRiskFactors(narrativeCallInfo?.gmgnRisk),
                factorResults?.buyWallets ?? 0,
                factorResults?.buyVolumeBnb ?? 0),
            }, gmgnCheckCondition),
          condition: gmgnCheckCondition,
        };
        if (!gmgnCheckInfo.passed) {
          this.logger.info(this._experimentId, 'BuyEval',
            `GMGN 条件拒买(回放) | ${token.symbol} ${gmgnCheckInfo.reason}`);
          if (signalId) {
            this._bufferSignalUpdate(signalId, {
              metadata: { gmgnCheck: { ...gmgnCheckInfo, execution_status: 'failed' } },
              executed: false,
            });
          }
          return { success: false, reason: `GMGN 条件未过: ${gmgnCheckInfo.reason}` };
        }
      }

      // 预检查通过：补全元数据后执行
      if (signalId) {
        this._bufferSignalUpdate(signalId, {
          metadata: {
            tokenCreateTime,
            trendFactors: buildFactorValuesForTimeSeries(factorResults),
            tpaFactors: buildTpaFactorSnapshot(factorResults),
            narrativeCall: narrativeCallInfo,
            narrativeLeaderCheck: narrativeLeaderInfo,
            // 第三层轨迹（通过路径；拒买路径在上方已单独落；回测无新鲜调用=快照口径）
            gmgnCheck: gmgnCheckInfo,
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
        // P1-3：状态更新走 buffer（flush 末段按入队序重放）；buffer 关时保留直写
        if (this._writeBufferEnabled && this._writeBuffer) {
          this._writeBuffer.addTokenStatusUpdate({
            experimentId: this._experimentId, tokenAddress: token.token, status: 'bought',
          });
        } else {
          await this.dataService.updateTokenStatus(this._experimentId, token.token, 'bought');
        }

        const faState = this._factorAggregator.getTokenState(token.token);
        this._factorAggregator.setBuyState(token.token, {
          buyPriceBnb: faState?.currentPriceBnb || 0,
          buyPriceUsd: latestPrice,
          buyTime: nowTs,
          // 双口径对称（2026-10-15）：fire==成交同 tick → signalAt=buyTime（holdDuration
          // 公式 bit 一致）；回测执行=信号价无独立执行价 → buyExecutedPriceBnb 缺省 null
          buySignalAt: nowTs,
        });

        this._bufferSignalUpdate(signalId, { executed: true, metadata: { execution_status: 'executed' } });
        this.metrics.executedSignals++;
        this.logger.info(this._experimentId, 'BuyEval',
          `✅ 买入成功(回放) | ${token.symbol} price=${latestPrice.toExponential(4)} amount=${buyAmt}${this._cardsEnabled ? `(${signal.cards ?? 1}卡)` : ''} 余额=${this.currentBalance.toFixed(4)}`);

        // 毕业事件先于买入的消费竞态补卖（虚拟引擎三挂点之一，盘古案 2026-09-28）：
        // graduation 事件消费时 status!=='bought' no-op，买入成功点查 FA graduated
        // 标记（或事件集合——事件先于首 tick 的边缘 noteGraduation 会 no-op）直接补
        // 毕业全清。回放串行直接 await（虚拟为 fire-and-forget，效果等价）
        if (faState?.graduated || this._graduatedTokens.has(token.token)) {
          if (!this._graduationSoldTokens.has(token.token)) {
            await this._emitGraduationSell(token, {
              token: token.token, tsMs: nowTs, fundsBnb: faState?.lastFundsBnb ?? null,
            });
          }
        }
        return { success: true };
      }

      this._bufferSignalUpdate(signalId, { executed: false, metadata: { execution_status: 'failed', tradeResult: result } });
      return { success: false, reason: result?.reason || result?.message || '交易执行失败' };
    } finally {
      this._buyingTokens.delete(tokenAddress);
      // pending fire 峰兜底清理（成功路径 setBuyState 已消费；失败/异常防残峰）
      this._factorAggregator.clearBuyFire(tokenAddress);
    }
  }

  // ==================== 卖路径（虚拟时钟版）====================

  /**
   * 引擎级止损双腿判定（与实时引擎 FourMemeWssTradingEngine._stopLossHit 逐字一致；
   * 配置 stopLoss 段启用；纯读 factors 不动状态）。返回命中描述或 null；price 先判
   * （两条同时命中时标注更深的那条，全清同效）。因子口径与策略腿同源：
   * profitPercent=相对 FA buyState 成本（%）/ realHoldDuration=物理持有秒
   * （2026-10-15 双口径：holdDuration 已改信号口径起算，回测两值恒等零影响）。
   * 时间腿 <=0 而非 <0。
   */
  _stopLossHit(factors) {
    if (!this._stopLossEnabled) return null;
    const profit = factors.profitPercent;
    const hold = factors.realHoldDuration;
    if (this._stopLossPricePct != null && Number.isFinite(profit) && profit <= this._stopLossPricePct) {
      return { kind: 'price', profitPercent: profit };
    }
    if (this._stopLossTimeSec != null && Number.isFinite(hold) && hold > this._stopLossTimeSec
        && Number.isFinite(profit) && profit <= 0) {
      return { kind: 'time', profitPercent: profit, holdDuration: hold };
    }
    return null;
  }

  /**
   * 止损卖出：构造等价 strategy 走 _emitSellSignal 全清链——signals/trades/卡账本
   * （cards='all'→全清 sellPct=1）/累亏记账副作用全复用（实时引擎同款，零新执行逻辑）。
   * 回测签名差异：多 nowTs（虚拟时钟，去抖/评估路径统一传法）。
   */
  async _emitStopLossSell(token, factors, hit, nowTs, tick) {
    const common = {
      action: 'sell', sellPercentage: 1, cards: 'all', bypassDebounce: true,
      priority: 0, lockTokenAfterSell: false, maxExecutions: null, cumulativeLossLockPct: null,
    };
    const strategy = hit.kind === 'price'
      ? { id: 'stopLossPrice', name: `止损-价格跌破成本线(${this._stopLossPricePct}%)`, ...common }
      : { id: 'stopLossTime', name: `止损-持有超时仍亏损(${Math.round(this._stopLossTimeSec / 60)}min)`, ...common };
    this.logger.info(this._experimentId, 'StopLoss',
      `${token.symbol || token.token.slice(0, 10)} 触发${strategy.name}(回放) | profitPercent=${hit.profitPercent?.toFixed(1)}%` +
      `${hit.kind === 'time' ? ` holdDuration=${(hit.holdDuration / 60).toFixed(1)}min` : ''}`);
    return this._emitSellSignal(token, strategy, factors, nowTs, tick);
  }

  /**
   * 持仓止损扫描（虚拟时钟版，实时 _scanHoldingsStopLoss 的回放等价）：主循环按
   * scanIntervalMs 虚拟节流调用，断流持仓在此兜底。只判止损双腿不跑策略腿
   * （P 腿断流「不评估」语义维持）。串行逐 token await（对齐实时，避免卖出风暴）。
   * 毕业兜底不在扫描嵌（虚拟版有）：回放的毕业事件消费指针自带重试语义等价覆盖。
   */
  async _scanHoldingsStopLoss(nowTs) {
    for (const holding of this._getAllHoldings()) {
      const tokenAddress = holding.tokenAddress;
      if (!tokenAddress) continue;
      const token = this._tokenPool.getToken(tokenAddress, 'bsc');
      if (!token || token.status !== 'bought') continue;
      if (this._sellingTokens.has(tokenAddress) || this._buyingTokens.has(tokenAddress)) continue;
      const factors = this._factorAggregator.buildFactorMap(tokenAddress, nowTs);
      if (!factors) continue;
      const hit = this._stopLossHit(factors);
      if (hit) {
        await this._emitStopLossSell(token, factors, hit, nowTs, null);
      }
    }
  }

  /**
   * FA prune 保护集（P17 虚拟时钟 prune 配套）：state 被 prune 的 token 在后续
   * buildFactorMap 会拿 null——凡「回放中仍可能对该 token 取因子」的形状必须保护。
   *
   * 构成（FA 内部另有 `_positions.size > 0` 自查，与引擎侧互补）：
   * 1. 全部账面持仓（_getAllHoldings，与 live prune 保护集同源同 API）——止损扫描/
   *    毕业卖/卖腿评估都是持仓票全量 buildFactorMap；
   * 2. 买入/卖出执行中（_buyingTokens/_sellingTokens）——执行链 await 完成后仍要
   *    走卖腿/止损路径（fire 评估链的 buildFactorMap 在虚拟时刻 dequeue 点附近，
   *    30min 窗内不受 prune 影响，此两项是执行期防御）；
   * 3. 未消费 graduation 事件涉及 token（_gradEvtIdx 起）——毕业卖
   *    buildFactorMap(evt.tsMs) 在事件消费点调用。对「未持仓票」事件消费仅推进
   *    指针不取因子（正确性上与持仓保护重叠），此项是防御性冗余：毕业卖出失败
   *    不推进指针跨 tick 重试期间票恒为持仓（被 1 覆盖），保留是为防未来消费路径
   *    改动引入的 state 依赖（成本=每 5min 一次 O(未消费事件数) 收集）。
   *
   * 复流重锚（2026-10-13 pr1 分叉根因修复）：死票 prune 后复流首 tick，主循环
   * 首见注册段按源实验 meta 权威锚重新 registerToken（见 _runMainLoop）——防
   * processTick 自动建 state 的锚=复流 tick 时刻导致 age 归零回进买窗（卡骆驰
   * 0x2d145db9 案：46min 断流复流出 +121 信号 + 止损扫描网格相位漂移 7 笔卖出
   * 时刻差 2-21s）。live 复流票由 token_create 事件带锚注册，无此问题。
   */
  _buildFaPruneProtectedSet() {
    const held = new Set(this._getAllHoldings().map(h => h.tokenAddress?.toLowerCase()));
    for (const addr of this._buyingTokens) held.add(addr.toLowerCase());
    for (const addr of this._sellingTokens) held.add(addr.toLowerCase());
    for (let i = this._gradEvtIdx; i < this._graduationEvents.length; i++) {
      held.add(String(this._graduationEvents[i].token).toLowerCase());
    }
    return held;
  }

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

      // 卡牌 sizing（与实时引擎同构）：soldN = 'all'→全清 / min(cards, 余卡) 钳制；
      // soldN>=tokenCards 时 sellPct 恒精确 1（IEEE T/T）→ Decimal.mul(1) 精确直通，
      // PM remainingAmount.eq(0) 删仓判据成立（E5d 僵尸仓教训）。sellPercentage 已
      // 退役（2026-10-24）：sizing 唯一表达=cards；腿无 cards/机制关/无卡 → 全清
      // （机制关闭/腿未配卡/无卡均不拦截）。cardTrade.after 为信号构造时点算好的
      // 绝对值，随 trade metadata 落库（_executeSell 成功分支写回 Map）
      let cardTrade = null;
      let sellPct = 1;
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
          // P1-3：状态更新走 buffer（flush 末段按入队序重放）；buffer 关时保留直写
          if (this._writeBufferEnabled && this._writeBuffer) {
            this._writeBuffer.addTokenStatusUpdate({
              experimentId: this._experimentId, tokenAddress: signal.tokenAddress, status: 'sold',
            });
          } else {
            await this.dataService.updateTokenStatus(this._experimentId, signal.tokenAddress, 'sold');
          }
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
      const cacheKey = `${jsExpr}\0${keys.join(',')}`;
      let fn = _permBlockFnCache.get(cacheKey);
      if (!fn) {
        fn = new Function(...keys, `return ${jsExpr};`);
        if (_permBlockFnCache.size >= 1000) {
          _permBlockFnCache.delete(_permBlockFnCache.keys().next().value);
        }
        _permBlockFnCache.set(cacheKey, fn);
      }
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

module.exports = { BacktestEngine, compareByChainOrder };
