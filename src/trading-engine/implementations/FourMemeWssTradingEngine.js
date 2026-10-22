/**
 * FourMeme WSS 交易引擎（BSC four.meme 专用，事件驱动）
 *
 * 母版：pumpfun-wss-trader 的 WssTradingEngine（debounce 买评估 / wss-down-guard /
 * 常驻守护 intervals / FA.pruneStaleTokens）。
 * 交易管线复用 richer-js 既有契约（StrategyEngine.evaluate + ConditionEvaluator +
 * PreBuyCheckService + processSignal（TradeSignal 落库）+ executeTrade（PortfolioManager
 * 虚拟记账）），因子源换为 FourMemeFactorAggregator（WSS tick 增量因子，61 键契约
 * 与旧 VirtualTradingEngine._buildFactors 逐字对齐）。
 *
 * 双交易模式（tradingMode）：
 *   - virtual：PortfolioManager 虚拟记账（executeTrade 0.5% 模拟手续费）
 *   - live（Phase 5）：FourMemeDirectTrader 真实链上成交。记账口径与 virtual 统一为
 *     USD 名义（实际 BNB 成交按 BNB/USD 换算；组合 cash = 链上可用 BNB 的 USD 等值，
 *     记账 fee=0——真实成本已含在实际成交里）。链上事实优先：记账异常不改变交易
 *     成功语义，cash 由 _reconcileLiveCash 对账兜底。重启恢复走 _loadHoldingsLive
 *     （trades 账面 + 链上 balanceOf 对账 + tokenPool/FA 状态重建）；卖出失败有
 *     冷却（防 tick 级重试烧 gas）。
 *
 * 驱动模型：collector（TokenCreate/TokenPurchase/TokenSale/LiquidityAdded 事件）→
 * FA.processTick → 'factorsUpdated' → _onFactorsUpdated：
 *   - 卖腿：token.status==='bought' 时每 tick 实时评估（止损/止盈时间敏感，不去抖）
 *   - 买腿：slot 级去抖（signalDebounceMs 重置 + signalDebounceMaxWaitMs 强制触发）
 *     —— 因子仍每 tick 实时累加，去抖只推迟「策略评估」时机
 *
 * 与旧 VirtualTradingEngine 的行为差异（Phase 3 有意收紧）：
 *   - 分腿评估：买/卖腿各自只评估对应 action 的策略（actionFilter）。旧引擎混合评估下
 *     同优先级的买策略会遮蔽卖出（已持仓时表现为加仓）；单仓语义下买入触发对持仓
 *     代币是无效噪声，不过滤会静默封死止损/止盈。sold 后重买（第 2 轮起走
 *     repeatBuyCheckCondition）与旧引擎轮次语义保持一致。
 *   - 单仓语义：token.status==='bought' 期间不再触发买入（旧引擎允许 condition 命中
 *     即加仓）；FA 的多仓能力保留给后续 live。
 *   - 组合快照 30s 一轮（portfolio_snapshots；experiment_time_series_data 时序表
 *     2026-10-15 停写，表与历史数据保留）。
 */

const { TradingMode, EngineStatus } = require('../interfaces/ITradingEngine');
const { AbstractTradingEngine } = require('../core/AbstractTradingEngine');
const { TxSeenSignal } = require('../core/TxSeenSignal.js');
const { createIpfsCacheWriter } = require('../core/IpfsCacheWriter.js');
const { ExperimentDataService } = require('../../web/services/ExperimentDataService');
const Logger = require('../../services/logger');
const Decimal = require('decimal.js');

// 基础配置（实验级 fourmemeWs 段在 _initializeDataSources 中合并覆盖）
const baseConfig = require('../../../config/default.json');

// 永久阻断条件编译缓存（批次 4c）：key=jsExpr\0keys（形参列表决定 fn），命中免每
// tick new Function。FIFO 1000 上限纯防呆（实际条目数=distinct(条件,键集)，极小）
const _permBlockFnCache = new Map();

class FourMemeWssTradingEngine extends AbstractTradingEngine {
  /**
   * @param {Object} engineConfig
   * @param {string} engineConfig.tradingMode - 'virtual' | 'live'
   * @param {number} [engineConfig.initialBalance] - 虚拟初始余额（USD 名义，live 忽略——以链上为准）
   */
  constructor(engineConfig = {}) {
    super({
      id: `fourmemeWs_${Date.now()}`,
      name: 'FourMeme WSS Trading Engine',
      mode: engineConfig.tradingMode === 'live' ? TradingMode.LIVE : TradingMode.VIRTUAL,
      blockchain: 'bsc',
    });

    this._isLive = engineConfig.tradingMode === 'live';

    this.initialBalance = engineConfig.initialBalance || 100;
    this._currentBalance = this.initialBalance;

    this.dataService = new ExperimentDataService();
    this.logger = new Logger({ dir: './logs', experimentId: null });

    // 组件（_initializeDataSources 中创建）
    this._factorAggregator = null;
    this._collectors = [];              // 内嵌 ANKR WSS collectors（直连架构 2026-10-09：per-platform 一枚，watcher 已废除）
    this._senderResolver = null;        // 共享 sender 解析器（config.senderResolve.enabled 才构造，单实例传各 collector）
    this._eventWriter = null;           // wss_events 写入器（token_create/graduation/token_quote_set + 重试队列）
    this._preBuyCheckService = null;
    this._strategyEngine = null;

    // 运行状态
    this._seenTokens = new Set();        // 已落库 experiment_tokens 的 `${token}-bsc`
    this._buyingTokens = new Set();      // 买路径执行中（预检查+记账期间防重入）
    this._sellingTokens = new Set();     // 卖路径执行中防重入（tick 密集，必须有）
    this._restoreAnchors = new Map();    // 重启恢复的持仓锚点 tokenAddress → { buyPriceUsd, buyTime }
    this._routerGateState = new Map();   // router 门观察史 tokenAddress → { lowSideSeen, outCount }（pre-check/router-gate-state.js）
    this._intervals = {};
    this._wssDownFlagged = false;

    // live 执行层状态（Phase 5）
    this._trader = null;                 // 主 trader（单平台=唯一；双平台=map 首个——余额检查/holdings 对账/PCS 懒加载等平台无关读点走它）
    this._liveTraderMap = null;          // per-platform live trader（platform → trader，2026-10-14 双平台 live；单平台 size=1）
    this._walletAddress = null;
    this._lastKnownBnbUsd = 0;           // 最近一次 BNB/USD（live 60s interval 刷新，启动时 trader 直读一次）
    this._sellCooldownUntil = new Map(); // 卖出失败冷却 tokenAddress → untilTs（live 防 gas 消耗风暴）
    this._sellFailStreak = new Map();    // 卖出连续失败计数 tokenAddress → 连败数（熔断判定输入）
    this._buyFailStreak = new Map();     // 买入连续失败计数 tokenAddress → 连败数（熔断判定输入，只计发单后链上失败）
    this._buyBlockedTokens = new Set();  // 买入熔断拉黑（连败达标 token；内存态重启丢，与 _narrativeBlockedTokens 同款）
    this._pcsTrader = null;              // PCS V2 trader（P0-C 懒加载：毕业票手工卖专用，TM2 毕业后 sellToken 必 revert）

    // 引擎级配置（fourmemeWs 段；实验级覆盖在 _initializeDataSources 中重读）
    this._applyWsConfig(baseConfig[this._wsConfigSectionName()] || {});

    // 买评估去抖（real 模式；与回测引擎共享 TickDebouncer 语义）
    const { TickDebouncer } = require('../core/TickDebouncer');
    this._buyDebouncer = new TickDebouncer({
      debounceMs: this._signalDebounceMs,
      maxWaitMs: this._signalDebounceMaxWaitMs,
      mode: 'real',
      onFire: (tokenAddress, tick) => {
        this.metrics.debounceFired++;
        this._runBuyEvaluation(tokenAddress, tick);
      },
    });

    // 卖出确认去抖（real 模式；首真 tick 起计不重置，语义见 SellConfirmDebouncer）
    // minTicks 双门（2026-10-16 蓝筹蛙/RIBBIT 断流案）：时间窗 AND 窗后新 tick 数，
    // maxWaitMs 强制逃生（缺省 120s）；minTicks=0 纯时间语义存量零变化
    const { SellConfirmDebouncer } = require('../core/SellConfirmDebouncer');
    this._sellConfirmDebouncer = new SellConfirmDebouncer({
      debounceMs: this._sellDebounceMs,
      minTicks: this._sellDebounceMinTicks,
      maxWaitMs: this._sellDebounceMaxWaitMs,
      mode: 'real',
      onFire: (tokenAddress, tick) => this._onSellDebounceFire(tokenAddress, tick),
    });

    // pumpfun 回迁批 2 闩锁（token 级降维：单仓语义下对齐 _tokenBlacklist 生命周期模式）
    this._tokenLocks = new Set();     // 止损闩锁：lockTokenAfterSell 卖腿成交 → 该 token 永久禁买
    this._cumLossTotals = new Map();  // token → 已平仓轮 profitPercent 累计（盈亏同记）
    this._cumLossLockPct = null;      // 累亏闩锁阈值（卖腿 cumulativeLossLockPct，多腿取最严；null=未配置）
    // E5 多卖腿轮账本：tokenAddress → { buyUsd, sellUsdGross, buyTime }——记账货币=USD
    // （与 PM cash/trades 表同口径；virtual tradeAmount 与 live bnbReceived×bnbUsd 统一折 USD）。
    // 买入成功登记，每卖腿累计；全清（PM 余仓≤0）时 addCompletedPair 一次记整轮 pnl=Σ卖-买
    this._roundLedger = new Map();
    // 卡牌仓位（迁自 rich-js）：addr → 该 token 当前卡数（key 用原始地址，与
    // _roundLedger/_tokenLocks 同口径）。机制关闭时恒空 Map；开关在
    // _initializeDataSources 解析 positionManagement.perCardBNB
    this._tokenCards = new Map();
    this._perCardBNB = null;
    this._cardsEnabled = false;

    this.metrics = {
      totalTrades: 0,
      successfulTrades: 0,
      failedTrades: 0,
      totalSignals: 0,
      executedSignals: 0,
      // 事件链路心跳（监控/停摆诊断）
      factorsUpdatedCount: 0,
      lastFactorsUpdatedAt: null,
      lastBuyEvalAt: null,
      debounceFired: 0,
      debounceSuppressed: 0,
    };

    this.logger.info(this._experimentId, 'FourMemeWssTradingEngine',
      `🎮 WSS 事件驱动引擎已创建: ${this.id}, 初始余额: ${this.initialBalance}`);
  }

  /** fourmemeWs 段配置 → 引擎参数 */
  _applyWsConfig(wsConfig) {
    this._wsConfig = wsConfig || {};
    this._signalDebounceMs = this._wsConfig.signalDebounceMs ?? 1500;
    this._signalDebounceMaxWaitMs = this._wsConfig.signalDebounceMaxWaitMs ?? 5000;
    // 卖出确认去抖（pumpfun 回迁批 2；默认 0=关闭，存量实验行为零变化）
    this._sellDebounceMs = this._wsConfig.sellDebounceMs ?? 0;
    // 双门确认（2026-10-16 蓝筹蛙/RIBBIT 断流案）：minTicks=0 纯时间语义零变化；
    // maxWaitMs 仅 minTicks>0 时武装（缺省 120s 强制逃生）
    this._sellDebounceMinTicks = this._wsConfig.sellDebounceMinTicks ?? 0;
    this._sellDebounceMaxWaitMs = this._wsConfig.sellDebounceMaxWaitMs ?? 120000;
    this._pruneIntervalMs = this._wsConfig.pruneIntervalMs ?? 5 * 60 * 1000;
    this._pruneMaxAgeMs = this._wsConfig.pruneMaxAgeMs ?? 30 * 60 * 1000;
    // TokenPool 监控票淘汰门槛（批次 3c）：null=不淘汰（默认，pool 零淘汰旧行为）；
    //   建议 24h——比 pool 自身 maxAge(20min) 更保守的引擎级第二道闸
    this._tokenPoolEvictMinAgeMs = this._wsConfig.tokenPoolEvictMinAgeMs ?? null;
    // 组合快照周期（experiment_time_series_data 时序表 2026-10-15 停写，表保留）
    this._portfolioSnapshotIntervalMs = this._wsConfig.portfolioSnapshotIntervalMs ?? 30 * 1000;
    this._wssDownThresholdMs = this._wsConfig.wssDownGuardMs ?? 15 * 60 * 1000;
    // 断流自愈阈值（消息静默 ≥ 此值每轮踢 forceReconnect；自 watcher 迁回实验进程，2026-10-09）
    this._wssSelfHealMs = this._wsConfig.downGuardSelfHealMs ?? 5 * 60 * 1000;

    // live 执行层参数（实验级覆盖在 _initializeLiveTrader 中重读 trading 段）
    const liveConfig = this._wsConfig.live || {};
    this._reserveNative = new Decimal(liveConfig.reserveNative ?? 0.01); // gas 保留 BNB（≈3 笔 300k×10gwei）
    this._liveSlippagePct = liveConfig.slippageTolerance ?? 5;           // 滑点百分比（trader 契约：5 = 5%）
    this._liveMaxGasPriceGwei = liveConfig.maxGasPrice ?? 10;            // gwei
    this._liveHoldingsSyncMs = liveConfig.holdingsSyncMs ?? 5 * 60 * 1000;
    this._sellFailureCooldownMs = liveConfig.sellFailureCooldownMs ?? 60 * 1000;
    // live 加固（迁自 rich-js 防御层）：
    this._liveMinOutRatio = liveConfig.minOutRatio ?? 0.5;               // L1 预成交校验比值（meme 内盘默认 0.5，见 preTradeCheck）
    this._liveMaxPositionTokens = liveConfig.maxPositionTokens ?? 0;     // 持仓代币数上限（0=不限；只拦新开仓）
    this._sellCbFailures = liveConfig.sellCircuitBreakerFailures ?? 5;   // 卖出连续失败熔断阈值
    this._sellCbCooldownMs = liveConfig.sellCircuitBreakerCooldownMs ?? 30 * 60 * 1000; // 熔断后长冷却
    this._liveTxWaitTimeoutMs = liveConfig.txWaitTimeoutMs ?? 120000;    // trader 交易回执等待超时（防 pending 永久挂起）
    this._liveTxReceiptViaWss = liveConfig.txReceiptViaWss !== false;    // WSS 快速回执（2026-10-15 提速①）：collector tick 信号 race waitForTransaction，默认开；显式 false=纯原路径
    this._buyCbFailures = liveConfig.buyCircuitBreakerFailures ?? 3;     // 买入连续失败熔断阈值（2026-10-14 龙龙币二 0x2831fdfa revert 死循环案用户裁定：连败 3 拉黑；前置拒绝不计——只计发单后失败）
  }

  /** 当前可用余额（PortfolioManager 真实余额优先） */
  get currentBalance() {
    try {
      const portfolio = this._portfolioManager?.getPortfolio(this._portfolioId);
      if (portfolio) {
        const cashBalance = portfolio.cashBalance;
        return typeof cashBalance === 'number' ? cashBalance : cashBalance?.toNumber?.() ?? this._currentBalance;
      }
    } catch {}
    return this._currentBalance;
  }

  // ==================== 抽象方法实现 ====================

  async _updateComponentLoggers() {
    this.logger.setExperimentId(this._experimentId);
  }

