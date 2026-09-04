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
   * @param {string} engineConfig.tradingMode - 'virtual' | 'live'（live 于 Phase 5 接入）
   * @param {number} [engineConfig.initialBalance] - 虚拟初始余额（BNB 名义）
   */
  constructor(engineConfig = {}) {
    super({
      id: `fourmemeWs_${Date.now()}`,
      name: 'FourMeme WSS Trading Engine',
      mode: engineConfig.tradingMode === 'live' ? TradingMode.LIVE : TradingMode.VIRTUAL,
      blockchain: 'bsc',
    });

    if (engineConfig.tradingMode === 'live') {
      // Phase 5 接入 FourMemeDirectTrader 执行层；在此之前 fail-fast 防止误启动
      throw new Error('FourMemeWssTradingEngine: live 模式尚未接入（Phase 5），当前仅支持 virtual');
    }

    this.initialBalance = engineConfig.initialBalance || 100;
    this._currentBalance = this.initialBalance;

    this.dataService = new ExperimentDataService();
    this.logger = new Logger({ dir: './logs', experimentId: null });

    // 组件（_initializeDataSources 中创建）
    this._factorAggregator = null;
    this._collector = null;
    this._preBuyCheckService = null;
    this._strategyEngine = null;

    // 运行状态
    this._seenTokens = new Set();        // 已落库 experiment_tokens 的 `${token}-bsc`
    this._buyingTokens = new Set();      // 买路径执行中（预检查+记账期间防重入）
    this._sellingTokens = new Set();     // 卖路径执行中防重入（tick 密集，必须有）
    this._restoreAnchors = new Map();    // 重启恢复的持仓锚点 tokenAddress → { buyPriceUsd, buyTime }
    this._intervals = {};
    this._wssDownFlagged = false;

    // 引擎级配置（fourmemeWs 段；实验级覆盖在 _initializeDataSources 中重读）
    this._applyWsConfig(baseConfig.fourmemeWs || {});

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
    this._pruneIntervalMs = this._wsConfig.pruneIntervalMs ?? 5 * 60 * 1000;
    this._pruneMaxAgeMs = this._wsConfig.pruneMaxAgeMs ?? 30 * 60 * 1000;
    this._timeSeriesIntervalMs = this._wsConfig.timeSeriesIntervalMs ?? 30 * 1000;
    this._timeSeriesActiveWindowMs = this._wsConfig.timeSeriesActiveWindowMs ?? 60 * 1000;
    this._wssDownThresholdMs = this._wsConfig.wssDownGuardMs ?? 15 * 60 * 1000;
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

    // 2. 代币池（FA 自带趋势序列，池不再需要价格/持有者历史缓存）
    this._tokenPool = new TokenPool(this.logger);
    this.logger.info(this._experimentId, 'FourMemeWssTradingEngine', '✅ 代币池初始化完成');

    // 3. 因子聚合器 + 事件链路
    const FourMemeFactorAggregator = require('../../services/FourMemeFactorAggregator');
    this._factorAggregator = new FourMemeFactorAggregator(
      { fourmemeWs: this._mergedWsConfig() }, this.logger);
    this._factorAggregator.on('factorsUpdated', (data) => this._onFactorsUpdated(data));
    this.logger.info(this._experimentId, 'FourMemeWssTradingEngine', '✅ 因子聚合器初始化完成');

    // 4. ankr WSS 采集器（发现 + tick + 毕业回调）
    const { FourMemeAnkrWsCollector } = require('../../collectors/fourmeme-ankr-ws-collector');
    this._collector = new FourMemeAnkrWsCollector(
      { fourmemeWs: this._mergedWsConfig() },
      this.logger,
      this._tokenPool,
      this._factorAggregator,
      {
        onTokenCreate: (info) => this._handleNewToken(info),
        onGraduation: (info) => this._handleGraduation(info),
      },
    );
    this._collector.setExperimentId(this._experimentId);
    this.logger.info(this._experimentId, 'FourMemeWssTradingEngine', '✅ ankr WSS 采集器初始化完成');

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
          enabled: true,
        });
      });
    }
    this._strategyEngine.loadStrategies(strategyArray, availableFactorIds);
    this.logger.info(this._experimentId, 'FourMemeWssTradingEngine',
      `✅ 策略引擎初始化完成，加载了 ${this._strategyEngine.getStrategyCount()} 个策略`);

    // 6. 交易金额 / 永久阻断
    const experimentConfig = this._experiment?.config || {};
    this._tradeAmount = experimentConfig.tradeAmount || 0.1;
    this._permanentBlockCondition = experimentConfig.strategiesConfig?.permanentBlockCondition || null;
    this._tokenBlacklist = new Map();
    this.logger.info(this._experimentId, 'FourMemeWssTradingEngine', `交易金额配置 | tradeAmount=${this._tradeAmount}`);

    // 7. 重启恢复：重放 trades 重建 PortfolioManager 持仓 + 记录 FA 锚点
    await this._loadHoldings();
  }

  /** 基础 fourmemeWs 配置 + 实验级覆盖（浅合并） */
  _mergedWsConfig() {
    return {
      ...(baseConfig.fourmemeWs || {}),
      ...(this._experiment?.config?.fourmemeWs || {}),
    };
  }

  async _runMainLoop() {
    this._collector.start();

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

    // [wss-down-guard] WSS 断流守护（60s）：消息心跳静默 ≥ 阈值 → 强制重连 + status='wss_down'
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

    // 不阻塞：main.js 在 start() 返回后注册优雅退出；WSS 连接 + intervals 保活事件循环
    this.logger.info(this._experimentId, 'FourMemeWssTradingEngine',
      `🚀 事件循环已启动（debounce=${this._signalDebounceMs}ms maxWait=${this._signalDebounceMaxWaitMs}ms ` +
      `时序=${this._timeSeriesIntervalMs / 1000}s 断流阈值=${this._wssDownThresholdMs / 60000}min），等待 WSS 事件...`);
  }

  async _syncHoldings() {
    // virtual：持仓由 PortfolioManager 内部维护（_loadHoldings 重放 + executeTrade 记账）
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

    // 停采集器（内部 flush 剩余 tick 缓冲后关闭 WSS）
    if (this._collector) {
      await this._collector.stop();
      this.logger.info(this._experimentId, 'FourMemeWssTradingEngine', '⏹️ WSS 采集器已停止');
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
  _onFactorsUpdated({ tokenAddress, factors, tick }) {
    this.metrics.lastFactorsUpdatedAt = Date.now();
    this.metrics.factorsUpdatedCount++;

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
    if (this._buyingTokens.has(tokenAddress)) return;
    if (token.status === 'bought') return; // 单仓语义

    if (this._tokenBlacklist.has(tokenAddress)) return;

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
    const { buildFactorValuesForTimeSeries, buildPreBuyCheckFactorValues } = require('../core/FactorBuilder');

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
              narrativeRating: 9,          // 叙事已解耦（[DECOUPLED]），恒未评级
              tweetAuthorType: factorResults.tweetAuthorType ?? 0,
              dataCollectionRound: factorResults.dataCollectionRound ?? 0,
              totalSupply: totalSupply,
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
        this._tokenPool.markAsBought(token.token, token.chain, {
          buyPrice: latestPrice,
          buyTime: Date.now(),
        });
        this._tokenPool.recordStrategyExecution(token.token, token.chain, strategy.id);
        await this.dataService.updateTokenStatus(this._experimentId, token.token, 'bought');

        // FA 持仓锚点（per-position 止盈/止损因子原料；单仓 'default'）
        const faState = this._factorAggregator.getTokenState(token.token);
        this._factorAggregator.setBuyState(token.token, {
          buyPriceBnb: faState?.currentPriceBnb || 0,
          buyPriceUsd: latestPrice,
          buyTime: Date.now(),
        });

        this.logger.info(this._experimentId, 'BuyEval',
          `✅ 买入成功 | ${token.symbol} price=${latestPrice.toExponential(4)} amount=${this._tradeAmount} 余额=${this.currentBalance.toFixed(4)}`);
        return { success: true };
      }

      return { success: false, reason: result?.reason || result?.message || '交易执行失败' };
    } finally {
      this._buyingTokens.delete(tokenAddress);
    }
  }

  // ==================== 卖路径 ====================

  /**
   * 卖腿评估（对齐旧 _executeStrategy 的 sell 分支）：持有中每 tick 评估，
   * 触发即构造信号 → processSignal（自建信号落库）→ 全额卖出。
   */
  async _evaluateSellPath(tokenAddress, factors, tick) {
    const token = this._tokenPool.getToken(tokenAddress, 'bsc');
    if (!token || token.status !== 'bought') return { success: false, reason: '非持有状态' };
    if (this._sellingTokens.has(tokenAddress)) return { success: false, reason: '卖出执行中' };

    this._sellingTokens.add(tokenAddress);
    try {
      // 只看卖腿：单仓语义下买入触发对持仓代币是无效噪声，混合评估会让同优先级的
      // 买策略永远压住卖出（triggeredStrategies[0] 按插入序取）——止损/止盈被静默杀死
      const strategy = this._strategyEngine.evaluate(factors, tokenAddress, Date.now(), token, 'sell');
      if (!strategy) {
        return { success: false, reason: '无触发卖出策略' };
      }

      this.logger.info(this._experimentId, 'SellEval',
        `${token.symbol} 触发卖出策略: ${strategy.name} | profitPercent=${factors.profitPercent?.toFixed(1)}% ` +
        `holdDuration=${factors.holdDuration?.toFixed(0)}s drawdown=${factors.drawdownFromHighestSinceLastBuy?.toFixed(1)}%`);

      const latestPrice = factors.currentPrice || 0;
      if (!(latestPrice > 0)) {
        return { success: false, reason: '无有效价格' };
      }

      const { buildFactorValuesForTimeSeries } = require('../core/FactorBuilder');
      const holding = this._getHolding(tokenAddress);
      const buyPrice = holding?.averagePurchasePrice || token.buyPrice || null;

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
        factors: { trendFactors: buildFactorValuesForTimeSeries(factors) },
        timestamp: new Date(),
      };

      const result = await this.processSignal(signal);

      if (result && result.success) {
        this._tokenPool.recordStrategyExecution(token.token, token.chain, strategy.id);
        return { success: true };
      }
      return { success: false, reason: result?.reason || result?.message || '卖出执行失败' };
    } finally {
      this._sellingTokens.delete(tokenAddress);
    }
  }

  // ==================== 交易执行（虚拟记账，与旧 Virtual 引擎同构）====================

  async _executeBuy(signal, signalId = null, metadata = {}) {
    try {
      const amountInBNB = this._calculateBuyAmount(signal);
      if (amountInBNB <= 0) {
        return { success: false, reason: '余额不足或计算金额为0' };
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
        metadata: { ...metadata },
      });
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

      const amountToSell = holding.amount;
      const price = signal.price || 0;
      const amountOutBNB = price > 0 ? new Decimal(amountToSell).mul(price).toNumber() : 0;

      const result = await this.executeTrade({
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
        },
      });

      if (result && result.success) {
        // 全额卖出：记录交易对 + 状态推进 + FA 清锚
        const token = this._tokenPool.getToken(signal.tokenAddress, signal.chain || 'bsc');
        if (token && token.buyTime && token.buyPrice) {
          const sellTime = Date.now();
          const buyPrice = token.buyPrice;
          const returnRate = buyPrice > 0 ? ((price - buyPrice) / buyPrice * 100) : 0;
          const pnl = amountOutBNB - (amountOutBNB / (1 + returnRate / 100));

          this._tokenPool.addCompletedPair(signal.tokenAddress, signal.chain, {
            buyTime: token.buyTime,
            sellTime,
            returnRate,
            pnl,
          });
          this.logger.info(this._experimentId, '_executeSell',
            `已完成交易对 | ${signal.symbol} returnRate=${returnRate.toFixed(2)}% pnl=${pnl.toFixed(6)}`);
        }

        this._tokenPool.markAsSold(signal.tokenAddress, signal.chain);
        await this.dataService.updateTokenStatus(this._experimentId, signal.tokenAddress, 'sold');
        this._factorAggregator.clearBuyState(signal.tokenAddress, 'default');
      }

      return result;
    } catch (error) {
      return { success: false, reason: error.message };
    }
  }

  _calculateBuyAmount(signal) {
    const tradeAmount = this._tradeAmount;
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

  /** TokenCreate：新代币落库 experiment_tokens（_seenTokens 去重；23505 容忍在 saveToken 内） */
  async _handleNewToken(info) {
    const tokenKey = `${info.token}-bsc`;
    if (this._seenTokens.has(tokenKey)) return;
    this._seenTokens.add(tokenKey);

    try {
      await this.dataService.saveToken(this._experimentId, {
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
      });
    } catch (error) {
      this.logger.error(this._experimentId, 'NewToken',
        `新代币落库失败 | ${info.token} ${error.message}`);
    }
  }

  /**
   * LiquidityAdded（毕业）：内盘曲线终结，此后不再有 TokenManager2 事件。
   * virtual 模式未订阅外盘（PancakeSwap），毕业票的持仓将收不到 tick、无法通过
   * 事件驱动卖出——只记日志与 FA 标记，不改 token 状态（不阻断卖出路径）。
   */
  _handleGraduation(info) {
    this._factorAggregator.markGraduated(info.token);
    const token = this._tokenPool.getToken(info.token, 'bsc');
    if (token && token.status === 'bought') {
      this.logger.warn(this._experimentId, 'Graduation',
        `⚠️ 持仓代币已毕业（内盘事件流终止）| ${token.symbol} ${info.token} ` +
        `funds=${info.fundsBnb} BNB —— virtual 模式无外盘数据源，持仓不再有 tick 触发卖出`);
    }
  }

  // ==================== 守护 intervals ====================

  /**
   * [wss-down-guard]（60s）：以 collector 消息心跳为准（socket "已连接"可能僵尸），
   * 静默 ≥ 阈值 → forceReconnect（自愈）+ status='wss_down'；恢复且曾由本守护置位
   * → 回写 'running'（本地标志绑定，绝不覆盖 stopped/error 等其他来源状态）。
   */
  async _checkWssDownGuard() {
    if (this._status !== EngineStatus.RUNNING || this._isStopped) return;

    const last = this._collector ? this._collector.getLastMessageAt() : null;
    const since = last || this._collector?.stats?.startTime || null;
    if (!since) return;

    const silentMs = Date.now() - since;
    if (silentMs >= this._wssDownThresholdMs) {
      // 静默超阈值 = 僵尸连接（无 close 事件）或 collector 已停：每轮守护主动踢一次强制重连（幂等）
      try {
        this._collector.forceReconnect();
      } catch (e) {
        this.logger.error(this._experimentId, 'WssDownGuard', `强制重连失败: ${e.message}`);
      }
      if (!this._wssDownFlagged) {
        this._wssDownFlagged = true;
        this.logger.error(this._experimentId, 'WssDownGuard',
          `WSS 断流（无消息心跳）超过阈值，实验状态置为 wss_down`,
          { silentMs, thresholdMs: this._wssDownThresholdMs });
        await this._updateExperimentStatus('wss_down');
      }
    } else if (this._wssDownFlagged && last) {
      this._wssDownFlagged = false;
      this.logger.info(this._experimentId, 'WssDownGuard', 'WSS 已恢复收数，实验状态回写 running');
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

  /** 代币信息（购买前检查用；早期参与者检查只需要 innerPair） */
  _buildTokenInfo(token) {
    return {
      address: token.token,
      symbol: token.symbol,
      chain: token.chain || 'bsc',
      platform: token.platform || 'fourmeme',
      launchAt: token.createdAt || null,      // WSS: TokenCreate 块时间（秒）
      innerPair: `${token.token}_fo`,         // four.meme BSC 内盘交易对
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

        if (!(tokenAmount > 0) || !(tokenPrice > 0)) continue;

        await this._portfolioManager.executeTrade(
          this._portfolioId,
          trade.tokenAddress,
          trade.tradeDirection || trade.direction,
          new Decimal(tokenAmount),
          new Decimal(tokenPrice),
          0.001,
        );
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

  /** 引擎运行状态（collector/FA/组合，监控用） */
  getStats() {
    return {
      engine: {
        id: this._id,
        mode: this._mode,
        status: this._status,
        loopCount: this._loopCount,
        isLive: this._isLive,
      },
      metrics: { ...this.metrics },
      collector: this._collector ? this._collector.getStats() : null,
      factorAggregator: this._factorAggregator ? this._factorAggregator.getStats() : null,
      tokenPool: this._tokenPool ? this._tokenPool.getStats() : null,
      debouncePending: this._buyDebouncer ? this._buyDebouncer.size : 0,
      buying: this._buyingTokens.size,
      selling: this._sellingTokens.size,
      wssDownFlagged: this._wssDownFlagged,
      balance: this.currentBalance,
    };
  }
}

module.exports = { FourMemeWssTradingEngine };
