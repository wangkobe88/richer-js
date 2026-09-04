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

    // live 执行层状态（Phase 5）
    this._trader = null;                 // FourMemeDirectTrader（live 专用）
    this._walletAddress = null;
    this._lastKnownBnbUsd = 0;           // 最近一次 BNB/USD（collector 刷新，启动时 trader 直读一次）
    this._sellCooldownUntil = new Map(); // 卖出失败冷却 tokenAddress → untilTs（live 防 gas 消耗风暴）

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

    // live 执行层参数（实验级覆盖在 _initializeLiveTrader 中重读 trading 段）
    const liveConfig = this._wsConfig.live || {};
    this._reserveNative = new Decimal(liveConfig.reserveNative ?? 0.01); // gas 保留 BNB（≈3 笔 300k×10gwei）
    this._liveSlippagePct = liveConfig.slippageTolerance ?? 5;           // 滑点百分比（trader 契约：5 = 5%）
    this._liveMaxGasPriceGwei = liveConfig.maxGasPrice ?? 10;            // gwei
    this._liveHoldingsSyncMs = liveConfig.holdingsSyncMs ?? 5 * 60 * 1000;
    this._sellFailureCooldownMs = liveConfig.sellFailureCooldownMs ?? 60 * 1000;
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

    // 7. live 执行层（FourMemeDirectTrader + 钱包），必须在重启恢复之前就绪
    if (this._isLive) {
      await this._initializeLiveTrader();
    }

    // 8. 重启恢复：重放 trades 重建 PortfolioManager 持仓 + 记录 FA 锚点
    //    live：以链上余额为准对账（cash=链上 BNB 等值，持仓数量=balanceOf）
    await (this._isLive ? this._loadHoldingsLive() : this._loadHoldings());
  }

  /** 基础 fourmemeWs 配置 + 实验级覆盖（浅合并） */
  _mergedWsConfig() {
    return {
      ...(baseConfig.fourmemeWs || {}),
      ...(this._experiment?.config?.fourmemeWs || {}),
    };
  }

  // ==================== live 执行层（Phase 5：FourMemeDirectTrader）====================

  /**
   * live 交易器初始化：钱包配置校验 → 私钥解密 → FourMemeDirectTrader →
   * 地址一致性校验（私钥推导地址 ≠ 配置地址 = 配置错误，fail-fast）→
   * 链上连通性探测 + BNB/USD 启动锚定。
   */
  async _initializeLiveTrader() {
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
    this._trader = traderFactory.createTrader('fourmeme', traderConfig);
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

  /** 启动时 BNB/USD 直读一次（PancakeSwap V2 Router getAmountsOut；运行期由 collector 60s 刷新接力） */
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
        `BNB/USD 启动直读失败（collector 启动后接力刷新）: ${error.message}`);
    }
  }

  /** 当前 BNB/USD（collector 刷新值优先，回落最近已知值） */
  _getBnbUsd() {
    const fromCollector = this._collector ? this._collector.getBnbUsd() : 0;
    if (fromCollector > 0) this._lastKnownBnbUsd = fromCollector;
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

    // live 持仓对账（链上余额 vs 账面，外部处置/偏差告警）
    if (this._isLive) {
      this._intervals.liveSync = setInterval(() => {
        this._syncHoldings().catch(err => {
          this.logger.error(this._experimentId, 'LiveSync', `live 持仓对账失败: ${err.message}`);
        });
      }, this._liveHoldingsSyncMs);
    }

    // 不阻塞：main.js 在 start() 返回后注册优雅退出；WSS 连接 + intervals 保活事件循环
    this.logger.info(this._experimentId, 'FourMemeWssTradingEngine',
      `🚀 事件循环已启动（debounce=${this._signalDebounceMs}ms maxWait=${this._signalDebounceMaxWaitMs}ms ` +
      `时序=${this._timeSeriesIntervalMs / 1000}s 断流阈值=${this._wssDownThresholdMs / 60000}min），等待 WSS 事件...`);
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

        this.logger.info(this._experimentId, 'BuyEval',
          `✅ 买入成功${this._isLive ? '(live)' : ''} | ${token.symbol} price=${execPriceUsd.toExponential(4)} amount=${this._tradeAmount} 余额=${this.currentBalance.toFixed(4)}`);
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

    // live 卖出失败冷却：tick 驱动的卖腿若无冷却，链上失败会每 tick 重试烧 gas
    if (this._isLive) {
      const cooldownUntil = this._sellCooldownUntil.get(tokenAddress);
      if (cooldownUntil && Date.now() < cooldownUntil) {
        return { success: false, reason: '卖出冷却中' };
      }
    }

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

      let result;
      if (this._isLive) {
        result = await this._executeSellLive(signal, signalId, metadata, holding);
      } else {
        const amountToSell = holding.amount;
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
          },
        });
      }

      if (result && result.success) {
        this._sellCooldownUntil.delete(signal.tokenAddress);

        // 记账价/所得：live 用实际成交（priceUsd/bnbReceived），虚拟按信号价估算
        const sellPrice = result.priceUsd ?? (signal.price || 0);
        const amountOutBNB = result.bnbReceived ??
          (sellPrice > 0 ? new Decimal(holding.amount).mul(sellPrice).toNumber() : 0);

        // 全额卖出：记录交易对 + 状态推进 + FA 清锚
        const token = this._tokenPool.getToken(signal.tokenAddress, signal.chain || 'bsc');
        if (token && token.buyTime && token.buyPrice) {
          const sellTime = Date.now();
          const buyPrice = token.buyPrice;
          const returnRate = buyPrice > 0 ? ((sellPrice - buyPrice) / buyPrice * 100) : 0;
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
      } else if (this._isLive) {
        // 卖出失败冷却：防每 tick 高频重试烧 gas（成功后清除）
        this._sellCooldownUntil.set(signal.tokenAddress, Date.now() + this._sellFailureCooldownMs);
        this.logger.warn(this._experimentId, '_executeSell',
          `live 卖出失败，冷却 ${this._sellFailureCooldownMs / 1000}s | ${signal.symbol} ${result?.reason || ''}`);
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
      const amountInBNB = this._tradeAmount;
      if (!(amountInBNB > 0)) {
        return { success: false, reason: 'tradeAmount 未配置或为 0' };
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
      const options = {
        slippageTolerance: this._liveSlippagePct,
        maxGasPrice: this._liveMaxGasPriceGwei,
      };

      this.logger.info(this._experimentId, '_executeBuyLive',
        `📡 live 买入 | ${signal.symbol} ${amountInBNB} BNB（滑点 ${this._liveSlippagePct}% gas≤${this._liveMaxGasPriceGwei}gwei）`);

      const buyResult = await this._trader.buyToken(signal.tokenAddress, amountInWei, options);
      if (!buyResult.success) {
        return { success: false, reason: buyResult.error || 'live 买入交易失败' };
      }

      // 实际成交数量：receipt 解析为准，失败按信号价估算
      const bnbUsd = this._getBnbUsd();
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
          protocol: 'FourMeme TokenManager2',
          method: buyResult.method || 'buyTokenAMAP',
        },
      });
      const tradeId = await trade.save();

      this.logger.info(this._experimentId, '_executeBuyLive',
        `✅ live 买入成交 | ${signal.symbol} tx=${trade.txHash} 得 ${actualTokenAmount} @ ${actualPriceUsd.toExponential(4)} USD`);

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
  async _executeSellLive(signal, signalId = null, metadata = {}, holding) {
    const { ethers } = require('ethers');
    const amountToSell = Number(holding.amount);

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
    const options = {
      slippageTolerance: this._liveSlippagePct,
      maxGasPrice: this._liveMaxGasPriceGwei,
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
        protocol: 'FourMeme TokenManager2',
        method: 'sellToken',
      },
    });
    const tradeId = await trade.save();

    this.logger.info(this._experimentId, '_executeSellLive',
      `✅ live 卖出成交 | ${signal.symbol} tx=${trade.txHash} 得 ${bnbReceived} BNB @ ${actualPriceUsd.toExponential(4)} USD`);

    return { success: true, tradeId, txHash: trade.txHash, trade, priceUsd: actualPriceUsd, bnbReceived };
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
        platform: 'fourmeme',
        data_source: 'wss',
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

  /** 引擎运行状态（collector/FA/组合，监控用） */
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