  async _initializeDataSources() {
    // 双平台实验（config.platform='both'）：单引擎实例 per-token 分派，两平台共用
    // 资金池/策略状态/consumer 水位；引擎级配置恒 fourmemeWs 段（见 _wsConfigSectionName）
    if (this._experiment?.config?.platform === 'both') {
      this._name = 'Dual WSS Trading Engine (fourmeme+flap)';
      this.logger.info(this._experimentId, 'FourMemeWssTradingEngine',
        '🔀 双平台实验 | platforms=fourmeme,flap 配置段=fourmemeWs | 单引擎共用资金池/策略状态/水位');
    }
    // 实验级 fourmemeWs 覆盖重读（构造器时 _experiment 未注入，只有 base 段；
    // debounce/live 参数随之生效，debouncer 按最终参数重建——初始化阶段无 pending，安全）
    this._applyWsConfig(this._mergedWsConfig());
    const { TickDebouncer } = require('../core/TickDebouncer');
    this._buyDebouncer = new TickDebouncer({
      debounceMs: this._signalDebounceMs,
      maxWaitMs: this._signalDebounceMaxWaitMs,
      mode: 'real',
      onFire: (tokenAddress, tick) => {
        this.metrics.debounceFired++;
        this._runBuyEvaluation(tokenAddress, tick);
      },
    });
    const { SellConfirmDebouncer } = require('../core/SellConfirmDebouncer');
    this._sellConfirmDebouncer = new SellConfirmDebouncer({
      debounceMs: this._sellDebounceMs,
      minTicks: this._sellDebounceMinTicks,
      maxWaitMs: this._sellDebounceMaxWaitMs,
      mode: 'real',
      onFire: (tokenAddress, tick) => this._onSellDebounceFire(tokenAddress, tick),
    });

    const TokenPool = require('../../core/token-pool');

    // 1. 购买前检查服务（默认配置 + 实验级覆盖，与 Virtual 同源）
    const { PreBuyCheckService } = require('../pre-check/PreBuyCheckService');
    const { dbManager } = require('../../services/dbManager');
    const supabase = dbManager.getClient();
    const preBuyCheckConfig = {
      ...baseConfig.preBuyCheck,
      ...(this._experiment?.config?.preBuyCheck || {}),
    };
    this._preBuyCheckService = new PreBuyCheckService(supabase, this.logger, preBuyCheckConfig);
    this.logger.info(this._experimentId, 'FourMemeWssTradingEngine',
      `✅ 购买前检查服务初始化完成 (earlyParticipantFilterEnabled=${preBuyCheckConfig.earlyParticipantFilterEnabled})`);

    // 1.5 叙事评级直调（策略 narrativeCallCondition 触发时同步调 NarrativeAnalyzer.analyze，Jev 秒级）
    const { NarrativeDirectCaller, mapGmgnRiskFactors, shouldBlockOnNarrative } = require('../pre-check/NarrativeDirectCaller');
    // C70 参数化（2026-10-15 bunker 案，实验级 fourmemeWs.narrativeRetry）：
    // enabled 默认开（显式 false 才关——UI 物化语义：删段=静默重开）；
    // intervalMs=穿透 TTL（默认 10s）/ maxAnalyses=真跑上限（默认 3，计含首析
    // 故名 maxAnalyses 非 maxRetries）/ windowSec=叙事否决豁免窗（默认 300s）；
    // flap 实验经 _mergedWsConfig 自动读 flapWs 段。
    // C84（2026-10-17）起 intervalMs/maxAnalyses 兼供叙事触发状态机的重试轮臂
    //（FA narrativeRetryDue 因子，见 _narrativeTriggerCheck）
    const narrativeRetry = this._mergedWsConfig().narrativeRetry || {};
    this._narrativeCaller = new NarrativeDirectCaller({
      // 账号型未过缓存 10s TTL 穿透重析（2026-10-14 用户裁定，Virusking 案）：宣告推
      // 晚发场景直调 ~10s 内重析翻案，不等 worker PrecheckFailRetry ~30s 周期；仅实时
      // 链路开——回测禁穿透（历史行 analyzed_at 恒老，开了=语料前视）
      accountFailTtlReanalyze: narrativeRetry.enabled !== false,
      ...(Number.isInteger(narrativeRetry.intervalMs) ? { accountFailTtlMs: narrativeRetry.intervalMs } : {}),
      ...(Number.isInteger(narrativeRetry.maxAnalyses) ? { maxAnalysesPerToken: narrativeRetry.maxAnalyses } : {}),
    });
    // 叙事否决短路集（2026-09-27 用户裁定：叙事评级确认为 low 的代币不再重复生成
    // 买信号——每次 fire 白落 signal 行 + 全套 preBuyCheck；address-fail 宣告竞态
    // 盘的豁免见 shouldBlockOnNarrative。内存语义：重启丢失后首个 fire 重新调叙事
    // （缓存命中秒回）重新登记，代价一条 signal 行）
    this._narrativeBlockedTokens = new Set();
    // 叙事预触发（N3，2026-10-13 叙事提速案）：tick 先于买门 fire 后台发起直调，
    // fire 时 inflight join 同一 promise / 已完成则行缓存命中秒回（直调路径零改动）。
    // 实验级开关 fourmemeWs.narrativePrefetch.enabled（2026-10-17 用户裁定默认开：
    // 0xd97a…7777 案 fire→成交 10.85s 中叙事直调同步段占 9.1s；删段=开、显式 false
    // 才关，narrativeRetry 同款物化语义；flap 实验配 flapWs 段同键）；回测不适用
    // （BacktestEngine 有 preloadCache 预载机制）。默认开代价：过叙事条件的 token
    // 全部后台跑一次叙事链（不只最终 fire 的），配额放大由条件门槛控制
    this._narrativePrefetchEnabled = (this._mergedWsConfig().narrativePrefetch || {}).enabled !== false;
    this._narrativePrefetchedTokens = new Set();   // write-once per-token（无论成败，失败由 fire 直调兜底）
    this._narrativePrefetchStartedAt = new Map();  // token → 预触发发起时刻（prefetchLeadMs 度量）
    this._narrativePrefetchCond = undefined;       // 惰性解析的预触发条件（undefined=未算过）
    // ── C84 叙事发起条件触发状态机（2026-10-17 买腿链路重构）──
    // 新模型腿（携带 narrativeTriggerCondition）：tick 时刻按因子表达式发起/续跑后台
    // 叙事分析（首轮 reason='condition'；账号型 rating=1 到期补轮 reason='retry'，上限
    // narrativeRetry.maxAnalyses），结果投影回 FA（narrativeRating/narrativeRounds/
    // narrativeRetryDue）供单一买条件消费——分析未完成/未通过 = 条件恒 false =
    // 不产生买信号（无 signal 行）。每轮留痕 narrative_analysis_rounds（信号页叙事
    // 事件列表）。legacy 腿不携带字段 = 状态机零激活（_narrativeTriggerCheck 首行
    // 早退），旧链路 bit 一致。fire-and-forget + catch（N3/OPB 同款先例）
    this._narrativeTriggerStates = new Map();  // token → 触发态（字段见 _narrativeTriggerCheck 头注）
    this._narrativeTriggerCondCache = undefined; // 惰性解析的发起条件（undefined=未算过）
    // 毕业事件全清幂等集（2026-09-28 王之蔑视案裁定「2+1」）：graduation 事件实测重复
    // 派发两遍 → Set 挡第二次触发；内存语义与 _narrativeBlockedTokens 同款——重启丢失
    // 安全（事件不重放，重启后无仓则不触发、已卖则 status 已变）
    this._graduationSoldTokens = new Set();
    // 叙事否决豁免窗（C70 实验级参数化）：windowSec 缺省 300=worker retryWindowSec
    // 缺省同款全局常量；⚠️ 不得低于 worker 的 retryWindowSec——拉黑先于末次重析
    // 翻正 = 误拉黑且 _narrativeBlockedTokens 无撤销路径。闭包包装：三个消费点
    // （拉黑登记/买腿短路）签名零改动
    this._narrativeRetryWindowSec = Number.isInteger(narrativeRetry.windowSec) && narrativeRetry.windowSec >= 60
      ? narrativeRetry.windowSec : 300;
    this._shouldBlockOnNarrative = (r, s, a) => shouldBlockOnNarrative(r, s, a, this._narrativeRetryWindowSec);
    // 挂 this：解构是 _initializeDataSources 函数级作用域，_evaluateBuyPath 裸引用会
    // ReferenceError（2026-09-27 蝴蝶轮回案：60 次 BUY 信号全挂「mapGmgnRiskFactors is not defined」）
    this._mapGmgnRiskFactors = mapGmgnRiskFactors;

    // 1.5.2 买腿第三层 GMGN 条件（FAKER 0xc6ee…7777 团伙盘案，2026-10-14 用户裁定）：
    // 触发→预检查→GMGN 三层；第三层因子在前两层全过后才构建（=此刻才真调 GMGN
    // getTokenInfo，与直调快照刻意隔离——只认自己 fetch 的结果）。fail-closed：
    // 调不到数据=拒买，机制硬保证。配置 fourmemeWs.gmgnCheck（flap 实验同键；
    // perTokenTtlMs 短窗复用 / failCooldownMs 失败冷却）
    const { GmgnRiskCheckService } = require('../pre-check/GmgnRiskCheckService');
    this._gmgnRiskCheckService = new GmgnRiskCheckService(
      this._mergedWsConfig().gmgnCheck || {}, this.logger);

    // 1.5.2b GMGN 钱包画像层（2026-10-18 Agentum/Konasu/7777 sybil 案调研接入）：fire
    // 时刻首窗 top-N 买家的跨盘画像（gmgn_wallet_profiles 表离线回填为主 + 触发窗后台
    // 增量回写 + miss 轻量补查），gwp* 18 键并入 GMGN 第三层 context。架构=用户裁定
    // 离线建库优先（fire 查表毫秒级，绝不逐钱包实时 API 主路径）。默认关
    //（enabled !== true 才开——观察模式物化语义，与 narrativePrefetch 相反方向：新
    // 机制默认零影响）；flap 实验经 _mergedWsConfig 同键。回测不接线（BacktestEngine
    // GMGN 快照层 spread emptyFactors）——gwp 动态计数对历史 fire 是已知时序穿越，
    // 跳过比穿越诚实（台账显式声明）
    const gwpCfg = this._mergedWsConfig().gmgnWalletStats || {};
    this._walletStatsEnabled = gwpCfg.enabled === true;
    this._walletStatsService = this._walletStatsEnabled
      ? new (require('../pre-check/GmgnWalletStatsService').GmgnWalletStatsService)(gwpCfg, this.logger)
      : null;
    // per-token 预取状态：{ lastCheckAt, firstPrefetchAt }（gwpLeadMs=首次预取→fire 提前量）
    this._walletProfileStates = new Map();
    this._gwpCondLeg = undefined;     // 惰性解析：任一买腿带 gmgnCheckCondition（_narrativePrefetchCondCache 同款）

    // 1.5.2c 账号信息复检（C166，2026-10-22 一次性专号 rug 家族案 SL/FOURGE）：持仓期
    // 定期裸调 apidance 检测宣告账号「删号/宣告推被删/推文清零」→ FA issuerAccountState
    // 因子 → 卖臂全清（删号删推=比价格更早的 rug 前兆；本案买入后 3 分钟砸盘 -56%，
    // 价格止损永远吃残值）。默认关（enabled !== true 才开，gwp 同款新机制物化语义：
    // 默认零影响）；flap 实验经 _mergedWsConfig 同键。节流双档=持仓前 firstWindowMin
    // 每 fastIntervalSec（rug 高发窗）之后每 slowIntervalSec 持续到清仓（用户裁定）。
    // 回测不接线：BacktestEngine 无本段（时序穿越防线，gwp 同款）。
    const ahcCfg = this._mergedWsConfig().accountHealthCheck || {};
    this._accountHealthEnabled = ahcCfg.enabled === true;
    this._accountHealthMonitor = this._accountHealthEnabled
      ? new (require('../core/AccountHealthMonitor').AccountHealthMonitor)(ahcCfg, this.logger)
      : null;
    // per-token 复检态：{handle, announceTweetId, lastCheckAt, firstHeldAt, resolved}
    // resolved=true 含负缓存（token_narrative 无 twitter_info 的票 handle=null 不再重查）
    this._accountRecheckStates = new Map();
    this._accountHealthFirstWindowMs = Number.isFinite(ahcCfg.firstWindowMin) && ahcCfg.firstWindowMin > 0
      ? ahcCfg.firstWindowMin * 60 * 1000 : 10 * 60 * 1000;
    this._accountHealthFastMs = Number.isFinite(ahcCfg.fastIntervalSec) && ahcCfg.fastIntervalSec > 0
      ? ahcCfg.fastIntervalSec * 1000 : 30 * 1000;
    this._accountHealthSlowMs = Number.isFinite(ahcCfg.slowIntervalSec) && ahcCfg.slowIntervalSec > 0
      ? ahcCfg.slowIntervalSec * 1000 : 120 * 1000;

    // 1.5.1 同叙事龙头已火检查（narrativeLeaderHot 因子：直调拿到 sourceTweetId 后查
    // 同源推文其余代币的峰值涨幅，火门槛 5x + 首达后 24h 拒绝窗口；详见 SameNarrativeLeaderService 头注）
    const { SameNarrativeLeaderService } = require('../pre-check/SameNarrativeLeaderService');
    this._sameNarrativeLeaderService = new SameNarrativeLeaderService(supabase, this.logger);

    //（1.5.3 数据预取门已随 C84 2026-10-17 退役：分析提前到叙事发起条件触发时刻，
    // 预取失去意义——机制整体删除，档案见台账 C84）

    // 1.6 叙话语料补采（新代币入池时抓平台附属信息进 raw_api_data；
    // 配置段 corpusEnrich（默认/实验级覆盖经 _mergedWsConfig 合并；flap 子类同键生效））
    const { TokenCorpusEnricher } = require('../core/TokenCorpusEnricher');
    this._corpusEnricher = new TokenCorpusEnricher(
      this._mergedWsConfig().corpusEnrich || {}, this.logger, this._experimentId);
    // IPFS 缓存共用（2026-10-15 提速②b）：补采拿到的 metadata 写叙事侧缓存（键与
    // 直调读键一致），fire 直调 ipfs 段塌缩为 DB 读。无条件注入——写幂等无害不设开关
    this._corpusEnricher.ipfsCacheWriter = createIpfsCacheWriter(this.logger).write;

    // 2. 代币池（FA 自带趋势序列，池不再需要价格/持有者历史缓存）
    this._tokenPool = new TokenPool(this.logger);
    this.logger.info(this._experimentId, 'FourMemeWssTradingEngine', '✅ 代币池初始化完成');

    // 3. 因子聚合器 + 事件链路
    // （键名固定 fourmemeWs：FA 仅读该节的 maxTrackedTokens，flap 子类传 flap merged 配置同键）
    const FourMemeFactorAggregator = require('../../services/FourMemeFactorAggregator');
    const wsMerged = this._mergedWsConfig();
    // P2b 死重维护开关（2026-10-12 回测性能案）：FA 先于 TPA/OPB 构造 → 用 config 判定
    // 而非实例存在性。cls 轨迹跟随 OPB enabled（false 时 OPB start/扫描早退对 cls 字段零读，
    // 与 3.5 节 OPB 构造段同判据）；TPA 双 map 跟随 3.4 节 TPA 构造条件（config 段存在）
    this._factorAggregator = new FourMemeFactorAggregator({
      fourmemeWs: wsMerged,
      maintainClassifierTracks: (wsMerged.onlineProfile || {}).enabled === true,
      maintainTpaTracks: this._experiment?.config?.tokenPositionAnalyzer != null,
    }, this.logger);
    this._factorAggregator.on('factorsUpdated', (data) => this._onFactorsUpdated(data));
    // C84 叙事触发轮参数投影（各键全传——setNarrativeFactorConfig 部分注入语义下，
    // 同进程先跑过回测（Infinity/0）再起实时引擎会继承回测值；用 FA 默认值单一
    // 真相源补全防字面量漂移）：narrativeRetry.intervalMs/maxAnalyses 兼供 FA
    // narrativeRetryDue 臂（引擎触发状态机与 FA 因子判据共用同一组数=行为一致）；
    // C162 零语料臂两键 noCorpusIntervalMs/noCorpusMaxAnalyses（实验级可选覆盖，
    // 默认 60s×8=8 分钟窗，覆盖抢跑票宣告推/GMGN 聚合的分钟级晚到）
    {
      const _nrDefaults = FourMemeFactorAggregator.getNarrativeFactorDefaults();
      this._narrativeTriggerIntervalMs = Number.isInteger(narrativeRetry.intervalMs) && narrativeRetry.intervalMs > 0
        ? narrativeRetry.intervalMs : _nrDefaults.intervalMs;
      this._narrativeTriggerMaxAnalyses = Number.isInteger(narrativeRetry.maxAnalyses) && narrativeRetry.maxAnalyses >= 0
        ? narrativeRetry.maxAnalyses : _nrDefaults.maxAnalyses;
      this._narrativeTriggerNoCorpusIntervalMs = Number.isInteger(narrativeRetry.noCorpusIntervalMs) && narrativeRetry.noCorpusIntervalMs > 0
        ? narrativeRetry.noCorpusIntervalMs : _nrDefaults.noCorpusIntervalMs;
      this._narrativeTriggerNoCorpusMaxAnalyses = Number.isInteger(narrativeRetry.noCorpusMaxAnalyses) && narrativeRetry.noCorpusMaxAnalyses >= 0
        ? narrativeRetry.noCorpusMaxAnalyses : _nrDefaults.noCorpusMaxAnalyses;
      FourMemeFactorAggregator.setNarrativeFactorConfig({
        intervalMs: this._narrativeTriggerIntervalMs,
        maxAnalyses: this._narrativeTriggerMaxAnalyses,
        noCorpusIntervalMs: this._narrativeTriggerNoCorpusIntervalMs,
        noCorpusMaxAnalyses: this._narrativeTriggerNoCorpusMaxAnalyses,
      });
    }
    // 市场 regime 截面 feed 显式 opt-in（回迁批 2.6 观察版：web 侧裸 FA 不 feed → 读恒 null 零污染；
    // 红线：任何交易策略 condition 不得引用 market* 键。stop() 关 feed 防同进程下一实验继承）
    FourMemeFactorAggregator.setMarketFeedEnabled(true);
    this._marketRegimeWriteFails = 0;
    this.logger.info(this._experimentId, 'FourMemeWssTradingEngine', '✅ 因子聚合器初始化完成');

    // 3.1 名单因子名单加载（回迁批 3.3）：smart_bot（wallets.category）+ sniper（wallets.token_count
    //     ≥ 阈值）。两加载均 try/catch fail-open：smartBotCount 恒 0 观察 / sniperHolderShare 恒 null
    //     fail-closed 门不放行——后果方向在因子层已定，加载失败只 warn 不阻断启动。
    //     （母版 Backtest 对 sniper 是 fail-fast：A/B B 臂门引用该键，静默 null 会产出误导性空统计；
    //     richer-js 无 A/B 装置且新键无存量策略引用，加载失败杀死整个 run 不符合「存量实验零变化」
    //     总门槛，故两引擎统一 fail-open——偏离存案，生产策略引用 sniperHolderShare 后再议）
    try {
      await FourMemeFactorAggregator.loadSmartBotWallets(supabase,
        (this._mergedWsConfig().factorParams || {}).smartBotCategory);
    } catch (e) {
      this.logger.warn(this._experimentId, 'FourMemeWssTradingEngine', `smart_bot 名单加载失败(fail-open): ${e.message}`);
    }
    try {
      await FourMemeFactorAggregator.loadSniperWallets(supabase);
    } catch (e) {
      this.logger.warn(this._experimentId, 'FourMemeWssTradingEngine', `sniper 名单加载失败(fail-open, sniperHolderShare 将恒 null): ${e.message}`);
    }
    // 跟单簇名单（2026-10-16 FLY 案）：读 config/rosters/copy-wallet-roster.json。
    // fail-closed 方向（文件缺失=因子恒 null=引用键的门不放行）与 sniper 同向；
    // 名单文件随仓库部署，正常 pull 即在——缺失=部署异常，warn 提示后继续启动
    // （门语义安全侧：宁可错过不可放过），人工补名单后重启生效。
    try {
      await FourMemeFactorAggregator.loadCopyWalletRoster();
    } catch (e) {
      this.logger.warn(this._experimentId, 'FourMemeWssTradingEngine', `跟单簇名单加载失败(fail-closed, maxCopyWalletHolderCircPct 将恒 null=门拦): ${e.message}`);
    }
    // 极著名钱包子集（2026-10-18 币安人生案用户点名）：famousCopyWalletCircPct 原料。
    // fail-open 方向（与主名单相反——它是收紧门不是防线）：文件缺失 → 空集合；加载
    // 抛错 → 保持 null——两者因子都恒 null=条件串 IS NULL 臂放行（未启用零影响）。
    try {
      await FourMemeFactorAggregator.loadFamousCopyWallets();
    } catch (e) {
      this.logger.warn(this._experimentId, 'FourMemeWssTradingEngine', `极著名钱包名单加载失败(fail-open, famousCopyWalletCircPct 恒 null=IS NULL 臂放行): ${e.message}`);
    }
    // sybil 大簇钱包并集（2026-10-20 乌龟案用户裁定）：sybilClusterHolderCircPct 原料。
    // fail-open 同 famous（新门未启用=零影响）：文件缺失 → 空集合；加载抛错 → 保持
    // null——两者因子恒 null=条件串 IS NULL 臂放行
    try {
      await FourMemeFactorAggregator.loadSybilClusters();
    } catch (e) {
      this.logger.warn(this._experimentId, 'FourMemeWssTradingEngine', `sybil 大簇名单加载失败(fail-open, sybilClusterHolderCircPct 恒 null=IS NULL 臂放行): ${e.message}`);
    }

    // 3.4 TPA 触发点持仓分析（回迁批 4 shadow 先行）：opt-in——实验 config 整段无
    //     tokenPositionAnalyzer → 不构造（存量实验零影响）；段存在才构造，trigger 缺配/非法
    //     由构造器 fail-fast 抛错 → 实验启动失败（禁止默认值兜底掩盖配置缺失）。
    //     策略条件暂不引用 TPAPre_*（纯观察+落表 enforce=false），参数回测校准后由用户裁定写入策略
    this._tokenPositionAnalyzer = null;
    const tpaExpConfig = this._experiment?.config?.tokenPositionAnalyzer;
    if (tpaExpConfig != null) {
      const { TokenPositionAnalyzer } = require('../../services/TokenPositionAnalyzer');
      this._tokenPositionAnalyzer = new TokenPositionAnalyzer(tpaExpConfig, {
        logger: this.logger,
        experimentId: this._experimentId,
        factorAggregator: this._factorAggregator,
      });
      this.logger.info(this._experimentId, 'FourMemeWssTradingEngine',
        `✅ TPA 已构造 (enabled=${this._tokenPositionAnalyzer.isEnabled()} ` +
        `enforce=${this._tokenPositionAnalyzer.isEnforceMode()})`);
      // offline 画像预载（TPA 内部 try/catch：失败 warn 回退按需 DB 查——fail-open 性能退化，不阻启动）
      const pre = await this._tokenPositionAnalyzer.preloadOfflineProfiles(supabase);
      this.logger.info(this._experimentId, 'FourMemeWssTradingEngine',
        `TPA offline 画像预载: ${pre.rows} 行 / ${(pre.ms / 1000).toFixed(1)}s (${pre.source || 'fail-open'})`);
      // live ticks 缓冲初始化 + 近期预载（直连架构 2026-10-09，母版同款时序）：init 先于预载，
      //   预载 await + fail-open（失败仅性能退化+窗口缺口由 fetchTicksPreBuffer 计数暴露，不阻断启动），
      //   且都在 _runMainLoop 的 collector.start() 之前完成 → 预载灌入与 collector tick 累积无交错
      this._tokenPositionAnalyzer.initLiveTicksBuffer();
      try {
        const _rt = await this._tokenPositionAnalyzer.preloadRecentTicks(supabase);
        if (_rt) this.logger.info(this._experimentId, 'FourMemeWssTradingEngine',
          `TPA live ticks 预加载: ${_rt.rows} 行 / ${(_rt.ms / 1000).toFixed(1)}s (窗口自 ${_rt.sinceIso})`);
      } catch (e) {
        this.logger.warn(this._experimentId, 'FourMemeWssTradingEngine',
          `TPA live ticks 预加载失败(fail-open): ${e.message}`);
      }
      // live token 分类预热（fire-and-forget：缓冲窗口 distinct token 一次预载，消除首分析冷查）
      this._tokenPositionAnalyzer.prewarmLiveTokenProfiles(supabase)
        .then((_tp) => {
          if (_tp) this.logger.info(this._experimentId, 'FourMemeWssTradingEngine',
            `TPA token_profile 预加载（窗口 distinct ${_tp.tokens}）→ 缓存 ${_tp.cached} / ${(_tp.ms / 1000).toFixed(1)}s`);
        })
        .catch(e => this.logger.warn(this._experimentId, 'FourMemeWssTradingEngine',
          `TPA prewarm 异常: ${e.message}`));
    }

    // 3.5 在线代币分类（回迁批 3.1：idle 60s/大额断流 600s 双触发 + 60s 扫描补救，
    //     写 token_profiles source='online'；config fourmemeWs.onlineProfile.enabled 默认 false，
    //     未配置的存量实验零行为变化。BacktestEngine 不嵌——回测无写表副作用）
    const { OnlineProfileBuilder } = require('../../services/OnlineProfileBuilder');
    this._onlineProfileBuilder = new OnlineProfileBuilder(
      this._mergedWsConfig().onlineProfile || {}, this.logger,
      // 分类落库成功回调（回迁批 4）：喂 TPA 分类缓存——OPB 只写库不留内存，无此钩子时
      // token 在分类完成前被 TPA 查过会 stuck-null 永不更新；TPA 未启用时传 null 不挂钩
      this._tokenPositionAnalyzer
        ? (tokenAddress, row) => this._tokenPositionAnalyzer.upsertTokenProfileCache(tokenAddress, row)
        : null);
    this._onlineProfileBuilder.start({ factorAggregator: this._factorAggregator });

    // 4. 内嵌 WSS collectors（直连架构 2026-10-09：实验进程自己持有订阅，watcher 已废除；
    //    collector 内存回调直喂 FA/pool→factorsUpdated→买卖管线，DB 落库仅作持久化）
    this._createCollectors();
    this.logger.info(this._experimentId, 'FourMemeWssTradingEngine',
      `✅ 内嵌 WSS collectors 初始化完成 | platforms=[${this._collectors.map(c => c._platformLabel).join(',')}]`);

    // 5. 策略引擎（buyStrategies/sellStrategies → 扁平数组，与 Virtual 同构）
    const { StrategyEngine } = require('../../strategies/StrategyEngine');
    const strategiesConfig = this._buildStrategyConfig();
    this._strategyEngine = new StrategyEngine({ strategies: strategiesConfig });

    const { getAvailableFactorIds } = require('../core/FactorBuilder');
    const availableFactorIds = getAvailableFactorIds();

    const strategyArray = [];
    if (strategiesConfig.buyStrategies && Array.isArray(strategiesConfig.buyStrategies)) {
      strategiesConfig.buyStrategies.forEach((s, idx) => {
        strategyArray.push({
          id: `buy_${idx}_${s.priority || 0}`,
          name: `买入策略 P${s.priority || 0}`,
          description: s.description || '',
          action: 'buy',
          condition: s.condition,
          priority: s.priority || 0,
          maxExecutions: s.maxExecutions || null,
          preBuyCheckCondition: s.preBuyCheckCondition || null,
          repeatBuyCheckCondition: s.repeatBuyCheckCondition || null,
          // 买腿第三层 GMGN 条件（FAKER 团伙盘案 2026-10-14）。★此白名单映射漏透传
          // =运行时 strategy.gmgnCheckCondition 恒 undefined = 第三层静默跳过、GMGN 门
          // 整体失效（v15 事故 2026-10-15：起跑 9h 三笔已执行买入全都没过 GMGN 检查，
          // metadata.gmgnCheck 恒 null）——单测 D 段源码口径已锁此透传
          gmgnCheckCondition: s.gmgnCheckCondition || null,
          narrativeCallCondition: s.narrativeCallCondition || null,
          // N3 叙事预触发条件（2026-10-13）：不配 = 预触发用 narrativeCallCondition
          narrativePrefetchCondition: s.narrativePrefetchCondition || null,
          // C84 叙事发起条件（2026-10-17 买腿链路重构）：新模型腿标识——携带即激活
          // 触发状态机（tick 后台多轮叙事分析 + FA 投影），且与 narrativeCallCondition
          // 互斥（loadStrategies fail-fast）。★白名单映射漏透传 = 状态机永不激活 =
          // narrativeRating 恒 null = 新模型腿永不买（gmgnCheckCondition 透传事故同款
          // 形状，v15 教训），单测锁此透传
          narrativeTriggerCondition: s.narrativeTriggerCondition || null,
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
    if (strategiesConfig.sellStrategies && Array.isArray(strategiesConfig.sellStrategies)) {
      strategiesConfig.sellStrategies.forEach((s, idx) => {
        strategyArray.push({
          id: `sell_${idx}_${s.priority || 0}`,
          name: `卖出策略 P${s.priority || 0}`,
          description: s.description || '',
          action: 'sell',
          condition: s.condition,
          priority: s.priority || 0,
          maxExecutions: s.maxExecutions || null,
          bypassDebounce: !!s.bypassDebounce,
          lockTokenAfterSell: !!s.lockTokenAfterSell,
          cumulativeLossLockPct: typeof s.cumulativeLossLockPct === 'number' ? s.cumulativeLossLockPct : null,
          sellPercentage: (typeof s.sellPercentage === 'number'
            && s.sellPercentage > 0 && s.sellPercentage <= 1) ? s.sellPercentage : 1,
          // 卡牌仓位（迁自 rich-js）：同买腿透传（卖腿额外接受 'all'）
          cards: s.cards,
          cooldownSec: s.cooldownSec,
          // 已删除机制的 legacy 字段（cycle 分桶路由 2026-10-15 删除）刻意原样透传：
          // loadStrategies fail-fast 靠它识别携带旧字段的存量实验并拒启
          groups: s.groups,
          cycle: s.cycle,
          enabled: true,
        });
      });
    }
    // 未知因子 fail-fast（2026-10-03 hg55 事故裁定）：condition/narrativeCall 用 FA
    // 因子集校验；preBuy/repeat 买检查用 PreBuyCheckService 评估上下文键集校验；
    // gmgnCheckCondition 用第三层固定三键集校验（FAKER 团伙盘案 2026-10-14）
    //（别名防与本方法早前第 2 步的 PreBuyCheckService 声明重复）
    const { PreBuyCheckService: _PreBuyCheckService } = require('../pre-check/PreBuyCheckService');
    const { GmgnRiskCheckService: _GmgnRiskCheckService } = require('../pre-check/GmgnRiskCheckService');
    this._strategyEngine.loadStrategies(strategyArray, availableFactorIds,
      new Set(_PreBuyCheckService.getConditionFactorKeys()),
      new Set(_GmgnRiskCheckService.getConditionFactorKeys()));

    //（数据预取门因子校验已随 C84 2026-10-17 机制退役删除；narrativeTriggerCondition
    // 的未知因子校验在 loadStrategies FA 集内完成）

    // 累亏闩锁阈值：取卖腿 cumulativeLossLockPct 最大值（多腿并存时最严者先锁，fail-closed 方向）；
    // 未配置任何腿 = null = 机制关闭（存量实验零变化）
    const _cumLocks = this._strategyEngine.getAllStrategies()
      .filter(s => s.action === 'sell' && s.cumulativeLossLockPct != null)
      .map(s => s.cumulativeLossLockPct);
    this._cumLossLockPct = _cumLocks.length > 0 ? Math.max(..._cumLocks) : null;
    this.logger.info(this._experimentId, 'FourMemeWssTradingEngine',
      `✅ 策略引擎初始化完成，加载了 ${this._strategyEngine.getStrategyCount()} 个策略`);

    // 6.0.5 FA preFilter 平移实时（批次 6，2026-10-15；对齐回测 2026-10-12 默认开裁定）：
    //   从每个买腿 condition AST 提取 age 区间（分钟，与 FA age 因子同锚同单位）注入 FA
    //   ——未持仓 token 的 age 落在全部区间外 → FA _buildFactorMap 返回 null →
    //   processTick/applyWalletTick 尾部不 emit factorsUpdated（出窗票零买腿/卖腿/TPA/
    //   OPB per-tick 评估，副作用序列与回测 tickBuildSkip build-null 同族）。持仓票豁免
    //   由 FA _positions.size===0 门结构性保证（卖腿/止损不受影响）；AND 链出 age 区间必
    //   false 不漏买；fire 评估 _runBuyEvaluation 独立全量重建零影响。live 刻意不调
    //   shouldSkipTickBuild/不做 C 类 minimal factors（出窗=不 emit，与回测 build-null
    //   continue 同族）。观察通道代价（回测已接受同族损失）：出窗票 TPA 不再触发、OPB
    //   per-tick 入口停→60s 扫描兜底。开关 fourmemeWs.faPreFilter !== false 默认开
    //   （flap 实验经 _mergedWsConfig 同键继承）；显式 false 恢复恒 emit 旧行为
    if (this._mergedWsConfig().faPreFilter !== false) {
      const { ConditionEvaluator: _CE } = require('../../strategies/ConditionEvaluator');
      const ranges = [];
      for (const s of this._strategyEngine.getAllStrategies()) {
        if (s.action !== 'buy') continue;
        // ★s.condition 是 loadStrategies 存的 AST 对象（非字符串）——原 String(s.condition)
        // 化成 "[object Object]" → parse 恒 throw → 提取恒 null（e50 3fcea181 三次实测形状，
        // preFilter 从未生效）。extractBuyRangeFromCondition 双形状入口（string|AST）直传
        const pf = s.condition ? _CE.extractBuyRangeFromCondition(s.condition) : null;
        if (pf) ranges.push(pf);
      }
      this._factorAggregator.setPreFilter(ranges.length > 0 ? ranges : null);
      if (ranges.length > 0) {
        const fmt = pf => `age∈[${pf.minAgeMinutes ?? '-∞'},${pf.maxAgeMinutes ?? '∞'})`;
        this.logger.info(this._experimentId, 'preFilter',
          `FA preFilter 已启用（默认开，fourmemeWs.faPreFilter=false 可关）：${ranges.length} 个买腿区间并集 ${ranges.map(fmt).join(' | ')}`);
      } else {
        this.logger.info(this._experimentId, 'preFilter',
          'FA preFilter 开启但无可提取 age 区间的买腿（OR 结构/无 age 子句）→ 不过滤');
      }
    }

    // 6. 交易金额 / 永久阻断 / 卡牌仓位
    const experimentConfig = this._experiment?.config || {};
    this._tradeAmount = experimentConfig.tradeAmount || 0.1;
    this._permanentBlockCondition = experimentConfig.strategiesConfig?.permanentBlockCondition || null;
    this._tokenBlacklist = new Map();
    // 卡牌机制开关（迁自 rich-js）：positionManagement.perCardBNB 存在且 >0 才启用。
    // 启用：买入金额 = perCardBNB × 本腿张数（cards ?? 1），卖腿配 cards 按卡数比例
    // 卖余仓（_emitSellSignal sizing）；未配置 = 全部卡牌字段忽略（存量实验零变化）
    const _pmPerCard = Number((experimentConfig.positionManagement || {}).perCardBNB);
    this._perCardBNB = Number.isFinite(_pmPerCard) && _pmPerCard > 0 ? _pmPerCard : null;
    this._cardsEnabled = this._perCardBNB != null;
    this.logger.info(this._experimentId, 'FourMemeWssTradingEngine',
      `交易金额配置 | tradeAmount=${this._tradeAmount}${this._cardsEnabled ? ` | 🃏 卡牌模式 perCardBNB=${this._perCardBNB}` : ''}`);

    // 6.5 引擎级止损双腿（用户裁定 2026-09-27，c5945f36 11 买 0 卖冻结实跑触发）：
    //   ① 时间止损：持有超 timeStopMinutes 仍浮亏或持平（profitPercent <= 0）→ 全清
    //     （<=0 而非 <0：断流冻结票 profit 恒 0，<0 会永远不触发——盘古案盲区）
    //   ② 价格止损：现价跌破买入成本 priceStopPercent（如 -50 = 跌 50%）→ 全清
    // 不配 stopLoss 段 = 机制完全关闭（存量实验零变化）；两条规则独立可配。
    // 触发双挂点：tick 即时（活票）+ 持仓扫描（断流票无 tick 永不进 _onFactorsUpdated，
    // 扫描是唯一路径）；执行走 _emitSellSignal 全清链（signals/trades/卡账本副作用全复用）
    const _sl = experimentConfig.stopLoss || {};
    const _slTimeMin = Number(_sl.timeStopMinutes);
    const _slPricePct = Number(_sl.priceStopPercent);
    this._stopLossTimeSec = Number.isFinite(_slTimeMin) && _slTimeMin > 0 ? _slTimeMin * 60 : null;
    this._stopLossPricePct = Number.isFinite(_slPricePct) && _slPricePct < 0 ? _slPricePct : null;
    const _slScanSec = Number(_sl.scanIntervalSec);
    this._stopLossScanMs = Number.isFinite(_slScanSec) && _slScanSec > 0 ? _slScanSec * 1000 : null;
    this._stopLossEnabled = !!(this._stopLossTimeSec || this._stopLossPricePct);
    if (this._stopLossEnabled) {
      this.logger.info(this._experimentId, 'FourMemeWssTradingEngine',
        `🛡️ 止损双腿已启用 | ${this._stopLossTimeSec != null ? `时间止损: 持有>${Math.round(this._stopLossTimeSec / 60)}min仍浮亏或持平全清 ` : ''}` +
        `${this._stopLossPricePct != null ? `价格止损: 现价≤成本${this._stopLossPricePct}%全清 ` : ''}` +
        `| 持仓扫描=${this._stopLossScanMs != null ? this._stopLossScanMs / 1000 + 's' : '未配置（仅 tick 路径）'}（断流兜底）`);
    }

    // 6.5b 持仓卖腿兜底扫描（2026-10-13 用户裁定「所有卖出归卖出策略管」的断流侧
    //   配套）：引擎级 stopLoss 迁移为卖腿后，删 stopLoss 段的实验若不补此路径，
    //   断流票（无 tick → tick 驱动卖腿冻结）的止损臂永远不评估。启用 = 存在卖腿
    //   或 引擎级止损启用；周期 = stopLoss.scanIntervalSec ?? sellScanIntervalSec
    //   ?? 30s 缺省。stopLoss 段启用但未配 scanIntervalSec 的存量实验：引擎级止损
    //   仍仅 tick 路径（存量语义不变），卖腿评估按缺省周期起（新机制只做加法）
    const _sellLegs = this._strategyEngine ? this._strategyEngine.getAllStrategies().filter(s => s.action === 'sell') : [];
    this._sellLegScanEnabled = _sellLegs.length > 0;
    const _sellScanSec = Number(experimentConfig.sellScanIntervalSec);
    this._holdingsScanMs = this._stopLossScanMs != null ? this._stopLossScanMs
      : (Number.isFinite(_sellScanSec) && _sellScanSec > 0 ? _sellScanSec * 1000 : 30000);
    // 断流判据：60s 无 tick 视为冻结（BSC 0.75s 出块，健康票秒级 tick；活跃票每
    // tick 已实时评估卖腿，扫描重复评估徒增噪音且与 tick 路径竞态）
    this._sellLegStallMs = 60 * 1000;
    if (this._sellLegScanEnabled) {
      this.logger.info(this._experimentId, 'FourMemeWssTradingEngine',
        `🛡️ 持仓卖腿兜底扫描已启用 | 周期=${this._holdingsScanMs / 1000}s 断流判据=${this._sellLegStallMs / 1000}s无tick` +
        `${this._stopLossEnabled ? '' : '（stopLoss 段未配置，引擎级止损关闭）'}`);
    }

    // 7. live 执行层（FourMemeDirectTrader + 钱包），必须在重启恢复之前就绪
    if (this._isLive) {
      await this._initializeLiveTrader();
    }

    // 8. 重启恢复：重放 trades 重建 PortfolioManager 持仓 + 记录 FA 锚点
    //    live：以链上余额为准对账（cash=链上 BNB 等值，持仓数量=balanceOf）
    await (this._isLive ? this._loadHoldingsLive() : this._loadHoldings());
  }

  /** WSS 配置节名（子类覆盖：flap 引擎用 'flapWs'；双平台 'both' 走基类 fourmemeWs 段——
   *  引擎级单值参数（debounce 等）不按平台合并；collector 侧配置在 _createCollectors
   *  内 per-platform 分段读各自 section（fourmeme→fourmemeWs / flap→flapWs）） */
  _wsConfigSectionName() {
    return 'fourmemeWs';
  }

  /**
   * 消费平台集合（内嵌 collector 构造维度 + router 平台分门）。
   * 基类按 experiment.config.platform 归一化（'both' → 双平台；flap 子类覆盖为 ['flap']）。
   * 构造期 _experiment 未注入时返回 ['fourmeme']，与旧行为一致；collectors 在
   * _initializeDataSources 中构造，彼时 _experiment 已由 AbstractTradingEngine.initialize 注入。
   */
  _wsPlatforms() {
    const { resolvePlatforms } = require('../core/platforms');
    return resolvePlatforms(this._experiment?.config?.platform);
  }

  /** 基础 fourmemeWs 配置 + 实验级覆盖（浅合并） */
  _mergedWsConfig() {
    const section = this._wsConfigSectionName();
    return {
      ...(baseConfig[section] || {}),
      ...(this._experiment?.config?.[section] || {}),
    };
  }

  /**
   * 内嵌 WSS collectors 构造（直连架构 2026-10-09，watcher 废除）：per _wsPlatforms()
   * 一枚（both = 双 collector，watcher 单进程双 collector 同型已验证数周），共享一个
   * SenderResolver 与 WssEventWriter。FA/tokenPool 传引擎实例（tick 三路输出在 collector
   * `_emitTick`：pool.updatePrice / tickBuffer 批量落库 / FA.processTick）。
   *
   * ★ 08-27 防线：绝不调 collector.setExperimentId——tick 行 experiment_id 恒 NULL，
   *   删实验级联永不带走 wss_price_ticks 行（用户裁定 2026-10-09 维持）。
   * 实验级 collector 配置覆盖恢复生效（watcher 时代失效）：per-platform section 浅合并。
   */
  _createCollectors() {
    const { SenderResolver } = require('../../collectors/sender-resolver.js');
    const { WssEventWriter } = require('../../collectors/wss-event-writer.js');

    // 共享 sender 解析器（单实例传各 collector：同钱包跨平台交易，kind 缓存利用率更高）。
    // 段缺失/enabled≠true → 不构造，collector 收 null 走直推路径（sender=NULL 回退 trader）
    const senderCfg = baseConfig.senderResolve;
    if (senderCfg && senderCfg.enabled === true) {
      this._senderResolver = new SenderResolver(senderCfg, this.logger);
      this.logger.info(this._experimentId, 'FourMemeWssTradingEngine',
        'sender 解析已启用（真实买家 tx.from；公共路由行 sender≠trader）');
    }

    // wss_events 写入器（token_create/graduation/token_quote_set 持续供行 + 重试队列；
    // heartbeat 不写——watcher 专属人工查活，直连架构判据回到 collector 消息心跳）
    this._eventWriter = new WssEventWriter(this.logger);
    this._eventWriter.start();

    // WSS 快速回执信号（2026-10-15 提速①，뮤오23 案 8.2s 回执纯工程延迟）：自家
    // collector 在 tx 上链后 ~0.3s 即见成交 tick，比 ethers v6 4s 轮询+ANKR receipt
    // 索引快一个量级。仅 live 构造；virtual/backtest 恒 null=零变化
    this._txSeenSignal = (this._isLive && this._liveTxReceiptViaWss)
      ? new TxSeenSignal()
      : null;
    if (this._txSeenSignal) {
      this.logger.info(this._experimentId, 'FourMemeWssTradingEngine',
        '⚡ WSS 快速回执已启用（collector tick→_awaitReceipt race）');
    }

    const PLATFORMS = {
      fourmeme: {
        section: 'fourmemeWs',
        Ctor: require('../../collectors/fourmeme-ankr-ws-collector.js').FourMemeAnkrWsCollector,
      },
      flap: {
        section: 'flapWs',
        Ctor: require('../../collectors/flap-ankr-ws-collector.js').FlapAnkrWsCollector,
      },
    };

    for (const platform of this._wsPlatforms()) {
      const p = PLATFORMS[platform];
      // collector 段配置：base 段浅合并实验级（flap collector 读 flapWs、fourmeme 读 fourmemeWs，
      // 与引擎级 _mergedWsConfig 的单 section 无关——both 实验两段各自合并）
      const sectionCfg = {
        ...(baseConfig[p.section] || {}),
        ...(this._experiment?.config?.[p.section] || {}),
      };
      const collector = new p.Ctor(
        { [p.section]: sectionCfg },
        this.logger,
        this._tokenPool,
        this._factorAggregator,
        {
          // 事件双投：wss_events 持久化（叙事年龄锚/回测 totalSupply/flap quote 水位供数源）
          // + 引擎既有句柄（experiment_tokens 落库/毕业卖出）。collector 已先做
          // FA.registerToken + pool.addToken（meta 自带 platform 键）
          onTokenCreate: (info) => {
            this._eventWriter.enqueue('token_create', platform, info);
            this._handleNewToken(info, platform);
          },
          onGraduation: (info) => {
            this._eventWriter.enqueue('graduation', platform, info);
            this._handleGraduation(info);
          },
          // flap 专属：QuoteSet 持久化（重启用——_loadQuoteMapFromDb 水位驱动增量补停机缺口）
          onQuoteSet: platform === 'flap'
            ? (info) => this._eventWriter.enqueue('token_quote_set', 'flap', info)
            : null,
        },
        this._senderResolver,
      );
      // ★不调 setExperimentId（08-27 防线，见方法头注）
      // TPA live 缓冲钩子（pumpfun 同款）：tick 行 push 后同步喂（sender 已定值）；TPA 未启用不挂
      if (this._tokenPositionAnalyzer) {
        collector._onTickBuffered = (tickRow) => this._tokenPositionAnalyzer.ingestLiveTick(tickRow);
      }
      // WSS 快速回执（提速①）：tick 到达即通知（collector 侧恒发，引擎无信号器时
      // no-op；与 _onTickBuffered 独立属性共存）
      collector._onTickEmitted = (txHash) => {
        if (this._txSeenSignal) this._txSeenSignal.notify(txHash);
      };
      // tickBuffer 高水位转发（批次 3a）：collector 侧已打 error 日志+stats 峰值/计数，
      // 这里只在 live Telegram 通知器可用时补值班通道（virtual/backtest 恒 null=零变化）；
      // fire-and-forget，推送失败不打日志（collector error 日志已是主告警）
      collector._onTickBufferHighWatermark = (len) => {
        if (!this._telegramNotifier) return;
        Promise.resolve(this._telegramNotifier.sendMessage(
          `⚠️ [${this._experimentId}] TickBuffer高水位\n${platform} collector buffer=${len}——落库速度跟不上，绝不丢行`
        )).catch(() => {});
      };
      collector._platformLabel = platform; // 日志/getStats 标签
      this._collectors.push(collector);
    }
  }

  // ==================== live 执行层（Phase 5：FourMemeDirectTrader / FlapPortalTrader）====================

  /** live trader 类型（TraderFactory 注册名）；flap 子类覆盖为 'flap' */
  _liveTraderType() {
    return 'fourmeme';
  }

  /** per-platform live trader 类型分派（双平台 live 2026-10-14）：flap 平台恒
   *  FlapPortalTrader（'flap'，与子类覆盖无关）；其余走 _liveTraderType()（基类
   *  'fourmeme'；flap 子类恒单平台不会走到本分支） */
  _liveTraderTypeFor(platform) {
    if (platform === 'flap') return 'flap';
    return this._liveTraderType();
  }

  /** token → live trader 分派（双平台核心路由）：单 trader 直返（单平台实验零行为
   *  变化）；双平台按 token 所属平台查 map——平台未知 fail-closed throw，真实资金
   *  绝不能把 fourmeme token 发给 flap Portal swap（或反之，协议/地址空间完全不同） */
  _liveTraderFor(tokenAddress) {
    if (!this._liveTraderMap) return this._trader;
    if (this._liveTraderMap.size === 1) return this._trader;
    const platform = this._platformForToken(tokenAddress);
    const trader = platform ? this._liveTraderMap.get(platform) : null;
    if (!trader) {
      throw new Error(`live trader 分派失败: ${tokenAddress} platform=${platform}（token 池/FA 均无平台标记，拒绝跨协议盲发）`);
    }
    return trader;
  }

  /** token 平台归属：token 池 record.platform（_buildFourMemeTokenRecord/
   *  _buildFlapTokenRecord 写入）优先，FA state.platform（collector registerToken
   *  meta，write-once）兜底；均无 → null */
  _platformForToken(tokenAddress) {
    const record = this._tokenPool?.getToken(tokenAddress, 'bsc');
    if (record?.platform) return record.platform;
    return this._factorAggregator.getTokenState(tokenAddress)?.platform || null;
  }

  /**
   * live 交易器初始化：钱包配置解析（executorId 表加载 | privateKey 直配，二选一）→
   * 私钥解密 → per-platform trader map（fourmeme→FourMemeDirectTrader / flap→
   * FlapPortalTrader，双平台 live 2026-10-14 改造：单引擎双 trader 同一钱包，nonce 由
   * 共享 NonceManager 串行分配）→ 地址一致性校验（私钥推导地址 ≠ 配置地址 =
   * 配置错误，fail-fast）→ 链上连通性探测 + BNB/USD 启动锚定。
   *
   * 钱包双源（实盘前置批 2026-10-13，迁移自 rich-js）：
   *   - executorId：executors 表集中管理（auth_token 密文解密，私钥单一真相源在表），
   *     executor 的 reserve_native 覆盖 config 默认（钱包自带 gas 保留值）
   *   - privateKey：存量实验直配（config.wallet 私钥密文），路径零改动
   *   - 两源并存 → throw（防歧义）；皆无 → 现行报错
   */
  async _initializeLiveTrader() {
    const walletConfig = this._experiment?.config?.wallet;
    if (!walletConfig) {
      throw new Error('live 实验缺少钱包配置 (config.wallet)');
    }
    if (walletConfig.executorId && walletConfig.privateKey) {
      throw new Error('config.wallet.executorId 与 privateKey 互斥（钱包双源只能选一）');
    }

    const { CryptoUtils } = require('../../utils/CryptoUtils');
    let privateKey;
    if (walletConfig.executorId) {
      // 执行器表加载（service key——executors 表 RLS 对 anon 全拒，红线③）
      const { dbManager } = require('../../services/dbManager');
      const { data: executor, error } = await dbManager.getClient()
        .from('executors')
        .select('name, address, auth_token, blockchain, reserve_native')
        .eq('id', walletConfig.executorId)
        .single();
      if (error || !executor) {
        throw new Error(`执行器加载失败: ${walletConfig.executorId} ${error?.message || '不存在'}`);
      }
      if (executor.blockchain !== 'bsc') {
        throw new Error(`执行器区块链不符: ${executor.blockchain}（BSC-only）`);
      }
      this._walletAddress = executor.address;
      this._walletSource = `executor:${executor.name}`;
      try {
        privateKey = new CryptoUtils().decrypt(executor.auth_token);
      } catch (err) {
        throw new Error(`执行器私钥解密失败（auth_token 可能损坏）: ${err.message}`);
      }
      // executor 的 reserve_native 覆盖 config 默认（钱包自带保留值；实验级 live.reserveNative
      // 显式配置仍最高优先——三级：实验 live 段 > executors 行 > base 默认）
      if (!(this._wsConfig.live || {}).hasOwnProperty('reserveNative')
          && executor.reserve_native != null && Number(executor.reserve_native) >= 0) {
        this._reserveNative = new Decimal(executor.reserve_native);
      }
    } else {
      if (!walletConfig.address || !walletConfig.privateKey) {
        throw new Error('live 实验缺少钱包配置 (config.wallet.address / config.wallet.privateKey 或 config.wallet.executorId)');
      }
      this._walletAddress = walletConfig.address;
      this._walletSource = 'config';
      try {
        privateKey = new CryptoUtils().decrypt(walletConfig.privateKey);
      } catch (error) {
        throw new Error(`钱包私钥解密失败: ${error.message}`);
      }
    }

    const traderFactory = require('../traders');
    const traderConfig = { blockchain: 'bsc', chain: 'bsc' };
    // 发单 RPC（B4）：ANKR_HTTP_RPC_URL 显式 > ANKR_API_KEY > 从 ANKR_WS_URL 末段提取
    // key 构造（wss://rpc.ankr.com/bsc/ws/<key> → https://rpc.ankr.com/bsc/<key>，与
    // WSS 同源账号付费连接，免公共节点限流）；皆无则 BaseTrader 内置公共节点
    const ankrHttpRpc = process.env.ANKR_HTTP_RPC_URL
      || (process.env.ANKR_API_KEY && `https://rpc.ankr.com/bsc/${process.env.ANKR_API_KEY}`)
      || (() => {
        const wsUrl = process.env.ANKR_WS_URL || '';
        const m = wsUrl.match(/^wss:\/\/rpc\.ankr\.com\/bsc\/ws\/([0-9a-f]+)\/?$/);
        return m ? `https://rpc.ankr.com/bsc/${m[1]}` : null;
      })();
    if (ankrHttpRpc) {
      traderConfig.network = { rpcUrl: ankrHttpRpc };
      this.logger.info(this._experimentId, 'FourMemeWssTradingEngine', `发单 RPC: ANKR HTTP（与 WSS 同源账号）`);
    } else {
      this.logger.warn(this._experimentId, 'FourMemeWssTradingEngine', '发单 RPC: 公共节点（未配置 ANKR_HTTP_RPC_URL/ANKR_API_KEY/ANKR_WS_URL，有限流风险）');
    }
    // B4 gas 策略透传（'pinned'=恒上限价旧行为回滚开关）
    const liveGasStrategy = (this._wsConfig.live || {}).gasStrategy;
    if (liveGasStrategy) traderConfig.gasStrategy = liveGasStrategy;
    // per-platform trader 构造（2026-10-14 双平台 live）：每平台一枚（fourmeme/flap
    // 各自合约交互协议不同），同一私钥；首个 trader 建钱包，其余 setWallet 各自跑通
    // 校验路径后 shareSignerFrom 共享 wallet+NonceManager——同地址进程内单一 nonce
    // 分配源，双 trader 并发发单不互抢 nonce。this._trader=首个（平台无关读点兼容）
    this._liveTraderMap = new Map();
    for (const platform of this._wsPlatforms()) {
      const trader = traderFactory.createTrader(this._liveTraderTypeFor(platform), traderConfig);
      trader.txWaitTimeoutMs = this._liveTxWaitTimeoutMs;
      trader.txSeenSignal = this._txSeenSignal;   // WSS 快速回执（提速①）；null=纯原路径
      trader.setLogger(this.logger, this._experimentId); // trader 行进实验日志文件（2026-10-16 蓝蛙案：裸 console 落 stdout 重定向文件，现场与引擎行割裂）
      await trader.setWallet(privateKey);
      if (this._liveTraderMap.size > 0) {
        await trader.shareSignerFrom(this._trader);
      } else {
        this._trader = trader;
      }
      this._liveTraderMap.set(platform, trader);
    }

    const derivedAddress = this._trader.wallet?.address;
    if (!derivedAddress || derivedAddress.toLowerCase() !== this._walletAddress.toLowerCase()) {
      throw new Error(
        `钱包地址不一致: 私钥推导 ${derivedAddress} ≠ 配置 ${this._walletAddress}` +
        `${this._walletSource.startsWith('executor') ? '（执行器表数据损坏，检查 executors 行）' : '（检查 config.wallet）'}`);
    }

    // 连通性探测 + 启动时 BNB/USD 锚定（collector 尚未启动，getBnbUsd 为 0）
    const nativeBalance = await this._trader.getNativeBalance();
    await this._fetchBnbUsdOnce();

    this.logger.info(this._experimentId, 'FourMemeWssTradingEngine',
      `✅ live 交易器就绪 | 钱包 ${this._walletAddress} 链上 ${nativeBalance} BNB（reserve ${this._reserveNative}）` +
      ` BNB/USD≈${this._lastKnownBnbUsd} 滑点 ${this._liveSlippagePct}% gas≤${this._liveMaxGasPriceGwei}gwei`);
  }

  /** live 紧急告警（Telegram；未启用通知时仅 error 日志——告警通道尽最大努力不阻断交易流） */
  async _notifyLiveAlert(title, message) {
    this.logger.error(this._experimentId, 'LiveAlert', `${title} | ${message}`);
    try {
      if (this._telegramNotifier) {
        await this._telegramNotifier.sendMessage(`⚠️ [${this._experimentId}] ${title}\n${message}`);
      }
    } catch (error) {
      this.logger.warn(this._experimentId, 'LiveAlert', `Telegram 推送失败: ${error.message}`);
    }
  }

  /** BNB/USD 直读一次（PancakeSwap V2 Router getAmountsOut；live 启动锚定 + 60s interval 接力刷新） */
  async _fetchBnbUsdOnce() {
    try {
      const { ethers } = require('ethers');
      const router = new ethers.Contract(
        '0x10ED43C718714eb63d5aA57B78B54704E256024E',
        ['function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)'],
        this._trader.provider,
      );
      const amounts = await router.getAmountsOut(ethers.parseEther('1'), [
        '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
        '0x55d398326f99059fF775485246999027B3197955', // USDT (BSC)
      ]);
      const rate = Number(ethers.formatUnits(amounts[1], 18));
      if (rate > 0) this._lastKnownBnbUsd = rate;
    } catch (error) {
      this.logger.warn(this._experimentId, 'FourMemeWssTradingEngine',
        `BNB/USD 直读失败（沿用缓存 ${this._lastKnownBnbUsd}）: ${error.message}`);
    }
  }

  /**
   * 当前 BNB/USD（collector 60s 自刷优先——price_usd 换算与 live 锚定同源；
   * live 启动锚定 _fetchBnbUsdOnce 兜底，全部 miss 回落最近已知值）
   */
  _getBnbUsd() {
    for (const c of this._collectors) {
      const v = c.getBnbUsd();
      if (v > 0) {
        this._lastKnownBnbUsd = v;
        return v;
      }
    }
    return this._lastKnownBnbUsd;
  }

  /** 链上 ERC20 余额（代币数量；查询失败返回 null） */
  async _getOnChainTokenBalance(tokenAddress) {
    try {
      const { ethers } = require('ethers');
      const erc20 = new ethers.Contract(
        tokenAddress,
        ['function balanceOf(address) view returns (uint256)'],
        this._trader.provider,
      );
      const balance = await erc20.balanceOf(this._trader.wallet.address);
      return Number(ethers.formatUnits(balance, 18));
    } catch (error) {
      this.logger.warn(this._experimentId, 'FourMemeWssTradingEngine',
        `链上余额查询失败 | ${tokenAddress} ${error.message}`);
      return null;
    }
  }

  /**
   * live 现金对账：cashBalance 直设为链上可用 BNB 的 USD 等值。
   * 现金就是现金——gas/手续费/盈亏在链上余额里都已体现，直设即完成校正。
   */
  async _reconcileLiveCash() {
    const rate = this._getBnbUsd();
    const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);
    if (!portfolio || !(rate > 0)) return;

    const native = new Decimal(await this._trader.getNativeBalance());
    portfolio.cashBalance = Decimal.max(0, native.sub(this._reserveNative)).mul(rate);
  }

  /** live 记账（fee=0，真实成本已含在实际成交里）：cash 不足（对账 drift）时先对账再重试；仍失败不阻断链上事实 */
  async _liveRecordTrade(direction, signal, tokenAmount, priceUsd) {
    try {
      return await this._portfolioManager.executeTrade(
        this._portfolioId, signal.tokenAddress, direction, tokenAmount, priceUsd, 0);
    } catch (firstError) {
      // P11 幽灵持仓案（GROK 2026-10-15）：qtySold 链上 formatEther→parseEther 往返 …907 vs
      // 账面 Decimal …906（相对差 ~6e-17）被 PM 以 Insufficient token balance 拒绝——全清后账面
      // 永久挂账、SyncHoldings 每 5min 误报「外部处置」。卖出方向差值 ≤相对 1e-9 时钳到账面
      // 持有量（与执行层重放精度钳制同语义；真超卖照常失败）
      if (direction === 'sell' && /Insufficient token balance/.test(firstError.message || '')) {
        // 全 Decimal 比较：qtySold 是链上 formatEther 高精度值（…907 vs 账面 …906 差 1e-11），
        // double 会吞掉该差异（两字面量同 double），Number 化 held 后 Decimal>Number 比较经
        // valueOf→字符串→double 同样吞 → 钳制静默失效；new Decimal(tokenAmount) 与 PM 内
        // 同款转换，判断口径与 lt 恒一致
        const position = this._portfolioManager.getPortfolio(this._portfolioId)
          ?.positions?.get(String(signal.tokenAddress).toLowerCase());
        const heldDec = position ? new Decimal(position.amount) : new Decimal(0);
        const sellDec = new Decimal(tokenAmount);
        if (heldDec.gt(0) && sellDec.gt(heldDec) && sellDec.minus(heldDec).div(heldDec).lte(1e-9)) {
          this.logger.warn(this._experimentId, '_liveRecordTrade',
            `卖出记账数量 ${sellDec.toString()} 略超账面 ${heldDec.toString()}（相对差≤1e-9），钳到账面持有量重试`);
          tokenAmount = heldDec; // Decimal 原值：executeTrade 内 new Decimal(Decimal) 恒等清零
        }
      }
      this.logger.warn(this._experimentId, '_liveRecordTrade',
        `记账失败（${firstError.message}），对账修正 cash 后重试`);
      await this._reconcileLiveCash();
      try {
        return await this._portfolioManager.executeTrade(
          this._portfolioId, signal.tokenAddress, direction, tokenAmount, priceUsd, 0);
      } catch (secondError) {
        this.logger.error(this._experimentId, '_liveRecordTrade',
          `记账失败（链上已成交，持仓账目待 _syncHoldings 对账）: ${secondError.message}`);
        return null;
      }
    }
  }

  async _runMainLoop() {
    // 内嵌 collectors 启动（直连架构：WSS 订阅随实验起停；BNB/USD 60s 自刷由 collector 承担，
    // live 启动锚定在 _initializeLiveTrader 内 _fetchBnbUsdOnce 已做，此处不再挂 interval）
    for (const c of this._collectors) {
      c.start();
    }

    // 30s 组合快照（portfolio_snapshots；experiment_time_series_data 时序表 2026-10-15 停写）
    this._intervals.portfolioSnapshot = setInterval(() => {
      this._loopCount++;
      this._createPortfolioSnapshot().catch(err => {
        this.logger.error(this._experimentId, 'Portfolio', `组合快照失败: ${err.message}`);
      });
    }, this._portfolioSnapshotIntervalMs);

    // 定期统计（experiments.stats，间隔来自实验配置，默认 30min）
    this._intervals.stats = setInterval(() => {
      this._checkAndCalculateStats().catch(err => {
        this.logger.error(this._experimentId, 'Stats', `定期统计失败: ${err.message}`);
      });
    }, this._statsInterval || 30 * 60 * 1000);

    // [wss-down-guard] 断流守护（60s）：collector 消息心跳静默 ≥ 5min 踢自愈 / ≥ 15min 置 wss_down
    this._intervals.wssDownGuard = setInterval(() => {
      this._checkWssDownGuard().catch(err => {
        this.logger.error(this._experimentId, 'WssDownGuard', `检查失败: ${err.message}`);
      });
    }, 60 * 1000);

    // FA 陈旧状态清理（持仓保护）+ TPA live ticks 缓冲裁剪（批次 3b，默认关）
    this._intervals.prune = setInterval(() => {
      try {
        const held = new Set(this._getAllHoldings().map(h => h.tokenAddress?.toLowerCase()));
        const pruned = this._factorAggregator.pruneStaleTokens(this._pruneMaxAgeMs, held);
        if (pruned > 0) {
          this.logger.info(this._experimentId, 'Prune', `FA 清理陈旧代币状态: ${pruned} 个`);
        }
      } catch (err) {
        this.logger.error(this._experimentId, 'Prune', `FA 清理失败: ${err.message}`);
      }
      // TPA live ticks 窗口裁剪（liveTicksRetainHours 缺省 null=no-op；回测引擎无本 interval）
      if (this._tokenPositionAnalyzer) {
        try {
          this._tokenPositionAnalyzer.trimLiveTicksBuffer();
        } catch (err) {
          this.logger.error(this._experimentId, 'Prune', `TPA live ticks 裁剪失败: ${err.message}`);
        }
      }
      // TokenPool 监控票淘汰（tokenPoolEvictMinAgeMs 缺省 null=no-op）
      try {
        this._evictStaleMonitoringTokens();
      } catch (err) {
        this.logger.error(this._experimentId, 'Prune', `监控票淘汰失败: ${err.message}`);
      }
    }, this._pruneIntervalMs);

    // 市场截面快照落表（60s，纯观察通道；写失败仅计数不重试不阻塞——显式设计非吞错兜底；
    // ts=分钟桶键 → PK 幂等 upsert ≈1440 行/天，source=实验 id）
    this._intervals.marketRegime = setInterval(() => {
      this._captureMarketRegimeSnapshot().catch(err => {
        this.logger.error(this._experimentId, 'MarketRegime', `快照采集异常: ${err.message}`);
      });
    }, 60 * 1000);

    // live 持仓对账（链上余额 vs 账面，外部处置/偏差告警）
    if (this._isLive) {
      this._intervals.liveSync = setInterval(() => {
        this._syncHoldings().catch(err => {
          this.logger.error(this._experimentId, 'LiveSync', `live 持仓对账失败: ${err.message}`);
        });
      }, this._liveHoldingsSyncMs);

      // 手工交易命令消费（P0-C，5s）：manual_trade_requests 命令队列——web 进程绝不
      // 直接建 trader 交易（会与本引擎内存账本冲突），命令由本进程 CAS 抢占后走与
      // 策略交易同一执行路径；停机期命令滞留 pending（不执行不丢）
      this._intervals.manualTrade = setInterval(() => {
        this._consumeManualTrades().catch(err => {
          this.logger.error(this._experimentId, 'ManualTrade', `手工交易消费异常: ${err.message}`);
        });
      }, 5000);
    }

    // 持仓兜底扫描（断流兜底）：断流 token 无 tick → tick 驱动的止损/卖腿全部冻结，
    // 扫描周期性重建因子判引擎级止损 + 评估卖腿（2026-10-13 裁定：卖腿存在即启用
    // 扫描，引擎级止损部分维持 stopLoss 段配置语义——配 scanIntervalSec 才扫）
    if ((this._stopLossEnabled && this._stopLossScanMs != null) || this._sellLegScanEnabled) {
      const _scanMs = this._stopLossScanMs != null ? this._stopLossScanMs : this._holdingsScanMs;
      this._intervals.stopLossScan = setInterval(() => {
        this._scanHoldingsStopLoss().catch(err => {
          this.logger.error(this._experimentId, 'StopLoss', `持仓兜底扫描异常: ${err.message}`);
        });
      }, _scanMs);
    }

    // 账号信息复检（C166）：周期=fast 档间隔（slow 档靠 per-token 节流跳过）；只查
    // 有宣告账号的持仓票，fire-and-forget 回填 FA（stopLossScan 同款 interval 组织）
    if (this._accountHealthEnabled && this._accountHealthMonitor) {
      this._intervals.accountHealth = setInterval(() => {
        this._accountHealthScan().catch(err => {
          this.logger.error(this._experimentId, 'AccountHealth', `账号复检扫描异常: ${err.message}`);
        });
      }, Math.min(this._accountHealthFastMs, 30 * 1000));
    }

    // 不阻塞：main.js 在 start() 返回后注册优雅退出；WSS 连接 + intervals 保活事件循环
    this.logger.info(this._experimentId, 'FourMemeWssTradingEngine',
      `🚀 事件循环已启动（debounce=${this._signalDebounceMs}ms maxWait=${this._signalDebounceMaxWaitMs}ms ` +
      `卖确认=${this._sellDebounceMs}ms/${this._sellDebounceMinTicks}tick/上限${this._sellDebounceMaxWaitMs / 1000}s ` +
      `组合快照=${this._portfolioSnapshotIntervalMs / 1000}s 断流阈值=${this._wssDownThresholdMs / 60000}min），等待 WSS 事件...`);
  }

  /**
   * 市场截面快照落表（60s 计时器；纯观察通道，失败仅计数不重试不阻塞）。
   * ts=分钟桶键（ISO）→ 表 PK 幂等：计时器抖动/重启同分钟覆写不产生重复行。
   */
  async _captureMarketRegimeSnapshot() {
    const snap = this._factorAggregator.computeMarketSnapshot(Date.now());
    if (!snap) return; // 未 feed（引擎构造即 opt-in，理论不可达；防御 null 不写空行）
    const { dbManager } = require('../../services/dbManager');
    const row = {
      ts: new Date(snap.minuteKey * 60000).toISOString(),
      newborn_count_1h: snap.newborn1h,
      rocket_rate_30m: snap.rocketRate,
      young_mean_ret_30m: snap.youngMeanRetPct,
      death_rate_30m: snap.deathRate,
      flow_bs_ratio_10m: snap.flowBsRatio,
      cohort_n: snap.cohortN,
      flow_buy_bnb: snap.flowBuyBnb,
      flow_sell_bnb: snap.flowSellBnb,
      fed_age_ms: snap.fedAgeMs,
      source: this._experimentId,
    };
    try {
      await dbManager.getClient().from('market_regime_snapshots').upsert(row);
    } catch (err) {
      this._marketRegimeWriteFails++;
      this.logger.error(this._experimentId, 'MarketRegime',
        `快照落表失败（累计 ${this._marketRegimeWriteFails}）: ${err.message}`);
    }
  }

  /**
   * virtual：持仓由 PortfolioManager 内部维护（_loadHoldings 重放 + executeTrade 记账）。
   * live：链上对账——持仓数量逐个 balanceOf（链上 0 = 外部处置，告警；数量偏差告警），
   * 现金只记对账日志（cash 修正已由 _liveRecordTrade 的对账重试兜底）。
   */
  async _syncHoldings() {
    if (!this._isLive || !this._trader) return;

    const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);
    if (!portfolio) return;

    for (const [tokenAddress, position] of portfolio.positions) {
      if (!(position.amount > 0)) continue;
      const onChainQty = await this._getOnChainTokenBalance(tokenAddress);
      if (onChainQty === null) continue;
      if (onChainQty <= 0) {
        this.logger.warn(this._experimentId, 'SyncHoldings',
          `⚠️ 链上余额为 0（可能已外部处置），账面 ${position.amount}——卖出触发将失败 | ${tokenAddress}`);
      } else if (Math.abs(onChainQty - Number(position.amount)) / Number(position.amount) > 0.01) {
        this.logger.warn(this._experimentId, 'SyncHoldings',
          `⚠️ 持仓偏差>1%：链上 ${onChainQty} vs 账面 ${position.amount} | ${tokenAddress}`);
      }
    }

    const rate = this._getBnbUsd();
    if (rate > 0) {
      const native = new Decimal(await this._trader.getNativeBalance());
      this.logger.info(this._experimentId, 'SyncHoldings',
        `对账 | 链上 ${native.toFixed(4)} BNB ≈ ${native.mul(rate).toFixed(2)} USD vs cash ${portfolio.cashBalance.toFixed(2)}` +
        `（持仓 ${portfolio.positions.size} 个）`);
    }
  }

  async stop() {
    if (this._isStopped) {
      return;
    }

    // 清守护 intervals
    for (const key of Object.keys(this._intervals)) {
      clearInterval(this._intervals[key]);
    }
    this._intervals = {};

    // 清 debounce 定时器（fire 回调内自清，此处处理未 fire 的）
    if (this._buyDebouncer) {
      this._buyDebouncer.clearAll();
    }
    if (this._sellConfirmDebouncer) {
      this._sellConfirmDebouncer.clearAll();
    }

    // 停采集链（顺序镜像 watcher.stop，各自独立 try/catch 不互相阻断）：
    // ① eventWriter 冲刷（create 行丢失 = token 对所有消费方永久不可见）
    // ② senderResolver（NULL 回推必须进 tickBuffer 有人收）
    // ③ collectors 逐个 stop（flush tickBuffer 落库 + 关 WSS）
    if (this._eventWriter) {
      try {
        await this._eventWriter.stop();
      } catch (e) {
        this.logger.error(this._experimentId, 'FourMemeWssTradingEngine', `eventWriter 停止失败: ${e.message}`);
      }
    }
    if (this._senderResolver) {
      try {
        await this._senderResolver.stop();
      } catch (e) {
        this.logger.error(this._experimentId, 'FourMemeWssTradingEngine', `senderResolver 停止失败: ${e.message}`);
      }
    }
    for (const c of this._collectors) {
      try {
        await c.stop();
      } catch (e) {
        this.logger.error(this._experimentId, 'FourMemeWssTradingEngine', `collector(${c._platformLabel}) 停止失败: ${e.message}`);
      }
    }
    this._collectors = [];

    // 市场截面 feed 关闭 + 模块级单例清除（main.js 同进程起下一实验不继承旧截面）
    require('../../services/FourMemeFactorAggregator').setMarketFeedEnabled(false);

    // 在线代币分类器清理（扫描 interval + 已分类集合；回迁批 3.1）
    if (this._onlineProfileBuilder) {
      this._onlineProfileBuilder.destroy();
    }

    // TPA 清理（回迁批 4：verdict/画像缓存释放 + enabled=false 防停后续触发）
    if (this._tokenPositionAnalyzer) {
      this._tokenPositionAnalyzer.destroy();
    }

    // C84 叙事触发态清理（2026-10-17）：状态机 Map 清空 + FA narrative 静态投影逐
    // token 清除——main.js 同进程接续起下一实验时不读到旧实验评级。进行中的后台
    // 分析无需等：完成回填带 identity 校验（states.get !== st 即跳过投影，见
    // _narrativeTriggerLaunch），轮次行落库归属本实验无害
    if (this._narrativeTriggerStates) {
      for (const addr of this._narrativeTriggerStates.keys()) {
        require('../../services/FourMemeFactorAggregator').clearNarrativeFactors(addr);
      }
      this._narrativeTriggerStates.clear();
    }

    // gwp 钱包画像层清态（2026-10-18）：预取状态 Map 清空防同进程下一实验读到旧
    // leadMs/节流锚；service 是实例级（ctor 重建），无需单独销毁——进行中的后台
    // 拉取写表是全局资产（写行无害）
    if (this._walletProfileStates) this._walletProfileStates.clear();

    // C166 账号复检清态：per-token FA 注入逐个清（narrative 同款）+ 复检态 Map 清空
    // + monitor 实例释放（进行中的检测回填写的是实例外 FA Map——先清后写=新实验
    // 首轮扫描重接线，残留窗 ≤ 一轮；getAccountHealthFactors 不进任何跨进程路径）
    if (this._accountRecheckStates) {
      for (const addr of this._accountRecheckStates.keys()) {
        require('../../services/FourMemeFactorAggregator').clearAccountHealthFactors(addr);
      }
      this._accountRecheckStates.clear();
    }
    if (this._accountHealthMonitor) this._accountHealthMonitor.destroy();

    await super.stop();

    this.logger.info(this._experimentId, 'FourMemeWssTradingEngine',
      `🛑 WSS 事件驱动引擎已停止: 实验 ${this._experimentId}`, { metrics: this.metrics });
  }

  // ==================== 事件入口 ====================

  /**
   * FA 'factorsUpdated' 回调：单一咽喉点分买卖两腿。
   * 卖腿 fire-and-forget（同步事件内不 await）；买腿走去抖调度。
   */
  _onFactorsUpdated({ tokenAddress, factors, tick, tokenState }) {
    this.metrics.lastFactorsUpdatedAt = Date.now();
    this.metrics.factorsUpdatedCount++;

    // 在线代币分类触发检查（回迁批 3.1：state 驱动、全 token 覆盖，先于 pool 门——
    // 分类是画像层观察与交易两腿无关；池外 token 由 OPB 60s 扫描入口兜底）
    this._onlineProfileBuilder.checkAndEnqueue(tokenAddress, tokenState, tick.timestamp);

    // TPA 触发检查（回迁批 4 shadow：write-once 五门；fire-and-forget——返回 promise 已含
    // .catch 兜底，live 不等 verdict，holding 因子经 setHoldingFactors 回填后由后续
    // buildFactorMap 消费，晚到只影响首个读点。asOf=tick.timestamp（tick 含 block_number））
    if (this._tokenPositionAnalyzer) {
      this._tokenPositionAnalyzer.checkAndTrigger(tokenAddress, factors, tokenState, tick, tick.timestamp);
    }

    const token = this._tokenPool.getToken(tokenAddress, 'bsc');
    if (!token) return;

    // 重启恢复的持仓锚点：FA 首个可靠价到达时落锚（BNB 锚点以重启后首价近似）
    if (this._restoreAnchors.has(tokenAddress)) {
      const state = this._factorAggregator.getTokenState(tokenAddress);
      const anchor = this._restoreAnchors.get(tokenAddress);
      if (state && state.currentPriceBnb > 0) {
        this._factorAggregator.setBuyState(tokenAddress, {
          buyPriceBnb: state.currentPriceBnb,
          buyPriceUsd: anchor.buyPriceUsd,
          buyTime: anchor.buyTime,
        });
        this._restoreAnchors.delete(tokenAddress);
        this.logger.info(this._experimentId, 'FourMemeWssTradingEngine',
          `重启持仓锚点已落位 | ${token.symbol || tokenAddress} buyPriceUsd=${anchor.buyPriceUsd} ` +
          `buyPriceBnb≈${state.currentPriceBnb.toExponential(4)}（BNB 锚点为重启后首价近似）`);
      }
    }

    // 卖腿：持有中每 tick 实时评估（止损/止盈时间敏感，不去抖）
    if (token.status === 'bought' && !this._buyingTokens.has(tokenAddress)) {
      // 引擎级止损双腿（tick 即时路径）：命中优先于策略腿——保命腿不等策略评估
      const _slHit = this._stopLossHit(factors);
      if (_slHit) {
        this._emitStopLossSell(token, factors, _slHit, tick)
          .catch(e => this.logger.error(this._experimentId, 'StopLoss',
            `${token.symbol || tokenAddress.slice(0, 10)} 止损卖出异常: ${e.message}`));
        return;
      }
      this._evaluateSellPath(tokenAddress, factors, tick)
        .catch(e => this.logger.error(this._experimentId, 'SellEval',
          `${token.symbol || tokenAddress.slice(0, 10)} 卖腿评估异常: ${e.message}`));
      return;
    }

    // 买腿：未持有（单仓语义）→ 去抖买评估
    if (!this._buyingTokens.has(tokenAddress) && token.status !== 'bought') {
      // 叙事预触发（N3，2026-10-13 叙事提速案）：tick 时刻后台提前发起 fire 时会做的
      // 叙事直调（fire 前置 ~200-1000ms 去抖窗 + 条件先满足的 token 更早），见方法头注
      this._narrativePrefetchCheck(tokenAddress, factors, token);
      // C84 叙事发起条件触发状态机（新模型腿）：tick 后台多轮叙事分析 + FA 投影
      //（legacy 腿首行早退零成本；dataPrefetch 已退役，档案见台账 C84）
      this._narrativeTriggerCheck(tokenAddress, factors, token);
      // GMGN 钱包画像触发窗预取（默认关；miss 钱包后台拉取回写表，fire 查表毫秒级）
      this._walletProfilePrefetchCheck(tokenAddress, factors, token);
      this._scheduleDebouncedBuy(tokenAddress, tick);
    }
  }

  /**
   * 叙事预触发检查（N3，2026-10-13 叙事提速案）：买门 fire 前后台发起叙事直调。
   *
   * 机制：与 fire 直调共用同一 NarrativeDirectCaller 实例——预触发仍在跑时 fire 的
   * getRating join 同一 inflight promise（等待=剩余时间）；已完成时 analyze 命中
   * token_narrative 行缓存秒回。fire 侧直调代码零改动。
   *
   * 条件 = 首条买腿 narrativePrefetchCondition ?? narrativeCallCondition（新可选
   * 字段不配=用现有条件；配更宽松条件=更早发起，API 消耗与提前量的权衡由策略侧定；
   * 叙事直调 per-token 幂等缓存，多腿命中同 token 只析一次）；tick 时刻因子评估
   * （fire 评估是 buildFactorMap 重读快照——预触发用本 tick 因子，条件不满足不标
   * write-once，后续 tick 满足再发起）。
   *
   * write-once per-token 无论成败（失败由 fire 时直调兜底重试）；rating=low（终态）
   * 提前登记否决短路集 _narrativeBlockedTokens（address-fail 宣告竞态重试窗豁免
   * 与 fire 侧同款 shouldBlockOnNarrative 判定）——fire 到来直接短路不落 signal 行。
   *
   * 回测不适用（BacktestEngine 装载时 preloadCache 全量预载）；实验级开关
   * fourmemeWs.narrativePrefetch.enabled 默认 true（2026-10-17 用户裁定；删段=开、
   * 显式 false 才关；live/虚拟通用）。fire-and-forget + catch（OPB/TPA 同款先例），
   * 不阻塞 tick 管线。
   */
  _narrativePrefetchCheck(tokenAddress, factors, token) {
    if (!this._narrativePrefetchEnabled) return;
    if (this._narrativePrefetchedTokens.has(tokenAddress)) return;
    const cond = this._narrativePrefetchCondition();
    if (!cond) return;
    if (!this._strategyEngine.evaluateCondition(cond, factors)) return;
    this._narrativePrefetchedTokens.add(tokenAddress);
    this._narrativePrefetchStartedAt.set(tokenAddress, Date.now());
    const sym = token.symbol || tokenAddress.slice(0, 10);
    this.logger.info(this._experimentId, 'NarrativePrefetch', `${sym} 预触发发起（tick 先于买门 fire）`);
    // 预触发完成：rating=low 终态提前登记短路集（fire 侧 gate 仍按
    // narrativeCallCondition 启用——只配 prefetch 不配 call 的腿不短路，语义照实）
    this._narrativeCaller.getRating(tokenAddress)
      .then(r => {
        if (this._shouldBlockOnNarrative(r.numericRating, r.precheckStage ?? null, factors.age ?? null)) {
          this._narrativeBlockedTokens.add(tokenAddress);
          this.logger.info(this._experimentId, 'NarrativePrefetch',
            `${sym} 预触发否决登记 | rating=low${r.precheckStage ? `(${r.precheckStage})` : ''} → 后续买信号短路`);
        }
        this.logger.info(this._experimentId, 'NarrativePrefetch',
          `${sym} 预触发完成 | rating=${r.numericRating}(${r.rating}) ${r.durationMs}ms` +
          ` fromCache=${r.fromCache}` + (r.error ? ` error=${r.error}` : ''));
      })
      .catch(e => this.logger.warn(this._experimentId, 'NarrativePrefetch',
        `${sym} 预触发失败（fire 时直调兜底重试）: ${e.message}`));
  }

  /**
   * 预触发条件（惰性解析缓存）：首条带叙事条件的买腿，narrativePrefetchCondition
   * 优先、缺省回落 narrativeCallCondition。策略启动后不变（重启进程才换策略）
   * @private
   */
  _narrativePrefetchCondition() {
    if (this._narrativePrefetchCond !== undefined) return this._narrativePrefetchCond;
    this._narrativePrefetchCond = null;
    for (const s of this._strategyEngine.getAllStrategies()) {
      if (s.action !== 'buy') continue;
      const c = (typeof s.narrativePrefetchCondition === 'string' && s.narrativePrefetchCondition.trim() !== '')
        ? s.narrativePrefetchCondition.trim()
        : (typeof s.narrativeCallCondition === 'string' && s.narrativeCallCondition.trim() !== '')
          ? s.narrativeCallCondition.trim()
          : null;
      if (c) { this._narrativePrefetchCond = c; break; }
    }
    return this._narrativePrefetchCond;
  }

  /**
   * GMGN 钱包画像触发窗预取（2026-10-18，默认关 fourmemeWs.gmgnWalletStats.enabled）：
   * early 窗内（首批买家成形后）查 top-N miss 钱包后台拉取回写 gmgn_wallet_profiles 表
   * +进程内存——fire 时刻 GMGN 层查表毫秒级（架构=用户裁定离线建库优先）。
   *
   * 时机=tokenAgeSec ≥ prefetchMinAgeSec（默认 25s；此前 top-N 未成形无意义）且
   * FA early 窗未关闭（getEarlyTopBuyers 出窗返回 []=天然短路）。非 write-once：
   * top-N 随窗内买入漂移（触发后补买逃预取的规避形状），per-token 检查节流
   * 500ms + service 层 inflight/冷却/日预算去重——每 tick 真实 API 次数收敛于
   * 新进 top-N 的 miss 钱包数。只有配了 gmgnCheckCondition 的实验才预取
   * （没配 GMGN 条件的实验 fire 不消费 gwp 键，预取白烧配额）。
   * fire-and-forget + catch（N3/触发状态机同款先例），不阻塞 tick 管线。
   * @private
   */
  _walletProfilePrefetchCheck(tokenAddress, factors, token) {
    if (!this._walletStatsService) return;
    if (!this._gwpConditionLegExists()) return;
    const ageSec = factors.tokenAgeSec ?? (factors.age != null ? factors.age * 60 : null);
    const minAge = this._walletStatsService._c.prefetchMinAgeSec;
    if (ageSec == null || ageSec < minAge) return;
    let st = this._walletProfileStates.get(tokenAddress);
    const now = Date.now();
    if (!st) { st = { lastCheckAt: 0, firstPrefetchAt: null }; this._walletProfileStates.set(tokenAddress, st); }
    if (now - st.lastCheckAt < this._walletStatsService._c.prefetchIntervalMs) return;
    st.lastCheckAt = now;
    const topWallets = this._factorAggregator.getEarlyTopBuyers(tokenAddress, {
      limit: this._walletStatsService._c.topWallets,
      minBnb: this._walletStatsService._c.minBuyBnb,
    });
    if (topWallets.length === 0) return;
    if (st.firstPrefetchAt == null) st.firstPrefetchAt = now;
    const sym = token?.symbol || tokenAddress.slice(0, 10);
    this._walletStatsService.prefetchMiss(topWallets)
      .then(r => {
        if (r.fetched > 0) {
          this.logger.info(this._experimentId, 'GwpPrefetch',
            `${sym} 钱包画像预取 ${r.fetched}/${r.fetched + r.skipped}（lead 供 gwpLeadMs 观测）`);
        }
      })
      .catch(e => this.logger.warn(this._experimentId, 'GwpPrefetch',
        `${sym} 钱包画像预取失败（fire 补查兜底）: ${e.message}`));
  }

  /**
   * gwp 消费腿存在性（惰性缓存）：任一买腿携带 gmgnCheckCondition 才预取/构建 gwp 键
   * @private
   */
  _gwpConditionLegExists() {
    if (this._gwpCondLeg !== undefined) return this._gwpCondLeg;
    this._gwpCondLeg = this._strategyEngine.getAllStrategies().some(
      s => s.action === 'buy' && String(s.gmgnCheckCondition || '').trim() !== '');
    return this._gwpCondLeg;
  }

  /**
   * C84 叙事发起条件触发状态机（2026-10-17 买腿链路重构，台账 C84）
   *
   * 新模型腿（携带 narrativeTriggerCondition 的买腿）tick 时刻驱动：
   * - 发起条件（FA 因子表达式，如 `buyVolumeBnb >= 0.5 OR narrativeRetryDue == 1`）
   *   在 tick 因子表上评估，过门 → 发起后台叙事分析（NarrativeDirectCaller.getRating）
   * - 首轮 reason='condition'（常规调用，token 级缓存命中秒回）；此后仅补轮臂可再发：
   *   lastRating===1 ∧（accountOnly（账号型语料=动态，重取可翻案）∨ corpusEmpty
   *   （C162 零自有语料=宣告推/GMGN link 晚到竞态，60s×8 节奏独立键））∧
   *   rounds<maxAnalyses（按臂选参数）∧ 距末轮完成 ≥ intervalMs → reason='retry'
   *   （override ignoreCache+invalidateAccountCorpus 强制重取重析，getRating '!ttl'
   *   inflight 槽）。条件首臂（量门）持续为真不重复发起——hasInitial 后按状态机
   *   真值结构化把关，与 FA narrativeRetryDue 判据同参数源（FA config 由 ctor
   *   投影，双侧一致）
   * - 每轮发起/完成即 FA.setNarrativeFactors 投影（rating/rounds/completedAt/
   *   accountOnly/inFlight）→ 下一 tick buildFactorMap 注入 narrative 三键 →
   *   单一买条件（含 narrativeRating == 2 OR == 3）裁决；分析未完成/未通过/失败(9)
   *   = 条件恒 false = 不产生买信号（无 signal 行，用户需求第二点）
   *
   * 状态 per token：{rounds, inFlight, hasInitial, lastRating, lastCompletedAt,
   * accountOnly, currentRowId}——重启全内存语义（首 tick 重走 round 1，缓存命中
   * from_cache=true 留痕，_analysisCounts 同款先例；rounds 按进程计）。轮次行
   * narrative_analysis_rounds insert/update 各自 catch+warn（观测 fail-open 不中断
   * 交易链；交易门本身 fail-closed 在买条件里）。fire-and-forget + catch。
   * @private
   */
  _narrativeTriggerCheck(tokenAddress, factors, token) {
    // 激活门（ctor 恒建成员；极简桩/机制未初始化=未激活，_narrativePrefetchEnabled
    // 同款先例——真引擎不可能走到这里缺 Map，ctor 接线错误在首 tick 前已 fail-fast）
    if (!this._narrativeTriggerStates) return;
    const cond = this._narrativeTriggerCondition();
    if (!cond) return; // 无新模型腿（legacy）→ 整机零激活
    const st = this._narrativeTriggerStates.get(tokenAddress);
    if (st?.inFlight) return;
    if (!this._strategyEngine.evaluateCondition(cond, factors)) return;
    if (!st) {
      // 首轮：条件过门即发起（写入状态后交给 launch）
      this._narrativeTriggerLaunch(tokenAddress, {
        rounds: 0, inFlight: false, hasInitial: false, lastRating: null,
        lastCompletedAt: null, accountOnly: false, corpusEmpty: false, currentRowId: null,
        category: null, superIp: null, recognizedEntitySlogan: null,
      }, 'condition', token);
      return;
    }
    // 补轮资格（状态机真值二次把关——tick 因子表的 narrativeRetryDue 投影可能滞后
    // 一轮；判据与 FA retryDue 逐字一致，刻意的双侧冗余）。C162（2026-10-22 双 BINA
    // 案·正主 0xed71…7777）扩第二臂：corpusEmpty（零自有语料——抢跑发币票宣告推/
    // GMGN link 聚合典型晚到几分钟，rating=1 大概率语料竞态）与 accountOnly 同为
    // 「语料晚到可重评」形状；两臂互斥（accountOnly 要求 twitter 桶非空），节奏
    // 参数独立（corpusEmpty 臂用 noCorpus* 键：间隔更长轮次更多，覆盖分钟级晚到窗）
    if (!st.hasInitial) return;
    if (st.lastRating !== 1) return;
    const noCorpusArm = st.corpusEmpty === true && st.accountOnly !== true;
    if (st.accountOnly !== true && !noCorpusArm) return;
    const maxAnalyses = noCorpusArm ? this._narrativeTriggerNoCorpusMaxAnalyses : this._narrativeTriggerMaxAnalyses;
    const intervalMs = noCorpusArm ? this._narrativeTriggerNoCorpusIntervalMs : this._narrativeTriggerIntervalMs;
    if (st.rounds >= maxAnalyses) return;
    if (!Number.isFinite(st.lastCompletedAt)
        || Date.now() - st.lastCompletedAt < intervalMs) return;
    this._narrativeTriggerLaunch(tokenAddress, st, 'retry', token);
  }

  /**
   * 发起一轮叙事分析（状态推进 + FA 投影 + 轮次行留痕 + fire-and-forget 调用）。
   * @private
   */
  _narrativeTriggerLaunch(tokenAddress, st, reason, token) {
    // 入 Map（首轮由 _narrativeTriggerCheck 传新鲜对象进来——不 set 则每 tick 重复
    // 发起首轮 + 完成回填 identity 校验恒不中（states.get 恒 undefined），单测
    // _test_narrative_trigger_condition B1 反证锁定）
    this._narrativeTriggerStates.set(tokenAddress, st);
    const sym = token?.symbol || tokenAddress.slice(0, 10);
    const roundNo = st.rounds + 1;
    st.rounds = roundNo;
    st.inFlight = true;
    this._projectNarrativeFactors(tokenAddress, st);
    this.logger.info(this._experimentId, 'NarrativeTrigger',
      `${sym} 析起 R${roundNo}(${reason})`);
    // 轮次行 insert（观测 fail-open）：异步拿 id，完成点回填 update 用
    this._insertNarrativeRoundRow(tokenAddress, roundNo, reason, Date.now())
      .then(id => { st.currentRowId = id; })
      .catch(e => this.logger.warn(this._experimentId, 'NarrativeTrigger',
        `${sym} 轮次行插入失败（观测 fail-open）: ${e.message}`));
    const callOpts = reason === 'retry'
      ? { overrideOptions: { ignoreCache: true, invalidateAccountCorpus: true } } : {};
    this._narrativeCaller.getRating(tokenAddress, callOpts)
      .then(r => {
        // stop() 已清态（identity 校验）→ 只收尾不投影（防同进程下一实验读到旧投影）
        if (this._narrativeTriggerStates.get(tokenAddress) !== st) return;
        st.inFlight = false;
        st.hasInitial = true;
        st.lastRating = [1, 2, 3, 9].includes(r.numericRating) ? r.numericRating : null;
        st.lastCompletedAt = Date.now();
        st.accountOnly = r.accountOnly === true;
        // 零自有语料形状（C162）：补轮第二臂的回填——rating=1 ∧ corpusEmpty 的
        // 下一轮带 noCorpus 节奏重评（语料晚到翻案）；语料到位后的轮次自然
        // corpusEmpty=false 转入常规形状（翻正即止与其他臂一致）
        st.corpusEmpty = r.corpusEmpty === true;
        // 叙事类型回填（Nightshift 案 2026-10-17）：GMGN 条件层 narrativeCategory 的
        // 真值源——完成时刻取 analyzer 顶层透出值（catch 异常轮保持 null=门放行）
        st.category = r.narrativeCategory ?? null;
        // C88 超级IP两标签回填（2026-10-18 CZ 出书簇）：analyzer 零列推导三态
        // 1/0/null；catch 异常轮保持 null（fail-closed：==1 臂恒 false）
        st.superIp = r.narrativeSuperIp ?? null;
        st.recognizedEntitySlogan = r.narrativeSuperIpSlogan ?? null;
        this._projectNarrativeFactors(tokenAddress, st);
        this.logger.info(this._experimentId, 'NarrativeTrigger',
          `${sym} 析毕 R${roundNo}(${reason}) | rating=${r.numericRating}(${r.rating})` +
          ` ${r.durationMs}ms fromCache=${r.fromCache} accountOnly=${st.accountOnly}` +
          (r.error ? ` error=${r.error}` : ''));
        this._completeNarrativeRoundRow(st.currentRowId, r, st.lastCompletedAt)
          .catch(e => this.logger.warn(this._experimentId, 'NarrativeTrigger',
            `${sym} 轮次行完成更新失败（观测 fail-open）: ${e.message}`));
      })
      .catch(e => {
        // getRating 契约永不抛错，此处兜接线级异常——inFlight 必须复位防状态机卡死
        if (this._narrativeTriggerStates.get(tokenAddress) !== st) return;
        st.inFlight = false;
        st.hasInitial = true;
        st.lastRating = 9;
        st.lastCompletedAt = Date.now();
        this._projectNarrativeFactors(tokenAddress, st);
        this.logger.warn(this._experimentId, 'NarrativeTrigger',
          `${sym} R${roundNo}(${reason}) 分析异常（rating 归 9 拦截）: ${e?.message || e}`);
      });
  }

  /**
   * 状态机真值 → FA 静态投影（buildFactorMap narrative 三键的唯一数据源）。
   * @private
   */
  _projectNarrativeFactors(tokenAddress, st) {
    require('../../services/FourMemeFactorAggregator').setNarrativeFactors(tokenAddress, {
      rating: st.lastRating,
      rounds: st.rounds,
      completedAt: st.lastCompletedAt,
      accountOnly: st.accountOnly === true,
      corpusEmpty: st.corpusEmpty === true,
      inFlight: st.inFlight === true,
      category: st.category ?? null,
      superIp: st.superIp ?? null,
      recognizedEntitySlogan: st.recognizedEntitySlogan ?? null,
    });
  }

  /**
   * 轮次行 insert（narrative_analysis_rounds；dbManager service key，红线③）。
   * @returns {Promise<number>} 新行 id
   * @private
   */
  async _insertNarrativeRoundRow(tokenAddress, roundNo, reason, startedAtMs) {
    const { dbManager } = require('../../services/dbManager');
    const { data, error } = await dbManager.getClient()
      .from('narrative_analysis_rounds')
      .insert({
        experiment_id: this._experimentId,
        token_address: tokenAddress,
        round_no: roundNo,
        trigger_reason: reason,
        started_at: new Date(startedAtMs).toISOString(),
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return data.id;
  }

  /**
   * 轮次行完成 update（rating/from_cache/error/completed_at）。
   * @private
   */
  async _completeNarrativeRoundRow(rowId, r, completedAtMs) {
    if (!rowId) return;
    const { dbManager } = require('../../services/dbManager');
    const { error } = await dbManager.getClient()
      .from('narrative_analysis_rounds')
      .update({
        completed_at: new Date(completedAtMs).toISOString(),
        rating: [1, 2, 3, 9].includes(r.numericRating) ? r.numericRating : null,
        from_cache: r.fromCache === true,
        error: r.error || null,
      })
      .eq('id', rowId);
    if (error) throw new Error(error.message);
  }

  /**
   * 叙事发起条件（惰性解析缓存）：首条携带 narrativeTriggerCondition 的买腿。
   * 策略启动后不变（重启进程才换策略）；多腿模型各腿自带（当前取首条，与
   * _narrativePrefetchCondition 同款先例）。
   * @private
   */
  _narrativeTriggerCondition() {
    if (this._narrativeTriggerCondCache !== undefined) return this._narrativeTriggerCondCache;
    this._narrativeTriggerCondCache = null;
    for (const s of this._strategyEngine.getAllStrategies()) {
      if (s.action !== 'buy') continue;
      if (typeof s.narrativeTriggerCondition === 'string' && s.narrativeTriggerCondition.trim() !== '') {
        this._narrativeTriggerCondCache = s.narrativeTriggerCondition.trim();
        break;
      }
    }
    return this._narrativeTriggerCondCache;
  }

  /**
   * 买评估 slot 级去抖：burst 内每 tick 重置；maxWait 强制触发
   *（持续拉升的热门票全程连续 tick 时不会被无限推迟）。语义见 TickDebouncer。
   */
  _scheduleDebouncedBuy(tokenAddress, tick) {
    if (this._buyDebouncer.pending.has(tokenAddress)) {
      this.metrics.debounceSuppressed++;
    }
    this._buyDebouncer.touch(tokenAddress, tick);
  }

  /**
   * 去抖 fire 后的买评估：全部基于 fire 时刻的最新状态重读
   *（窗口内 token 可能已被 prune/买入/卖出，不可用旧快照——母版纪律）。
   */
  _runBuyEvaluation(tokenAddress, tick) {
    this.metrics.lastBuyEvalAt = Date.now();
    const factors = this._factorAggregator.buildFactorMap(tokenAddress, Date.now());
    if (!factors) return; // 已被 prune

    const token = this._tokenPool.getToken(tokenAddress, 'bsc');
    if (!token) return;
    if (this._buyingTokens.has(tokenAddress)) return;
    if (token.status === 'bought') return; // 单仓语义

    if (this._tokenBlacklist.has(tokenAddress)) return;

    // pumpfun 回迁批 2 买腿门：止损闩锁（lockTokenAfterSell 成交置锁）/
    // 累亏闩锁（该 token 已平仓轮 profitPercent 累计 ≤ 阈值）→ 永久禁买。
    // 置锁与记账在 _emitSellSignal 卖出成功处，日志 tag [stopLossLock]/[cumLossLock]
    if (this._tokenLocks.has(tokenAddress)) return;
    if (this._cumLossLockPct != null
        && (this._cumLossTotals.get(tokenAddress) ?? 0) <= this._cumLossLockPct) return;

    this._evaluateBuyPath(token, factors, tick)
      .catch(e => this.logger.error(this._experimentId, 'BuyEval',
        `${token.symbol || tokenAddress.slice(0, 10)} 买腿评估异常: ${e.message}`));
  }

  // ==================== 买路径（信号 → 预检查 → 虚拟记账）====================

  /**
   * 买路径主体（对齐旧 VirtualTradingEngine._executeStrategy 的 buy 分支）：
   * 信号先落库（预检查失败也留痕）→ 购买前检查 → processSignal 执行 → 池/FA 状态推进。
   */
  async _evaluateBuyPath(token, factorResults, tick) {
    const tokenAddress = token.token;
    const { buildFactorValuesForTimeSeries, buildPreBuyCheckFactorValues, buildTpaFactorSnapshot } = require('../core/FactorBuilder');

    this._buyingTokens.add(tokenAddress);
    try {
      // 初始化策略执行计数（maxExecutions 门）
      if (!token.strategyExecutions || Object.keys(token.strategyExecutions).length === 0) {
        const strategyIds = this._strategyEngine.getAllStrategies().map(s => s.id);
        this._tokenPool.initStrategyExecutions(token.token, token.chain || 'bsc', strategyIds);
      }

      // 评估（fire 时点因子；只看买腿——同优先级下避免卖策略遮蔽买入）
      const strategy = this._strategyEngine.evaluate(factorResults, token.token, Date.now(), token, 'buy');
      if (!strategy) {
        return { success: false, reason: '无触发买入策略' };
      }

      this.logger.info(this._experimentId, 'BuyEval',
        `${token.symbol} 触发买入策略: ${strategy.name} | price=${factorResults.currentPrice?.toExponential(4)}` +
        ` earlyReturn=${factorResults.earlyReturn?.toFixed(1)}% age=${factorResults.age?.toFixed(2)}min tick=${tick ? 'y' : 'n'}`);

      // ── 叙事否决短路（2026-09-27 用户裁定）──
      // 叙事评级已确认为 low（终态，检测多少次都没用）的代币不再生成买信号——
      // 不落 signal 行、不跑叙事直调/preBuyCheck；仅对配置了 narrativeCallCondition
      // （叙事直调链路启用）的策略生效，未配叙事的策略零影响。address-fail 宣告
      // 竞态盘的豁免在登记侧把关（shouldBlockOnNarrative，重试窗内不登记）
      const narrativeGateEnabled = !!(strategy.narrativeCallCondition && String(strategy.narrativeCallCondition).trim() !== '');
      if (narrativeGateEnabled && this._narrativeBlockedTokens.has(tokenAddress)) {
        return { success: false, reason: '叙事否决短路（评级 low 终态，不再生成信号）' };
      }

      // ── 买入熔断短路（2026-10-14 用户裁定，龙龙币二 revert 死循环案）──
      // 同一 token 连续 3 次买入执行失败（发单后链上 revert/estimate 失败；preBuy 拒、
      // 资金不足等前置拒绝不计——不是 token 买不进）→ 内存拉黑至进程重启，不再生成
      // 买信号（省叙事直调/preBuy 重复成本与 revert gas）。手工买不走此检查（人工指令）
      if (this._buyBlockedTokens.has(tokenAddress)) {
        return { success: false, reason: '买入熔断短路（连续链上买入失败已拉黑）' };
      }

      const latestPrice = factorResults.currentPrice || 0;
      if (!(latestPrice > 0)) {
        return { success: false, reason: '无有效价格（USD 换算未就绪）' };
      }

      // 口径统一锚（2026-10-13 用户裁定）：捕获 fire 时刻 BNB 价——预检/叙事直调可
      // 耗时十几秒（어피치案 17s 内对倒拉盘 +20%），FA 成本锚 buyPriceBnb 须定在
      // 信号触发时刻而非执行时刻，profitPercent/peakProfitPct/drawdown 族因子全程
      // 按 fire 价起算；记账锚 buyPriceUsd 不变（live=实际成交价，虚拟=signal.price）
      const firePriceBnb = Number.isFinite(factorResults.currentPriceBnb) && factorResults.currentPriceBnb > 0
        ? factorResults.currentPriceBnb : null;

      // 双口径裁定（2026-10-15，0xc7fe…7777 案）：fire 时刻开启 pending 峰追踪——
      // preBuy/GMGN 检查窗（live 实测 10-17s）内的冲高由 FA 双轨推进记账，买入成功
      // setBuyState 消费回填（信号口径峰值从 fire 起算）；失败路径 finally 兜底清理
      this._factorAggregator.markBuyFire(token.token, firePriceBnb || factorResults.currentPriceBnb || 0);

      // ── 信号先落库 ──
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
        cards: strategy.cards, // 卡牌（迁自 rich-js）：本腿买入张数（_buyAmountFor/_executeBuy* 消费）
        factors: { trendFactors: buildFactorValuesForTimeSeries(factorResults) },
        timestamp: new Date(),
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
            // C84 新模型腿：fire 时刻叙事轮次摘要（leadMs=fire−末轮完成=评级新鲜度
            // 观测，秒级~几十秒、tokenAgeSec<90 封顶；null=从未完成=不该出现——
            // 条件含 narrativeRating==2|3 恒 false 不会走到这里，防御性留观测）
            ...(this._narrativeTriggerStates.has(tokenAddress) ? {
              narrativeRoundsSummary: (() => {
                const st = this._narrativeTriggerStates.get(tokenAddress);
                return {
                  rounds: st.rounds,
                  finalRating: st.lastRating,
                  leadMs: Number.isFinite(st.lastCompletedAt) ? Date.now() - st.lastCompletedAt : null,
                };
              })(),
            } : {}),
            ...signal.factors,
          },
        });
        signalId = await tradeSignal.save();
        this._registerSignalRow(signalId, tradeSignal._insertedRow);
      } catch (saveError) {
        this.logger.error(this._experimentId, 'BuyEval', `信号保存失败 | ${token.symbol} ${saveError.message}`);
        return { success: false, reason: `信号保存失败: ${saveError.message}` };
      }

      // ── 购买前检查 ──
      let preCheckPassed = true;
      let blockReason = null;
      let preBuyCheckResult = null;

      // creator_address：WSS TokenCreate 自带（Phase 0 验证恒非空），AVE 时代的重取兜底不再需要
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

      // ── 叙事评级直调 ──
      // 策略配置 narrativeCallCondition（fire 因子评估）满足才同步调 NarrativeAnalyzer.analyze（Jev 秒级）；
      // 结果为代币级全局缓存（不挂实验名下），未配置/不满足/调用失败/超时 → numericRating=9（未评级）放行，
      // 由 preBuyCheckCondition 裁决买不买。
      let narrativeCallInfo = null;
      let narrativeLeaderInfo = null;
      const narrativeCallCondition = strategy.narrativeCallCondition && String(strategy.narrativeCallCondition).trim() !== ''
        ? String(strategy.narrativeCallCondition).trim()
        : null;
      if (narrativeCallCondition && preCheckPassed
          && this._strategyEngine.evaluateCondition(narrativeCallCondition, factorResults)) {
        narrativeCallInfo = await this._narrativeCaller.getRating(token.token);
        // N3 预触发提前量（2026-10-13 叙事提速案）：fire 直调与预触发共用实例
        //（inflight join / 行缓存命中），lead = fire 时刻 − 预触发发起时刻，
        // 随 narrativeCall 落 signal metadata 供 182 实跑统计真实提前量
        const prefetchStartedAt = this._narrativePrefetchStartedAt.get(tokenAddress);
        if (prefetchStartedAt) {
          narrativeCallInfo.prefetchLeadMs = Date.now() - prefetchStartedAt;
          this._narrativePrefetchStartedAt.delete(tokenAddress);
        }
        this.logger.info(this._experimentId, 'BuyEval',
          `叙事评级直调 | ${token.symbol} rating=${narrativeCallInfo.numericRating}(${narrativeCallInfo.rating})` +
          ` ${narrativeCallInfo.durationMs}ms fromCache=${narrativeCallInfo.fromCache}` +
          (narrativeCallInfo.error ? ` error=${narrativeCallInfo.error}` : ''));
        // N1 探针（2026-10-13 叙事提速案）：慢调用（≥3s 真跑）现场打印 top3 耗时段，
        // 全量分段在 signal metadata narrativeCall.timing（182 tmp 脚本统计用）
        if (narrativeCallInfo.durationMs >= 3000 && Array.isArray(narrativeCallInfo.timing)
            && narrativeCallInfo.timing.length > 0) {
          const top = [...narrativeCallInfo.timing].sort((a, b) => b.ms - a.ms).slice(0, 3)
            .map(s => `${s.seg}=${s.ms}ms`).join(' ');
          this.logger.info(this._experimentId, 'BuyEval', `叙事直调分段 | ${token.symbol} ${top}`);
        }

        // ── 叙事否决短路登记 ──
        // rating=low（终态）→ 登记短路集，本 token 后续 fire 不再生成买信号；
        // address-fail（宣告竞态，重试窗内可能被 PrecheckFailRetryService 翻正）豁免
        if (this._shouldBlockOnNarrative(
          narrativeCallInfo.numericRating,
          narrativeCallInfo.precheckStage,
          factorResults.age ?? null,
        )) {
          this._narrativeBlockedTokens.add(tokenAddress);
          this.logger.info(this._experimentId, 'BuyEval',
            `叙事否决登记 | ${token.symbol} rating=low${narrativeCallInfo.precheckStage ? `(${narrativeCallInfo.precheckStage})` : ''}` +
            ' → 后续买信号短路（address-fail 重试窗内已豁免的除外）');
        }

        // ── 同叙事龙头已火检查（依赖直调结果的 sourceTweetId，未拿到→因子 0 放行）──
        if (narrativeCallInfo.sourceTweetId) {
          narrativeLeaderInfo = await this._sameNarrativeLeaderService.check({
            tokenAddress: token.token,
            sourceTweetId: narrativeCallInfo.sourceTweetId,
            checkTimeSec: Math.floor(Date.now() / 1000), // 与下方 performAllChecks checkTime 同值
          });
          this.logger.info(this._experimentId, 'BuyEval',
            `同叙事龙头检查 | ${token.symbol} hot=${narrativeLeaderInfo.factors.narrativeLeaderHot}` +
            ` count=${narrativeLeaderInfo.factors.narrativeLeaderCount}` +
            ` max=${narrativeLeaderInfo.factors.narrativeLeaderMaxMultiple}x` +
            ` ${narrativeLeaderInfo.detail.durationMs}ms tweet=${narrativeCallInfo.sourceTweetId}` +
            (narrativeLeaderInfo.detail.error ? ` error=${narrativeLeaderInfo.detail.error}` : ''));
        }
      }

      if (preCheckPassed && shouldPerformPreCheck && this._preBuyCheckService) {
        try {
          const { updateRouterGateState, routerGateFactors } = require('../pre-check/router-gate-state');
          const tokenInfo = this._buildTokenInfo(token);
          let preBuyCheckCondition = currentRound === 0
            ? strategy.preBuyCheckCondition
            : strategy.repeatBuyCheckCondition;
          preBuyCheckCondition = String(preBuyCheckCondition).trim();

          const lastPairReturnRate = this._tokenPool.getLastPairReturnRate(token.token, token.chain || 'bsc');

          const faState = this._factorAggregator.getTokenState(token.token);

          // 早晚票语料滞后秒（0fed29f9 案 2026-10-08）：FA 出生锚（TokenCreate 块时间）
          // − 语料最早推文时间（主推/父推取更早，NarrativeDirectCaller.corpusTs）。
          // 早票（事件新鲜）正常买；晚票由条件表达式加严（如 lag>=300s 要求 er/uw 门）。
          // null = 无推文语料/无出生锚/直调未触发——null 比较恒 false → 落晚票门
          // fail-closed（5 张无语料时间票实测 4/5 亏损）。负值 = 宣告竞态（token 先于
          // 推文出生）= 事件原创点，按早票放行。
          const faBirthMs = faState?.createdAtMs ?? null;
          const narrativeCorpusLagSec = faBirthMs && narrativeCallInfo?.corpusTs
            ? Math.round((faBirthMs - narrativeCallInfo.corpusTs) / 1000)
            : null;

          // 总供应量：FA（TokenCreate）优先，兜底 fdv/price
          let totalSupply = faState?.totalSupply || parseFloat(token.total) || 0;
          if (totalSupply <= 0 && factorResults.fdv > 0 && factorResults.currentPrice > 0) {
            totalSupply = factorResults.fdv / factorResults.currentPrice;
          }

          preBuyCheckResult = await this._preBuyCheckService.performAllChecks(
            token.token,
            creatorAddress,
            this._experimentId,
            signalId,
            token.chain || 'bsc',
            tokenInfo,
            preBuyCheckCondition,
            {
              checkTime: Math.floor(Date.now() / 1000),
              tokenBuyTime: token.buyTime || null,
              drawdownFromHighest: factorResults.drawdownFromHighest || null,
              buyRound: currentRound + 1,
              lastPairReturnRate: lastPairReturnRate ?? 0,
              narrativeRating: narrativeCallInfo?.numericRating ?? 9, // 直调链路；未配置/未触发/失败/超时=9
              narrativeCorpusLagSec, // 早晚票分级（上方注释）；null=晚票门 fail-closed
              // earlyReturn 注入 preBuy context（drawdownFromHighest 同款先例：晚票门
              // 右臂 `earlyReturn >= N` 是 preBuy 条件可引用的「用户认同」证据）
              earlyReturn: factorResults.earlyReturn ?? null,
              // gmgnUserPct 注入（2026-10-16 u40 门挪层）：FA 实时占比 fire 时点快照；
              // null=无 TPA 段 fail-closed（preBuy 键集经 getConditionFactorKeys 自动放行）
              gmgnUserPct: factorResults.gmgnUserPct ?? null,
              narrativeLeaderHot: narrativeLeaderInfo?.factors?.narrativeLeaderHot ?? 0, // 同叙事龙头链路；无 tweet/失败=0 放行
              narrativeLeaderCount: narrativeLeaderInfo?.factors?.narrativeLeaderCount ?? 0,
              narrativeLeaderMaxMultiple: narrativeLeaderInfo?.factors?.narrativeLeaderMaxMultiple ?? 0,
              // GMGN 风险因子（x-0 案）：直调链路同次 getTokenInfo 带出发币史/捆绑钱包；
              // 未触发/失败/未索引 → covered=0 + 0 值放行（宁漏拦不误杀）
              ...this._mapGmgnRiskFactors(narrativeCallInfo?.gmgnRisk),
              tweetAuthorType: factorResults.tweetAuthorType ?? 0,
              dataCollectionRound: factorResults.dataCollectionRound ?? 0,
              totalSupply: totalSupply,
              // 平台标签（router 平台分门）：FA state（collector registerToken meta
              // 传入）优先，factorResults（buildFactorMap platform 键）双保险
              platform: faState?.platform || factorResults.platform || null,
              // router 门观察史（2026-10-03）：截至上次 fire 的状态——本次 fire 的 rp
              // 由下方回填进状态、本次评估不消费（本次出界由区间门拦，无双计数）
              ...routerGateFactors(this._routerGateState.get(token.token)),
            },
          );

          // router 门观察史回填（fire 后）：flap 且 rp 非空才累计（宁漏不误）
          if (preBuyCheckResult && preBuyCheckResult.earlyTradesRouterPct != null) {
            this._routerGateState.set(token.token, updateRouterGateState(
              this._routerGateState.get(token.token),
              faState?.platform || factorResults.platform || null,
              preBuyCheckResult.earlyTradesRouterPct,
            ));
          }

          if (!preBuyCheckResult.canBuy) {
            this.logger.warn(this._experimentId, 'BuyEval',
              `购买前检查失败 | ${token.symbol} reason=${preBuyCheckResult.checkReason}`);
            preCheckPassed = false;
            blockReason = preBuyCheckResult.checkReason || 'pre_buy_check_failed';
          }

          // 永久阻断条件评估（独立于 preBuyCheckCondition 通过/失败）
          if (this._permanentBlockCondition && preBuyCheckResult) {
            const blockResult = this._evaluatePermanentBlock(preBuyCheckResult, this._permanentBlockCondition);
            if (blockResult.blocked) {
              this._tokenBlacklist.set(token.token, { reason: blockResult.reason, timestamp: Date.now() });
              if (preCheckPassed) {
                preCheckPassed = false;
                blockReason = blockResult.reason;
              }
              this.logger.warn(this._experimentId, 'BuyEval',
                `永久阻断触发 | ${token.symbol} condition=${this._permanentBlockCondition}`);
            }
          }
        } catch (checkError) {
          const errorMsg = checkError?.message || String(checkError);
          this.logger.error(this._experimentId, 'BuyEval', `购买前检查异常: ${token.symbol} - ${errorMsg}`);
          preCheckPassed = false; // 检查失败拒绝购买（保守处理，与旧引擎一致）
          blockReason = `购买前检查异常: ${errorMsg}`;
        }
      } else if (!shouldPerformPreCheck) {
        preBuyCheckResult = { canBuy: true, checkReason: '跳过购买前检查' };
      }

      const tokenCreateTime = token.createdAt ? Math.floor(new Date(token.createdAt * 1000).getTime() / 1000) : null;

      if (!preCheckPassed) {
        // 预检查失败也保存检查数据（用于分析），信号置 failed
        if (preBuyCheckResult && signalId) {
          try {
            await this._updateSignalMetadata(signalId, {
              tokenCreateTime,
              trendFactors: buildFactorValuesForTimeSeries(factorResults),
              tpaFactors: buildTpaFactorSnapshot(factorResults),
              narrativeCall: narrativeCallInfo,
              narrativeLeaderCheck: narrativeLeaderInfo,
              preBuyCheckFactors: {
                ...buildPreBuyCheckFactorValues(preBuyCheckResult),
                permanentBlockTriggered: this._tokenBlacklist.has(token.token),
                permanentBlockCondition: this._permanentBlockCondition || null,
              },
              preBuyCheckResult: {
                canBuy: preBuyCheckResult.canBuy,
                reason: preBuyCheckResult.checkReason || 'pre_buy_check_failed',
                failedConditions: preBuyCheckResult.failedConditions || null,
                permanentBlockTriggered: this._tokenBlacklist.has(token.token),
                permanentBlockCondition: this._permanentBlockCondition || null,
              },
            });
          } catch (updateError) {
            this.logger.warn(this._experimentId, 'BuyEval',
              `更新信号元数据失败 | ${token.symbol} ${updateError.message}`);
          }
        }
        await this._updateSignalStatus(signalId, 'failed', { message: `预检查失败: ${blockReason}`, reason: blockReason });
        return { success: false, reason: `预检查失败: ${blockReason}` };
      }

      // ── 第三层：GMGN 条件（FAKER 0xc6ee…7777 团伙盘案，2026-10-14 用户裁定；
      // 2026-10-20 乌龟案改 fail-open）：前两层全过、下单前才真调 GMGN
      // getTokenInfo 构建因子（配额最小化+数据天然新鲜，与直调快照隔离——只认本层
      // fetch 的结果）。covered=0（失败/超时/未索引/key 缺失/冷却）→ **放行**
      // （不评表达式，reason 留审计）——GMGN API 不可用不得拦住买点；repeat 轮与
      // 首轮统一同一条件串 ──
      let gmgnCheckInfo = null;
      const gmgnCheckCondition = String(strategy.gmgnCheckCondition || '').trim();
      if (gmgnCheckCondition && this._gmgnRiskCheckService) {
        try {
          // gwp 钱包画像层（默认关）：fire 时刻 top-N 买家查表聚合（miss 补查 ≤1.5s 上界，
          // 常态 0=触发窗预取已暖/离线库命中）。未启用 → 第五参 null=存量零影响
          let gwpFactors = null;
          if (this._walletStatsService && this._gwpConditionLegExists()) {
            const topWallets = this._factorAggregator.getEarlyTopBuyers(token.token, {
              limit: this._walletStatsService._c.topWallets,
              minBnb: this._walletStatsService._c.minBuyBnb,
            });
            const gwpState = this._walletProfileStates.get(token.token);
            gwpFactors = await this._walletStatsService.buildFactors(topWallets, {
              leadMs: gwpState?.firstPrefetchAt != null ? Date.now() - gwpState.firstPrefetchAt : null,
            });
          }
          gmgnCheckInfo = await this._gmgnRiskCheckService.checkAndEvaluate(
            token.token, token.chain || 'bsc', gmgnCheckCondition,
            // narrativeCategory 从 fire 因子表透传（Nightshift 案 2026-10-17）：与单一
            // 买条件同刻同源，防 Pingus 案式两门错位
            factorResults?.narrativeCategory ?? null,
            gwpFactors);
        } catch (e) {
          // check 本身不抛（归一 covered=0）；此处兜 service 接线级异常（gwp buildFactors
          // 等）——2026-10-20 用户裁定：GMGN 层拿不到数据一律放行不拦买，warn 留痕
          //（不静默掩盖实现问题）
          this.logger.warn(this._experimentId, 'BuyEval',
            `GMGN 检查异常放行 | ${token.symbol} ${e?.message || e}`);
          gmgnCheckInfo = { passed: true, evaluated: false, reason: `gmgn_check_error(${e?.message || e})` };
        }
        if (!gmgnCheckInfo.passed) {
          this.logger.info(this._experimentId, 'BuyEval',
            `GMGN 条件拒买 | ${token.symbol} ${gmgnCheckInfo.reason}` +
            (gmgnCheckInfo.factors
              ? ` bundler=${gmgnCheckInfo.factors.gmgnBundlerWalletRatio} visiting=${gmgnCheckInfo.factors.gmgnVisitingCount}`
                + (gmgnCheckInfo.factors.gwpCovered != null
                  ? ` gwp=${gmgnCheckInfo.factors.gwpCovered}/${gmgnCheckInfo.factors.gwpSelected}` +
                    ` cCluster=${gmgnCheckInfo.factors.gwpCreatedClusterWallets} nMirror=${gmgnCheckInfo.factors.gwpNearMirrorClusterWallets} young=${gmgnCheckInfo.factors.gwpYoungCount}`
                  : '')
              : ''));
          if (signalId) {
            try {
              await this._updateSignalMetadata(signalId, { gmgnCheck: gmgnCheckInfo });
            } catch (updateError) {
              this.logger.warn(this._experimentId, 'BuyEval',
                `更新信号元数据失败 | ${token.symbol} ${updateError.message}`);
            }
          }
          await this._updateSignalStatus(signalId, 'failed',
            { message: `GMGN 条件未过: ${gmgnCheckInfo.reason}`, reason: gmgnCheckInfo.reason });
          return { success: false, reason: `GMGN 条件未过: ${gmgnCheckInfo.reason}` };
        }
        // fail-open 放行留痕（2026-10-20）：reason 非空=无数据跳过（evaluated=false），
        // 不打日志则 GMGN 故障期完全静默——可观测性靠这一条
        if (gmgnCheckInfo.reason) {
          this.logger.info(this._experimentId, 'BuyEval',
            `GMGN 无数据放行 | ${token.symbol} ${gmgnCheckInfo.reason}`);
        }
      }

      // ── 预检查通过：补全信号元数据后执行 ──
      if (preBuyCheckResult && signalId) {
        try {
          await this._updateSignalMetadata(signalId, {
            tokenCreateTime,
            trendFactors: buildFactorValuesForTimeSeries(factorResults),
            tpaFactors: buildTpaFactorSnapshot(factorResults),
            narrativeCall: narrativeCallInfo,
            narrativeLeaderCheck: narrativeLeaderInfo,
            // 第三层轨迹（通过路径；拒买路径在上方已单独落）
            gmgnCheck: gmgnCheckInfo,
            preBuyCheckFactors: buildPreBuyCheckFactorValues(preBuyCheckResult),
            preBuyCheckResult: {
              canBuy: preBuyCheckResult.canBuy,
              reason: preBuyCheckResult.checkReason || 'passed',
              failedConditions: preBuyCheckResult.failedConditions || null,
            },
          });
        } catch (updateError) {
          this.logger.warn(this._experimentId, 'BuyEval',
            `更新信号元数据失败 | ${token.symbol} ${updateError.message}`);
        }
      }

      const result = await this.processSignal(signal, signalId);

      if (result && result.success) {
        // 持仓锚点价：live 用实际成交价（result.priceUsd），虚拟用信号时刻因子价
        const execPriceUsd = result.priceUsd || latestPrice;
        this._tokenPool.markAsBought(token.token, token.chain, {
          buyPrice: execPriceUsd,
          buyTime: Date.now(),
        });
        this._tokenPool.recordStrategyExecution(token.token, token.chain, strategy.id);
        await this.dataService.updateTokenStatus(this._experimentId, token.token, 'bought');

        // FA 持仓锚点（per-position 止盈/止损因子原料；单仓 'default'）。
        // buyPriceBnb = fire 时刻因子价（2026-10-13 口径统一裁定；fire 后市场移动
        // 不再漂移成本锚）；fire 价缺失（quote 映射未就绪等）回落执行时刻价旧口径。
        // buySignalAt=信号（fire）时刻——holdDuration 因子起算锚（2026-10-15 双口径
        // 裁定）；buyExecutedPriceBnb=live 余额差法成交价（虚拟无独立执行价 → null）。
        // pending fire 峰在 setBuyState 内消费回填 highestPriceSinceBuyBnb/peakProfitPct
        //（preBuy 窗内冲高计入信号口径峰值）
        const faState = this._factorAggregator.getTokenState(token.token);
        this._factorAggregator.setBuyState(token.token, {
          buyPriceBnb: firePriceBnb || faState?.currentPriceBnb || 0,
          buyPriceUsd: execPriceUsd,
          buyTime: Date.now(),
          buySignalAt: signal.timestamp instanceof Date ? signal.timestamp.getTime() : Date.now(),
          buyExecutedPriceBnb: result.priceBnb ?? null,
        });

        // 毕业竞态补卖（盘古案 2026-09-28，virtual）：graduation 事件先于买入到达时
        // _handleGraduation 因 status!=='bought' no-op，买入即断流冻结。买入成功点查
        // FA graduated 标记直接补毕业全清（markAsBought 已置位；幂等在 _emitGraduationSell）。
        // live 不适用——毕业持仓走 Telegram 人工告警处置（语义见 _handleGraduation）
        if (!this._isLive && faState?.graduated && !this._graduationSoldTokens.has(token.token)) {
          this._emitGraduationSell(token, { fundsBnb: faState.lastFundsBnb ?? null })
            .catch(e => this.logger.error(this._experimentId, 'Graduation',
              `买入点毕业竞态补卖失败 | ${token.symbol} ${e.message}`));
        }

        // C166 账号复检重置：再买入=重新开始（清旧态防 sold→rebuy 竞态读到陈旧
        // deleted/tweets_gone 首 tick 误卖；首检由下轮扫描重新接线）
        this._resetAccountRecheckFor(tokenAddress);

        this.logger.info(this._experimentId, 'BuyEval',
          `✅ 买入成功${this._isLive ? '(live)' : ''} | ${token.symbol} price=${execPriceUsd.toExponential(4)} amount=${this._buyAmountFor(signal)}${this._cardsEnabled ? `(${signal.cards ?? 1}卡)` : ''} 余额=${this.currentBalance.toFixed(4)}`);
        return { success: true };
      }

      return { success: false, reason: result?.reason || result?.message || '交易执行失败' };
    } finally {
      this._buyingTokens.delete(tokenAddress);
      // pending fire 峰兜底清理：成功路径 setBuyState 已消费（此处 no-op），失败/异常
      // 路径防残峰跨 fire 窗污染下一次回填
      this._factorAggregator.clearBuyFire(tokenAddress);
    }
  }

  // ==================== 卖路径 ====================

  /**
   * 引擎级止损双腿判定（配置 stopLoss 段启用；纯读 factors 不动状态）。
   * 返回命中描述或 null；price 先判（两条同时命中时标注更深的那条，全清同效）。
   * 因子口径与策略腿同源：profitPercent=相对 FA buyState 成本（%）/ realHoldDuration=
   * 物理持有秒（2026-10-15 双口径：holdDuration 已改信号口径起算，时间止损语义=
   * 成交后 N 秒仍亏损 → 用 realHoldDuration，虚拟/回测两值恒等零影响）。
   * 时间腿 <=0 而非 <0：断流冻结票 FA 价格不动 profit 恒 0，<0 永不触发（盘古案盲区）
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
   * 止损卖出：构造等价 strategy 走 _emitSellSignal 全清链——signals/trades/
   * 卡账本（cards='all'→全清卖Pct=1，PM remainingAmount.eq(0) 删仓判据成立）/
   * 累亏记账副作用全复用，零新执行逻辑。@param {Object|null} tick 触发 tick（扫描路径 null）
   */
  async _emitStopLossSell(token, factors, hit, tick) {
    const common = {
      action: 'sell', sellPercentage: 1, cards: 'all', bypassDebounce: true,
      priority: 0, lockTokenAfterSell: false, maxExecutions: null, cumulativeLossLockPct: null,
    };
    const strategy = hit.kind === 'price'
      ? { id: 'stopLossPrice', name: `止损-价格跌破成本线(${this._stopLossPricePct}%)`, ...common }
      : { id: 'stopLossTime', name: `止损-持有超时仍亏损(${Math.round(this._stopLossTimeSec / 60)}min)`, ...common };
    this.logger.info(this._experimentId, 'StopLoss',
      `${token.symbol || token.token.slice(0, 10)} 触发${strategy.name} | profitPercent=${hit.profitPercent?.toFixed(1)}%` +
      `${hit.kind === 'time' ? ` holdDuration=${(hit.holdDuration / 60).toFixed(1)}min` : ''}` +
      `${tick ? '' : ' | 持仓扫描触发(断流兜底)'}`);
    return this._emitSellSignal(token, strategy, factors, tick);
  }

  /**
   * TokenPool 监控票淘汰（批次 3c，2026-10-15；tokenPoolEvictMinAgeMs 缺省 null=关）。
   * pool Map 长跑零淘汰无界增长（cleanup() 引擎路径零调用）——本方法在 5min prune
   * 周期内删「monitoring 且 age≥minAgeMs」条目。安全子集（刻意不做 pool 全量清理）：
   *   - 仅删 status==='monitoring'：sold 票观察窗后仍可再买（_onFactorsUpdated 买腿
   *     status!=='bought' 语义锁定）、inactive/exited 历史语义未审计一律不动
   *   - 双重防线：① protected set（持仓 ∪ 买/卖执行中 ∪ 两 debouncer pending ∪
   *     重启恢复锚点）——pool status 与引擎状态可能脱钩（重启恢复/手工交易），脱钩
   *     时以引擎侧为准；② minAgeMs 门槛在 pool maxAge(20min) 之上再设闸（建议 24h）
   *   - createdAt 缺失/非有限 → 不删（fail-safe）
   * 副作用（已论证接受）：被删票 OPB 分类时延从 tick 级粗化到 ≤60s 扫描兜底。
   * @returns {number} 本次淘汰数
   */
  _evictStaleMonitoringTokens() {
    if (this._tokenPoolEvictMinAgeMs == null || !(this._tokenPoolEvictMinAgeMs > 0)) return 0;
    const now = Date.now();
    // protected set：引擎侧真状态（一律小写归一）
    const protectedSet = new Set(
      this._getAllHoldings().map(h => h.tokenAddress?.toLowerCase()).filter(Boolean),
    );
    for (const t of this._buyingTokens || []) protectedSet.add(t.toLowerCase());
    for (const t of this._sellingTokens || []) protectedSet.add(t.toLowerCase());
    if (this._buyDebouncer?.pending) {
      for (const t of this._buyDebouncer.pending.keys()) protectedSet.add(t.toLowerCase());
    }
    if (this._sellConfirmDebouncer?.pending) {
      for (const t of this._sellConfirmDebouncer.pending.keys()) protectedSet.add(t.toLowerCase());
    }
    if (this._restoreAnchors) {
      for (const t of this._restoreAnchors.keys()) protectedSet.add(t.toLowerCase());
    }
    let evicted = 0;
    for (const token of this._tokenPool.getAllTokens()) {
      if (token.status !== 'monitoring') continue; // 安全子集：sold/inactive/exited/bought/selling 全不动
      const ageMs = now - token.createdAt * 1000;
      if (!Number.isFinite(ageMs) || ageMs < this._tokenPoolEvictMinAgeMs) continue;
      const addr = (token.token || '').toLowerCase();
      if (protectedSet.has(addr)) continue;
      this._tokenPool.removeToken(token.token, token.chain);
      evicted++;
      this.logger.info(this._experimentId, 'TokenPoolEvict',
        `监控超时票淘汰 | ${token.symbol || addr.slice(0, 10)} ${addr} age=${(ageMs / 3600000).toFixed(1)}h`);
    }
    return evicted;
  }

  /**
   * 持仓兜底扫描（stopLoss.scanIntervalSec / 卖腿存在时 30s 缺省驱动）：
   * 断流 token 无 tick → _onFactorsUpdated 永不进 → tick 驱动的止损/卖腿全部
   * 冻结（c5945f36 11 票冻结实跑实证）。扫描做三件事：毕业补卖重试（virtual）→
   * 引擎级止损双腿（stopLoss 段配置时）→ 卖腿评估（2026-10-13 用户裁定「所有
   * 卖出归卖出策略管」：止损臂迁为卖腿后，断流票的卖腿覆盖由扫描承担；只对
   * 断流票评——活跃票每 tick 已实时评估）。buildFactorMap 必须传 Date.now()：
   * 断流期 holdDuration 继续走（回落 lastTickAt 会冻结时钟因子，见
   * _onSellDebounceFire 注释）。串行执行（一次扫描内逐 token await，避免卖出风暴）
   */
  async _scanHoldingsStopLoss() {
    for (const holding of this._getAllHoldings()) {
      const tokenAddress = holding.tokenAddress;
      if (!tokenAddress) continue;
      const token = this._tokenPool.getToken(tokenAddress, 'bsc');
      if (!token || token.status !== 'bought') continue;
      if (this._sellingTokens.has(tokenAddress) || this._buyingTokens.has(tokenAddress)) continue;
      const factors = this._factorAggregator.buildFactorMap(tokenAddress, Date.now());
      if (!factors) continue;
      // 毕业兜底（盘古案，virtual）：graduation 事件路径的卖出失败（幂等标记后置到
      // 成功，失败不标记）在此重试——毕业票断流，扫描是唯一重试路径。先于止损判定
      //（毕业全清语义正确且卖出价更可靠）
      if (!this._isLive) {
        const st = this._factorAggregator.getTokenState(tokenAddress);
        if (st?.graduated && !this._graduationSoldTokens.has(tokenAddress)) {
          await this._emitGraduationSell(token, { fundsBnb: st.lastFundsBnb ?? null });
          continue;
        }
      }
      const hit = this._stopLossHit(factors);
      if (hit) {
        await this._emitStopLossSell(token, factors, hit, null);
        continue; // 保命腿已触发（卖出执行中/已清仓），本轮不再评卖腿
      }
      // 卖腿兜底评估（2026-10-13）：只对断流票评（>stallMs 无 tick）。bypass 腿立即
      // 卖；默认腿 touch 卖出确认去抖（real 模式 setTimeout 驱动，200ms 后 fire 重读
      // 因子重评，无 tick 也能到点）。时间类因子随 Date.now() 推进——时间止损腿在
      // 断流票上按预期走钟；价格类因子冻结在末 tick（与 tick 路径同源无分叉）
      if (this._sellLegScanEnabled) {
        const st = this._factorAggregator.getTokenState(tokenAddress);
        const lastTickAt = st ? st.lastTickAt : null;
        if (lastTickAt == null || Date.now() - lastTickAt > this._sellLegStallMs) {
          await this._evaluateSellPath(tokenAddress, factors, null);
        }
      }
    }
  }

  /**
   * 账号信息复检扫描（C166）：遍历持仓票，懒解析宣告账号（token_narrative.twitter_info，
   * 负缓存防重查）→ per-token 双档节流（持仓 < firstWindowMs 每 fast 档，之后 slow 档）
   * → fire-and-forget 裸调检测 → 结果回填 FA（issuerAccountState）。顺手自清理：已清仓
   * token 的复检态与 FA 注入清掉（防 sold 票 20min 再买入读到陈旧 deleted 误卖——
   * 再买入另有买入成功点重置双保险）。检测结果非 active 时留 warn 供审计。
   */
  async _accountHealthScan() {
    if (!this._accountHealthEnabled || !this._accountHealthMonitor) return;
    const FourMemeFactorAggregator = require('../../services/FourMemeFactorAggregator');
    const held = new Set();
    const now = Date.now();

    for (const holding of this._getAllHoldings()) {
      const tokenAddress = holding.tokenAddress;
      if (!tokenAddress) continue;
      held.add(tokenAddress.toLowerCase());

      let st = this._accountRecheckStates.get(tokenAddress);
      if (!st) {
        st = await this._resolveIssuerAccount(tokenAddress);
        if (!st) continue; // 解析失败（DB 错误）——不缓存，60s 后重试（见 _resolveIssuerAccount）
      }
      if (!st.resolved || st.handle == null) continue; // 负缓存：无宣告账号票不参与

      // 双档节流（用户裁定 2026-10-22）：持仓前 firstWindowMs 高频，之后低频。
      // 持仓起点=扫描首见时刻（重启后重置——重启后重新确认一轮状态，方向安全）
      const heldMs = now - (st.firstHeldAt ?? now);
      const interval = heldMs < this._accountHealthFirstWindowMs ? this._accountHealthFastMs : this._accountHealthSlowMs;
      if (st.lastCheckAt && now - st.lastCheckAt < interval) continue;
      st.lastCheckAt = now;

      // fire-and-forget（_narrativeTriggerLaunch 同款）：检测慢/失败不阻塞扫描轮
      this._accountHealthMonitor.checkAccount({ handle: st.handle, announceTweetId: st.announceTweetId })
        .then(res => {
          // 竞态防线：stop 清态/清仓自清理后不回填（完成晚于清理的检测丢弃，
          // 下轮扫描/新实验重新接线——narrative identity 校验的简化同款）
          if (!this._accountRecheckStates.has(tokenAddress)) return;
          FourMemeFactorAggregator.setAccountHealthFactors(tokenAddress, { state: res.state, checkedAt: res.checkedAt });
          if (res.state === 'deleted' || res.state === 'tweets_gone') {
            this.logger.warn(this._experimentId, 'AccountHealth',
              `🚨 宣告账号 rug 前兆: ${st.handle} → ${res.state}（${res.detail}）| ${tokenAddress}`);
          }
        })
        .catch(err => this.logger.error(this._experimentId, 'AccountHealth',
          `复检回填异常 | ${tokenAddress} ${err.message}`));
    }

    // 自清理：清仓 token 的复检态 + FA 注入（Map 不大，全量比对）
    for (const addr of [...this._accountRecheckStates.keys()]) {
      if (!held.has(addr.toLowerCase())) {
        this._accountRecheckStates.delete(addr);
        FourMemeFactorAggregator.clearAccountHealthFactors(addr);
      }
    }
  }

  /**
   * 懒解析持仓票的宣告账号（token_narrative 最新一行 twitter_info；NarrativeRepository
   * findByAddress 同语义但那是 ESM——dbManager 直查零依赖）：
   * - type=tweet → author_screen_name + tweet_id（宣告推）
   * - type=account → screen_name（无宣告推，只查账号级判据）
   * - 无行/无 twitter_info → 负缓存 {resolved:true, handle:null}（防每轮重查）
   * - DB 错误 → 不缓存返回 null（下轮重试；60s 节流防刷）
   */
  async _resolveIssuerAccount(tokenAddress) {
    const prev = this._resolveIssuerLastAttempt || (this._resolveIssuerLastAttempt = new Map());
    const now = Date.now();
    if (now - (prev.get(tokenAddress) || 0) < 60 * 1000) return null; // 错误重试节流
    prev.set(tokenAddress, now);

    try {
      const { dbManager } = require('../../services/dbManager');
      const rows = await dbManager.getClient().from('token_narrative')
        .select('twitter_info')
        .eq('token_address', tokenAddress)
        .order('created_at', { ascending: false })
        .limit(1);
      const ti = rows?.data?.[0]?.twitter_info || null;

      const st = { handle: null, announceTweetId: null, lastCheckAt: 0, firstHeldAt: now, resolved: true };
      if (ti && typeof ti === 'object') {
        if (ti.type === 'tweet' && (ti.author_screen_name || ti.screen_name)) {
          st.handle = ti.author_screen_name || ti.screen_name;
          st.announceTweetId = ti.tweet_id ? String(ti.tweet_id) : null;
        } else if (ti.type === 'account' && ti.screen_name) {
          st.handle = ti.screen_name;
        }
      }
      this._accountRecheckStates.set(tokenAddress, st);
      if (st.handle) {
        this.logger.info(this._experimentId, 'AccountHealth',
          `宣告账号复检接线 | @${st.handle}${st.announceTweetId ? ` 宣告推=${st.announceTweetId}` : ''} | ${tokenAddress}`);
      }
      return st;
    } catch (err) {
      this.logger.error(this._experimentId, 'AccountHealth',
        `宣告账号解析失败（下轮重试）| ${tokenAddress} ${err.message}`);
      return null;
    }
  }

  /**
   * 再买入重置（买入成功点调用）：清旧复检态与 FA 注入——sold 票 20min 可再买，
   * 残留 'deleted' 会让再买入票首 tick 即满足卖臂（自清理之外的竞态双保险）。
   */
  _resetAccountRecheckFor(tokenAddress) {
    if (!tokenAddress) return;
    if (this._accountRecheckStates) this._accountRecheckStates.delete(tokenAddress);
    if (this._accountHealthEnabled) {
      require('../../services/FourMemeFactorAggregator').clearAccountHealthFactors(tokenAddress);
    }
  }

  /**
   * 卖腿评估（pumpfun 回迁批 2：每 tick 实时评估不去抖，hit 后分流）：
   * - bypassDebounce 腿（利润锁定/断流类时间敏感腿）或 sellDebounceMs=0 → 立即卖（存量行为）
   * - 默认腿 → SellConfirmDebouncer touch（首真 tick 起计不重置），fire 重读因子重评，
   *   仍真才卖（窗口内恢复→不卖）——「庄还在的回调拿住，庄撤了的真跌快卖」
   * - 条件变 false → clear pending（下次触发重新起算）
   */
  async _evaluateSellPath(tokenAddress, factors, tick) {
    const token = this._tokenPool.getToken(tokenAddress, 'bsc');
    if (!token || token.status !== 'bought') return { success: false, reason: '非持有状态' };
    if (this._sellingTokens.has(tokenAddress)) return { success: false, reason: '卖出执行中' };

    // 只看卖腿：单仓语义下买入触发对持仓代币是无效噪声，混合评估会让同优先级的
    // 买策略永远压住卖出（triggeredStrategies[0] 按插入序取）——止损/止盈被静默杀死
    const strategy = this._strategyEngine.evaluate(factors, tokenAddress, Date.now(), token, 'sell');
    if (!strategy) {
      this._sellConfirmDebouncer.clear(tokenAddress); // 条件 false（趋势恢复）→ 取消 pending
      return { success: false, reason: '无触发卖出策略' };
    }

    // B/C 分流：bypassDebounce 或去抖关闭 → 立即卖；趋势失去类默认腿 → 进确认去抖
    if (strategy.bypassDebounce || this._sellDebounceMs <= 0) {
      this._sellConfirmDebouncer.clear(tokenAddress);
      return this._emitSellSignal(token, strategy, factors, tick);
    }

    this._sellConfirmDebouncer.touch(tokenAddress, tick);
    return { success: false, reason: '卖出确认去抖中' };
  }

  /**
   * 卖出确认去抖 fire：重读 fire 时刻因子重评（窗口内 token 可能已恢复/sold/prune）。
   * now 必须 Date.now()——省略会回落 lastTickAt，断流期时钟因子冻结在末 tick。
   */
  _onSellDebounceFire(tokenAddress, tick) {
    const factors = this._factorAggregator.buildFactorMap(tokenAddress, Date.now());
    if (!factors) return;
    const token = this._tokenPool.getToken(tokenAddress, 'bsc');
    if (!token || token.status !== 'bought') return;
    if (this._buyingTokens.has(tokenAddress)) return; // 与卖腿路由门同口径

    this._reconfirmAndSell(token, factors)
      .catch(e => this.logger.error(this._experimentId, 'SellEval',
        `${token.symbol || tokenAddress.slice(0, 10)} 卖出去抖 fire 异常: ${e.message}`));
  }

  /** fire 重评：条件仍真才卖（恢复→不卖，等下次触发重新起算） */
  async _reconfirmAndSell(token, factors) {
    const tokenAddress = token.token;
    if (this._sellingTokens.has(tokenAddress)) return { success: false, reason: '卖出执行中' };

    const strategy = this._strategyEngine.evaluate(factors, tokenAddress, Date.now(), token, 'sell');
    if (!strategy) return { success: false, reason: '条件恢复，不卖' };

    return this._emitSellSignal(token, strategy, factors, null);
  }

  /**
   * 构造卖出信号并执行（立即卖 / 去抖 fire 共用；从原 _evaluateSellPath 抽取）。
   * 成功后：累亏闩锁记账（盈亏同记）+ lockTokenAfterSell 止损闩锁置位。
   * @param {Object|null} tick - 触发 tick（去抖 fire 路径为 null）
   */
  async _emitSellSignal(token, strategy, factors, tick) {
    const tokenAddress = token.token;
    if (this._sellingTokens.has(tokenAddress)) return { success: false, reason: '卖出执行中' };

    // live 卖出失败冷却：tick 驱动的卖腿若无冷却，链上失败会每 tick 重试烧 gas
    if (this._isLive) {
      const cooldownUntil = this._sellCooldownUntil.get(tokenAddress);
      if (cooldownUntil && Date.now() < cooldownUntil) {
        return { success: false, reason: '卖出冷却中' };
      }
    }

    this._sellingTokens.add(tokenAddress);
    try {
      this.logger.info(this._experimentId, 'SellEval',
        `${token.symbol} 触发卖出策略: ${strategy.name}${tick ? '' : '（去抖确认后）'} | ` +
        `profitPercent=${factors.profitPercent?.toFixed(1)}% ` +
        `holdDuration=${factors.holdDuration?.toFixed(0)}s drawdown=${factors.drawdownFromHighestSinceLastBuy?.toFixed(1)}%`);

      const latestPrice = factors.currentPrice || 0;
      if (!(latestPrice > 0)) {
        return { success: false, reason: '无有效价格' };
      }

      const { buildFactorValuesForTimeSeries } = require('../core/FactorBuilder');
      const holding = this._getHolding(tokenAddress);
      const buyPrice = holding?.averagePurchasePrice || token.buyPrice || null;

      // 卡牌 sizing（迁自 rich-js，与 BacktestEngine 同构）：机制启用 且 卖腿配 cards 且
      // token 有卡 → 按卡数比例卖余仓：soldN = 'all'→全清 / min(cards, 余卡) 钳制；
      // soldN>=tokenCards 时 sellPct 恒精确 1（IEEE T/T）→ Decimal.mul(1) 精确直通，
      // PM remainingAmount.eq(0) 删仓判据成立（E5d 僵尸仓教训）。否则旧 sellPercentage
      // 路径。cardTrade.after 为信号构造时点绝对值，随 trade metadata 落库
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
        buyPrice: buyPrice,
        profitPercent: buyPrice && latestPrice ? ((latestPrice - buyPrice) / buyPrice * 100) : null,
        holdDuration: token.buyTime ? ((Date.now() - token.buyTime) / 1000) : null,
        sellPercentage: sellPct, // E5：本腿卖出比例（执行时点余仓；卡牌模式=卡数比例）
        cardTrade,
        factors: { trendFactors: buildFactorValuesForTimeSeries(factors) },
        timestamp: new Date(),
      };

      const result = await this.processSignal(signal);

      if (result && result.success) {
        this._tokenPool.recordStrategyExecution(token.token, token.chain, strategy.id);
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

        // 止损闩锁：lockTokenAfterSell 卖腿成交 → 该 token 永久禁买（"止损后该票不再交易"）
        if (strategy.lockTokenAfterSell) {
          this._tokenLocks.add(tokenAddress);
          this.logger.info(this._experimentId, 'stopLossLock',
            `[stopLossLock] ${token.symbol} 止损腿[${strategy.id}]成交，该 token 禁买`);
        }

        return { success: true };
      }
      return { success: false, reason: result?.reason || result?.message || '卖出执行失败' };
    } finally {
      this._sellingTokens.delete(tokenAddress);
    }
  }

