/**
 * 回测引擎
 * 用于 fourmeme 交易实验的历史数据回放
 * 继承自 AbstractTradingEngine
 */

const { TradingMode, EngineStatus } = require('../interfaces/ITradingEngine');
const { AbstractTradingEngine } = require('../core/AbstractTradingEngine');
const { ExperimentDataService } = require('../../web/services/ExperimentDataService');
const Logger = require('../../services/logger');

// 延迟导入以避免循环依赖
let TokenPool = null;
let StrategyEngine = null;
let CardPositionManager = null;

function getLazyModules() {
  if (!TokenPool) {
    TokenPool = require('../../core/token-pool');
    const SE = require('../../strategies/StrategyEngine');
    StrategyEngine = SE.StrategyEngine;
    const CPM = require('../../portfolio/CardPositionManager');
    CardPositionManager = CPM.CardPositionManager;
  }
  return { TokenPool, StrategyEngine, CardPositionManager };
}

// 加载配置
const config = require('../../../config/default.json');

/**
 * 回测引擎
 * @class
 * @extends AbstractTradingEngine
 */
class BacktestEngine extends AbstractTradingEngine {
  /**
   * 构造函数
   * @param {Object} options - 配置选项
   */
  constructor(options = {}) {
    super({
      id: `backtest_${Date.now()}`,
      name: 'Fourmeme Backtest Engine',
      mode: TradingMode.BACKTEST,
      blockchain: options.blockchain || 'bsc',
      ...options
    });

    // Backtest 特有属性
    this._sourceExperimentId = null;
    this._historicalData = [];
    this._groupedData = [];
    this._currentDataIndex = 0;
    this._currentLoopCount = 0;

    // 虚拟资金管理（余额从 PortfolioManager 获取，不再单独维护）
    this.initialBalance = 100;

    // 统计信息
    this.metrics = {
      totalTrades: 0,
      successfulTrades: 0,
      failedTrades: 0,
      totalSignals: 0,
      executedSignals: 0,
      processedDataPoints: 0
    };

    // 服务
    this.dataService = new ExperimentDataService();
    this.timeSeriesService = null;
    this.logger = new Logger({ dir: './logs', experimentId: null });

    // Backtest 特有组件
    this._positionManagement = null;

    // 代币追踪
    this._seenTokens = new Set();
    this._tokenStates = new Map();

    console.log(`📊 回测引擎已创建: ${this.id}`);
  }

  // ==================== 抽象方法实现 ====================

  /**
   * 初始化数据源（Backtest 特有：加载历史数据）
   * @protected
   * @returns {Promise<void>}
   */
  async _initializeDataSources() {
    // 从配置获取源实验ID
    this._sourceExperimentId = this._experiment.config?.backtest?.sourceExperimentId;
    if (!this._sourceExperimentId) {
      throw new Error('回测实验缺少源实验ID配置 (config.backtest.sourceExperimentId)');
    }

    // 从配置获取初始余额
    if (this._experiment.config?.backtest?.initialBalance) {
      this.initialBalance = this._experiment.config.backtest.initialBalance;
    }

    // 验证源实验存在
    const { ExperimentFactory } = require('../factories/ExperimentFactory');
    const factory = ExperimentFactory.getInstance();
    const sourceExp = await factory.load(this._sourceExperimentId);
    if (!sourceExp) {
      throw new Error(`源实验不存在: ${this._sourceExperimentId}`);
    }

    console.log(`📊 回测配置: 源实验=${this._sourceExperimentId}, 初始余额=${this.initialBalance}`);

    // 初始化 Backtest 特有组件
    await this._initializeBacktestComponents();

    // 加载历史数据
    await this._loadHistoricalData();

    console.log(`📊 加载了 ${this._historicalData.length} 条历史数据点`);
  }

