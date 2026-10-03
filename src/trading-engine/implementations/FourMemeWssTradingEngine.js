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
 *   - 时序快照 30s 一轮，只记录最近 timeSeriesActiveWindowMs 内有 tick 的活跃代币
 *     （旧引擎 10s 轮询对全池记录）。
 */

const { TradingMode, EngineStatus } = require('../interfaces/ITradingEngine');
const { AbstractTradingEngine } = require('../core/AbstractTradingEngine');
const { ExperimentDataService } = require('../../web/services/ExperimentDataService');
const Logger = require('../../services/logger');
const Decimal = require('decimal.js');

// 基础配置（实验级 fourmemeWs 段在 _initializeDataSources 中合并覆盖）
const baseConfig = require('../../../config/default.json');

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
    this._consumer = null;              // SharedTickConsumer（watcher 架构：DB 增量消费，无 WSS 连接）
    this._preBuyCheckService = null;
    this._strategyEngine = null;

    // 运行状态
    this._seenTokens = new Set();        // 已落库 experiment_tokens 的 `${token}-bsc`
    this._buyingTokens = new Set();      // 买路径执行中（预检查+记账期间防重入）
    this._sellingTokens = new Set();     // 卖路径执行中防重入（tick 密集，必须有）
    this._restoreAnchors = new Map();    // 重启恢复的持仓锚点 tokenAddress → { buyPriceUsd, buyTime }
    this._intervals = {};
    this._wssDownFlagged = false;

    // live 执行层状态（Phase 5）
    this._trader = null;                 // FourMemeDirectTrader（live 专用）
    this._walletAddress = null;
    this._lastKnownBnbUsd = 0;           // 最近一次 BNB/USD（live 60s interval 刷新，启动时 trader 直读一次）
    this._sellCooldownUntil = new Map(); // 卖出失败冷却 tokenAddress → untilTs（live 防 gas 消耗风暴）
    this._sellFailStreak = new Map();    // 卖出连续失败计数 tokenAddress → 连败数（熔断判定输入）

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
    const { SellConfirmDebouncer } = require('../core/SellConfirmDebouncer');
    this._sellConfirmDebouncer = new SellConfirmDebouncer({
      debounceMs: this._sellDebounceMs,
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
    this._pruneIntervalMs = this._wsConfig.pruneIntervalMs ?? 5 * 60 * 1000;
    this._pruneMaxAgeMs = this._wsConfig.pruneMaxAgeMs ?? 30 * 60 * 1000;
    this._timeSeriesIntervalMs = this._wsConfig.timeSeriesIntervalMs ?? 30 * 1000;
    this._timeSeriesActiveWindowMs = this._wsConfig.timeSeriesActiveWindowMs ?? 60 * 1000;
    this._wssDownThresholdMs = this._wsConfig.wssDownGuardMs ?? 15 * 60 * 1000;

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
    this._narrativeCaller = new NarrativeDirectCaller();
    // 叙事否决短路集（2026-09-27 用户裁定：叙事评级确认为 low 的代币不再重复生成
    // 买信号——每次 fire 白落 signal 行 + 全套 preBuyCheck；address-fail 宣告竞态
    // 盘的豁免见 shouldBlockOnNarrative。内存语义：重启丢失后首个 fire 重新调叙事
    // （缓存命中秒回）重新登记，代价一条 signal 行）
    this._narrativeBlockedTokens = new Set();
    // 毕业事件全清幂等集（2026-09-28 王之蔑视案裁定「2+1」）：graduation 事件实测重复
    // 派发两遍 → Set 挡第二次触发；内存语义与 _narrativeBlockedTokens 同款——重启丢失
    // 安全（事件不重放，重启后无仓则不触发、已卖则 status 已变）
    this._graduationSoldTokens = new Set();
    this._shouldBlockOnNarrative = shouldBlockOnNarrative;
    // 挂 this：解构是 _initializeDataSources 函数级作用域，_evaluateBuyPath 裸引用会
    // ReferenceError（2026-09-27 蝴蝶轮回案：60 次 BUY 信号全挂「mapGmgnRiskFactors is not defined」）
    this._mapGmgnRiskFactors = mapGmgnRiskFactors;

    // 1.5.1 同叙事龙头已火检查（narrativeLeaderHot 因子：直调拿到 sourceTweetId 后查
    // 同源推文其余代币的峰值涨幅，火门槛 5x + 首达后 24h 拒绝窗口；详见 SameNarrativeLeaderService 头注）
    const { SameNarrativeLeaderService } = require('../pre-check/SameNarrativeLeaderService');
    this._sameNarrativeLeaderService = new SameNarrativeLeaderService(supabase, this.logger);

    // 1.6 叙话语料补采（新代币入池时抓平台附属信息进 raw_api_data；
    // 配置段 corpusEnrich（默认/实验级覆盖经 _mergedWsConfig 合并；flap 子类同键生效））
    const { TokenCorpusEnricher } = require('../core/TokenCorpusEnricher');
    this._corpusEnricher = new TokenCorpusEnricher(
      this._mergedWsConfig().corpusEnrich || {}, this.logger, this._experimentId);

    // 2. 代币池（FA 自带趋势序列，池不再需要价格/持有者历史缓存）
    this._tokenPool = new TokenPool(this.logger);
    this.logger.info(this._experimentId, 'FourMemeWssTradingEngine', '✅ 代币池初始化完成');

    // 3. 因子聚合器 + 事件链路
    // （键名固定 fourmemeWs：FA 仅读该节的 maxTrackedTokens，flap 子类传 flap merged 配置同键）
    const FourMemeFactorAggregator = require('../../services/FourMemeFactorAggregator');
    // cycle 判定配置化（2026-09-28）：实验级显式入口 tokenCycle.params 并入 factorParams，
    // 三级合并最高优先级（FACTOR_PARAM_DEFAULTS < ws.factorParams < tokenCycle.params）；
    // 不带 params 的存量实验 mapCycleParams 返回 {} 行为零变化。flap/both 同此处注入
    const { mapCycleParams } = require('../../strategies/group-variables');
    const wsMerged = this._mergedWsConfig();
    wsMerged.factorParams = {
      ...(wsMerged.factorParams || {}),
      ...mapCycleParams(this._experiment?.config?.tokenCycle?.params),
    };
    this._factorAggregator = new FourMemeFactorAggregator(
      { fourmemeWs: wsMerged }, this.logger);
    this._factorAggregator.on('factorsUpdated', (data) => this._onFactorsUpdated(data));
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
      // live token 分类预热（BSC live 无 ticks 缓冲恒 no-op——watcher 架构 DB 即真相；保留结构对齐母版）
      this._tokenPositionAnalyzer.prewarmLiveTokenProfiles(supabase)
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

    // 4. 共享流消费者（watcher 架构：实验不再持有 WSS 连接，从 wss_events / wss_price_ticks
    //    增量消费常驻 watcher 落库的同一份数据流；FA/pool 分发与旧 collector 内嵌路径等价）
    const { SharedTickConsumer } = require('../core/SharedTickConsumer');
    this._consumer = new SharedTickConsumer({
      platforms: this._wsPlatforms(),
      pollIntervalMs: this._mergedWsConfig().consumer?.pollIntervalMs,
      minTickBnb: this._mergedWsConfig().minTickBnb,
      factorAggregator: this._factorAggregator,
      tokenPool: this._tokenPool,
      onTokenCreate: (info, platform) => this._handleNewToken(info, platform),
      onGraduation: (info) => this._handleGraduation(info),
      logger: this.logger,
      experimentId: this._experimentId,
    });
    this.logger.info(this._experimentId, 'FourMemeWssTradingEngine', '✅ SharedTickConsumer 初始化完成');

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
          narrativeCallCondition: s.narrativeCallCondition || null,
          // 卡牌仓位（迁自 rich-js）：cards/cooldownSec 原样透传，loadStrategies 内归一化
          //（正整数/卖腿 'all'，脏值 → null=旧语义）；cooldownSec 独立于卡牌机制生效
          cards: s.cards,
          cooldownSec: s.cooldownSec,
          // 组路由（策略库一期，2026-09-28）：groups 表达式透传（loadStrategies 内
          // 归一 + 校验）；存量 cycle 数字仍在 normalizeGroups 内转换为等价表达式
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
          // 组路由（策略库一期，2026-09-28）：groups 表达式透传（loadStrategies 内
          // 归一 + 校验）；存量 cycle 数字仍在 normalizeGroups 内转换为等价表达式
          groups: s.groups,
          cycle: s.cycle,
          enabled: true,
        });
      });
    }
    // 未知因子 fail-fast（2026-10-03 hg55 事故裁定）：condition/narrativeCall 用 FA
    // 因子集校验；preBuy/repeat 买检查用 PreBuyCheckService 评估上下文键集校验
    //（别名防与本方法早前第 2 步的 PreBuyCheckService 声明重复）
    const { PreBuyCheckService: _PreBuyCheckService } = require('../pre-check/PreBuyCheckService');
    this._strategyEngine.loadStrategies(strategyArray, availableFactorIds,
      new Set(_PreBuyCheckService.getConditionFactorKeys()));

    // 累亏闩锁阈值：取卖腿 cumulativeLossLockPct 最大值（多腿并存时最严者先锁，fail-closed 方向）；
    // 未配置任何腿 = null = 机制关闭（存量实验零变化）
    const _cumLocks = this._strategyEngine.getAllStrategies()
      .filter(s => s.action === 'sell' && s.cumulativeLossLockPct != null)
      .map(s => s.cumulativeLossLockPct);
    this._cumLossLockPct = _cumLocks.length > 0 ? Math.max(..._cumLocks) : null;
    this.logger.info(this._experimentId, 'FourMemeWssTradingEngine',
      `✅ 策略引擎初始化完成，加载了 ${this._strategyEngine.getStrategyCount()} 个策略`);

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

    // 6.6 行为周期分桶（卖出臂周期路由，2026-09-28 用户思路 v1）：tokenCycle 段存在且
    //   enforce=true → 每 tick 把 factors.tokenCycle 写进 token.cycleTag，带 cycle 腿按桶
    //   路由（evaluate 内过滤）；缺段 = 不写 cycleTag = 带 cycle 腿全隐（fail-closed，
    //   止损双腿兜底），不带 cycle 腿恒可见（存量实验零变化）
    this._cycleEnforce = !!(experimentConfig.tokenCycle && experimentConfig.tokenCycle.enforce);
    if (this._cycleEnforce) {
      const _cycled = this._strategyEngine.getAllStrategies().filter(s => s.groups != null).length;
      this.logger.info(this._experimentId, 'FourMemeWssTradingEngine',
        `🔁 周期路由已启用（enforce）| 标注 groups 的腿=${_cycled}/${this._strategyEngine.getStrategyCount()} | 桶标签=token.cycleTag（FA _cycleFactors 判定）`);
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
   *  引擎级单值参数（debounce 等）不按平台合并，flapWs 独有键全是 watcher 侧消费） */
  _wsConfigSectionName() {
    return 'fourmemeWs';
  }

  /**
   * 消费平台集合（SharedTickConsumer 本地过滤 ticks/events 用）。
   * 基类按 experiment.config.platform 归一化（'both' → 双平台；flap 子类覆盖为 ['flap']）。
   * 构造期 _experiment 未注入时返回 ['fourmeme']，与旧行为一致；consumer 在
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

  // ==================== live 执行层（Phase 5：FourMemeDirectTrader / FlapPortalTrader）====================

  /** live trader 类型（TraderFactory 注册名）；flap 子类覆盖为 'flap' */
  _liveTraderType() {
    return 'fourmeme';
  }

  /**
   * live 交易器初始化：钱包配置校验 → 私钥解密 → trader（类型按平台分派）→
   * 地址一致性校验（私钥推导地址 ≠ 配置地址 = 配置错误，fail-fast）→
   * 链上连通性探测 + BNB/USD 启动锚定。
   */
  async _initializeLiveTrader() {
    // 双平台 live 禁止（防线三：web-server 400 / main.js throw 之外的兜底，防未来新入口；
    // trader 引擎级单例也无法承载双平台）
    if (this._wsPlatforms().length > 1) {
      throw new Error('双平台实验不支持 live（仅 virtual/backtest）');
    }
    const walletConfig = this._experiment?.config?.wallet;
    if (!walletConfig?.address || !walletConfig?.privateKey) {
      throw new Error('live 实验缺少钱包配置 (config.wallet.address / config.wallet.privateKey)');
    }
    this._walletAddress = walletConfig.address;

    const { CryptoUtils } = require('../../utils/CryptoUtils');
    let privateKey;
    try {
      privateKey = new CryptoUtils().decrypt(walletConfig.privateKey);
    } catch (error) {
      throw new Error(`钱包私钥解密失败: ${error.message}`);
    }

    const traderFactory = require('../traders');
    const traderConfig = { blockchain: 'bsc', chain: 'bsc' };
    // 发单 RPC：ankr（与 WSS 同源账号）优先，否则 BaseTrader 内置公共节点
    if (process.env.ANKR_API_KEY) {
      traderConfig.network = { rpcUrl: `https://rpc.ankr.com/bsc/${process.env.ANKR_API_KEY}` };
    }
    this._trader = traderFactory.createTrader(this._liveTraderType(), traderConfig);
    this._trader.txWaitTimeoutMs = this._liveTxWaitTimeoutMs;
    await this._trader.setWallet(privateKey);

    const derivedAddress = this._trader.wallet?.address;
    if (!derivedAddress || derivedAddress.toLowerCase() !== this._walletAddress.toLowerCase()) {
      throw new Error(
        `钱包地址不一致: 私钥推导 ${derivedAddress} ≠ 配置 ${this._walletAddress}（检查 config.wallet）`);
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

  /** 当前 BNB/USD（live：60s interval 刷新 _lastKnownBnbUsd；virtual：无 collector 后不再用此价） */
  _getBnbUsd() {
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
    await this._consumer.start();

    // live BNB/USD 接力刷新（60s；watcher 架构下 collector 不在实验进程，由本引擎承担——
    // virtual 无 _trader 不需要，价格 USD 换算已在 watcher 侧完成随 tick 行下发）
    if (this._isLive) {
      this._fetchBnbUsdOnce();
      this._intervals.bnbUsd = setInterval(() => {
        this._fetchBnbUsdOnce();
      }, 60 * 1000);
    }

    // 30s 时序快照（experiment_time_series_data 30s 节奏 + 组合快照）
    this._intervals.timeSeries = setInterval(() => {
      this._recordTimeSeriesSnapshot().catch(err => {
        this.logger.error(this._experimentId, 'TimeSeries', `时序快照失败: ${err.message}`);
      });
    }, this._timeSeriesIntervalMs);

    // 定期统计（experiments.stats，间隔来自实验配置，默认 30min）
    this._intervals.stats = setInterval(() => {
      this._checkAndCalculateStats().catch(err => {
        this.logger.error(this._experimentId, 'Stats', `定期统计失败: ${err.message}`);
      });
    }, this._statsInterval || 30 * 60 * 1000);

    // [wss-down-guard] 数据断供守护（60s）：消费心跳停滞 ≥ 阈值 → status='wss_down'（自愈已迁 watcher）
    this._intervals.wssDownGuard = setInterval(() => {
      this._checkWssDownGuard().catch(err => {
        this.logger.error(this._experimentId, 'WssDownGuard', `检查失败: ${err.message}`);
      });
    }, 60 * 1000);

    // FA 陈旧状态清理（持仓保护）
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
    }

    // 止损双腿持仓扫描（断流兜底）：断流 token 无 tick → tick 驱动的止损/卖腿全部冻结，
    // 扫描周期性重建因子判止损。stopLoss 段配置才起（存量实验零变化）
    if (this._stopLossEnabled && this._stopLossScanMs != null) {
      this._intervals.stopLossScan = setInterval(() => {
        this._scanHoldingsStopLoss().catch(err => {
          this.logger.error(this._experimentId, 'StopLoss', `持仓止损扫描异常: ${err.message}`);
        });
      }, this._stopLossScanMs);
    }

    // 不阻塞：main.js 在 start() 返回后注册优雅退出；WSS 连接 + intervals 保活事件循环
    this.logger.info(this._experimentId, 'FourMemeWssTradingEngine',
      `🚀 事件循环已启动（debounce=${this._signalDebounceMs}ms maxWait=${this._signalDebounceMaxWaitMs}ms ` +
      `时序=${this._timeSeriesIntervalMs / 1000}s 断流阈值=${this._wssDownThresholdMs / 60000}min），等待 WSS 事件...`);
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

  _shouldRecordTimeSeries() {
    return true;
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

    // 停消费者（清轮询 interval；WSS 由常驻 watcher 持有，不随实验停启）
    if (this._consumer) {
      await this._consumer.stop();
      this.logger.info(this._experimentId, 'FourMemeWssTradingEngine', '⏹️ SharedTickConsumer 已停止');
    }

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

    // 行为周期分桶（2026-09-28）：tokenCycle 写进 token.cycleTag 供 evaluate 桶路由
    //（_evaluateSellPath/买腿去抖重评传同一 token 对象引用）。仅 enforce 实验写；
    // null（证据不足）也写——带 cycle 腿全隐 fail-closed
    if (this._cycleEnforce) token.cycleTag = factors.tokenCycle ?? null;

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
      this._scheduleDebouncedBuy(tokenAddress, tick);
    }
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
    // 周期路由同步（fire 时刻 buildFactorMap 已推进 latch；避免 cycleTag 滞后末 tick 一拍）
    if (this._cycleEnforce) token.cycleTag = factors.tokenCycle ?? null;
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

      const latestPrice = factorResults.currentPrice || 0;
      if (!(latestPrice > 0)) {
        return { success: false, reason: '无有效价格（USD 换算未就绪）' };
      }

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
            ...signal.factors,
          },
        });
        signalId = await tradeSignal.save();
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
        this.logger.info(this._experimentId, 'BuyEval',
          `叙事评级直调 | ${token.symbol} rating=${narrativeCallInfo.numericRating}(${narrativeCallInfo.rating})` +
          ` ${narrativeCallInfo.durationMs}ms fromCache=${narrativeCallInfo.fromCache}` +
          (narrativeCallInfo.error ? ` error=${narrativeCallInfo.error}` : ''));

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
          const tokenInfo = this._buildTokenInfo(token);
          let preBuyCheckCondition = currentRound === 0
            ? strategy.preBuyCheckCondition
            : strategy.repeatBuyCheckCondition;
          preBuyCheckCondition = String(preBuyCheckCondition).trim();

          const lastPairReturnRate = this._tokenPool.getLastPairReturnRate(token.token, token.chain || 'bsc');

          // 总供应量：FA（TokenCreate）优先，兜底 fdv/price
          const faState = this._factorAggregator.getTokenState(token.token);
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
              narrativeLeaderHot: narrativeLeaderInfo?.factors?.narrativeLeaderHot ?? 0, // 同叙事龙头链路；无 tweet/失败=0 放行
              narrativeLeaderCount: narrativeLeaderInfo?.factors?.narrativeLeaderCount ?? 0,
              narrativeLeaderMaxMultiple: narrativeLeaderInfo?.factors?.narrativeLeaderMaxMultiple ?? 0,
              // GMGN 风险因子（x-0 案）：直调链路同次 getTokenInfo 带出发币史/捆绑钱包；
              // 未触发/失败/未索引 → covered=0 + 0 值放行（宁漏拦不误杀）
              ...this._mapGmgnRiskFactors(narrativeCallInfo?.gmgnRisk),
              tweetAuthorType: factorResults.tweetAuthorType ?? 0,
              dataCollectionRound: factorResults.dataCollectionRound ?? 0,
              totalSupply: totalSupply,
              // 平台标签（router 平台分门）：FA state（SharedTickConsumer registerToken
              // 传入）优先，factorResults（buildFactorMap platform 键）双保险
              platform: faState?.platform || factorResults.platform || null,
            },
          );

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

      // ── 预检查通过：补全信号元数据后执行 ──
      if (preBuyCheckResult && signalId) {
        try {
          await this._updateSignalMetadata(signalId, {
            tokenCreateTime,
            trendFactors: buildFactorValuesForTimeSeries(factorResults),
            tpaFactors: buildTpaFactorSnapshot(factorResults),
            narrativeCall: narrativeCallInfo,
            narrativeLeaderCheck: narrativeLeaderInfo,
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

        // FA 持仓锚点（per-position 止盈/止损因子原料；单仓 'default'）
        const faState = this._factorAggregator.getTokenState(token.token);
        this._factorAggregator.setBuyState(token.token, {
          buyPriceBnb: faState?.currentPriceBnb || 0,
          buyPriceUsd: execPriceUsd,
          buyTime: Date.now(),
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

        this.logger.info(this._experimentId, 'BuyEval',
          `✅ 买入成功${this._isLive ? '(live)' : ''} | ${token.symbol} price=${execPriceUsd.toExponential(4)} amount=${this._buyAmountFor(signal)}${this._cardsEnabled ? `(${signal.cards ?? 1}卡)` : ''} 余额=${this.currentBalance.toFixed(4)}`);
        return { success: true };
      }

      return { success: false, reason: result?.reason || result?.message || '交易执行失败' };
    } finally {
      this._buyingTokens.delete(tokenAddress);
    }
  }

  // ==================== 卖路径 ====================

  /**
   * 引擎级止损双腿判定（配置 stopLoss 段启用；纯读 factors 不动状态）。
   * 返回命中描述或 null；price 先判（两条同时命中时标注更深的那条，全清同效）。
   * 因子口径与策略腿同源：profitPercent=相对 FA buyState 成本（%）/ holdDuration=秒。
   * 时间腿 <=0 而非 <0：断流冻结票 FA 价格不动 profit 恒 0，<0 永不触发（盘古案盲区）
   */
  _stopLossHit(factors) {
    if (!this._stopLossEnabled) return null;
    const profit = factors.profitPercent;
    const hold = factors.holdDuration;
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
   * 持仓止损扫描（stopLoss.scanIntervalSec 驱动）：断流 token 无 tick →
   * _onFactorsUpdated 永不进 → tick 驱动的止损/策略腿全部冻结（c5945f36 11 票
   * 冻结实跑实证）。扫描只判止损双腿、不跑策略腿——P1-P8 在断流票上维持
   * 「不评估」现状语义。buildFactorMap 必须传 Date.now()：断流期 holdDuration
   * 继续走（回落 lastTickAt 会冻结时钟因子，见 _onSellDebounceFire 注释）。
   * 串行执行（一次扫描内逐 token await，避免卖出风暴）
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
      // 周期路由同步点（断流票 stale 降档）：buildFactorMap 顺带推进 _cycleLatch，
      // 此处把结果写进 token.cycleTag（恢复零星 tick 后 evaluate 用最新档）
      if (this._cycleEnforce) token.cycleTag = factors.tokenCycle ?? null;
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
      }
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
    // 周期路由同步（fire 时刻 buildFactorMap 已推进 latch；避免 cycleTag 滞后末 tick 一拍）
    if (this._cycleEnforce) token.cycleTag = factors.tokenCycle ?? null;

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

  async _executeSell(signal, signalId = null, metadata = {}) {
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
        result = await this._executeSellLive(signal, signalId, metadata, holding, sellPct);
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
      // 卡牌模式：逐腿金额 = perCardBNB × 张数（不走 _calculateBuyAmount 的 PM cash 门，
      // live 真金白银以链上余额检查为准）
      const amountInBNB = this._buyAmountFor(signal);
      if (!(amountInBNB > 0)) {
        return { success: false, reason: 'tradeAmount 未配置或为 0' };
      }

      // 卡账本（迁自 rich-js）：after 绝对值先写 trade metadata，成交才落 Map
      let cardTrade = null;
      if (this._cardsEnabled) {
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

      const buyResult = await this._trader.buyToken(signal.tokenAddress, amountInWei, options);
      if (!buyResult.success) {
        return { success: false, reason: buyResult.error || 'live 买入交易失败' };
      }

      // 实际成交数量：receipt 解析为准，失败按信号价估算（bnbUsd 沿用上方锚定值）
      let actualTokenAmount = parseFloat(buyResult.actualAmountOut);
      if (!isFinite(actualTokenAmount) || actualTokenAmount <= 0) {
        const fallbackPrice = signal.price || 0;
        actualTokenAmount = fallbackPrice > 0
          ? new Decimal(amountInBNB).div(fallbackPrice).toNumber() : 0;
        this.logger.warn(this._experimentId, '_executeBuyLive',
          `实际成交数量未知（receipt 解析失败），按信号价估算 ${actualTokenAmount}`);
      }
      if (!(actualTokenAmount > 0)) {
        return { success: false, reason: `成交数量无效: ${buyResult.actualAmountOut}` };
      }
      const actualPriceUsd = bnbUsd > 0
        ? new Decimal(amountInBNB).mul(bnbUsd).div(actualTokenAmount).toNumber()
        : (signal.price || 0);

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

      return { success: true, tradeId, txHash: trade.txHash, trade, priceUsd: actualPriceUsd };
    } catch (error) {
      this.logger.error(this._experimentId, '_executeBuyLive', `异常 | ${error.message}`);
      return { success: false, reason: error.message || 'live 买入执行异常', error: error.message };
    }
  }

  /**
   * live 卖出：链上余额预查（账面 > 链上时按链上数量卖，防呆账）→
   * sellToken（trader 内自动 approve + 余额截断 + minFunds 滑点保护）→
   * 实收 BNB 换算 USD 记账（fee=0）→ Trade 落库。
   */
  async _executeSellLive(signal, signalId = null, metadata = {}, holding, sellPct = 1) {
    const { ethers } = require('ethers');
    // E5：按腿比例卖执行时点余仓（holding.amount 此刻尚未被改写，无需额外快照——
    // PM 部分卖改写在交易返回之后）
    const amountToSell = new Decimal(Number(holding.amount)).mul(sellPct).toNumber();

    const onChainQty = await this._getOnChainTokenBalance(signal.tokenAddress);
    let qtySold = amountToSell;
    if (onChainQty !== null && onChainQty < amountToSell) {
      if (onChainQty <= 0) {
        return { success: false, reason: `链上余额为 0（可能已外部处置），账面 ${amountToSell}` };
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

    const sellResult = await this._trader.sellToken(signal.tokenAddress, amountOutWei, options);
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

  /** 本腿买入金额（迁自 rich-js）：卡牌模式 = perCardBNB × 张数（cards ?? 1，现金门
   * 不足在 _calculateBuyAmount 返 0=买失败不降张）；旧模式 = 固定 tradeAmount。live
   * 用本方法取金额（链上余额门才是真门，不走 PM cash 镜像门） */
  _buyAmountFor(signal) {
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

      await this._updateSignalStatus(signalId, result.success ? 'executed' : 'failed', result);
    } catch (error) {
      this.logger.error(this._experimentId, 'processSignal',
        `信号执行失败 | signalId=${signalId} error=${error.message}`);
      await this._updateSignalStatus(signalId, 'failed', { message: error.message, error: error.stack });
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
   * [wss-down-guard]（60s）：以 consumer 消费心跳为准（lastIngestAt——任意表读到新行，
   * watcher 60s 心跳行保证市场安静时也持续刷新；停滞 = watcher 挂了/两表均无写入/DB 断），
   * ≥ 阈值 → status='wss_down'；恢复且曾由本守护置位 → 回写 'running'（本地标志绑定，
   * 绝不覆盖 stopped/error 等其他来源状态）。自愈（forceReconnect）已迁 watcher 侧
   * （5min 消息静默守护），实验进程只检测告警不重连——WSS 连接不在本进程。
   */
  async _checkWssDownGuard() {
    if (this._status !== EngineStatus.RUNNING || this._isStopped) return;

    const lastIngest = this._consumer ? this._consumer.getLastIngestAt() : null;
    const since = lastIngest || this._consumer?.stats?.startedAt || null;
    if (!since) return;

    const silentMs = Date.now() - since;
    if (silentMs >= this._wssDownThresholdMs) {
      if (!this._wssDownFlagged) {
        this._wssDownFlagged = true;
        this.logger.error(this._experimentId, 'WssDownGuard',
          `数据消费停滞超过阈值（watcher 断供或其心跳停跳），实验状态置为 wss_down`,
          { silentMs, thresholdMs: this._wssDownThresholdMs });
        await this._updateExperimentStatus('wss_down');
      }
    } else if (this._wssDownFlagged && lastIngest) {
      this._wssDownFlagged = false;
      this.logger.info(this._experimentId, 'WssDownGuard', '数据消费已恢复，实验状态回写 running');
      await this._updateExperimentStatus('running');
    }
  }

  /**
   * 30s 时序快照：对最近 activeWindow 内有 tick 的活跃代币记录 experiment_time_series_data
   * + 写组合快照（portfolio_snapshots）。dataCollectionRound 随轮次自增（对齐旧语义）。
   */
  async _recordTimeSeriesSnapshot() {
    if (this._isStopped) return;
    this._loopCount++;

    const now = Date.now();
    const { buildSlimFactorValues } = require('../core/FactorBuilder');

    let recorded = 0;
    for (const tokenAddress of this._factorAggregator.getTrackedTokens()) {
      const state = this._factorAggregator.getTokenState(tokenAddress);
      if (!state || !state.lastTickAt) continue;
      if (now - state.lastTickAt > this._timeSeriesActiveWindowMs) continue; // 只记活跃代币

      state.dataCollectionRound++;
      const token = this._tokenPool.getToken(tokenAddress, 'bsc');
      const factors = this._factorAggregator.buildFactorMap(tokenAddress, now);
      if (!factors) continue;

      const recordResult = await this._timeSeriesService.recordRoundData({
        experimentId: this._experimentId,
        tokenAddress,
        tokenSymbol: token?.symbol || state.symbol || '',
        timestamp: new Date(),
        loopCount: this._loopCount,
        priceUsd: factors.currentPrice,
        priceNative: null,
        factorValues: buildSlimFactorValues(factors),
        blockchain: 'bsc',
      });
      if (recordResult) recorded++;
    }

    if (recorded > 0) {
      this.logger.debug(this._experimentId, 'TimeSeries',
        `第 ${this._loopCount} 轮时序快照: ${recorded} 个活跃代币`);
    }

    await this._createPortfolioSnapshot();
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
      .select('token_address, token_symbol, created_at, raw_api_data, creator_address')
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
      });
      this._tokenPool.addToken({
        token: tokenAddress,
        chain: 'bsc',
        platform: this._wsPlatforms()[0],
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

  /** 引擎运行状态（consumer/FA/组合，监控用） */
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
      consumer: this._consumer ? this._consumer.getStats() : null,
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