  // ==================== 交易执行（virtual 虚拟记账 / live FourMemeDirectTrader）====================

  async _executeBuy(signal, signalId = null, metadata = {}) {
    if (this._isLive) {
      return this._executeBuyLive(signal, signalId, metadata);
    }
    try {
      const amountInBNB = this._calculateBuyAmount(signal);
      if (amountInBNB <= 0) {
        return { success: false, reason: '余额不足或计算金额为0' };
      }

      // 卡账本（迁自 rich-js）：机制启用时所有买入都是卡牌计价（本腿 cards ?? 1 张）。
      // after 为成交时点绝对值，先写进 trade metadata（重启重放/诊断），成功才落 Map
      let cardTrade = null;
      if (this._cardsEnabled) {
        const cardsN = signal.cards != null ? signal.cards : 1;
        const before = this._tokenCards.get(signal.tokenAddress) || 0;
        cardTrade = { cards: cardsN, before, after: before + cardsN };
      }

      const price = signal.price || signal.buyPrice || 0;
      const tokenAmount = price > 0 ? new Decimal(amountInBNB).div(price).toNumber() : 0;

      const result = await this.executeTrade({
        tokenAddress: signal.tokenAddress,
        symbol: signal.symbol,
        direction: 'buy',
        amount: tokenAmount,
        price: price,
        signalId: signalId,
        metadata: { ...metadata, ...(cardTrade ? { cardTrade } : {}) },
      });
      if (result && result.success) {
        if (cardTrade) {
          this._tokenCards.set(signal.tokenAddress, cardTrade.after);
        }
        // E5 轮账本开轮：买入成功登记成本（记账货币 USD；virtual tradeAmount 即此口径）
        this._roundLedger.set(signal.tokenAddress, {
          buyUsd: amountInBNB, sellUsdGross: 0, buyTime: Date.now(), legCount: 0,
        });
      }
      return result || { success: false, reason: 'executeTrade 返回空值' };
    } catch (error) {
      this.logger.error(this._experimentId, '_executeBuy', `异常 | ${error.message}`);
      return { success: false, reason: error.message || '买入执行异常', error: error.message };
    }
  }