  /**
   * 运行主循环（Backtest 特有：遍历历史数据）
   * @protected
   * @returns {Promise<void>}
   */
  async _runMainLoop() {
    const startTime = Date.now();
    let completedSuccessfully = false;

    try {
      console.log(`📊 开始回测，共 ${this._groupedData.length} 个轮次`);

      for (const roundData of this._groupedData) {
        const { loopCount, dataPoints } = roundData;

        this._currentLoopCount = loopCount;
        this._loopCount = loopCount;

        this.logger.info(this._experimentId, 'BacktestEngine',
          `开始处理第 ${loopCount} 轮，数据点数: ${dataPoints.length}`);

        if (this._roundSummary) {
          this._roundSummary.startRound(loopCount);
        }

        for (const dataPoint of dataPoints) {
          await this._processTimePoint(dataPoint);
        }

        await this._createPortfolioSnapshot();

        if (this._roundSummary) {
          this._roundSummary.printToConsole();
          this._roundSummary.writeToLog();
        }

        this.metrics.processedDataPoints += dataPoints.length;
      }

      const duration = Date.now() - startTime;
      console.log(`✅ 回测完成，耗时: ${duration}ms`);
      console.log(`📊 处理了 ${this.metrics.processedDataPoints} 个数据点`);

      // 输出回测结果汇总
      // 从 PortfolioManager 获取最终余额
      const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);
      const finalBalance = portfolio?.totalValue || this.initialBalance;
      const finalBalanceValue = typeof finalBalance === 'number' ? finalBalance : finalBalance.toNumber();
      const profit = finalBalanceValue - this.initialBalance;
      const profitPercent = ((profit / this.initialBalance) * 100).toFixed(2);
      console.log(``);
      console.log(`========================================`);
      console.log(`📊 回测结果汇总`);
      console.log(`========================================`);
      console.log(`初始余额: ${this.initialBalance} BSC`);
      console.log(`最终余额: ${finalBalanceValue.toFixed(2)} BSC`);
      console.log(`收益: ${profit.toFixed(2)} BSC (${profitPercent > 0 ? '+' : ''}${profitPercent}%)`);
      console.log(`总交易次数: ${this.metrics.totalTrades}`);
      console.log(`成功交易: ${this.metrics.successfulTrades}`);
      console.log(`失败交易: ${this.metrics.failedTrades}`);
      console.log(`总信号数: ${this.metrics.totalSignals}`);
      console.log(`执行信号数: ${this.metrics.executedSignals}`);
      console.log(`========================================`);

      completedSuccessfully = true;

    } catch (error) {
      console.error(`❌ 回测执行失败: ${error.message}`);
      console.error(error.stack);
    } finally {
      // 更新实验状态
      try {
        const { ExperimentFactory } = require('../factories/ExperimentFactory');
        const factory = ExperimentFactory.getInstance();

        const finalStatus = completedSuccessfully ? 'completed' : 'failed';

        console.log(`📊 更新实验状态为: ${finalStatus}`);

        const additionalData = {};
        if (completedSuccessfully) {
          additionalData.config = this._experiment?.config || {};
        }

        await factory.updateStatus(this._experimentId, finalStatus, additionalData);
        this._status = EngineStatus.STOPPED;

        if (completedSuccessfully) {
          console.log(`✅ 回测实验已完成，状态已更新`);
        } else {
          console.log(`⚠️ 回测实验失败，状态已更新`);
        }
      } catch (updateError) {
        console.error(`❌ 更新实验状态失败: ${updateError.message}`);
      }
    }
  }

  /**
   * 同步持仓数据（Backtest 特有：从历史数据回放）
   * @protected
   * @returns {Promise<void>}
   */
  async _syncHoldings() {
    // Backtest 引擎从历史数据回放持仓
    // 持仓在 _processTimePoint 中通过交易历史数据重建
  }

  /**
   * 执行买入（Backtest 特有：使用历史时间戳）
   * @protected
   * @param {Object} signal - 买入信号
   * @param {string} signalId - 信号ID
   * @param {Object} metadata - 元数据
   * @param {Date} timestamp - 历史时间戳
   * @returns {Promise<Object>} 交易结果
   */
  async _executeBuy(signal, signalId = null, metadata = {}, timestamp = null) {
    try {
      const cardManager = this._tokenPool.getCardPositionManager(signal.tokenAddress, signal.chain);
      if (!cardManager) {
        return { success: false, reason: '卡牌管理器未初始化' };
      }

      const beforeCardState = {
        bnbCards: cardManager.bnbCards,
        tokenCards: cardManager.tokenCards,
        totalCards: cardManager.totalCards
      };

      const amountInBNB = this._calculateBuyAmount(signal);
      if (amountInBNB <= 0) {
        return { success: false, reason: '余额不足或计算金额为0' };
      }

      const price = signal.price || 0;
      const tokenAmount = price > 0 ? amountInBNB / price : 0;

      const tradeRequest = {
        tokenAddress: signal.tokenAddress,
        symbol: signal.symbol,
        direction: 'buy',
        amount: tokenAmount,
        price: price,
        signalId: signalId,
        timestamp: timestamp,
        metadata: {
          ...metadata,
          cards: signal.cards,
          cardPositionChange: {
            before: { ...beforeCardState }
          }
        }
      };

      const result = await this.executeTrade(tradeRequest);

      // 更新统计信息
      this.metrics.totalTrades++;
      if (result && result.success) {
        this.metrics.successfulTrades++;
        const cards = parseInt(signal.cards) || 1;
        cardManager.afterBuy(signal.symbol, cards);

        const afterCardState = {
          bnbCards: cardManager.bnbCards,
          tokenCards: cardManager.tokenCards,
          totalCards: cardManager.totalCards
        };

        if (!result.trade.metadata) {
          result.trade.metadata = {};
        }
        result.trade.metadata.cardPositionChange = {
          before: { ...beforeCardState },
          after: { ...afterCardState },
          transferredCards: cards
        };

        const tradeId = result.trade?.id;
        if (tradeId) {
          await this.dataService.updateTrade(tradeId, {
            metadata: result.trade.metadata
          });
        }
      } else {
        this.metrics.failedTrades++;
      }

      return result;

    } catch (error) {
      return { success: false, reason: error.message };
    }
  }

  /**
   * 执行卖出（Backtest 特有：使用历史时间戳）
   * @protected
   * @param {Object} signal - 卖出信号
   * @param {string} signalId - 信号ID
   * @param {Object} metadata - 元数据
   * @param {Date} timestamp - 历史时间戳
   * @returns {Promise<Object>} 交易结果
   */
  async _executeSell(signal, signalId = null, metadata = {}, timestamp = null) {
    try {
      const holding = this._getHolding(signal.tokenAddress);
      if (!holding || holding.amount <= 0) {
        return { success: false, reason: '无持仓' };
      }

      const cardManager = this._tokenPool.getCardPositionManager(signal.tokenAddress, signal.chain);
      if (!cardManager) {
        return { success: false, reason: '卡牌管理器未初始化' };
      }

      const beforeCardState = {
        bnbCards: cardManager.bnbCards,
        tokenCards: cardManager.tokenCards,
        totalCards: cardManager.totalCards
      };

      const cards = signal.cards || 'all';
      const sellAll = (cards === 'all');
      const cardsToUse = sellAll ? null : parseInt(cards);
      const amountToSell = cardManager.calculateSellAmount(holding.amount, signal.symbol, cardsToUse, sellAll);

      if (amountToSell <= 0) {
        return { success: false, reason: '计算卖出数量为0' };
      }

      const price = signal.price || 0;

      const tradeRequest = {
        tokenAddress: signal.tokenAddress,
        symbol: signal.symbol,
        direction: 'sell',
        amount: amountToSell,
        price: price,
        signalId: signalId,
        timestamp: timestamp,
        metadata: {
          ...metadata,
          buyPrice: signal.buyPrice,
          profitPercent: signal.profitPercent,
          holdDuration: signal.holdDuration,
          cards: signal.cards,
          cardPositionChange: {
            before: { ...beforeCardState }
          }
        }
      };

      const result = await this.executeTrade(tradeRequest);

      // 更新统计信息
      this.metrics.totalTrades++;
      if (result && result.success) {
        this.metrics.successfulTrades++;
        const actualCards = sellAll ? beforeCardState.tokenCards : cardsToUse;
        cardManager.afterSell(signal.symbol, actualCards);

        const afterCardState = {
          bnbCards: cardManager.bnbCards,
          tokenCards: cardManager.tokenCards,
          totalCards: cardManager.totalCards
        };

        if (!result.trade.metadata) {
          result.trade.metadata = {};
        }
        result.trade.metadata.cardPositionChange = {
          before: { ...beforeCardState },
          after: { ...afterCardState },
          transferredCards: actualCards
        };

        const tradeId = result.trade?.id;
        if (tradeId) {
          await this.dataService.updateTrade(tradeId, {
            metadata: result.trade.metadata
          });
        }
      } else {
        this.metrics.failedTrades++;
      }

      return result;

    } catch (error) {
      return { success: false, reason: error.message };
    }
  }

  /**
   * 是否记录时序数据（Backtest 返回 false）
   * @protected
   * @returns {boolean}
   */
  _shouldRecordTimeSeries() {
    return false;
  }

  // ==================== Backtest 特有方法 ====================

  /**
   * 初始化 Backtest 特有组件
   * @private
   * @returns {Promise<void>}
   */
  async _initializeBacktestComponents() {
    const { TokenPool, StrategyEngine } = getLazyModules();

    // 1. 初始化代币池（简化版，用于状态管理）
    this._tokenPool = new TokenPool(this.logger);
    console.log(`✅ 代币池初始化完成`);

    // 2. 初始化策略引擎
    const strategies = this._buildStrategyConfig();
    this._strategyEngine = new StrategyEngine({ strategies });

    const availableFactorIds = new Set([
      'age', 'currentPrice', 'collectionPrice', 'earlyReturn', 'buyPrice',
      'holdDuration', 'profitPercent',
      'highestPrice', 'highestPriceTimestamp', 'drawdownFromHighest',
      'txVolumeU24h', 'holders', 'tvl', 'fdv', 'marketCap'
    ]);

    this._strategyEngine.loadStrategies(strategies, availableFactorIds);
    console.log(`✅ 策略引擎初始化完成，加载了 ${this._strategyEngine.getStrategyCount()} 个策略`);

    // 3. 初始化卡牌仓位管理配置
    const experimentConfig = this._experiment?.config || {};
    this._positionManagement = experimentConfig.positionManagement || experimentConfig.strategy?.positionManagement || null;
    if (this._positionManagement && this._positionManagement.enabled) {
      console.log(`✅ 卡牌仓位管理已启用: 总卡牌数=${this._positionManagement.totalCards || 4}, 单卡BNB=${this._positionManagement.perCardMaxBNB || 0.025}`);
    }

    // 4. 初始化时序数据服务（用于读取源实验数据）
    const { ExperimentTimeSeriesService } = require('../../web/services/ExperimentTimeSeriesService');
    this.timeSeriesService = new ExperimentTimeSeriesService();
  }

  /**
   * 加载历史数据（带重试机制）
   * @private
   * @returns {Promise<void>}
   */
  async _loadHistoricalData() {
    const MAX_RETRIES = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`📊 开始加载历史数据 (尝试 ${attempt}/${MAX_RETRIES})，源实验: ${this._sourceExperimentId}`);

        let data;
        try {
          data = await this.timeSeriesService.getExperimentTimeSeries(
            this._sourceExperimentId,
            null,
            {
              retryAttempt: attempt,
              maxRetries: MAX_RETRIES
            }
          );
        } catch (queryError) {
          console.warn(`⚠️  时序数据查询出现问题 (尝试 ${attempt}/${MAX_RETRIES}): ${queryError.message}`);
          lastError = queryError;

          if (attempt === MAX_RETRIES) {
            const { ExperimentFactory } = require('../factories/ExperimentFactory');
            const factory = ExperimentFactory.getInstance();
            const sourceExp = await factory.load(this._sourceExperimentId);

            if (!sourceExp) {
              throw new Error(`源实验不存在: ${this._sourceExperimentId}`);
            }

            if (sourceExp.tradingMode !== 'virtual') {
              throw new Error(`源实验必须是虚拟交易模式，当前模式: ${sourceExp.tradingMode}`);
            }

            throw new Error(`无法获取源实验的时序数据（已重试 ${MAX_RETRIES} 次）。请确保源实验已运行并收集了足够的时序数据。`);
          }

          console.log(`⏳ 等待 2 秒后重试...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }

        if (!data || data.length === 0) {
          throw new Error(`源实验没有时序数据。请确保源实验已运行并收集了足够的时序数据。`);
        }

        this._historicalData = data.sort((a, b) => {
          const timeA = new Date(a.timestamp).getTime();
          const timeB = new Date(b.timestamp).getTime();
          return timeA - timeB;
        });

        this._groupDataByLoopCount();

        console.log(`✅ 历史数据加载完成: ${this._historicalData.length} 条数据点`);
        return;

      } catch (error) {
        console.error(`❌ 加载历史数据失败 (尝试 ${attempt}/${MAX_RETRIES}): ${error.message}`);
        lastError = error;

        if (attempt === MAX_RETRIES) {
          throw error;
        }

        console.log(`⏳ 等待 2 秒后重试...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  /**
   * 按轮次分组数据
   * @private
   */
  _groupDataByLoopCount() {
    const grouped = new Map();
    for (const dataPoint of this._historicalData) {
      const loopCount = dataPoint.loop_count || 0;
      if (!grouped.has(loopCount)) {
        grouped.set(loopCount, []);
      }
      grouped.get(loopCount).push(dataPoint);
    }

    this._groupedData = Array.from(grouped.entries())
      .map(([loopCount, dataPoints]) => ({ loopCount, dataPoints }))
      .sort((a, b) => a.loopCount - b.loopCount);

    console.log(`📊 数据分为 ${this._groupedData.length} 个轮次`);
  }

  /**
   * 处理单个时间点
   * @private
   * @param {Object} dataPoint - 时序数据点
   * @returns {Promise<void>}
   */
  async _processTimePoint(dataPoint) {
    try {
      const tokenAddress = dataPoint.token_address;
      const tokenSymbol = dataPoint.token_symbol || 'UNKNOWN';
      const timestamp = new Date(dataPoint.timestamp);

      const tokenState = this._getOrCreateTokenState(tokenAddress, tokenSymbol, dataPoint);

      const priceUsd = parseFloat(dataPoint.price_usd) || 0;
      tokenState.currentPrice = priceUsd;

      this._tokenPool.updatePrice(tokenAddress, 'bsc', priceUsd, timestamp.getTime(), {
        txVolumeU24h: dataPoint.factor_values?.txVolumeU24h || 0,
        holders: dataPoint.factor_values?.holders || 0,
        tvl: dataPoint.factor_values?.tvl || 0,
        fdv: dataPoint.factor_values?.fdv || 0,
        marketCap: dataPoint.factor_values?.marketCap || 0
      });

      const factorResults = this._buildFactorsFromData(tokenState, dataPoint);

      if (this._roundSummary) {
        this._roundSummary.recordTokenIndicators(
          tokenAddress,
          tokenSymbol,
          {
            type: 'backtest-factor-based',
            factorCount: Object.keys(factorResults).length,
            factorValues: factorResults
          },
          priceUsd,
          {
            loopCount: dataPoint.loop_count,
            timestamp: dataPoint.timestamp
          }
        );
      }

      const strategy = this._strategyEngine.evaluate(
        factorResults,
        tokenAddress,
        timestamp.getTime(),
        { strategyExecutions: tokenState.strategyExecutions }
      );

      if (strategy) {
        if (strategy.action === 'buy' && tokenState.status !== 'monitoring') {
          return;
        }
        if (strategy.action === 'sell' && tokenState.status !== 'bought') {
          return;
        }

        this.logger.info(this._experimentId, 'BacktestEngine',
          `${tokenSymbol} 触发策略: ${strategy.name} (${strategy.action})`);

        if (this._roundSummary) {
          this._roundSummary.recordSignal(tokenAddress, {
            direction: strategy.action.toUpperCase(),
            action: strategy.action,
            confidence: 80,
            reason: strategy.name
          });
        }

        await this._executeStrategy(strategy, tokenState, factorResults, timestamp);
      }

    } catch (error) {
      this.logger.error(this._experimentId, 'BacktestEngine',
        `处理时间点失败: ${error.message}`);
    }
  }

  /**
   * 获取或创建代币状态
   * @private
   * @param {string} tokenAddress - 代币地址
   * @param {string} tokenSymbol - 代币符号
   * @param {Object} dataPoint - 数据点
   * @returns {Object} 代币状态
   */
  _getOrCreateTokenState(tokenAddress, tokenSymbol, dataPoint) {
    if (!this._tokenStates.has(tokenAddress)) {
      const factorValues = dataPoint.factor_values || {};

      this._tokenStates.set(tokenAddress, {
        token: tokenAddress,
        symbol: tokenSymbol,
        chain: 'bsc',
        status: 'monitoring',
        currentPrice: parseFloat(dataPoint.price_usd) || 0,
        collectionPrice: factorValues.collectionPrice || parseFloat(dataPoint.price_usd) || 0,
        collectionTime: new Date(dataPoint.timestamp).getTime(),
        buyPrice: 0,
        buyTime: null,
        highestPrice: factorValues.highestPrice || parseFloat(dataPoint.price_usd) || 0,
        highestPriceTimestamp: factorValues.highestPriceTimestamp || new Date(dataPoint.timestamp).getTime(),
        strategyExecutions: {}
      });

      this._tokenPool.addToken({
        token: tokenAddress,
        symbol: tokenSymbol,
        chain: 'bsc',
        current_price_usd: dataPoint.price_usd,
        created_at: new Date(dataPoint.timestamp).getTime() / 1000
      });
    }
    return this._tokenStates.get(tokenAddress);
  }

  /**
   * 从历史数据构建因子
   * @private
   * @param {Object} tokenState - 代币状态
   * @param {Object} dataPoint - 数据点
   * @returns {Object} 因子结果
   */
  _buildFactorsFromData(tokenState, dataPoint) {
    const factorValues = dataPoint.factor_values || {};
    const now = new Date(dataPoint.timestamp).getTime();
    const priceUsd = parseFloat(dataPoint.price_usd) || 0;

    const collectionTime = tokenState.collectionTime || now;
    const age = (now - collectionTime) / 1000 / 60;

    const holdDuration = tokenState.buyTime ? (now - tokenState.buyTime) / 1000 : 0;

    let profitPercent = 0;
    if (tokenState.buyPrice && tokenState.buyPrice > 0 && priceUsd > 0) {
      profitPercent = ((priceUsd - tokenState.buyPrice) / tokenState.buyPrice) * 100;
    }

    const highestPrice = tokenState.highestPrice || priceUsd;
    let drawdownFromHighest = 0;
    if (highestPrice > 0 && priceUsd > 0) {
      drawdownFromHighest = ((priceUsd - highestPrice) / highestPrice) * 100;
    }

    if (priceUsd > tokenState.highestPrice) {
      tokenState.highestPrice = priceUsd;
      tokenState.highestPriceTimestamp = now;
    }

    return {
      age: age,
      currentPrice: priceUsd,
      collectionPrice: tokenState.collectionPrice,
      earlyReturn: factorValues.earlyReturn || 0,
      riseSpeed: factorValues.riseSpeed || 0,
      buyPrice: tokenState.buyPrice || 0,
      holdDuration: holdDuration,
      profitPercent: profitPercent,
      highestPrice: highestPrice,
      highestPriceTimestamp: tokenState.highestPriceTimestamp,
      drawdownFromHighest: drawdownFromHighest,
      txVolumeU24h: factorValues.txVolumeU24h || 0,
      holders: factorValues.holders || 0,
      tvl: factorValues.tvl || 0,
      fdv: factorValues.fdv || 0,
      marketCap: factorValues.marketCap || 0
    };
  }

  /**
   * 执行策略
   * @private
   * @param {Object} strategy - 策略对象
   * @param {Object} tokenState - 代币状态
   * @param {Object} factorResults - 因子结果
   * @param {Date} timestamp - 历史时间戳
   * @returns {Promise<boolean>} 是否执行成功
   */
  async _executeStrategy(strategy, tokenState, factorResults, timestamp) {
    const { CardPositionManager } = getLazyModules();
    const price = tokenState.currentPrice || 0;

    if (strategy.action === 'buy') {
      if (!tokenState.strategyExecutions[strategy.id]) {
        tokenState.strategyExecutions[strategy.id] = { count: 0, lastExecution: 0 };
      }

      if (strategy.maxExecutions &&
          tokenState.strategyExecutions[strategy.id].count >= strategy.maxExecutions) {
        return false;
      }

      if (this._positionManagement && this._positionManagement.enabled) {
        let cardManager = this._tokenPool.getCardPositionManager(tokenState.token, tokenState.chain);
        if (!cardManager) {
          cardManager = new CardPositionManager({
            totalCards: this._positionManagement.totalCards || 4,
            perCardMaxBNB: this._positionManagement.perCardMaxBNB || 0.25,
            minCardsForTrade: 1,
            initialAllocation: {
              bnbCards: this._positionManagement.totalCards || 4,
              tokenCards: 0
            }
          });
          this._tokenPool.setCardPositionManager(tokenState.token, tokenState.chain, cardManager);
        }
      }

      const signal = {
        action: 'buy',
        symbol: tokenState.symbol,
        tokenAddress: tokenState.token,
        chain: tokenState.chain,
        price: price,
        confidence: 80,
        reason: strategy.name,
        cards: strategy.cards || 1,
        strategyId: strategy.id,
        strategyName: strategy.name,
        factors: factorResults,
        timestamp: timestamp
      };

      const result = await this.processSignal(signal);

      if (result && result.success) {
        tokenState.status = 'bought';
        tokenState.buyPrice = price;
        tokenState.buyTime = timestamp.getTime();

        tokenState.strategyExecutions[strategy.id].count++;
        tokenState.strategyExecutions[strategy.id].lastExecution = timestamp.getTime();

        if (this._roundSummary) {
          this._roundSummary.recordSignalExecution(tokenState.token, true, null);
        }

        return true;
      }

      return false;

    } else if (strategy.action === 'sell') {
      const cardManager = this._tokenPool.getCardPositionManager(tokenState.token, tokenState.chain);
      if (!cardManager) {
        this.logger.warn(this._experimentId, '_executeStrategy',
          `代币 ${tokenState.symbol} 没有卡牌管理器，跳过卖出`);
        return false;
      }

      const holding = this._getHolding(tokenState.token);
      if (!holding || holding.amount <= 0) {
        return false;
      }

      if (!tokenState.strategyExecutions[strategy.id]) {
        tokenState.strategyExecutions[strategy.id] = { count: 0, lastExecution: 0 };
      }

      if (strategy.maxExecutions &&
          tokenState.strategyExecutions[strategy.id].count >= strategy.maxExecutions) {
        return false;
      }

      const cards = strategy.cards || 'all';

      const signal = {
        action: 'sell',
        symbol: tokenState.symbol,
        tokenAddress: tokenState.token,
        chain: tokenState.chain,
        price: price,
        confidence: 80,
        reason: strategy.name,
        cards: cards,
        strategyId: strategy.id,
        strategyName: strategy.name,
        buyPrice: tokenState.buyPrice || null,
        profitPercent: tokenState.buyPrice && price ? ((price - tokenState.buyPrice) / tokenState.buyPrice * 100) : null,
        holdDuration: tokenState.buyTime ? ((timestamp.getTime() - tokenState.buyTime) / 1000) : null,
        factors: factorResults,
        timestamp: timestamp
      };

      const result = await this.processSignal(signal);

      if (result && result.success) {
        tokenState.strategyExecutions[strategy.id].count++;
        tokenState.strategyExecutions[strategy.id].lastExecution = timestamp.getTime();

        if (this._roundSummary) {
          this._roundSummary.recordSignalExecution(tokenState.token, true, null);
        }

        return true;
      }

      return false;
    }

    return false;
  }

  /**
   * 计算买入金额（Backtest 特有：使用卡牌管理器）
   * @protected
   * @param {Object} signal - 信号
   * @returns {number} BNB金额
   */
  _calculateBuyAmount(signal) {
    // 从 PortfolioManager 获取可用余额
    const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);
    const availableBalance = portfolio?.availableBalance || 0;

    const cardManager = this._tokenPool.getCardPositionManager(signal.tokenAddress, signal.chain);
    if (cardManager) {
      const cards = signal.cards || 1;
      const amount = cardManager.calculateBuyAmount(cards);
      if (amount <= 0) {
        return 0;
      }
      // 转换 Decimal 为数字
      const amountValue = typeof amount === 'number' ? amount : amount.toNumber();
      const balanceValue = typeof availableBalance === 'number' ? availableBalance : availableBalance.toNumber();
      if (balanceValue < amountValue) {
        return 0;
      }
      return amountValue;
    }

    const tradeAmount = this._experiment.config?.backtest?.tradeAmount || 0.1;
    const balanceValue = typeof availableBalance === 'number' ? availableBalance : availableBalance.toNumber();
    if (balanceValue < tradeAmount) {
      return 0;
    }
    return tradeAmount;
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

    this._status = EngineStatus.RUNNING;

    if (this._experiment) {
      this._experiment.start();
      const { ExperimentFactory } = require('../factories/ExperimentFactory');
      const factory = ExperimentFactory.getInstance();
      await factory.updateStatus(this._experimentId, 'running');
    }

    console.log(`🚀 回测引擎已启动: 实验 ${this._experimentId}`);

    await this._runMainLoop();
  }

  /**
   * 停止引擎（覆盖基类方法）
   * @returns {Promise<void>}
   */
  async stop() {
    if (this._status === EngineStatus.STOPPED) {
      return;
    }

    this._status = EngineStatus.STOPPED;

    if (this._experiment) {
      this._experiment.stop('stopped');
      const { ExperimentFactory } = require('../factories/ExperimentFactory');
      const factory = ExperimentFactory.getInstance();
      await factory.updateStatus(this._experimentId, 'stopped');
    }

    console.log(`🛑 回测引擎已停止: 实验 ${this._experimentId}`);
  }

  /**
   * 构建默认策略（覆盖基类方法，Backtest 特有实现）
   * @protected
   * @returns {Object} 默认策略配置
   */
  _buildDefaultStrategies() {
    const experimentConfig = this._experiment?.config || {};
    const defaultStrategyConfig = config.strategy || {};
    const strategyConfig = experimentConfig.strategy || defaultStrategyConfig;

    const buyTimeMinutes = strategyConfig.buyTimeMinutes !== undefined ? strategyConfig.buyTimeMinutes : 1.33;
    const earlyReturnMin = strategyConfig.earlyReturnMin !== undefined ? strategyConfig.earlyReturnMin : 80;
    const earlyReturnMax = strategyConfig.earlyReturnMax !== undefined ? strategyConfig.earlyReturnMax : 120;
    const takeProfit1 = strategyConfig.takeProfit1 !== undefined ? strategyConfig.takeProfit1 : 30;
    const takeProfit2 = strategyConfig.takeProfit2 !== undefined ? strategyConfig.takeProfit2 : 50;
    const stopLossMinutes = strategyConfig.stopLossMinutes !== undefined ? strategyConfig.stopLossMinutes : 5;

    const takeProfit1Cards = strategyConfig.takeProfit1Cards !== undefined
      ? strategyConfig.takeProfit1Cards
      : 1;
    const takeProfit2Cards = strategyConfig.takeProfit2Cards !== undefined
      ? strategyConfig.takeProfit2Cards
      : 'all';

    const stopLossSeconds = stopLossMinutes * 60;

    console.log('⚠️ 使用默认硬编码策略（未配置自定义策略）');

    return {
      early_return_buy: {
        id: 'early_return_buy',
        name: `早止买入 (${earlyReturnMin}-${earlyReturnMax}%收益率)`,
        action: 'buy',
        priority: 1,
        cooldown: 60,
        enabled: true,
        cards: 1,
        condition: `age < ${buyTimeMinutes} AND earlyReturn >= ${earlyReturnMin} AND earlyReturn < ${earlyReturnMax} AND currentPrice > 0`
      },
      take_profit_1: {
        id: 'take_profit_1',
        name: `止盈1 (${takeProfit1}%卖出${takeProfit1Cards}卡)`,
        action: 'sell',
        priority: 1,
        cooldown: 30,
        enabled: true,
        cards: takeProfit1Cards,
        maxExecutions: 1,
        condition: `profitPercent >= ${takeProfit1} AND holdDuration > 0`
      },
      take_profit_2: {
        id: 'take_profit_2',
        name: `止盈2 (${takeProfit2}%卖出全部)`,
        action: 'sell',
        priority: 2,
        cooldown: 30,
        enabled: true,
        cards: takeProfit2Cards,
        maxExecutions: 1,
        condition: `profitPercent >= ${takeProfit2} AND holdDuration > 0`
      },
      stop_loss: {
        id: 'stop_loss',
        name: `时间止损 (${stopLossMinutes}分钟)`,
        action: 'sell',
        priority: 10,
        cooldown: 60,
        enabled: true,
        cards: 'all',
        maxExecutions: 1,
        condition: `holdDuration >= ${stopLossSeconds} AND profitPercent <= 0`
      }
    };
  }
}

module.exports = { BacktestEngine };
