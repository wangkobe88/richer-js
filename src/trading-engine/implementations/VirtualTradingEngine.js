/**
 * 虚拟交易引擎
 * 用于 fourmeme 交易实验的虚拟交易模拟
 * 继承自 AbstractTradingEngine
 */

const { TradingMode, EngineStatus } = require('../interfaces/ITradingEngine');
const { AbstractTradingEngine } = require('../core/AbstractTradingEngine');
const { ExperimentDataService } = require('../../web/services/ExperimentDataService');
const Logger = require('../../services/logger');

// 延迟导入以避免循环依赖
let TokenPool = null;
let PlatformCollector = null;
let StrategyEngine = null;
let CardPositionManager = null;

function getLazyModules() {
  if (!TokenPool) {
    TokenPool = require('../../core/token-pool');
    PlatformCollector = require('../../collectors/platform-collector');
    const SE = require('../../strategies/StrategyEngine');
    StrategyEngine = SE.StrategyEngine;
    const CPM = require('../../portfolio/CardPositionManager');
    CardPositionManager = CPM.CardPositionManager;
  }
  return { TokenPool, PlatformCollector, StrategyEngine, CardPositionManager };
}

// 加载配置
const config = require('../../../config/default.json');

/**
 * 虚拟交易引擎
 * @class
 * @extends AbstractTradingEngine
 */
class VirtualTradingEngine extends AbstractTradingEngine {
  /**
   * 构造函数
   * @param {Object} config - 配置对象
   */
  constructor(config = {}) {
    super({
      id: `virtual_${Date.now()}`,
      name: 'Fourmeme Virtual Trading Engine',
      mode: TradingMode.VIRTUAL,
      blockchain: config.blockchain || 'bsc',
      ...config
    });

    // Virtual 特有属性
    this.initialBalance = config.initialBalance || 100;
    this.currentBalance = this.initialBalance;

    // 统计信息
    this.metrics = {
      totalTrades: 0,
      successfulTrades: 0,
      failedTrades: 0,
      totalSignals: 0,
      executedSignals: 0
    };

    // 服务
    this.dataService = new ExperimentDataService();
    this.timeSeriesService = null; // 在 _initializeComponents 中初始化
    // Logger 将在 initialize() 中创建（使用正确的 experimentId）

    // Virtual 特有组件
    this._fourmemeCollector = null;
    this._aveTokenApi = null;
    this._fourMemeApi = null;
    this._rsiIndicator = null;
    this._monitoringTimer = null;

    // 卡牌仓位管理配置
    this._positionManagement = null;

    // 代币追踪：记录已处理过的代币
    this._seenTokens = new Set();

    console.log(`🎮 虚拟交易引擎已创建: ${this.id}, 初始余额: ${this.initialBalance}`);
  }

  // ==================== 抽象方法实现 ====================

  /**
   * 初始化数据源（Virtual 特有）
   * @protected
   * @returns {Promise<void>}
   */
  async _initializeDataSources() {
    await this._initializeMonitoring();
  }

  /**
   * 运行主循环（Virtual 特有：定时监控循环）
   * @protected
   * @returns {Promise<void>}
   */
  async _runMainLoop() {
    // Virtual 引擎的主循环是定时监控循环
    // 在 _initializeMonitoring 中已经启动，这里不需要做任何事
    // 主循环在 _startMonitoringLoop() 中通过 setInterval 启动
  }

  /**
   * 同步持仓数据（Virtual 特有：返回虚拟持仓）
   * @protected
   * @returns {Promise<void>}
   */
  async _syncHoldings() {
    // Virtual 引擎不依赖外部持仓数据
    // 持仓由 PortfolioManager 内部维护
    // 每次监控循环自动同步最新价格
  }

  /**
   * 执行买入（Virtual 特有：模拟买入）
   * @protected
   * @param {Object} signal - 交易信号
   * @param {string} signalId - 信号ID
   * @param {Object} metadata - 元数据
   * @returns {Promise<Object>} 交易结果
   */
  async _executeBuy(signal, signalId = null, metadata = {}) {
    const { CardPositionManager } = getLazyModules();

    this.logger.info(this._experimentId, '_executeBuy',
      `========== _executeBuy 被调用 ==========`);
    this.logger.info(this._experimentId, '_executeBuy',
      `signal | action=${signal.action}, symbol=${signal.symbol}, tokenAddress=${signal.tokenAddress}, chain=${signal.chain}, price=${signal.price}, cards=${signal.cards}, signalId=${signalId}`);

    try {
      // 获取卡牌管理器（买入时必须存在）
      const cardManager = this._tokenPool.getCardPositionManager(signal.tokenAddress, signal.chain);
      if (!cardManager) {
        this.logger.error(this._experimentId, '_executeBuy',
          `卡牌管理器未初始化 | tokenAddress=${signal.tokenAddress}, chain=${signal.chain}`);
        return { success: false, reason: '卡牌管理器未初始化，无法执行买入' };
      }

      // 记录买入前的卡牌和余额状态
      const beforeCardState = {
        bnbCards: cardManager.bnbCards,
        tokenCards: cardManager.tokenCards,
        totalCards: cardManager.totalCards
      };
      const beforeBalance = {
        bnbBalance: this.currentBalance,
        tokenBalance: this._getHolding(signal.tokenAddress)?.amount || 0
      };

      this.logger.info(this._experimentId, '_executeBuy',
        `卡牌状态 | ${beforeCardState.bnbCards} BNB卡, ${beforeCardState.tokenCards} 代币卡`);
      this.logger.info(this._experimentId, '_executeBuy',
        `余额状态 | ${beforeBalance.bnbBalance} BNB, ${beforeBalance.tokenBalance} 代币`);

      const amountInBNB = this._calculateBuyAmount(signal);
      this.logger.info(this._experimentId, '_executeBuy',
        `计算买入金额 | amountInBNB=${amountInBNB}, signal.cards=${signal.cards}`);
      if (amountInBNB <= 0) {
        return { success: false, reason: '余额不足或计算金额为0' };
      }

      const price = signal.price || signal.buyPrice || 0;
      const tokenAmount = price > 0 ? amountInBNB / price : 0;

      const tradeRequest = {
        tokenAddress: signal.tokenAddress,
        symbol: signal.symbol,
        direction: 'buy',
        amount: tokenAmount,
        price: price,
        signalId: signalId,
        metadata: {
          ...metadata,
          cards: signal.cards,
          cardConfig: signal.cardConfig,
          cardPositionChange: {
            before: {
              ...beforeCardState,
              ...beforeBalance
            }
          }
        }
      };

      this.logger.info(this._experimentId, '_executeBuy',
        `执行交易 | symbol=${signal.symbol}, amount=${tokenAmount}, price=${price}`);

      const result = await this.executeTrade(tradeRequest);

      this.logger.info(this._experimentId, '_executeBuy',
        `交易结果 | success=${result?.success}, reason=${result?.reason || 'none'}`);

      // 买入成功后更新卡牌分配和状态
      if (result && result.success) {
        const cards = parseInt(signal.cards) || 1;
        this.logger.info(this._experimentId, '_executeBuy',
          `更新卡牌分配 | cards=${cards}, before: bnbCards=${cardManager.bnbCards}, tokenCards=${cardManager.tokenCards}`);
        cardManager.afterBuy(signal.symbol, cards);
        this.logger.info(this._experimentId, '_executeBuy',
          `更新卡牌分配完成 | after: bnbCards=${cardManager.bnbCards}, tokenCards=${cardManager.tokenCards}`);

        const afterCardState = {
          bnbCards: cardManager.bnbCards,
          tokenCards: cardManager.tokenCards,
          totalCards: cardManager.totalCards
        };
        const afterBalance = {
          bnbBalance: this.currentBalance,
          tokenBalance: this._getHolding(signal.tokenAddress)?.amount || 0
        };

        if (!result.trade.metadata) {
          result.trade.metadata = {};
        }
        result.trade.metadata.cardPositionChange = {
          before: {
            ...beforeCardState,
            ...beforeBalance
          },
          after: {
            ...afterCardState,
            ...afterBalance
          },
          transferredCards: cards
        };

        const tradeId = result.trade?.id;
        if (tradeId) {
          this.logger.info(this._experimentId, '_executeBuy',
            `更新交易记录 | tradeId=${tradeId}, after状态已更新`);
          await this.dataService.updateTrade(tradeId, {
            metadata: result.trade.metadata
          });
        }
      }

      return result;

    } catch (error) {
      return { success: false, reason: error.message };
    }
  }