  async _executeSell(signal, signalId = null, metadata = {}, traderOverride = null) {
    try {
      const holding = this._getHolding(signal.tokenAddress);
      if (!holding || holding.amount <= 0) {
        return { success: false, reason: '无持仓' };
      }
      const sellPct = (typeof signal.sellPercentage === 'number'
        && signal.sellPercentage > 0 && signal.sellPercentage <= 1) ? signal.sellPercentage : 1;
      // P-3 快照：PM 部分卖原地改写同一 position 对象（amount→余量），成交后 holding 引用即余量
      const qtyBefore = Number(holding.amount);

      let result;
      let virtualAmountDec = null; // 虚拟腿精确卖出量（Decimal），qtySold 回退用
      if (this._isLive) {
        result = await this._executeSellLive(signal, signalId, metadata, holding, sellPct, traderOverride);
      } else {
        // E5d 修复（精度，与 BacktestEngine 同构）：amountToSell 保持 Decimal 精确值，
        // 不经 Number 往返——部分卖后余仓 Number 化可能向上失真，全清腿会被 PM 以
        // 「Insufficient token balance」误拒（详见 BacktestEngine._executeSell 注释）
        const amountToSell = new Decimal(holding.amount).mul(sellPct);
        virtualAmountDec = amountToSell;
        const price = signal.price || 0;
        result = await this.executeTrade({
          tokenAddress: signal.tokenAddress,
          symbol: signal.symbol,
          direction: 'sell',
          amount: amountToSell,
          price: price,
          signalId: signalId,
          metadata: {
            ...metadata,
            buyPrice: signal.buyPrice,
            profitPercent: signal.profitPercent,
            holdDuration: signal.holdDuration,
            sellPercentage: sellPct,
            ...(signal.cardTrade ? { cardTrade: signal.cardTrade } : {}),
          },
        });
      }

      if (result && result.success) {
        this._sellCooldownUntil.delete(signal.tokenAddress);
        this._sellFailStreak.delete(signal.tokenAddress);

        // 腿实际卖出量：live=链上/receipt 实际 qtySold，虚拟=请求数量（Decimal 精确，PM 按此成交）
        const qtySold = result.qtySold ?? virtualAmountDec ?? new Decimal(qtyBefore).mul(sellPct).toNumber();
        // 腿所得（记账货币 USD）：live bnbReceived×汇率，虚拟 qtySold×信号价(USD)
        const sellPrice = result.priceUsd ?? (signal.price || 0);
        const legProceedsUsd = result.bnbReceived != null && result.bnbReceived > 0
          ? new Decimal(result.bnbReceived).mul(this._getBnbUsd() || 0).toNumber()
          : (sellPrice > 0 ? new Decimal(qtySold).mul(sellPrice).toNumber() : 0);

        // 全清判定用 PM 余仓（live 6 位小数截断/链上下调后比例反推不可靠；部分卖保持 bought，卖腿继续评估）
        const fullyClosed = (Number(this._getHolding(signal.tokenAddress)?.amount ?? 0) <= 0);

        // 卡账本写回（迁自 rich-js，与 BacktestEngine 同构）：成交才扣卡。配卡腿写
        // after 绝对值（0 → 删卡）；不带 cardTrade 的腿在全清时也删卡（防重买后卡数
        // 虚高）；部分比例卖不动卡数（比例/卡数两套 sizing 口径并行）
        if (signal.cardTrade) {
          if (signal.cardTrade.after > 0) {
            this._tokenCards.set(signal.tokenAddress, signal.cardTrade.after);
          } else {
            this._tokenCards.delete(signal.tokenAddress);
          }
        } else if (fullyClosed) {
          this._tokenCards.delete(signal.tokenAddress);
        }

        // E5 轮账本：每卖腿累计所得；全清时一次记整轮 pnl=Σ卖-买（替换旧单腿估算口径）
        const ledger = this._roundLedger.get(signal.tokenAddress)
          || { buyUsd: 0, sellUsdGross: 0, buyTime: Date.now(), legCount: 0 };
        ledger.sellUsdGross = new Decimal(ledger.sellUsdGross).plus(legProceedsUsd).toNumber();
        ledger.legCount = (ledger.legCount || 0) + 1;

        const token = this._tokenPool.getToken(signal.tokenAddress, signal.chain || 'bsc');
        if (fullyClosed) {
          if (token && token.buyTime) {
            const sellTime = Date.now();
            const returnRate = ledger.buyUsd > 0
              ? (ledger.sellUsdGross - ledger.buyUsd) / ledger.buyUsd * 100 : 0;
            this._tokenPool.addCompletedPair(signal.tokenAddress, signal.chain, {
              buyTime: token.buyTime,
              sellTime,
              returnRate,
              pnl: new Decimal(ledger.sellUsdGross).minus(ledger.buyUsd).toNumber(),
            });
            this.logger.info(this._experimentId, '_executeSell',
              `已完成交易对（全清 ${ledger.legCount} 腿归并） | ${signal.symbol} returnRate=${returnRate.toFixed(2)}%`);
          }
          this._roundLedger.delete(signal.tokenAddress);

          this._tokenPool.markAsSold(signal.tokenAddress, signal.chain);
          await this.dataService.updateTokenStatus(this._experimentId, signal.tokenAddress, 'sold');
          this._factorAggregator.clearBuyState(signal.tokenAddress, 'default');
        } else {
          this._roundLedger.set(signal.tokenAddress, ledger);
          this.logger.info(this._experimentId, '_executeSell',
            `部分卖出 ${(sellPct * 100).toFixed(0)}% | ${signal.symbol} 腿所得=${legProceedsUsd.toFixed(6)} 余仓=${Number(this._getHolding(signal.tokenAddress)?.amount ?? 0).toFixed(4)}${signal.cardTrade ? ` 余卡=${signal.cardTrade.after}` : ''}`);
        }
      } else if (this._isLive) {
        // 外部处置分流（P1）：链上余额为 0 = 钱包外已卖出/转走，重试必然失败——
        // 不计连败（熔断会误伤），长冷却静音 + 告警人工处置（账面仓位对账亦同源告警）
        if (result?.externalDisposal) {
          this._sellCooldownUntil.set(signal.tokenAddress, Date.now() + this._sellCbCooldownMs);
          this.logger.error(this._experimentId, '_executeSell',
            `⛓️ 链上余额为 0（外部处置，不计熔断连败）| ${signal.symbol} 账面 ${result.reason}，` +
            `长冷却 ${this._sellCbCooldownMs / 60000}min，请人工核查仓位`);
          this._notifyLiveAlert('⛓️ 外部处置仓位',
            `${signal.symbol} 链上余额为 0（可能钱包外已卖出/转走），账面仍记持仓。` +
            `已长冷却 ${this._sellCbCooldownMs / 60000}min（不计熔断）。请人工核查持仓 ${signal.tokenAddress}`);
          return result;
        }
        // 卖出失败冷却：防每 tick 高频重试烧 gas（成功后清除）
        // 连续失败熔断（迁自 rich-js 卖腿防线）：同一 token 连败达阈值 → 长冷却 + 告警
        // （rich-js 事故面：flap 税币 "Pancake: K" 持续 revert，短冷却下反复烧 gas）
        const streak = (this._sellFailStreak.get(signal.tokenAddress) || 0) + 1;
        this._sellFailStreak.set(signal.tokenAddress, streak);
        let cooldownMs = this._sellFailureCooldownMs;
        if (streak >= this._sellCbFailures) {
          cooldownMs = this._sellCbCooldownMs;
          this.logger.error(this._experimentId, '_executeSell',
            `🛑 卖出熔断 | ${signal.symbol} 连续失败 ${streak} 次（阈值 ${this._sellCbFailures}），` +
            `长冷却 ${this._sellCbCooldownMs / 60000}min，请人工核查（${result?.reason || '未知原因'}）`);
          this._notifyLiveAlert('🛑 卖出熔断',
            `${signal.symbol} 连续卖出失败 ${streak} 次，已长冷却 ${this._sellCbCooldownMs / 60000}min。` +
            `原因: ${result?.reason || '未知'}。请人工核查持仓 ${signal.tokenAddress}`);
        } else {
          this.logger.warn(this._experimentId, '_executeSell',
            `live 卖出失败（连败 ${streak}/${this._sellCbFailures}），冷却 ${this._sellFailureCooldownMs / 1000}s | ${signal.symbol} ${result?.reason || ''}`);
        }
        this._sellCooldownUntil.set(signal.tokenAddress, Date.now() + cooldownMs);
      }

      return result;
    } catch (error) {
      return { success: false, reason: error.message };
    }
  }

  /**
   * live 买入：链上余额检查（含 gas reserve）→ FourMemeDirectTrader.buyToken →
   * 实际成交（receipt 解析数量）按 BNB/USD 换算 USD 口径记账（fee=0，真实成本已含在
   * 成交差价里）→ Trade 落库（isVirtualTrade=false + txHash）。
   * 链上事实优先：记账异常不改变交易成功语义（cash 由 _reconcileLiveCash 对账兜底）。
   */
  async _executeBuyLive(signal, signalId = null, metadata = {}) {
    try {
      // 非 BNB 计价盘不再拒买（2026-10-14 用户裁定「所有非 BNB 盘都可以买，只要能正常
      // 买入」——推翻同日早些的 BNB-only 防线；买入可行性由 estimateGas 天然保证：多跳
      // 路径不通 estimate 失败即买入失败，不发垃圾 tx。卖出侧 quote 池风险由用户自担）

      // 卡牌模式：逐腿金额 = perCardBNB × 张数（不走 _calculateBuyAmount 的 PM cash 门，
      // live 真金白银以链上余额检查为准）
      const amountInBNB = this._buyAmountFor(signal);
      if (!(amountInBNB > 0)) {
        return { success: false, reason: 'tradeAmount 未配置或为 0' };
      }

      // 卡账本（迁自 rich-js）：after 绝对值先写 trade metadata，成交才落 Map。
      // 手工显式金额（manualAmountBnb）不记卡——金额非 perCard 计价，记卡必然失真
      let cardTrade = null;
      if (this._cardsEnabled && signal.manualAmountBnb == null) {
        const cardsN = signal.cards != null ? signal.cards : 1;
        const before = this._tokenCards.get(signal.tokenAddress) || 0;
        cardTrade = { cards: cardsN, before, after: before + cardsN };
      }

      // 持仓数上限（迁自 rich-js 安全阀：maxPositionTokens 只拦新开仓，不碰已有持仓的加仓）
      if (this._liveMaxPositionTokens > 0 && !this._getHolding(signal.tokenAddress)) {
        const heldCount = this._getAllHoldings().filter(h => Number(h.amount) > 0).length;
        if (heldCount >= this._liveMaxPositionTokens) {
          return {
            success: false,
            reason: `持仓数已达上限 ${this._liveMaxPositionTokens}（当前 ${heldCount}），拒绝新开仓 | ${signal.symbol}`,
          };
        }
      }

      // 链上资金检查（portfolio cash 是记账镜像，真金白银以链上为准）
      const nativeBalance = new Decimal(await this._trader.getNativeBalance());
      if (nativeBalance.lt(new Decimal(amountInBNB).plus(this._reserveNative))) {
        return {
          success: false,
          reason: `链上余额不足: 实际 ${nativeBalance.toString()}, 需要 ${amountInBNB}+reserve ${this._reserveNative}`,
        };
      }

      const { ethers } = require('ethers');
      const amountInWei = ethers.parseEther(String(amountInBNB));

      // L1 预成交校验锚（rich-js BURNIE 防线）：按信号价推导预期到手 token 数。
      // 信号价是 USD/token，买入金额 BNB → USD → token；bnbUsd/信号价任一缺失时
      // 传 null（trader 契约缺失即拒绝——极端行情宁可错过不可买错）
      const bnbUsd = this._getBnbUsd();
      const signalPriceUsd = signal.price || 0;
      const expectedTokenOut = (bnbUsd > 0 && signalPriceUsd > 0)
        ? new Decimal(amountInBNB).mul(bnbUsd).div(signalPriceUsd).toNumber()
        : null;

      const options = {
        slippageTolerance: this._liveSlippagePct,
        maxGasPrice: this._liveMaxGasPriceGwei,
        minOutRatio: this._liveMinOutRatio,
        expectedTokenOut,
      };

      this.logger.info(this._experimentId, '_executeBuyLive',
        `📡 live 买入 | ${signal.symbol} ${amountInBNB} BNB（滑点 ${this._liveSlippagePct}% gas≤${this._liveMaxGasPriceGwei}gwei）`);

      const buyResult = await this._liveTraderFor(signal.tokenAddress).buyToken(signal.tokenAddress, amountInWei, options);
      if (!buyResult.success) {
        this._registerBuyFailure(signal, buyResult.error);
        // 单次失败必打行（2026-10-16 蓝蛙 0x9499…7777 案：revert 失败只在熔断阈值才打，
        // 8.6s 静默期实验日志零行，定位全靠 DB execution_reason 考古）
        this.logger.warn(this._experimentId, '_executeBuyLive',
          `❌ live 买入失败 | ${signal.symbol} ${signal.tokenAddress} | ${String(buyResult.error || 'live 买入交易失败').slice(0, 300)}`);
        return { success: false, reason: buyResult.error || 'live 买入交易失败' };
      }

      // 实际成交数量：receipt 解析为准，失败按信号价估算（bnbUsd 沿用上方锚定值）
      let actualTokenAmount = parseFloat(buyResult.actualAmountOut);
      if (!isFinite(actualTokenAmount) || actualTokenAmount <= 0) {
        actualTokenAmount = this._estimateBuyTokenOut(amountInBNB, signal.price || 0, bnbUsd);
        this.logger.warn(this._experimentId, '_executeBuyLive',
          `实际成交数量未知（receipt 解析失败），按信号价估算 ${actualTokenAmount}`);
      }
      if (!(actualTokenAmount > 0)) {
        return { success: false, reason: `成交数量无效: ${buyResult.actualAmountOut}` };
      }
      const actualPriceUsd = bnbUsd > 0
        ? new Decimal(amountInBNB).mul(bnbUsd).div(actualTokenAmount).toNumber()
        : (signal.price || 0);
      // 执行口径 BNB 价（2026-10-15 双口径因子 buyExecutedPriceBnb 原料；与 USD 价
      // 同源——余额差法 amountIn/actualTokenAmount，免汇率）
      const actualPriceBnb = new Decimal(amountInBNB).div(actualTokenAmount).toNumber();

      await this._liveRecordTrade('buy', signal, actualTokenAmount, actualPriceUsd);

      const { Trade } = require('../entities');
      const trade = new Trade({
        experimentId: this._experimentId,
        signalId,
        tokenAddress: signal.tokenAddress,
        tokenSymbol: signal.symbol,
        tradeDirection: 'buy',
        tradeStatus: 'success',
        success: true,
        isVirtualTrade: false,
        inputCurrency: 'BNB',
        outputCurrency: signal.symbol,
        inputAmount: String(amountInBNB),
        outputAmount: String(actualTokenAmount),
        unitPrice: String(actualPriceUsd),
        txHash: buyResult.transactionHash || buyResult.txHash || null,
        gasUsed: buyResult.gasUsed || null,
        gasPrice: buyResult.gasPrice || null,
        executedAt: new Date(),
        metadata: {
          ...metadata,
          txHash: buyResult.transactionHash || buyResult.txHash || null,
          bnbUsd,
          amountInBnb: String(amountInBNB),
          ...(cardTrade ? { cardTrade } : {}),
          protocol: buyResult.protocol || 'FourMeme TokenManager2',
          method: buyResult.method || 'buyTokenAMAP',
        },
      });
      const tradeId = await trade.save();

      this.logger.info(this._experimentId, '_executeBuyLive',
        `✅ live 买入成交 | ${signal.symbol} tx=${trade.txHash} 得 ${actualTokenAmount} @ ${actualPriceUsd.toExponential(4)} USD`);

      if (cardTrade) {
        this._tokenCards.set(signal.tokenAddress, cardTrade.after);
      }
      // E5 轮账本开轮：买入成功登记成本（live 实付 BNB 折 USD，统一记账货币）
      this._roundLedger.set(signal.tokenAddress, {
        buyUsd: bnbUsd > 0 ? new Decimal(amountInBNB).mul(bnbUsd).toNumber() : amountInBNB,
        sellUsdGross: 0, buyTime: Date.now(), legCount: 0,
      });

      // 成功清零连败（竞争型「2 败 1 成」翻正不拉黑——喝水小猴/龙龙币一实证模式）
      this._buyFailStreak.delete(signal.tokenAddress);

      return { success: true, tradeId, txHash: trade.txHash, trade, priceUsd: actualPriceUsd, priceBnb: actualPriceBnb };
    } catch (error) {
      this.logger.error(this._experimentId, '_executeBuyLive', `异常 | ${error.message}`);
      this._registerBuyFailure(signal, error.message);
      return { success: false, reason: error.message || 'live 买入执行异常', error: error.message };
    }
  }