  /**
   * 执行卖出（Virtual 特有：模拟卖出）
   * @protected
   * @param {Object} signal - 卖出信号
   * @param {string} signalId - 信号ID
   * @param {Object} metadata - 元数据
   * @returns {Promise<Object>} 交易结果
   */
  async _executeSell(signal, signalId = null, metadata = {}) {
    try {
      this.logger.info(this._experimentId, '_executeSell',
        `检查持仓 | tokenAddress=${signal.tokenAddress}, chain=${signal.chain}`);
      const holding = this._getHolding(signal.tokenAddress);
      if (!holding) {
        this.logger.warn(this._experimentId, '_executeSell',
          `无持仓 | tokenAddress=${signal.tokenAddress}`);
        return { success: false, reason: '无持仓' };
      }
      if (holding.amount <= 0) {
        this.logger.warn(this._experimentId, '_executeSell',
          `持仓数量为0 | tokenAddress=${signal.tokenAddress}, amount=${holding.amount}`);
        return { success: false, reason: '持仓数量为0' };
      }

      const cardManager = this._tokenPool.getCardPositionManager(signal.tokenAddress, signal.chain);
      if (!cardManager) {
        this.logger.warn(this._experimentId, '_executeSell',
          `卡牌管理器未初始化 | tokenAddress=${signal.tokenAddress}, chain=${signal.chain}`);
        return { success: false, reason: '卡牌管理器未初始化，无法执行卖出' };
      }

      const beforeCardState = {
        bnbCards: cardManager.bnbCards,
        tokenCards: cardManager.tokenCards,
        totalCards: cardManager.totalCards
      };
      const beforeBalance = {
        bnbBalance: this.currentBalance,
        tokenBalance: holding.amount
      };

      const cards = signal.cards || 'all';
      const sellAll = (cards === 'all');
      const cardsToUse = sellAll ? null : parseInt(cards);
      const amountToSell = cardManager.calculateSellAmount(holding.amount, signal.symbol, cardsToUse, sellAll);

      if (amountToSell <= 0) {
        return { success: false, reason: '计算卖出数量为0' };
      }

      const price = signal.price || 0;
      const amountOutBNB = price > 0 ? amountToSell * price : 0;

      const tradeRequest = {
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
          cards: signal.cards,
          cardConfig: signal.cardConfig,
          sellCalculatedRatio: signal.sellCalculatedRatio || metadata.sellCalculatedRatio,
          cardPositionChange: {
            before: {
              ...beforeCardState,
              ...beforeBalance
            }
          }
        }
      };

      const result = await this.executeTrade(tradeRequest);

      if (result && result.success) {
        const actualCards = sellAll ? beforeCardState.tokenCards : cardsToUse;
        this.logger.info(this._experimentId, '_executeSell',
          `更新卡牌分配 | actualCards=${actualCards}, sellAll=${sellAll}, before: bnbCards=${cardManager.bnbCards}, tokenCards=${cardManager.tokenCards}`);
        cardManager.afterSell(signal.symbol, actualCards);
        this.logger.info(this._experimentId, '_executeSell',
          `更新卡牌分配完成 | after: bnbCards=${cardManager.bnbCards}, tokenCards=${cardManager.tokenCards}`);

        const afterCardState = {
          bnbCards: cardManager.bnbCards,
          tokenCards: cardManager.tokenCards,
          totalCards: cardManager.totalCards
        };
        const afterBalance = {
          bnbBalance: this.currentBalance,
          tokenBalance: this._getHolding(signal.tokenAddress)?.amount || 0
        };

        if (!result.trade.metadata) {
          result.trade.metadata = {};
        }
        result.trade.metadata.cardPositionChange = {
          before: {
            ...beforeCardState,
            ...beforeBalance
          },
          after: {
            ...afterCardState,
            ...afterBalance
          },
          transferredCards: actualCards
        };

        const tradeId = result.trade?.id;
        if (tradeId) {
          this.logger.info(this._experimentId, '_executeSell',
            `更新交易记录 | tradeId=${tradeId}, after状态已更新`);
          await this.dataService.updateTrade(tradeId, {
            metadata: result.trade.metadata
          });
        }
      }

      return result;

    } catch (error) {
      return { success: false, reason: error.message };
    }
  }

  /**
   * 是否记录时序数据（Virtual 返回 true）
   * @protected
   * @returns {boolean}
   */
  _shouldRecordTimeSeries() {
    return true;
  }

  // ==================== Virtual 特有方法 ====================

  /**
   * 初始化监控模块
   * @private
   * @returns {Promise<void>}
   */
  async _initializeMonitoring() {
    const { TokenPool, PlatformCollector } = getLazyModules();

    // 1. 初始化价格历史缓存（用于趋势检测）
    const PriceHistoryCache = require('../PriceHistoryCache');
    this._priceHistoryCache = new PriceHistoryCache(15 * 60 * 1000); // 15分钟
    console.log(`✅ 价格历史缓存初始化完成`);

    // 2. 初始化趋势检测器
    const TrendDetector = require('../TrendDetector');
    this._trendDetector = new TrendDetector({
      minDataPoints: 6,
      maxDataPoints: Infinity, // 不限制最大值
      cvThreshold: 0.005,
      scoreThreshold: 30,
      totalReturnThreshold: 5,
      riseRatioThreshold: 0.5
    });
    console.log(`✅ 趋势检测器初始化完成`);

    // 2.1 初始化持有者服务
    const { TokenHolderService } = require('../holders/TokenHolderService');
    const { dbManager } = require('../../services/dbManager');
    const supabase = dbManager.getClient();
    this._tokenHolderService = new TokenHolderService(supabase, this.logger);
    console.log(`✅ 持有者服务初始化完成`);

    // 3. 初始化代币池（传入价格历史缓存）
    this._tokenPool = new TokenPool(this.logger, this._priceHistoryCache);
    console.log(`✅ 代币池初始化完成`);

    // 2. 初始化AVE TokenAPI（用于获取代币价格和因子数据）
    const { AveTokenAPI } = require('../../core/ave-api');
    const apiKey = process.env.AVE_API_KEY;
    this._aveTokenApi = new AveTokenAPI(
      config.ave.apiUrl,
      config.ave.timeout,
      apiKey
    );
    console.log(`✅ AVE TokenAPI初始化完成`);

    // 2.1 初始化FourMeme API（用于获取创建者地址）
    const { FourMemeTokenAPI } = require('../../core/fourmeme-api');
    this._fourMemeApi = new FourMemeTokenAPI(
      config.fourmeme?.apiUrl || 'https://four.meme',
      config.fourmeme?.timeout || 30000
    );
    console.log(`✅ FourMeme API初始化完成`);

    // 3. 初始化收集器（传递实验ID）
    this._fourmemeCollector = new PlatformCollector(
      config,
      this.logger,
      this._tokenPool,
      this._experimentId  // 传递实验ID
    );
    console.log(`✅ Fourmeme收集器初始化完成 [实验ID: ${this._experimentId}]`);

    // 4. 初始化RSI指标
    const { RSIIndicator } = require('../../indicators/RSIIndicator');
    this._rsiIndicator = new RSIIndicator({
      period: 14,
      smoothingPeriod: 9,
      smoothingType: 'EMA'
    });
    console.log(`✅ RSI指标初始化完成`);

    // 5. 初始化策略引擎
    const { StrategyEngine } = require('../../strategies/StrategyEngine');
    const strategiesConfig = this._buildStrategyConfig();
    this._strategyEngine = new StrategyEngine({ strategies: strategiesConfig });

    // 使用统一的 FactorBuilder 获取可用因子列表
    const { getAvailableFactorIds } = require('../core/FactorBuilder');
    const availableFactorIds = getAvailableFactorIds();

    // 转换策略配置格式：{ buyStrategies: [...], sellStrategies: [...] } -> 扁平数组
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
          cooldown: s.cooldown || 300,
          cards: s.cards || 1,
          maxExecutions: s.maxExecutions || null,
          enabled: true
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
          cooldown: s.cooldown || 300,
          cards: s.cards || 1,
          maxExecutions: s.maxExecutions || null,
          enabled: true
        });
      });
    }

    this._strategyEngine.loadStrategies(strategyArray, availableFactorIds);
    console.log(`✅ 策略引擎初始化完成，加载了 ${this._strategyEngine.getStrategyCount()} 个策略`);

    // 6. 初始化卡牌仓位管理配置
    const experimentConfig = this._experiment?.config || {};
    this._positionManagement = experimentConfig.positionManagement || experimentConfig.strategy?.positionManagement || null;
    if (this._positionManagement && this._positionManagement.enabled) {
      console.log(`✅ 卡牌仓位管理已启用: 总卡牌数=${this._positionManagement.totalCards || 4}, 单卡BNB=${this._positionManagement.perCardMaxBNB || 0.025}`);
    }

    // 7. 初始化时序数据服务
    const { ExperimentTimeSeriesService } = require('../../web/services/ExperimentTimeSeriesService');
    this.timeSeriesService = new ExperimentTimeSeriesService();

    // 8. 加载持仓数据
    await this._loadHoldings();
  }

  /**
   * 启动监控循环
   * @private
   */
  _startMonitoringLoop() {
    const interval = config.monitor.interval || 10000;

    this._monitoringTimer = setInterval(async () => {
      await this._monitoringCycle();
    }, interval);

    console.log(`🔄 监控循环已启动，间隔: ${interval}ms`);
    this.logger.info(this._experimentId, 'VirtualTradingEngine', '监控循环已启动', {
      interval: interval
    });
  }

  /**
   * 监控循环主逻辑
   * @private
   * @returns {Promise<void>}
   */
  async _monitoringCycle() {
    this._loopCount++;
    const startTime = Date.now();

    if (this._roundSummary) {
      this._roundSummary.startRound(this._loopCount);
    }

    this.logger.info(this._experimentId, 'MonitoringCycle',
      `开始第 ${this._loopCount} 轮监控`);

    try {
      if (this._roundSummary) {
        const collectorStats = this._fourmemeCollector.getStats();
        this._roundSummary.recordCollectorStats({
          lastFetched: collectorStats.lastFetched || 0,
          lastAdded: collectorStats.lastAdded || 0,
          lastSkipped: collectorStats.lastSkipped || 0,
          poolSize: collectorStats.poolSize,
          monitoringCount: collectorStats.monitoringCount,
          boughtCount: collectorStats.boughtCount
        });
      }

      const tokens = this._tokenPool.getMonitoringTokens();
      this.logger.debug(this._experimentId, 'MonitoringCycle',
        `池中监控代币数: ${tokens.length} (monitoring+bought)`);

      if (tokens.length === 0) {
        this.logger.debug(this._experimentId, 'MonitoringCycle',
          `第 ${this._loopCount} 轮监控: 无代币需要处理`);
        if (this._roundSummary) {
          this._roundSummary.printToConsole();
          this._roundSummary.writeToLog();
        }
        return;
      }

      await this._fetchBatchPrices(tokens);

      // 存储因子数据用于清理不活跃代币
      const factorResultsMap = new Map();

      for (const token of tokens) {
        await this._processToken(token);
        // 收集因子数据用于后续清理判断
        const factorResults = this._buildFactors(token);
        factorResultsMap.set(token.token, factorResults);
      }

      // 🔧 清理低收益且无交易的代币
      const removedInactive = this._tokenPool.cleanupInactiveTokens(factorResultsMap);
      if (removedInactive.length > 0) {
        this.logger.info(this._experimentId, 'MonitoringCycle',
          `清理不活跃代币: ${removedInactive.length} 个 - ` +
          removedInactive.map(t => `${t.symbol}(${t.poolTimeMinutes}分钟, ${t.earlyReturn}%)`).join(', ')
        );
        // 同步 status 到数据库
        for (const t of removedInactive) {
          await this._updateTokenStatus(t.address, t.chain, 'inactive');
        }
      }

      const removed = this._tokenPool.cleanup();
      if (removed.length > 0) {
        this.logger.info(this._experimentId, 'MonitoringCycle',
          `清理过期代币: ${removed.length} 个`);
      }

      if (this._roundSummary) {
        const portfolio = this._buildPortfolioSummary();
        this._roundSummary.recordPortfolio(portfolio);
      }

      await this._createPortfolioSnapshot();

      if (this._roundSummary) {
        this._roundSummary.printToConsole();
        this._roundSummary.writeToLog();
      }

      const duration = Date.now() - startTime;
      this.logger.info(this._experimentId, 'MonitoringCycle',
        `第 ${this._loopCount} 轮监控完成，耗时: ${duration}ms`);

    } catch (error) {
      this.logger.error(this._experimentId, 'MonitoringCycle',
        `监控循环失败: ${error.message}`, { error: error.stack });
    }
  }

  /**
   * 处理单个代币
   * @private
   * @param {Object} token - 代币数据
   * @returns {Promise<void>}
   */
  async _processToken(token) {
    try {
      const tokenKey = `${token.token}-${token.chain}`;
      if (!this._seenTokens.has(tokenKey)) {
        await this.dataService.saveToken(this._experimentId, {
          token: token.token,
          symbol: token.symbol,
          chain: token.chain,
          platform: token.platform || 'fourmeme',
          created_at: token.createdAt,
          raw_api_data: token.rawApiData || null,
          contract_risk_raw_ave_data: token.contractRisk || null,
          creator_address: token.creatorAddress || null,
          status: token.status || 'monitoring'
        });
        this._seenTokens.add(tokenKey);
      }

      // bad_holder 状态的代币跳过后续处理
      if (token.status === 'bad_holder') {
        this.logger.info(this._experimentId, 'ProcessToken',
          `跳过黑名单持有者代币: ${token.symbol}`);
        return;
      }

      const currentPrice = token.currentPrice || 0;
      if (currentPrice === 0) {
        if (this._roundSummary) {
          this._roundSummary.recordTokenIndicators(
            token.token,
            token.symbol,
            {
              type: 'error',
              error: '无法获取有效价格 (价格API无数据)',
              factorValues: { currentPrice: 0 }
            },
            0,
            {
              createdAt: token.createdAt,
              addedAt: token.addedAt,
              status: token.status,
              collectionPrice: token.collectionPrice,
              launchPrice: token.launchPrice,
              platform: token.platform
            }
          );
        }
        return;
      }

      const factorResults = this._buildFactors(token);

      console.log(`📊 [时序数据] 准备保存 | symbol=${token.symbol}, tokenAddress=${token.token}, price=${factorResults.currentPrice}`);

      // 使用统一的 FactorBuilder 序列化因子
      const { buildFactorValuesForTimeSeries } = require('../core/FactorBuilder');

      const recordResult = await this.timeSeriesService.recordRoundData({
        experimentId: this._experimentId,
        tokenAddress: token.token,
        tokenSymbol: token.symbol,
        timestamp: new Date(),
        loopCount: this._loopCount,
        priceUsd: factorResults.currentPrice,
        priceNative: null,
        factorValues: buildFactorValuesForTimeSeries(factorResults),
        blockchain: this._experiment.blockchain || 'bsc'
      });

      console.log(`📊 [时序数据] 保存结果 | symbol=${token.symbol}, result=${recordResult}`);
      if (!recordResult) {
        this.logger.warn(this._experimentId, 'ProcessToken',
          `时序数据保存失败 | symbol=${token.symbol}, tokenAddress=${token.token}`);
      }

      if (this._roundSummary) {
        this._roundSummary.recordTokenIndicators(
          token.token,
          token.symbol,
          {
            type: 'factor-based',
            factorCount: Object.keys(factorResults).length,
            strategyCount: this._strategyEngine.getStrategyCount(),
            factorValues: factorResults,
            triggeredStrategy: null
          },
          factorResults.currentPrice,
          {
            createdAt: token.createdAt,
            addedAt: token.addedAt,
            status: token.status,
            collectionPrice: token.collectionPrice,
            launchPrice: token.launchPrice,
            platform: token.platform
          }
        );
      }

      const strategy = this._strategyEngine.evaluate(
        factorResults,
        token.token,
        Date.now(),
        token
      );

      if (strategy) {
        if (strategy.action === 'buy' && token.status !== 'monitoring') {
          this.logger.debug(this._experimentId, 'ProcessToken',
            `${token.symbol} 买入策略跳过 (状态: ${token.status})`);
          return;
        }
        if (strategy.action === 'sell' && token.status !== 'bought') {
          this.logger.debug(this._experimentId, 'ProcessToken',
            `${token.symbol} 卖出策略跳过 (状态: ${token.status})`);
          return;
        }
      }

      if (strategy) {
        this.logger.info(this._experimentId, 'ProcessToken',
          `${token.symbol} 触发策略: ${strategy.name} (${strategy.action})`);

        if (this._roundSummary) {
          this._roundSummary.recordSignal(token.token, {
            direction: strategy.action.toUpperCase(),
            action: strategy.action,
            confidence: 80,
            reason: strategy.name
          });

          const tokenData = this._roundSummary.getRoundData()?.tokens?.find(t => t.address === token.token);
          if (tokenData && tokenData.indicators) {
            tokenData.indicators.triggeredStrategy = strategy;
          }
        }

        const executed = await this._executeStrategy(strategy, token, factorResults);

        if (this._roundSummary) {
          this._roundSummary.recordSignalExecution(
            token.token,
            executed,
            executed ? null : '执行失败'
          );
        }
      }

      if (this._roundSummary && token.status === 'bought') {
        const holding = this._getHolding(token.token);
        if (holding) {
          this._roundSummary.recordPosition(token.token, {
            symbol: token.symbol,
            amount: holding.amount,
            buyPrice: holding.avgBuyPrice,
            currentPrice: factorResults.currentPrice
          });
        }
      }

    } catch (error) {
      this.logger.error(this._experimentId, 'ProcessToken',
        `处理代币 ${token.symbol} 失败: ${error.message}`);
    }
  }

  /**
   * 批量获取代币价格
   * @private
   * @param {Array} tokens - 代币数组
   * @returns {Promise<Object>} 价格信息字典
   */
  async _fetchBatchPrices(tokens) {
    try {
      if (!tokens || tokens.length === 0) {
        return {};
      }

      const tokenIds = tokens.map(t => `${t.token}-${t.chain}`);
      const batchSize = 200;
      const allPrices = {};

      for (let i = 0; i < tokenIds.length; i += batchSize) {
        const batchIds = tokenIds.slice(i, i + batchSize);

        const prices = await this._aveTokenApi.getTokenPrices(
          batchIds,
          0,
          0
        );

        for (const token of tokens) {
          const tokenId = `${token.token}-${token.chain}`;
          const priceInfo = prices[tokenId];

          if (priceInfo && priceInfo.current_price_usd) {
            const price = parseFloat(priceInfo.current_price_usd);
            if (price > 0) {
              const extraData = {
                txVolumeU24h: parseFloat(priceInfo.tx_volume_u_24h) || 0,
                holders: parseInt(priceInfo.holders) || 0,
                tvl: parseFloat(priceInfo.tvl) || 0,
                fdv: parseFloat(priceInfo.fdv) || 0,
                marketCap: parseFloat(priceInfo.market_cap) || 0
              };
              this._tokenPool.updatePrice(token.token, token.chain, price, Date.now(), extraData);
            }
          }
        }

        Object.assign(allPrices, prices);
      }

      return allPrices;

    } catch (error) {
      this.logger.error(this._experimentId, 'FetchBatchPrices',
        `批量获取价格失败: ${error.message}`);
      return {};
    }
  }

  /**
   * 构建策略因子
   * @private
   * @param {Object} token - 代币数据
   * @returns {Object} 因子结果
   */
  _buildFactors(token) {
    const now = Date.now();
    const currentPrice = token.currentPrice || 0;
    const launchPrice = token.launchPrice || 0;

    let earlyReturn = 0;
    if (launchPrice > 0 && currentPrice > 0) {
      earlyReturn = ((currentPrice - launchPrice) / launchPrice) * 100;
    }

    // collectionPrice 保留用于兼容和调试
    const collectionPrice = token.collectionPrice || currentPrice;

    // age 基于代币创建时间（AVE API 的 created_at），而不是收集时间
    const tokenCreatedAt = token.createdAt || Date.now() / 1000;
    const age = (now - tokenCreatedAt * 1000) / 1000 / 60;

    let riseSpeed = 0;
    if (age > 0) {
      riseSpeed = earlyReturn / age;
    }

    const holdDuration = token.buyTime ? (now - token.buyTime) / 1000 : 0;

    let profitPercent = 0;
    if (token.buyPrice && token.buyPrice > 0 && currentPrice > 0) {
      profitPercent = ((currentPrice - token.buyPrice) / token.buyPrice) * 100;
    }

    const highestPrice = token.highestPrice || launchPrice || currentPrice;
    const highestPriceTimestamp = token.highestPriceTimestamp || collectionTime;

    let drawdownFromHighest = 0;
    if (highestPrice > 0 && currentPrice > 0) {
      drawdownFromHighest = ((currentPrice - highestPrice) / highestPrice) * 100;
    }

    const factors = {
      age: age,
      currentPrice: currentPrice,
      collectionPrice: collectionPrice,
      launchPrice: launchPrice,
      earlyReturn: earlyReturn,
      riseSpeed: riseSpeed,
      buyPrice: token.buyPrice || 0,
      holdDuration: holdDuration,
      profitPercent: profitPercent,
      highestPrice: highestPrice,
      highestPriceTimestamp: highestPriceTimestamp,
      drawdownFromHighest: drawdownFromHighest,
      txVolumeU24h: token.txVolumeU24h || 0,
      holders: token.holders || 0,
      tvl: token.tvl || 0,
      fdv: token.fdv || 0,
      marketCap: token.marketCap || 0
    };

    // 趋势检测指标因子（只生成数值指标，不做判断）
    const prices = this._tokenPool.getTokenPrices(token.token, token.chain);
    factors.trendDataPoints = prices.length;

    if (prices.length >= 6 && this._trendDetector) {
      // 使用最近的10个数据点（或全部，如果不足10个）
      // 注意：prices 数组中最新价格在末尾，所以用负索引取最近的 N 个
      const _prices = prices.slice(-Math.min(10, prices.length));

      // 四步法核心指标
      factors.trendCV = this._trendDetector._calculateCV(_prices);

      const _direction = this._trendDetector._confirmDirection(_prices);
      factors.trendDirectionCount = _direction.passed;

      const _strength = this._trendDetector._calculateTrendStrength(_prices);
      factors.trendStrengthScore = _strength.score;
      factors.trendTotalReturn = _strength.details.totalReturn;
      factors.trendRiseRatio = _strength.details.riseRatio;

      // 卖出相关指标
      const _checkSize = Math.min(5, _prices.length);
      const _recentPrices = _prices.slice(-_checkSize);
      let _downCount = 0;
      for (let i = 1; i < _recentPrices.length; i++) {
        if (_recentPrices[i] < _recentPrices[i - 1]) _downCount++;
      }
      factors.trendRecentDownCount = _downCount;
      factors.trendRecentDownRatio = _downCount / Math.max(1, _recentPrices.length - 1);

      let _consecutiveDowns = 0;
      for (let i = _prices.length - 1; i > 0; i--) {
        if (_prices[i] < _prices[i - 1]) {
          _consecutiveDowns++;
        } else {
          break;
        }
      }
      factors.trendConsecutiveDowns = _consecutiveDowns;

      factors.trendPriceChangeFromDetect = currentPrice > 0 && _prices[_prices.length - 1] > 0
        ? ((currentPrice - _prices[_prices.length - 1]) / _prices[_prices.length - 1]) * 100
        : 0;

      // 持仓后指标
      if (token.buyTime && token.buyPrice) {
        const _buyPriceIndex = prices.findIndex(p => Math.abs(p - token.buyPrice) / token.buyPrice < 0.01);
        if (_buyPriceIndex >= 0 && _buyPriceIndex < prices.length - 1) {
          factors.trendSinceBuyReturn = ((prices[prices.length - 1] - prices[_buyPriceIndex]) / prices[_buyPriceIndex]) * 100;
          factors.trendSinceBuyDataPoints = prices.length - _buyPriceIndex;
        } else {
          factors.trendSinceBuyReturn = profitPercent;
          factors.trendSinceBuyDataPoints = 0;
        }
      }
    } else {
      // 数据不足时的默认值
      factors.trendCV = 0;
      factors.trendDirectionCount = 0;
      factors.trendStrengthScore = 0;
      factors.trendTotalReturn = earlyReturn;
      factors.trendRiseRatio = 0;
      factors.trendRecentDownCount = 0;
      factors.trendRecentDownRatio = 0;
      factors.trendConsecutiveDowns = 0;
      factors.trendPriceChangeFromDetect = earlyReturn;
      factors.trendSinceBuyReturn = profitPercent;
      factors.trendSinceBuyDataPoints = 0;
    }

    return factors;
  }

  /**
   * 执行策略
   * @private
   * @param {Object} strategy - 策略对象
   * @param {Object} token - 代币数据
   * @param {Object} factorResults - 因子计算结果
   * @returns {Promise<boolean>} 是否执行成功
   */
  async _executeStrategy(strategy, token, factorResults = null) {
    const { CardPositionManager } = getLazyModules();
    const latestPrice = token.currentPrice || 0;

    if (!factorResults) {
      factorResults = this._buildFactors(token);
    }

    if (strategy.action === 'buy') {
      if (token.status !== 'monitoring') {
        return false;
      }

      // ========== 验证 creator_address ==========
      // 1. 如果创建者地址为 null，重新获取
      if (!token.creator_address) {
        this.logger.warn(this._experimentId, '_executeStrategy',
          `代币 creator_address 为 null，重新获取并验证 | symbol=${token.symbol}, address=${token.token}`);

        try {
          // 使用 FourMeme API 获取创建者地址
          const creatorInfo = await this._fourMemeApi.getCreatorAddress(token.token);

          if (creatorInfo.creator_address) {
            token.creator_address = creatorInfo.creator_address;
            // 更新数据库中的 creator_address
            await this.dataService.updateTokenCreatorAddress(this._experimentId, token.token, creatorInfo.creator_address);
            this.logger.info(this._experimentId, '_executeStrategy',
              `重新获取成功，继续 Dev 钱包检查 | symbol=${token.symbol}, creator=${creatorInfo.creator_address}`);
            // 重新获取成功，继续检查 Dev 钱包
          } else {
            this.logger.warn(this._experimentId, '_executeStrategy',
              `重新获取后仍无 creator_address，跳过 Dev 钱包检查，继续购买流程 | symbol=${token.symbol}, address=${token.token}`);
            // 跳过 Dev 钱包检查，直接继续购买流程
          }
        } catch (error) {
          this.logger.warn(this._experimentId, '_executeStrategy',
            `重新获取 creator_address 失败，跳过 Dev 钱包检查，继续购买流程 | symbol=${token.symbol}, error=${error.message}`);
          // API 调用失败，跳过 Dev 钱包检查，直接继续购买流程
        }
      }

      // 2. 如果创建者地址存在，检查是否为 Dev 钱包
      if (token.creator_address) {
        this.logger.info(this._experimentId, '_executeStrategy',
          `开始 Dev 钱包检查 | symbol=${token.symbol}, creator=${token.creator_address}`);
        const isNegativeDevWallet = await this.isNegativeDevWallet(token.creator_address);
        if (isNegativeDevWallet) {
          this.logger.error(this._experimentId, '_executeStrategy',
            `代币创建者为 Dev 钱包，拒绝购买 | symbol=${token.symbol}, address=${token.token}, creator=${token.creator_address}`);
          return false;
        }
        this.logger.info(this._experimentId, '_executeStrategy',
          `Dev 钱包检查通过，继续购买流程 | symbol=${token.symbol}`);
      } else {
        this.logger.info(this._experimentId, '_executeStrategy',
          `无 creator_address，跳过 Dev 钱包检查，继续购买流程 | symbol=${token.symbol}`);
      }
      // ========== Dev 钱包验证结束 ==========

      // 功能二：购买前持有者二次检测
      if (this._tokenHolderService) {
        try {
          this.logger.info(this._experimentId, '_executeStrategy',
            `开始持有者黑名单检测 | symbol=${token.symbol}`);

          const holderCheck = await this._tokenHolderService.checkHolderRisk(
            token.token,
            this._experimentId,  // 传递实验ID
            token.chain || 'bsc',
            ['pump_group', 'negative_holder']
          );

          if (holderCheck.hasNegative) {
            this.logger.warn(this._experimentId, '_executeStrategy',
              `拒绝购买: ${token.symbol} - ${holderCheck.reason}`);

            // 记录被阻止的信号
            if (this._roundSummary) {
              this._roundSummary.recordSignal(token.token, {
                direction: 'BUY',
                action: 'buy',
                confidence: 0,
                reason: `黑名单持有者: ${holderCheck.reason}`,
                blocked: true,
                blockReason: 'bad_holder'
              });
            }

            return false;
          }

          this.logger.info(this._experimentId, '_executeStrategy',
            `持有者黑名单检测通过 | symbol=${token.symbol}`);
        } catch (holderError) {
          this.logger.error(this._experimentId, '_executeStrategy',
            `持有者检测失败: ${token.symbol} - ${holderError.message}`);
          // 检测失败时继续流程，避免阻止正常购买
        }
      }
      // ========== 持有者检测结束 ==========

      if (!token.strategyExecutions) {
        const strategyIds = this._strategyEngine.getAllStrategies().map(s => s.id);
        this._tokenPool.initStrategyExecutions(token.token, token.chain, strategyIds);
      }

      if (this._positionManagement && this._positionManagement.enabled) {
        let cardManager = this._tokenPool.getCardPositionManager(token.token, token.chain);
        if (!cardManager) {
          cardManager = new CardPositionManager({
            totalCards: this._positionManagement.totalCards || 4,
            perCardMaxBNB: this._positionManagement.perCardMaxBNB || 0.25,
            minCardsForTrade: 1,
            initialAllocation: {
              bnbCards: (this._positionManagement.totalCards || 4),
              tokenCards: 0
            }
          });
          this._tokenPool.setCardPositionManager(token.token, token.chain, cardManager);
          this.logger.info(this._experimentId, '_executeStrategy',
            `初始化卡牌管理器: ${token.symbol}, 全部BNB卡状态`);
        }
      }

      const signal = {
        action: 'buy',
        symbol: token.symbol,
        tokenAddress: token.token,
        chain: token.chain,
        price: latestPrice,
        confidence: 80,
        reason: strategy.name,
        cards: strategy.cards || 1,
        strategyId: strategy.id,
        strategyName: strategy.name,
        cardConfig: this._positionManagement?.enabled ? {
          totalCards: this._positionManagement.totalCards || 4,
          perCardMaxBNB: this._positionManagement.perCardMaxBNB || 0.25
        } : null,
        factors: factorResults ? {
          age: factorResults.age,
          currentPrice: factorResults.currentPrice,
          collectionPrice: factorResults.collectionPrice,
          earlyReturn: factorResults.earlyReturn,
          riseSpeed: factorResults.riseSpeed,
          buyPrice: factorResults.buyPrice,
          holdDuration: factorResults.holdDuration,
          profitPercent: factorResults.profitPercent,
          highestPrice: factorResults.highestPrice,
          highestPriceTimestamp: factorResults.highestPriceTimestamp,
          drawdownFromHighest: factorResults.drawdownFromHighest,
          txVolumeU24h: factorResults.txVolumeU24h,
          holders: factorResults.holders,
          tvl: factorResults.tvl,
          fdv: factorResults.fdv,
          marketCap: factorResults.marketCap,
          // 趋势检测因子
          trendDataPoints: factorResults.trendDataPoints,
          trendCV: factorResults.trendCV,
          trendDirectionCount: factorResults.trendDirectionCount,
          trendStrengthScore: factorResults.trendStrengthScore,
          trendTotalReturn: factorResults.trendTotalReturn,
          trendRiseRatio: factorResults.trendRiseRatio,
          trendRecentDownCount: factorResults.trendRecentDownCount,
          trendRecentDownRatio: factorResults.trendRecentDownRatio,
          trendConsecutiveDowns: factorResults.trendConsecutiveDowns,
          trendPriceChangeFromDetect: factorResults.trendPriceChangeFromDetect,
          trendSinceBuyReturn: factorResults.trendSinceBuyReturn,
          trendSinceBuyDataPoints: factorResults.trendSinceBuyDataPoints
        } : null
      };

      this.logger.info(this._experimentId, '_executeStrategy',
        `调用 processSignal | symbol=${token.symbol}, action=${signal.action}`);
      const result = await this.processSignal(signal);
      this.logger.info(this._experimentId, '_executeStrategy',
        `processSignal 返回 | symbol=${token.symbol}, success=${result?.success}, reason=${result?.reason || result?.message || 'none'}`);

      if (result && result.success) {
        this._tokenPool.markAsBought(token.token, token.chain, {
          buyPrice: latestPrice,
          buyTime: Date.now()
        });

        this._tokenPool.recordStrategyExecution(token.token, token.chain, strategy.id);

        await this.dataService.updateTokenStatus(this._experimentId, token.token, 'bought');

        return true;
      }

      return false;

    } else if (strategy.action === 'sell') {
      if (token.status !== 'bought') {
        return false;
      }

      const cardManager = this._tokenPool.getCardPositionManager(token.token, token.chain);

      if (!cardManager) {
        this.logger.warn(this._experimentId, '_executeStrategy',
          `代币 ${token.symbol} 没有卡牌管理器，跳过卖出`);
        return false;
      }

      const cards = strategy.cards || 'all';
      const sellAll = (cards === 'all');

      let sellCalculatedRatio = 1.0;
      if (!sellAll) {
        const cardNum = parseInt(cards);
        if (!isNaN(cardNum) && cardNum > 0) {
          sellCalculatedRatio = cardNum / cardManager.totalCards;
        }
      }

      const signal = {
        action: 'sell',
        symbol: token.symbol,
        tokenAddress: token.token,
        chain: token.chain,
        price: latestPrice,
        confidence: 80,
        reason: strategy.name,
        cards: strategy.cards || 'all',
        strategyId: strategy.id,
        strategyName: strategy.name,
        buyPrice: token.buyPrice || null,
        profitPercent: token.buyPrice && latestPrice ? ((latestPrice - token.buyPrice) / token.buyPrice * 100) : null,
        holdDuration: token.buyTime ? ((Date.now() - token.buyTime) / 1000) : null,
        cardConfig: this._positionManagement?.enabled ? {
          totalCards: this._positionManagement.totalCards || 4,
          perCardMaxBNB: this._positionManagement.perCardMaxBNB || 0.25
        } : null,
        sellCalculatedRatio: sellCalculatedRatio,
        factors: factorResults ? {
          age: factorResults.age,
          currentPrice: factorResults.currentPrice,
          collectionPrice: factorResults.collectionPrice,
          earlyReturn: factorResults.earlyReturn,
          riseSpeed: factorResults.riseSpeed,
          buyPrice: factorResults.buyPrice,
          holdDuration: factorResults.holdDuration,
          profitPercent: factorResults.profitPercent,
          highestPrice: factorResults.highestPrice,
          highestPriceTimestamp: factorResults.highestPriceTimestamp,
          drawdownFromHighest: factorResults.drawdownFromHighest,
          txVolumeU24h: factorResults.txVolumeU24h,
          holders: factorResults.holders,
          tvl: factorResults.tvl,
          fdv: factorResults.fdv,
          marketCap: factorResults.marketCap,
          // 趋势检测因子
          trendDataPoints: factorResults.trendDataPoints,
          trendCV: factorResults.trendCV,
          trendDirectionCount: factorResults.trendDirectionCount,
          trendStrengthScore: factorResults.trendStrengthScore,
          trendTotalReturn: factorResults.trendTotalReturn,
          trendRiseRatio: factorResults.trendRiseRatio,
          trendRecentDownCount: factorResults.trendRecentDownCount,
          trendRecentDownRatio: factorResults.trendRecentDownRatio,
          trendConsecutiveDowns: factorResults.trendConsecutiveDowns,
          trendPriceChangeFromDetect: factorResults.trendPriceChangeFromDetect,
          trendSinceBuyReturn: factorResults.trendSinceBuyReturn,
          trendSinceBuyDataPoints: factorResults.trendSinceBuyDataPoints
        } : null
      };

      const result = await this.processSignal(signal);

      if (result && result.success) {
        this._tokenPool.recordStrategyExecution(token.token, token.chain, strategy.id);
        return true;
      }

      return false;
    }

    return false;
  }

  /**
   * 计算买入金额（Virtual 特有：使用卡牌管理器）
   * @protected
   * @param {Object} signal - 信号
   * @returns {number} BNB金额
   */
  _calculateBuyAmount(signal) {
    this.logger.info(this._experimentId, '_calculateBuyAmount',
      `_calculateBuyAmount 被调用 | symbol=${signal.symbol}, tokenAddress=${signal.tokenAddress}, chain=${signal.chain}, cards=${signal.cards}`);

    const cardManager = this._tokenPool.getCardPositionManager(signal.tokenAddress, signal.chain);
    this.logger.info(this._experimentId, '_calculateBuyAmount',
      `获取卡牌管理器 | cardManager=${cardManager ? '存在' : '不存在'}`);

    if (cardManager) {
      const cards = signal.cards || 1;
      this.logger.info(this._experimentId, '_calculateBuyAmount',
        `卡牌管理器状态 | bnbCards=${cardManager.bnbCards}, tokenCards=${cardManager.tokenCards}, totalCards=${cardManager.totalCards}, perCardMaxBNB=${cardManager.perCardMaxBNB}`);

      const amount = cardManager.calculateBuyAmount(cards);
      this.logger.info(this._experimentId, '_calculateBuyAmount',
        `卡牌管理器计算金额 | cards=${cards}, amount=${amount}`);

      if (amount <= 0) {
        this.logger.warn(this._experimentId, '_calculateBuyAmount',
          `卡牌管理器返回金额为0: ${signal.symbol}`);
        return 0;
      }
      if (this.currentBalance < amount) {
        this.logger.warn(this._experimentId, '_calculateBuyAmount',
          `余额不足: 需要 ${amount} BNB, 当前 ${this.currentBalance.toFixed(4)} BNB`);
        return 0;
      }
      return amount;
    }

    const tradeAmount = this._experiment.config?.virtual?.tradeAmount || 0.1;

    if (this.currentBalance < tradeAmount) {
      this.logger.warn(this._experimentId, 'CalculateBuyAmount',
        `余额不足: 需要 ${tradeAmount} BNB, 当前 ${this.currentBalance.toFixed(4)} BNB`);
      return 0;
    }

    return tradeAmount;
  }

  /**
   * 检查创建者地址是否为 Dev 钱包
   * @private
   * @param {string} creatorAddress - 创建者地址
   * @returns {Promise<boolean>} 是否为 Dev 钱包
   */
  async isNegativeDevWallet(creatorAddress) {
    if (!creatorAddress) return false;

    try {
      const { WalletDataService } = require('../../web/services/WalletDataService');
      const walletService = new WalletDataService();

      const allWallets = await walletService.getWallets();
      const devWallets = allWallets.filter(w => w.category === 'dev');

      return devWallets.some(w =>
        w.address.toLowerCase() === creatorAddress.toLowerCase()
      );
    } catch (error) {
      this.logger.error(this._experimentId, 'isNegativeDevWallet',
        `检查 Dev 钱包失败 | error=${error.message}`);
      return false;
    }
  }

  /**
   * 加载持仓数据
   * @private
   */
  async _loadHoldings() {
    try {
      const trades = await this.dataService.getTrades(this._experimentId, {
        limit: 10000
      });

      if (!trades || trades.length === 0) {
        return;
      }

      const Decimal = require('decimal.js');

      for (const trade of trades.sort((a, b) => a.createdAt - b.createdAt)) {
        if (!trade.success) continue;

        try {
          let tokenAmount, tokenPrice;

          if (trade.tradeDirection === 'buy' || trade.direction === 'buy') {
            tokenAmount = trade.outputAmount || 0;
            tokenPrice = trade.unitPrice || 0;
          } else {
            tokenAmount = trade.inputAmount || 0;
            tokenPrice = trade.unitPrice || 0;
          }

          if (tokenAmount <= 0 || tokenPrice <= 0) {
            console.warn(`跳过无效交易: ${trade.tokenSymbol}, amount=${tokenAmount}, price=${tokenPrice}`);
            continue;
          }

          await this._portfolioManager.executeTrade(
            this._portfolioId,
            trade.tokenAddress,
            trade.tradeDirection || trade.direction,
            new Decimal(tokenAmount),
            new Decimal(tokenPrice),
            0.001
          );
        } catch (error) {
          console.error(`重放交易失败: ${trade.tokenSymbol} - ${error.message}`);
        }
      }

      const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);
      const holdingsCount = portfolio.positions.size;
      console.log(`📦 持仓加载完成: ${holdingsCount} 个代币, 余额 $${portfolio.cashBalance.toFixed(2)}`);

    } catch (error) {
      console.error('❌ 加载持仓失败:', error.message);
    }
  }

  /**
   * 启动引擎（覆盖基类方法）
   * @returns {Promise<void>}
   */
  async start() {
    if (this._status === EngineStatus.RUNNING) {
      console.warn('⚠️ 引擎已在运行');
      return;
    }

    // 调用基类 start 方法
    await super.start();

    // 启动收集器
    this._fourmemeCollector.start();
    console.log(`🔄 Fourmeme收集器已启动 (${config.collector.interval}ms间隔)`);
    this.logger.info(this._experimentId, 'VirtualTradingEngine', 'Fourmeme收集器已启动');

    // 启动监控循环
    this._startMonitoringLoop();

    console.log(`🚀 虚拟交易引擎已启动: 实验 ${this._experimentId}`);
    this.logger.info(this._experimentId, 'VirtualTradingEngine', '引擎已启动');
  }

  /**
   * 更新代币状态到数据库
   * @private
   * @param {string} tokenAddress - 代币地址
   * @param {string} chain - 链
   * @param {string} status - 状态
   * @returns {Promise<void>}
   */
  async _updateTokenStatus(tokenAddress, chain, status) {
    const { dbManager } = require('../../services/dbManager');
    const supabase = dbManager.getClient();

    const { error } = await supabase
      .from('experiment_tokens')
      .update({
        status: status,
        updated_at: new Date().toISOString()
      })
      .eq('experiment_id', this._experimentId)
      .eq('token_address', tokenAddress)
      .eq('blockchain', chain || 'bsc');

    if (error) {
      this.logger.error(this._experimentId, '_updateTokenStatus',
        `更新代币状态失败 | tokenAddress=${tokenAddress}, status=${status}, error=${error.message}`);
    } else {
      this.logger.debug(this._experimentId, '_updateTokenStatus',
        `代币状态已更新 | tokenAddress=${tokenAddress}, status=${status}`);
    }
  }

  /**
   * 停止引擎（覆盖基类方法）
   * @returns {Promise<void>}
   */
  async stop() {
    if (this._isStopped) {
      return;
    }

    // 停止收集器
    if (this._fourmemeCollector) {
      this._fourmemeCollector.stop();
      console.log(`⏹️ Fourmeme收集器已停止`);
    }

    // 停止监控循环
    if (this._monitoringTimer) {
      clearInterval(this._monitoringTimer);
      this._monitoringTimer = null;
      console.log(`⏹️ 监控循环已停止`);
    }

    // 调用基类 stop 方法
    await super.stop();

    console.log(`🛑 虚拟交易引擎已停止: 实验 ${this._experimentId}`);
    this.logger.info(this._experimentId, 'VirtualTradingEngine', '引擎已停止', {
      metrics: this.metrics,
      loopCount: this._loopCount
    });
  }

  // 注意：不再允许使用硬编码策略
  // 策略必须在实验配置中通过 config.strategiesConfig 明确定义
}

module.exports = { VirtualTradingEngine };