  /**
   * 买腿 receipt 解析失败时的成交数量估算（2026-10-15 妹珠 0xa4b8…7777 案）：
   * signal.price 是 USD/token 口径、amountInBNB 是 BNB——必须 ×bnbUsd 换算（与上方
   * expectedTokenOut 同公式）。旧版漏乘 → 数量低估 bnbUsd 倍（719×）：链上实收
   * 603,940 记账 847 → PM 按错误账面只卖 847，残仓 603,093 滞留钱包。锚缺失
   * （price/bnbUsd 任一 ≤0）返回 0 → 上游「成交数量无效」失败，不写错账。
   */
  _estimateBuyTokenOut(amountInBNB, signalPriceUsd, bnbUsd) {
    if (!(signalPriceUsd > 0) || !(bnbUsd > 0)) return 0;
    return new Decimal(amountInBNB).mul(bnbUsd).div(signalPriceUsd).toNumber();
  }

  /**
   * 买入连续失败登记（live 熔断输入）：发单后失败才计（链上 revert/estimate 失败/
   * 执行异常）；前置拒绝（金额 0/持仓上限/链上余额不足）在早退分支不计——那是资金
   * 问题不是 token 买不进。达阈值 → 内存拉黑至进程重启 + 告警（与卖出熔断同款机制，
   * 2026-10-14 用户裁定阈值 3；龙龙币二 0x2831fdfa 连败 6+ 烧 gas 案）
   */
  _registerBuyFailure(signal, failReason) {
    const addr = signal.tokenAddress;
    const streak = (this._buyFailStreak.get(addr) || 0) + 1;
    if (streak >= this._buyCbFailures) {
      this._buyFailStreak.delete(addr);
      this._buyBlockedTokens.add(addr);
      this.logger.error(this._experimentId, '_executeBuyLive',
        `🛑 买入熔断 | ${signal.symbol} 连续买入失败 ${streak} 次（阈值 ${this._buyCbFailures}），` +
        `已拉黑至进程重启 | 最后失败: ${String(failReason || '').slice(0, 120)}`);
      this._notifyLiveAlert('🛑 买入熔断',
        `${signal.symbol} 连续买入失败 ${streak} 次（阈值 ${this._buyCbFailures}），已拉黑至进程重启。\n` +
        `token: ${addr}\n最后失败: ${String(failReason || '').slice(0, 200)}`);
    } else {
      this._buyFailStreak.set(addr, streak);
    }
  }

  /**
   * live 卖出：链上余额预查（账面 > 链上时按链上数量卖，防呆账）→
   * sellToken（trader 内自动 approve + 余额截断 + minFunds 滑点保护）→
   * 实收 BNB 换算 USD 记账（fee=0）→ Trade 落库。
   */
  async _executeSellLive(signal, signalId = null, metadata = {}, holding, sellPct = 1, traderOverride = null) {
    const { ethers } = require('ethers');
    // E5：按腿比例卖执行时点余仓（holding.amount 此刻尚未被改写，无需额外快照——
    // PM 部分卖改写在交易返回之后）
    const amountToSell = new Decimal(Number(holding.amount)).mul(sellPct).toNumber();

    const onChainQty = await this._getOnChainTokenBalance(signal.tokenAddress);
    let qtySold = amountToSell;
    if (onChainQty !== null && onChainQty < amountToSell) {
      if (onChainQty <= 0) {
        // externalDisposal：链上 0 = 钱包外已处置（人工卖出/转走），重试必然失败——
        // 上游熔断计数分流不计连败（P1 裁定：外部处置非交易故障，熔断会误伤）
        return { success: false, reason: `链上余额为 0（可能已外部处置），账面 ${amountToSell}`, externalDisposal: true };
      }
      this.logger.warn(this._experimentId, '_executeSellLive',
        `账面 ${amountToSell} > 链上 ${onChainQty}，按链上数量卖出 | ${signal.symbol}`);
      qtySold = onChainQty;
    }

    const amountOutWei = ethers.parseUnits(qtySold.toFixed(18), 18); // trader bigint 分支内含 6 位小数舍入

    // L1 预成交校验锚（卖出侧）：qtySold×信号价(USD)/BNB-USD = 预期实收 BNB（UI 单位）。
    // bnbUsd/信号价任一缺失传 null（trader 缺锚时预估失败 fail-closed、预估成功仍走
    // 相对滑点锚——降级但不裸奔）
    const bnbUsdSell = this._getBnbUsd();
    const signalPriceUsdSell = signal.price || 0;
    const expectedNativeOut = (bnbUsdSell > 0 && signalPriceUsdSell > 0)
      ? new Decimal(qtySold).mul(signalPriceUsdSell).div(bnbUsdSell).toNumber()
      : null;

    const options = {
      slippageTolerance: this._liveSlippagePct,
      maxGasPrice: this._liveMaxGasPriceGwei,
      minOutRatio: this._liveMinOutRatio,
      expectedNativeOut,
    };

    this.logger.info(this._experimentId, '_executeSellLive',
      `📡 live 卖出 | ${signal.symbol} ${qtySold}（滑点 ${this._liveSlippagePct}%）`);

    const sellResult = await (traderOverride || this._liveTraderFor(signal.tokenAddress)).sellToken(signal.tokenAddress, amountOutWei, options);
    if (!sellResult.success) {
      return { success: false, reason: sellResult.error || 'live 卖出交易失败' };
    }

    // 实收 BNB：receipt 解析值优先（trader 解析失败时为 0），回落按信号价/汇率估算
    const bnbUsd = this._getBnbUsd();
    let bnbReceived = parseFloat(sellResult.actualReceived);
    if (!isFinite(bnbReceived) || bnbReceived <= 0) {
      const fallbackPriceUsd = signal.price || 0;
      bnbReceived = fallbackPriceUsd > 0 && bnbUsd > 0
        ? new Decimal(qtySold).mul(fallbackPriceUsd).div(bnbUsd).toNumber()
        : 0;
      this.logger.warn(this._experimentId, '_executeSellLive',
        `实收 BNB 解析失败，按信号价估算 ${bnbReceived}`);
    }
    const actualPriceUsd = qtySold > 0 && bnbReceived > 0 && bnbUsd > 0
      ? new Decimal(bnbReceived).mul(bnbUsd).div(qtySold).toNumber()
      : (signal.price || 0);

    await this._liveRecordTrade('sell', signal, qtySold, actualPriceUsd);

    const { Trade } = require('../entities');
    const trade = new Trade({
      experimentId: this._experimentId,
      signalId,
      tokenAddress: signal.tokenAddress,
      tokenSymbol: signal.symbol,
      tradeDirection: 'sell',
      tradeStatus: 'success',
      success: true,
      isVirtualTrade: false,
      inputCurrency: signal.symbol,
      outputCurrency: 'BNB',
      inputAmount: String(qtySold),
      outputAmount: String(bnbReceived),
      unitPrice: String(actualPriceUsd),
      txHash: sellResult.transactionHash || sellResult.txHash || null,
      gasUsed: sellResult.gasUsed || null,
      gasPrice: sellResult.gasPrice || null,
      executedAt: new Date(),
      metadata: {
        ...metadata,
        txHash: sellResult.transactionHash || sellResult.txHash || null,
        bnbUsd,
        bnbReceived: String(bnbReceived),
        sellPercentage: sellPct,
        ...(signal.cardTrade ? { cardTrade: signal.cardTrade } : {}),
        protocol: sellResult.protocol || 'FourMeme TokenManager2',
        method: sellResult.method || 'sellToken',
      },
    });
    const tradeId = await trade.save();

    this.logger.info(this._experimentId, '_executeSellLive',
      `✅ live 卖出成交 | ${signal.symbol} ${(sellPct * 100).toFixed(0)}%腿 tx=${trade.txHash} 得 ${bnbReceived} BNB @ ${actualPriceUsd.toExponential(4)} USD`);

    return { success: true, tradeId, txHash: trade.txHash, trade, priceUsd: actualPriceUsd, bnbReceived, qtySold };
  }

  // ==================== 手工交易命令消费（P0-C） ====================

  /**
   * 手工交易命令队列消费（5s interval，live only）：web 落 manual_trade_requests 行，
   * 本进程 CAS 抢占（pending→executing）后走与策略交易同一执行路径。
   * 架构红线：web 进程绝不直接建 trader 交易——会与本引擎内存账本冲突（手工卖出后
   * 引擎仍触发卖腿→链上0→计连败→熔断误伤）；停机期命令滞留 pending（不执行不丢）。
   * 滞留清理：pending >10min 未消费 → expired；executing >10min（进程崩溃在执行中，
   * 一次链上操作上限 ~2min）→ failed（执行中断）。
   */
  async _consumeManualTrades() {
    if (this._isStopped || !this._trader) return;
    const { dbManager } = require('../../services/dbManager');
    const client = dbManager.getClient(); // service key（manual_trade_requests RLS 对 anon 全拒，红线③）
    const { data: rows, error } = await client
      .from('manual_trade_requests')
      .select('id, token_address, direction, amount_bnb, sell_pct, status, requested_at')
      .eq('experiment_id', this._experimentId)
      .in('status', ['pending', 'executing'])
      .order('requested_at', { ascending: true })
      .limit(10);
    if (error) throw new Error(`手工交易队列查询失败: ${error.message}`);
    if (!rows || rows.length === 0) return;

    const TTL_MS = 10 * 60 * 1000;
    for (const row of rows) {
      if (Date.now() - new Date(row.requested_at).getTime() > TTL_MS) {
        // 滞留清理（CAS 防并发误改）：pending 未消费 → expired；executing 滞留（进程
        // 崩溃残留，一次链上操作上限 ~2min）→ failed，分开归因
        const isCrashed = row.status === 'executing';
        const { error: upErr } = await client.from('manual_trade_requests')
          .update({
            status: isCrashed ? 'failed' : 'expired',
            executed_at: new Date().toISOString(),
            error: isCrashed ? '执行中断（引擎进程崩溃残留）' : '排队超时未执行（>10min）',
          })
          .eq('id', row.id)
          .eq('status', row.status);
        if (!upErr) {
          this.logger.warn(this._experimentId, 'ManualTrade',
            `手工交易命令滞留清理 | ${row.direction} ${row.token_address} → ${isCrashed ? 'failed' : 'expired'}`);
        }
        continue;
      }
      // executing 且未超时：本进程上一轮可能正在执行（interval 异步并发），跳过防重复
      if (row.status !== 'pending') continue;
      await this._processManualTradeRequest(row, client);
    }
  }

  /** 单条手工命令执行：互斥检查 → CAS 抢占 → 构造 signal 等价物执行 → 终态写回 */
  async _processManualTradeRequest(row, client) {
    const tokenAddress = row.token_address;
    const meta = { isManualTrade: true, manualRequestId: row.id };

    // 策略执行互斥：买/卖执行中的 token 本轮跳过（留 pending 下轮重试，不判失败）
    if (this._buyingTokens.has(tokenAddress) || this._sellingTokens.has(tokenAddress)) return;

    const { data: claimed } = await client.from('manual_trade_requests')
      .update({ status: 'executing' })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id');
    if (!claimed || claimed.length === 0) return; // 已被抢/已被清理

    const token = this._tokenPool.getToken(tokenAddress, 'bsc');
    const symbol = token?.symbol
      || this._factorAggregator.getTokenState(tokenAddress)?.symbol
      || tokenAddress.slice(0, 10);
    const priceUsd = this._manualTradePriceUsd(tokenAddress);

    let result;
    try {
      if (row.direction === 'buy') {
        // 手工买 fail-closed：FA 无该票价格状态（引擎未见过）→ 拒绝（L1 预成交锚缺失，
        // 与策略路径「宁可错过不可买错」同语义）；pool 无该票（买后状态无法推进）同样拒绝
        if (!(priceUsd > 0)) {
          result = { success: false, reason: 'FA 无该 token 价格状态（引擎未见过该票），手工买拒绝：L1 预成交锚缺失' };
        } else if (!token) {
          result = { success: false, reason: 'token 不在本实验监控池，手工买拒绝（买后状态无法推进）' };
        } else {
          result = await this._executeManualBuy(row, token, symbol, priceUsd, meta);
        }
      } else {
        result = await this._executeManualSell(row, symbol, priceUsd, meta);
      }
    } catch (error) {
      result = { success: false, reason: error.message || '手工交易执行异常' };
    }

    const patch = {
      status: result.success ? 'success' : 'failed',
      executed_at: new Date().toISOString(),
    };
    if (result.success) {
      patch.result = {
        tradeId: result.tradeId ?? null,
        txHash: result.txHash ?? null,
        qtySold: result.qtySold ?? null,
        bnbReceived: result.bnbReceived ?? null,
        priceUsd: result.priceUsd ?? null,
      };
    } else {
      patch.error = String(result.reason || '未知失败').slice(0, 2000);
    }
    await client.from('manual_trade_requests').update(patch).eq('id', row.id);

    if (result.success) {
      this.logger.info(this._experimentId, 'ManualTrade',
        `✅ 手工${row.direction === 'buy' ? '买' : '卖'}成交 | ${symbol} tx=${result.txHash}`);
    } else {
      this.logger.warn(this._experimentId, 'ManualTrade',
        `❌ 手工${row.direction === 'buy' ? '买' : '卖'}失败 | ${symbol} ${result.reason}`);
    }
  }

  /** FA 当前价（USD/token）：手工交易 L1 锚来源。无状态/无价返回 0 */
  _manualTradePriceUsd(tokenAddress) {
    const factors = this._factorAggregator.buildFactorMap(tokenAddress, Date.now());
    return Number(factors?.currentPrice) || 0;
  }

  /** 手工买：manualAmountBnb 显式金额走 _executeBuyLive，成功后补状态推进
   * （对齐 _evaluateBuyPath 成功分支；recordStrategyExecution/毕业竞态补卖不适用——
   * 手工买无策略、live 毕业走人工告警） */
  async _executeManualBuy(row, token, symbol, priceUsd, meta) {
    const tokenAddress = token.token;
    const signal = {
      action: 'buy',
      tokenAddress,
      symbol,
      chain: 'bsc',
      price: priceUsd,
      manualAmountBnb: Number(row.amount_bnb), // _buyAmountFor 最高优先（卡牌/tradeAmount 不经）
      strategyId: null,
      strategyName: '手工交易',
    };
    this._buyingTokens.add(tokenAddress);
    try {
      const result = await this._executeBuyLive(signal, null, meta);
      if (result.success) {
        const execPriceUsd = result.priceUsd || priceUsd;
        this._tokenPool.markAsBought(tokenAddress, 'bsc', {
          buyPrice: execPriceUsd,
          buyTime: Date.now(),
        });
        await this.dataService.updateTokenStatus(this._experimentId, tokenAddress, 'bought');
        const faState = this._factorAggregator.getTokenState(tokenAddress);
        this._factorAggregator.setBuyState(tokenAddress, {
          buyPriceBnb: faState?.currentPriceBnb || 0,
          buyPriceUsd: execPriceUsd,
          buyTime: Date.now(),
        });
      }
      return result;
    } finally {
      this._buyingTokens.delete(tokenAddress);
    }
  }

  /** 手工卖：_executeSell 完整复用（全清判定/卡账本/轮账本/markAsSold 熔断计数全套）；
   * 价格锚缺省容忍（断流票 FA 无价传 0 → 无绝对锚走 trader 相对滑点锚降级——应急清仓
   * 不能因无价拒绝）。毕业票（FA graduated）路由 PCS V2 外盘：TM2 毕业后 sellToken 必 revert */
  async _executeManualSell(row, symbol, priceUsd, meta) {
    const tokenAddress = row.token_address;
    const sellPct = Number(row.sell_pct);
    const signal = {
      action: 'sell',
      tokenAddress,
      symbol,
      chain: 'bsc',
      price: priceUsd || 0,
      sellPercentage: (Number.isFinite(sellPct) && sellPct > 0 && sellPct <= 1) ? sellPct : 1,
      strategyId: null,
      strategyName: '手工交易',
    };

    let traderOverride = null;
    const st = this._factorAggregator.getTokenState(tokenAddress);
    if (st?.graduated) {
      traderOverride = await this._ensurePcsTrader();
      this.logger.info(this._experimentId, 'ManualTrade', `毕业票手工卖路由 PCS V2 外盘 | ${symbol}`);
    }

    this._sellingTokens.add(tokenAddress);
    try {
      return await this._executeSell(signal, null, meta, traderOverride);
    } finally {
      this._sellingTokens.delete(tokenAddress);
    }
  }

  /** PCS V2 trader 懒加载（毕业票手工卖专用）：与主 trader 同钱包同发单 RPC——
   * 私钥从既有 wallet 对象取，不新增明文存储点 */
  async _ensurePcsTrader() {
    if (this._pcsTrader) return this._pcsTrader;
    const traderFactory = require('../traders');
    const rpcUrl = this._trader.network?.rpcUrl;
    this._pcsTrader = traderFactory.createTrader('pancakeswap-v2', rpcUrl ? { network: { rpcUrl } } : {});
    await this._pcsTrader.setWallet(this._trader.wallet.privateKey);
    this.logger.info(this._experimentId, 'ManualTrade',
      `PCS V2 trader 就绪（毕业票外盘卖）: ${this._pcsTrader.wallet.address}`);
    return this._pcsTrader;
  }

  /** 本腿买入金额（迁自 rich-js）：卡牌模式 = perCardBNB × 张数（cards ?? 1，现金门
   * 不足在 _calculateBuyAmount 返 0=买失败不降张）；旧模式 = 固定 tradeAmount。live
   * 用本方法取金额（链上余额门才是真门，不走 PM cash 镜像门）。
   * manualAmountBnb（P0-C 手工交易）最高优先：显式金额不经卡牌/tradeAmount 计价，
   * 配套卡账本跳过（金额非 perCard 计价，记卡必然失真） */
  _buyAmountFor(signal) {
    if (Number.isFinite(signal.manualAmountBnb) && signal.manualAmountBnb > 0) {
      return signal.manualAmountBnb;
    }
    if (this._cardsEnabled) {
      return new Decimal(this._perCardBNB).mul(signal.cards != null ? signal.cards : 1).toNumber();
    }
    return this._tradeAmount;
  }

  _calculateBuyAmount(signal) {
    const tradeAmount = this._buyAmountFor(signal);
    if (this.currentBalance < tradeAmount) {
      this.logger.warn(this._experimentId, '_calculateBuyAmount',
        `余额不足: 需要 ${tradeAmount}, 当前 ${this.currentBalance.toFixed(4)}`);
      return 0;
    }
    return tradeAmount;
  }

  // ==================== processSignal（支持已落库 signalId，语义同旧 Virtual 重写版）====================

  async processSignal(signal, existingSignalId = null) {
    if (!this._experiment) {
      throw new Error('引擎未初始化');
    }
    if (this._isStopped) {
      return { success: false, message: '引擎已停止' };
    }

    let signalId = existingSignalId;
    let signalRow = null; // INSERT 回读行（通知侧免 SELECT * 重复读，批次 4a）
    let result = { success: false, message: '交易未执行' };

    // 卖腿信号（及无预落库场景）在此创建；买腿信号已在 _evaluateBuyPath 落库
    if (!signalId) {
      const { TradeSignal } = require('../entities');
      const signalMetadata = {
        ...signal.metadata,
        ...(signal.factors || {}),
        price: signal.price,
        strategyId: signal.strategyId,
        strategyName: signal.strategyName,
      };
      const tradeSignal = new TradeSignal({
        experimentId: this._experimentId,
        tokenAddress: signal.tokenAddress,
        tokenSymbol: signal.symbol,
        signalType: signal.action.toUpperCase(),
        action: signal.action.toLowerCase(),
        confidence: signal.confidence || 0.5,
        reason: signal.reason || '',
        chain: signal.chain,
        metadata: signalMetadata,
        createdAt: signal.timestamp || new Date(),
      });
      signalId = await tradeSignal.save();
      signalRow = tradeSignal._insertedRow || null;
      this._registerSignalRow(signalId, tradeSignal._insertedRow);
    }

    const signalTime = signal.timestamp || new Date();
    const metadata = {
      signalId,
      loopCount: this._loopCount,
      timestamp: signalTime instanceof Date ? signalTime.toISOString() : signalTime,
      factors: signal.factors || null,
    };

    try {
      if (signal.action.toLowerCase() === 'buy') {
        result = await this._executeBuy(signal, signalId, metadata);
      } else if (signal.action.toLowerCase() === 'sell') {
        result = await this._executeSell(signal, signalId, metadata);
      } else {
        result = { success: false, message: `未知动作: ${signal.action}` };
      }

      await this._updateSignalStatus(signalId, result.success ? 'executed' : 'failed', result, signalRow);
    } catch (error) {
      this.logger.error(this._experimentId, 'processSignal',
        `信号执行失败 | signalId=${signalId} error=${error.message}`);
      await this._updateSignalStatus(signalId, 'failed', { message: error.message, error: error.stack }, signalRow);
      result = { success: false, message: error.message };
    }

    return result;
  }

  // ==================== 采集器回调 ====================

  /**
   * TokenCreate：新代币落库 experiment_tokens（_seenTokens 去重——token 地址全局唯一
   * 无跨平台碰撞；23505 容忍在 saveToken 内）。platform 实参来自 consumer 的
   * row.platform，双平台实验按其分派 record builder（单平台实验恒为本平台值）。
   */
  async _handleNewToken(info, platform = 'fourmeme') {
    const tokenKey = `${info.token}-bsc`;
    if (this._seenTokens.has(tokenKey)) return;
    this._seenTokens.add(tokenKey);

    const record = platform === 'flap'
      ? this._buildFlapTokenRecord(info)
      : this._buildFourMemeTokenRecord(info);

    try {
      await this.dataService.saveToken(this._experimentId, record);
    } catch (error) {
      this.logger.error(this._experimentId, 'NewToken',
        `新代币落库失败 | ${info.token} ${error.message}`);
      return;
    }

    // 行已确保存在后补采语料（fire-and-forget：four.meme API/重试百毫秒~10s 级，
    // 不阻塞采集回调；结果合并进 raw_api_data，叙事直调/预检查按新字段生效）
    this._enrichCorpus(info, platform);
  }

  /** four.meme TokenCreate 落库 payload（与旧基类 _handleNewToken 逐字段一致） */
  _buildFourMemeTokenRecord(info) {
    return {
      token: info.token,
      symbol: info.symbol || '',
      chain: 'bsc',
      platform: 'fourmeme',
      data_source: 'wss',
      created_at: Math.floor(info.blockTimeMs / 1000),
      raw_api_data: {
        source: 'wss_token_create',
        name: info.name,
        symbol: info.symbol,
        totalSupply: info.totalSupply,
        creator: info.creator,
        requestId: info.requestId,
        blockNumber: info.blockNumber,
        txHash: info.txHash,
      },
      creator_address: info.creator,
      status: 'monitoring',
    };
  }

  /** flap TokenCreated 落库 payload（与旧 FlapWss._handleNewToken 逐字段一致：总量 1e9 + flap 存档字段） */
  _buildFlapTokenRecord(info) {
    return {
      token: info.token,
      symbol: info.symbol || '',
      chain: 'bsc',
      platform: 'flap',
      data_source: 'wss',
      created_at: Math.floor(info.blockTimeMs / 1000),
      raw_api_data: {
        source: 'wss_token_create',
        name: info.name,
        symbol: info.symbol,
        totalSupply: 1e9,          // flap 内盘固定总量
        creator: info.creator,
        nonce: info.nonce,
        eventTs: info.eventTsSec,  // 事件自带秒级时间戳（年龄口径仍用块时间，仅存档）
        meta: info.meta,           // IPFS 元数据 URL
        taxToken: info.taxToken,   // 税币（地址后缀 7777）
        blockNumber: info.blockNumber,
        txHash: info.txHash,
      },
      creator_address: info.creator,
      status: 'monitoring',
    };
  }

  /**
   * 语料补采并落库（fire-and-forget，永不抛错）。
   * 双平台共用：platform 实参按 token 分派（flap 行传 'flap' + info.meta=IPFS URL）。
   */
  _enrichCorpus(info, platform) {
    if (!this._corpusEnricher) return;
    this._corpusEnricher.enrich(info.token, platform, info.meta)
      .then(corpusFields => {
        if (!corpusFields) return;
        //（语料内存镜像与就绪即评门已随 dataPrefetch 退役删除，C84 2026-10-17；
        // corpusFields 仍原样落库供叙事分析器语料链路消费）
        return this.dataService.updateTokenCorpus(this._experimentId, info.token, corpusFields)
          .then(ok => {
            if (ok) {
              const parts = [
                corpusFields.twitterUrl ? `twitter=${corpusFields.twitterUrl.slice(0, 50)}` : null,
                corpusFields.webUrl ? 'web=有' : null,
                corpusFields.description ? `descr=${String(corpusFields.description).slice(0, 20)}` : null,
              ].filter(Boolean).join(' ');
              this.logger.info(this._experimentId, 'NewToken',
                `📥 语料补采 | ${info.symbol || info.token.slice(0, 10)} ${parts || '(无语料字段)'}`);
            }
          });
      })
      .catch(error => this.logger.warn(this._experimentId, 'NewToken',
        `语料补采落库失败 | ${info.token} ${error.message}`));
  }

  /**
   * LiquidityAdded（毕业）：内盘曲线终结，此后不再有 TokenManager2 事件。
   * virtual 模式（2026-09-28 王之蔑视案裁定「2+1」）：持仓票直接触发毕业事件驱动
   * 全清（_emitGraduationSell，余仓按断流前最后可靠价落袋——冻结与全清估值同价
   * 只差 0.5% 费，全清额外释放 PM 资金与卡牌）。王之蔑视 0x7abcc1 毕业断流后
   * 余 3 卡冻结 4 天即此盲区首案：progress 峰值 88.9%（funds=14.2 非标准盘，
   * 72 固定锚失真）→ P3(≥0.9)/P8(≥0.98) 全程够不着，断流后 tick 驱动卖腿整体冻结。
   * live 模式持仓毕业 = 资金卡死在内盘（TM2 sellToken 毕业 revert），即时告警
   * 人工去 PancakeSwap 处置（恰恰爆款票才会毕业——最赚钱的仓位不能静默死仓）。
   */
  _handleGraduation(info) {
    this._factorAggregator.markGraduated(info.token);
    const token = this._tokenPool.getToken(info.token, 'bsc');
    if (token && token.status === 'bought') {
      if (this._isLive) {
        const qty = Number(this._getHolding(info.token)?.amount ?? 0);
        this._notifyLiveAlert('🎓 持仓代币毕业（需人工处置）',
          `${token.symbol} 已毕业（内盘曲线终结，funds=${info.fundsBnb} BNB）。` +
          `live 持仓 ${qty} 个代币已无法通过内盘卖出（TM2 毕业 revert，引擎不再收到该 token 的 tick）。` +
          `请尽快到 PancakeSwap 手动处置: ${info.token}`);
      } else {
        this._emitGraduationSell(token, info).catch(error =>
          this.logger.error(this._experimentId, 'Graduation',
            `毕业事件全清卖出失败 | ${info.token} ${error.message}`));
      }
    }
  }

  /**
   * 毕业事件驱动全清（virtual）：构造等价 strategy（与止损腿同构：cards='all'/
   * sellPercentage=1/bypassDebounce）直接走 _emitSellSignal 全清链——signals/trades/
   * 卡账本/累亏记账副作用全复用。选全清而非等价 P3+P8 卖 3/4 剩 1/4：virtual 冻结
   * 与全清估值同价只差 0.5% 费，全清释放 PM 资金与卡牌。卖出价 = 断流前最后可靠价
   * （buildFactorMap 的 _relPriceBnb）。幂等标记后置到卖出成功：卖出失败（DB/执行
   * 异常/恰在卖出中）不标记 → 持仓扫描兜底重试（盘古案 2026-09-28 前为「无重试
   * 路径」盲区）；并发双调被 _emitSellSignal 内 _sellingTokens 挡住，无重复卖出。
   */
  async _emitGraduationSell(token, info) {
    const tokenAddress = token.token;
    if (this._graduationSoldTokens.has(tokenAddress)) return; // graduation 事件重复派发幂等（实测同事件两遍）
    const factors = this._factorAggregator.buildFactorMap(tokenAddress, Date.now());
    if (!factors) return;
    const strategy = {
      id: 'graduationSell', name: '毕业事件全清',
      action: 'sell', sellPercentage: 1, cards: 'all', bypassDebounce: true,
      priority: 0, lockTokenAfterSell: false, maxExecutions: null, cumulativeLossLockPct: null,
    };
    this.logger.info(this._experimentId, 'Graduation',
      `${token.symbol || tokenAddress.slice(0, 10)} 毕业事件驱动全清 | funds=${info?.fundsBnb} BNB ` +
      `余仓按断流前最后可靠价落袋 graduationProgress=${factors.graduationProgress?.toFixed(3)}`);
    const result = await this._emitSellSignal(token, strategy, factors, null);
    if (result && result.success) this._graduationSoldTokens.add(tokenAddress);
    return result;
  }

  // ==================== 守护 intervals ====================

  /**
   * [wss-down-guard]（60s）：以 collector 消息心跳为准（getLastMessageAt——newHeads 持续
   * 推送，市场安静时也刷新；socket "已连接"可能僵尸，静默 = WSS 僵尸连接/RPC 断）。
   * 两级（自 watcher 迁回实验进程，2026-10-09）：
   *   ≥ downGuardSelfHealMs（默认 5min）→ 每轮踢 forceReconnect（幂等自愈）
   *   ≥ wssDownGuardMs（默认 15min）→ status='wss_down'；全部恢复且曾由本守护置位
   *   → 回写 'running'（本地标志绑定，绝不覆盖 stopped/error 等其他来源状态）
   */
  async _checkWssDownGuard() {
    if (this._status !== EngineStatus.RUNNING || this._isStopped) return;
    if (!this._collectors.length) return;

    let worstSilentMs = 0;
    let anyLast = false;   // 至少一个 collector 曾收到消息（区分「从未连接」与「断流后恢复」）
    let anyAnchor = false;
    for (const c of this._collectors) {
      const last = c.getLastMessageAt();
      const since = last || c.stats?.startTime || null;
      if (last) anyLast = true;
      if (!since) continue;
      anyAnchor = true;
      const silentMs = Date.now() - since;
      if (silentMs > worstSilentMs) worstSilentMs = silentMs;
      if (silentMs >= this._wssSelfHealMs) {
        // 静默超自愈阈值 = 僵尸连接（无 close 事件）：每轮守护主动踢一次强制重连（幂等）
        try {
          c.forceReconnect();
        } catch (e) {
          this.logger.error(this._experimentId, 'WssDownGuard', `强制重连失败: ${e.message}`);
        }
      }
    }
    if (!anyAnchor) return;

    if (worstSilentMs >= this._wssDownThresholdMs) {
      if (!this._wssDownFlagged) {
        this._wssDownFlagged = true;
        this.logger.error(this._experimentId, 'WssDownGuard',
          `WSS 断流（无消息心跳）超过阈值，实验状态置为 wss_down`,
          { silentMs: worstSilentMs, thresholdMs: this._wssDownThresholdMs });
        await this._updateExperimentStatus('wss_down');
      }
    } else if (this._wssDownFlagged && anyLast) {
      // 最差静默已回落到阈值之下 = 消息恢复流动（last 粘性，靠 silentMs 判恢复而非 last 非空）
      this._wssDownFlagged = false;
      this.logger.info(this._experimentId, 'WssDownGuard', 'WSS 已恢复收数，实验状态回写 running');
      await this._updateExperimentStatus('running');
    }
  }

  // ==================== 辅助 ====================

  /** 代币信息（购买前检查用；早期参与者检查只需要 innerPair；platform/innerPair 按 token 行分派） */
  _buildTokenInfo(token) {
    const platform = token.platform || this._wsPlatforms()[0];
    return {
      address: token.token,
      symbol: token.symbol,
      name: token.name || '',                 // 严格同名代币检查（AVE）匹配用
      chain: token.chain || 'bsc',
      platform,
      launchAt: token.createdAt || null,      // WSS: TokenCreate 块时间（秒）
      innerPair: `${token.token}_${platform === 'flap' ? 'fl' : 'fo'}`, // 内盘交易对（对齐 BacktestEngine 写法）
      pairAddress: token.pairAddress || null,
    };
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

  /**
   * 重启恢复：重放 trades 重建 PortfolioManager 持仓（与旧 Virtual 引擎同构）。
   * FA 锚点（buyPrice/buyTime）从最后一笔买入恢复；BNB 价不可从 trades 还原
   *（unitPrice 为 USD 口径），挂 _restoreAnchors 待重启后首个可靠 tick 落锚。
   */
  async _loadHoldings() {
    try {
      const trades = await this.dataService.getTrades(this._experimentId, { limit: 10000 });
      if (!trades || trades.length === 0) return;

      let lastBuyByToken = new Map();
      for (const trade of trades.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))) {
        if (!trade.success) continue;

        let tokenAmount, tokenPrice;
        if (trade.tradeDirection === 'buy' || trade.direction === 'buy') {
          tokenAmount = trade.outputAmount || 0;
          tokenPrice = trade.unitPrice || 0;
          lastBuyByToken.set(trade.tokenAddress, { price: tokenPrice, time: trade.createdAt });
        } else {
          tokenAmount = trade.inputAmount || 0;
          tokenPrice = trade.unitPrice || 0;
        }

        // 卡账本重放（迁自 rich-js）：cardTrade.after 是成交时点绝对值，后写覆盖先写、
        // 0 → 删卡。独立于下方 qty/price 有效性门（卡记账不依赖成交价存在）；
        // 旧 trades 无此键自动跳过；机制未启用天然无此键
        const _cardAfter = Number(trade.metadata?.cardTrade?.after);
        if (Number.isFinite(_cardAfter)) {
          if (_cardAfter > 0) this._tokenCards.set(trade.tokenAddress, _cardAfter);
          else this._tokenCards.delete(trade.tokenAddress);
        }

        if (!(tokenAmount > 0) || !(tokenPrice > 0)) continue;

        // E5d 重放版精度钳制 + 单票隔离（2026-09-29 Adventures 62897.70879672016 vs …720157 案）：
        //   DB 金额列是 double，实时链路 PM 20 位 Decimal 余量 Number 化落库后与重放 Decimal
        //   累加值存在 ~1e-12 相对尾差——全清腿卖量恰好略超持有量时被 PM 严格 lt 校验拒绝，
        //   旧代码此 throw 逃出循环 →「加载持仓失败」→ 全部持仓丢失（一票尾差全灭 49 票）。
        //   处理（与 E5d 执行路径修复同族，重放路径无法「不经 Number 往返」——DB 里只有 double）：
        //   ① 卖单重放遇 Insufficient 且差异 ≤ 相对 1e-9（double 往返固有误差量级，现金差额
        //      ~1e-10 BNB 可忽略）→ 钳到持有量重试（余量归零删仓 = 实时 sellPct=1 全清语义）；
        //      真超卖（更大差异 = 数据异常）不钳制，照常失败——不掩盖。
        //   ② 单票失败只跳过该票（error log 留痕），不再中断其余票的恢复。
        try {
          await this._portfolioManager.executeTrade(
            this._portfolioId,
            trade.tokenAddress,
            trade.tradeDirection || trade.direction,
            new Decimal(tokenAmount),
            new Decimal(tokenPrice),
            0.001,
          );
        } catch (error) {
          const direction = trade.tradeDirection || trade.direction;
          let handled = false;
          if (direction === 'sell' && /Insufficient token balance/.test(error.message)) {
            const pos = this._portfolioManager.getPortfolio(this._portfolioId)
              ?.positions.get(trade.tokenAddress.toLowerCase());
            const avail = pos ? pos.amount : null;
            if (avail != null && avail.gt(0)
              && new Decimal(tokenAmount).minus(avail).lte(avail.times(1e-9))) {
              await this._portfolioManager.executeTrade(
                this._portfolioId, trade.tokenAddress, 'sell', avail,
                new Decimal(tokenPrice), 0.001,
              );
              handled = true;
            }
          }
          if (!handled) {
            this.logger.error(this._experimentId, 'FourMemeWssTradingEngine',
              `⚠️ 持仓重放单票失败已跳过（其余票继续恢复）: ${trade.tokenAddress} ${direction} ${error.message}`);
          }
        }
      }

      const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);
      if (portfolio && portfolio.positions.size > 0) {
        for (const [addrLower] of portfolio.positions) {
          const lastBuy = lastBuyByToken.get(addrLower);
          if (lastBuy) {
            this._restoreAnchors.set(addrLower, {
              buyPriceUsd: lastBuy.price,
              buyTime: new Date(lastBuy.time).getTime(),
            });
          }
        }
        this.logger.info(this._experimentId, 'FourMemeWssTradingEngine',
          `📦 持仓加载完成: ${portfolio.positions.size} 个代币, 余额 ${portfolio.cashBalance.toFixed(4)}` +
          `（FA 锚点待重启后首个 tick 落位: ${this._restoreAnchors.size} 个）`);
      }
    } catch (error) {
      this.logger.error(this._experimentId, 'FourMemeWssTradingEngine', `❌ 加载持仓失败: ${error.message}`);
    }
  }

  /**
   * live 重启恢复（链上事实优先）：
   *   trades 重放账面（净数量 / 买入加权均价 USD / 最后一笔买入）→ 链上 balanceOf 对账
   *   （数量以链上为准；链上 0 = 已外部处置，跳过）→ cash = 链上可用 BNB 的 USD 等值 →
   *   tokenPool markAsBought + FA registerToken/锚点（重启后卖腿才能被 tick 路由触发）。
   */
  async _loadHoldingsLive() {
    const trades = await this.dataService.getTrades(this._experimentId, { limit: 10000 });
    const book = new Map(); // tokenAddress → { qty, costUsd, lastBuy: { priceUsd, timeMs } }
    for (const trade of (trades || []).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))) {
      if (!trade.success) continue;
      const isBuy = (trade.tradeDirection || trade.direction) === 'buy';
      const qty = Number(isBuy ? trade.outputAmount : trade.inputAmount) || 0;
      const price = Number(trade.unitPrice) || 0;

      // 卡账本重放（迁自 rich-js）：同 _loadHoldings，cardTrade.after 绝对值直写，
      // 独立于 qty/price 有效性门
      const _cardAfter = Number(trade.metadata?.cardTrade?.after);
      if (Number.isFinite(_cardAfter)) {
        if (_cardAfter > 0) this._tokenCards.set(trade.tokenAddress, _cardAfter);
        else this._tokenCards.delete(trade.tokenAddress);
      }

      if (!(qty > 0) || !(price > 0)) continue;

      const entry = book.get(trade.tokenAddress) || { qty: 0, costUsd: 0, lastBuy: null };
      if (isBuy) {
        entry.qty += qty;
        entry.costUsd += qty * price;
        entry.lastBuy = { priceUsd: price, timeMs: new Date(trade.createdAt).getTime() };
      } else if (entry.qty > 0) {
        // 卖出按剩余比例摊减成本（与 PortfolioManager 卖出记账语义一致）
        const remainRatio = Math.max(0, (entry.qty - qty) / entry.qty);
        entry.costUsd *= remainRatio;
        entry.qty *= remainRatio;
      }
      book.set(trade.tokenAddress, entry);
    }

    // 链上对账 + 持仓注入（数量以链上为准）
    const positions = [];
    const anchorSources = [];
    for (const [tokenAddress, entry] of book) {
      if (!(entry.qty > 0)) continue;
      const avgPriceUsd = entry.costUsd / entry.qty;

      const onChainQty = await this._getOnChainTokenBalance(tokenAddress);
      if (onChainQty !== null && onChainQty <= 0) {
        this.logger.warn(this._experimentId, 'FourMemeWssTradingEngine',
          `⚠️ 恢复跳过：链上余额为 0（已外部处置）| ${tokenAddress} 账面 ${entry.qty}`);
        continue;
      }
      const finalQty = onChainQty ?? entry.qty; // 查询失败保守用账面
      if (onChainQty !== null && Math.abs(onChainQty - entry.qty) / entry.qty > 0.01) {
        this.logger.warn(this._experimentId, 'FourMemeWssTradingEngine',
          `⚠️ 恢复数量偏差>1%：链上 ${onChainQty} vs 账面 ${entry.qty}（以链上为准）| ${tokenAddress}`);
      }
      positions.push({
        tokenAddress,
        amount: finalQty,
        price: avgPriceUsd || entry.lastBuy?.priceUsd || 0,
      });
      anchorSources.push({ tokenAddress, avgPriceUsd, lastBuy: entry.lastBuy });
    }

    // cash = 链上可用 BNB 的 USD 等值（组合记账口径与虚拟版一致：USD 名义）
    await this._reconcileLiveCash();

    if (positions.length > 0) {
      await this._portfolioManager.setInitialPositions(this._portfolioId, positions);
      await this._restoreLiveTokens(anchorSources);
    }

    const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);
    const cashStr = portfolio?.cashBalance?.toFixed?.(2) ?? String(portfolio?.cashBalance ?? 0);
    this.logger.info(this._experimentId, 'FourMemeWssTradingEngine',
      `📦 live 持仓恢复完成: ${positions.length} 个代币, cash=${cashStr} USD 名义（BNB/USD≈${this._getBnbUsd()}）`);
  }

  /** 恢复代币的池/FA 状态：experiment_tokens 元数据 → registerToken / addToken / markAsBought / 锚点 */
  async _restoreLiveTokens(anchorSources) {
    const { dbManager } = require('../../services/dbManager');
    const supabase = dbManager.getClient();
    const { data: metaRows } = await supabase
      .from('experiment_tokens')
      .select('token_address, token_symbol, created_at, raw_api_data, creator_address, platform')
      .eq('experiment_id', this._experimentId)
      .in('token_address', anchorSources.map(a => a.tokenAddress));
    const metaByAddr = new Map((metaRows || []).map(r => [r.token_address, r]));

    for (const { tokenAddress, avgPriceUsd, lastBuy } of anchorSources) {
      const meta = metaByAddr.get(tokenAddress) || {};
      const createdAtSec = meta.created_at ? new Date(meta.created_at).getTime() / 1000 : null;

      this._factorAggregator.registerToken(tokenAddress, {
        createdAtMs: createdAtSec ? createdAtSec * 1000 : undefined,
        totalSupply: Number(meta.raw_api_data?.totalSupply) || 0,
        symbol: meta.token_symbol || '',
        creatorAddress: meta.creator_address || meta.raw_api_data?.creator || null,
        platform: meta.platform || undefined, // 平台真值（write-once；DB 缺列=不写与旧行为一致）
      });
      // platform 口径（우땅이 卖出分派错案 2026-10-14）：恢复持仓的平台归属取 DB 真值
      // （experiment_tokens.platform，买入落库时写入）——此前恒 _wsPlatforms()[0]，双平台
      // 实验把 flap 票冒充 fourmeme → _liveTraderFor 卖出分派 FourMemeDirectTrader →
      // four.meme 合约 revert「代币由不同的 TokenManager 管理」（对 flap token 查询
      // manager=0x0）。DB 缺 platform 且单平台实验才回退首平台（=唯一平台，语义无损）；
      // 双平台缺列 → null 不冒充（卖侧分派 fail-closed throw 拒盲发，绝不发错协议）
      const restorePlatform = meta.platform
        || (this._wsPlatforms().length === 1 ? this._wsPlatforms()[0] : null);
      this._tokenPool.addToken({
        token: tokenAddress,
        chain: 'bsc',
        platform: restorePlatform,
        data_source: 'wss',
        name: meta.raw_api_data?.name || '',
        symbol: meta.token_symbol || '',
        created_at: createdAtSec,
        current_price_usd: null,
        creator_address: meta.creator_address || meta.raw_api_data?.creator || null,
      });

      const buyTime = lastBuy?.timeMs || Date.now();
      const buyPriceUsd = avgPriceUsd || lastBuy?.priceUsd || 0;
      this._tokenPool.markAsBought(tokenAddress, 'bsc', { buyPrice: buyPriceUsd, buyTime });
      // FA 锚点：USD 价用账面记录，BNB 锚点等重启后首个可靠 tick 落位（_onFactorsUpdated 内处理）
      this._restoreAnchors.set(tokenAddress, { buyPriceUsd, buyTime });
    }
  }

  /** 引擎运行状态（collectors/FA/组合，监控用） */
  getStats() {
    return {
      engine: {
        id: this._id,
        mode: this._mode,
        status: this._status,
        loopCount: this._loopCount,
        isLive: this._isLive,
        walletAddress: this._isLive ? this._walletAddress : null,
        bnbUsd: this._isLive ? this._getBnbUsd() : null,
        sellCooldown: this._isLive ? this._sellCooldownUntil.size : 0,
      },
      metrics: { ...this.metrics },
      collectors: this._collectors.map(c => ({
        platform: c._platformLabel,
        lastMessageAt: c.getLastMessageAt(),
        stats: c.getStats(),
      })),
      senderResolver: this._senderResolver ? this._senderResolver.getStats() : null,
      eventWriter: this._eventWriter ? this._eventWriter.getStats() : null,
      factorAggregator: this._factorAggregator ? this._factorAggregator.getStats() : null,
      tokenPool: this._tokenPool ? this._tokenPool.getStats() : null,
      debouncePending: this._buyDebouncer ? this._buyDebouncer.size : 0,
      sellDebounce: this._sellConfirmDebouncer
        ? { pending: this._sellConfirmDebouncer.size, ...this._sellConfirmDebouncer.stats } : null,
      buying: this._buyingTokens.size,
      selling: this._sellingTokens.size,
      tokenLocks: this._tokenLocks.size,
      wssDownFlagged: this._wssDownFlagged,
      balance: this.currentBalance,
    };
  }
}

module.exports = { FourMemeWssTradingEngine };
