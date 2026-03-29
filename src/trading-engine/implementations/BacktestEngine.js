/**
 * 回测引擎
 * 用于 fourmeme 交易实验的历史数据回放
 * 继承自 AbstractTradingEngine
 */

const { TradingMode, EngineStatus } = require('../interfaces/ITradingEngine');
const { AbstractTradingEngine } = require('../core/AbstractTradingEngine');
const { ExperimentDataService } = require('../../web/services/ExperimentDataService');
const Logger = require('../../services/logger');
const Decimal = require('decimal.js');

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

    // 叙事分析配置
    this._narrativeAnalysisEnabled = false;
    this._narrativeReanalyze = false;
    this._narrativeTriggerThreshold = 80; // 默认80%
    this._narrativeMaxWaitSeconds = 300; // 回测等待5分钟
    this._narrativePollIntervalMs = 2000; // 默认每2秒检查一次

    // 代币追踪
    this._seenTokens = new Set();
    this._tokenStates = new Map();
    this._tokenCreatedTimes = new Map(); // 存储代币创建时间

    // 构造函数不使用logger（logger在initialize时创建）
  }

  // ==================== 抽象方法实现 ====================

  /**
   * 初始化数据源（Backtest 特有：加载历史数据）
   * @protected
   * @returns {Promise<void>}
   */
  async _initializeDataSources() {
    // 更新 logger 的 experimentId，确保日志写入正确的文件
    if (this.logger && this.logger.setExperimentId) {
      this.logger.setExperimentId(this._experimentId);
    }

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

    this.logger.info(this._experimentId, '_initializeDataSources', `📊 回测配置: 源实验=${this._sourceExperimentId}, 初始余额=${this.initialBalance}`);

    // 初始化 Backtest 特有组件
    await this._initializeBacktestComponents();

    // 加载历史数据
    await this._loadHistoricalData();

    this.logger.info(this._experimentId, '_loadHistoricalData', `📊 加载了 ${this._historicalData.length} 条历史数据点`);
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
      this.logger.info(this._experimentId, '_runMainLoop', `📊 开始回测，共 ${this._groupedData.length} 个轮次`);

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

      // 回测结束前强制卖出所有剩余持仓
      await this._forceSellAllRemaining();

      const duration = Date.now() - startTime;
      this.logger.info(this._experimentId, 'BacktestEngine',
        `✅ 回测完成，耗时: ${duration}ms，处理了 ${this.metrics.processedDataPoints} 个数据点`);

      // 输出回测结果汇总
      // 从 PortfolioManager 获取最终余额
      const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);
      const finalBalance = portfolio?.totalValue || this.initialBalance;
      const finalBalanceValue = typeof finalBalance === 'number' ? finalBalance : finalBalance.toNumber();
      const profit = finalBalanceValue - this.initialBalance;
      const profitPercent = ((profit / this.initialBalance) * 100).toFixed(2);

      this.logger.info(this._experimentId, 'BacktestEngine',
        `📊 回测结果汇总 | ` +
        `初始余额: ${this.initialBalance} BSC | ` +
        `最终余额: ${finalBalanceValue.toFixed(2)} BSC | ` +
        `收益: ${profit.toFixed(2)} BSC (${profitPercent > 0 ? '+' : ''}${profitPercent}%) | ` +
        `总交易: ${this.metrics.totalTrades} | ` +
        `成功: ${this.metrics.successfulTrades} | ` +
        `失败: ${this.metrics.failedTrades}`
      );

      this.logger.info(this._experimentId, '_generateFinalReport', `📊 回测结果汇总 | 初始余额: ${this.initialBalance} BSC, 最终余额: ${finalBalanceValue.toFixed(2)} BSC, 收益: ${profit.toFixed(2)} BSC (${profitPercent > 0 ? '+' : ''}${profitPercent}%), 总交易: ${this.metrics.totalTrades}, 成功: ${this.metrics.successfulTrades}, 失败: ${this.metrics.failedTrades}, 信号: ${this.metrics.totalSignals}/${this.metrics.executedSignals}`);

      completedSuccessfully = true;

    } catch (error) {
      this.logger.error(this._experimentId, 'BacktestEngine',
        `❌ 回测执行失败: ${error.message}`);
      console.error(error.stack);
    } finally {
      // 使用基类的 _updateExperimentStatus 方法更新最终状态
      const finalStatus = completedSuccessfully ? 'completed' : 'failed';
      this.logger.info(this._experimentId, '_updateExperimentStatus', `📊 更新实验状态为: ${finalStatus}`);

      try {
        await this._updateExperimentStatus(finalStatus);

        if (completedSuccessfully) {
          this.logger.info(this._experimentId, '_updateExperimentStatus', `✅ 回测实验已完成，状态已更新`);
        } else {
          this.logger.warn(this._experimentId, '_updateExperimentStatus', `⚠️ 回测实验失败，状态已更新`);
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
        console.error(`❌ 买入失败: ${signal.symbol} (${signal.tokenAddress}) - 卡牌管理器未初始化`);
        return { success: false, reason: '卡牌管理器未初始化' };
      }

      const beforeCardState = {
        bnbCards: cardManager.bnbCards,
        tokenCards: cardManager.tokenCards,
        totalCards: cardManager.totalCards
      };

      const amountInBNB = this._calculateBuyAmount(signal);
      if (amountInBNB <= 0) {
        console.error(`❌ 买入失败: ${signal.symbol} - 计算金额为0 (amountInBNB=${amountInBNB})`);
        return { success: false, reason: '余额不足或计算金额为0' };
      }

      const price = signal.price || 0;
      // 使用 Decimal 进行除法，避免浮点数精度问题
      const tokenAmount = price > 0 ? new Decimal(amountInBNB).div(price).toNumber() : 0;

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

      // 调试日志
      if (!result || !result.success) {
        console.error(`❌ 买入执行失败: ${signal.symbol}`);
        console.error(`   result:`, result);
        console.error(`   reason: ${result?.reason || result?.message || '未知'}`);
      } else {
        this.logger.info(this._experimentId, '_executeBuy', `✅ 买入成功: ${signal.symbol}, 金额: ${amountInBNB} BNB`);
      }

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
      console.error(`❌ 买入异常: ${signal.symbol}`, error.message);
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
        cardManager.afterSell(signal.symbol, actualCards, sellAll);

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

  /**
   * 处理信号（Backtest 特有：支持预先保存的信号ID）
   * @param {Object} signal - 信号对象
   * @param {string} [existingSignalId] - 预先保存的信号ID
   * @returns {Promise<Object>} 处理结果
   */
  async processSignal(signal, existingSignalId = null) {
    if (!this._experiment) {
      throw new Error('引擎未初始化');
    }

    // 检查引擎状态
    if (this._isStopped) {
      return { success: false, message: '引擎已停止' };
    }

    let signalId = existingSignalId;
    let result = { success: false, message: '交易未执行' };

    // 如果没有预先保存的信号ID（卖出策略的情况），则创建并保存信号
    if (!signalId) {
      const { TradeSignal } = require('../entities');

      // 创建信号实体
      const signalMetadata = {
        ...signal.metadata,
        ...signal.factors,
        price: signal.price,
        strategyId: signal.strategyId,
        strategyName: signal.strategyName,
        cards: signal.cards
      };

      const tradeSignal = new TradeSignal({
        experimentId: this._experimentId,
        tokenAddress: signal.tokenAddress,
        tokenSymbol: signal.symbol,
        signalType: signal.action.toUpperCase(),
        action: signal.action.toLowerCase(),
        confidence: signal.confidence || 0.5,
        reason: signal.reason || '',
        metadata: signalMetadata,
        createdAt: signal.timestamp || new Date()
      });

      signalId = await tradeSignal.save();
      this.logger.info('processSignal', `信号已保存 | symbol=${signal.symbol}, signalId=${signalId}`);
    } else {
      this.logger.info('processSignal', `使用已存在的信号 | symbol=${signal.symbol}, signalId=${signalId}`);
    }

    // 执行交易
    const signalTime = signal.timestamp || new Date();
    const metadata = {
      signalId,
      loopCount: this._loopCount,
      timestamp: signalTime instanceof Date ? signalTime.toISOString() : signalTime,
      factors: signal.factors || null
    };

    try {
      if (signal.action.toLowerCase() === 'buy') {
        result = await this._executeBuy(signal, signalId, metadata);
      } else if (signal.action.toLowerCase() === 'sell') {
        result = await this._executeSell(signal, signalId, metadata);
      } else {
        result = { success: false, message: `未知动作: ${signal.action}` };
      }

      // 更新信号状态
      await this._updateSignalStatus(signalId, result.success ? 'executed' : 'failed', result);

    } catch (error) {
      this.logger.error('processSignal', '信号执行失败', {
        signalId,
        error: error.message,
        stack: error.stack
      });

      result = {
        success: false,
        message: error.message || '未知错误',
        reason: error.message || '未知错误',
        error: error.message || '未知错误'
      };

      try {
        await this._updateSignalStatus(signalId, 'failed', result);
      } catch (statusError) {
        this.logger.error('processSignal', '更新信号状态失败', {
          signalId,
          error: statusError.message
        });
      }
    }

    return result;
  }

  // ==================== Backtest 特有方法 ====================

  /**
   * 初始化 Backtest 特有组件
   * @private
   * @returns {Promise<void>}
   */
  async _initializeBacktestComponents() {
    this.logger.info(this._experimentId, '_initializeBacktestComponents', '开始初始化回测组件');

    const { TokenPool, StrategyEngine } = getLazyModules();

    // 1. 初始化持有者历史缓存（用于回测时动态计算持有者趋势因子）
    const HolderHistoryCache = require('../HolderHistoryCache');
    this._holderHistoryCache = new HolderHistoryCache(15 * 60 * 1000); // 15分钟

    // 1.1 初始化持有者趋势检测器（用于动态计算持有者趋势因子）
    const HolderTrendDetector = require('../HolderTrendDetector');
    this._holderTrendDetector = new HolderTrendDetector({
      minDataPoints: 6,
      maxDataPoints: Infinity,
      cvThreshold: 0.02,
      scoreThreshold: 30,
      growthRatioThreshold: 3,
      riseRatioThreshold: 0.5
    });

    // 2. 初始化代币池（简化版，用于状态管理，传入持有者历史缓存）
    this._tokenPool = new TokenPool(this.logger, null, this._holderHistoryCache);
    this.logger.info(this._experimentId, '_initializeBacktestComponents', '✅ 代币池初始化完成');

    // 2. 初始化策略引擎
    const strategies = this._buildStrategyConfig();
    this._strategyEngine = new StrategyEngine({ strategies });

    // 使用统一的 FactorBuilder 获取可用因子列表
    const { getAvailableFactorIds } = require('../core/FactorBuilder');
    const availableFactorIds = getAvailableFactorIds();

    // 转换策略配置格式：{ buyStrategies: [...], sellStrategies: [...] } -> 扁平数组
    const strategyArray = [];
    if (strategies.buyStrategies && Array.isArray(strategies.buyStrategies)) {
      strategies.buyStrategies.forEach((s, idx) => {
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
          preBuyCheckCondition: s.preBuyCheckCondition || null,  // 购买前检查条件
          enabled: true
        });
      });
    }
    if (strategies.sellStrategies && Array.isArray(strategies.sellStrategies)) {
      strategies.sellStrategies.forEach((s, idx) => {
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
    this.logger.info(this._experimentId, '_initializeBacktestComponents', `✅ 策略引擎初始化完成，加载了 ${this._strategyEngine.getStrategyCount()} 个策略`);

    // 3. 初始化卡牌仓位管理配置
    const experimentConfig = this._experiment?.config || {};
    this._positionManagement = experimentConfig.positionManagement || experimentConfig.strategy?.positionManagement || null;
    if (this._positionManagement && this._positionManagement.enabled) {
      this.logger.info(this._experimentId, '_initializeBacktestComponents', `✅ 卡牌仓位管理已启用: 总卡牌数=${this._positionManagement.totalCards || 4}, 单卡BNB=${this._positionManagement.perCardMaxBNB || 0.025}`);
    }

    // 3.1 初始化叙事分析配置
    const narrativeAnalysisConfig = experimentConfig.strategiesConfig?.narrativeAnalysis || experimentConfig.narrativeAnalysis || {};
    this._narrativeAnalysisEnabled = narrativeAnalysisConfig.enabled === true;
    this._narrativeReanalyze = narrativeAnalysisConfig.reanalyze === true;
    this._narrativeTriggerThreshold = narrativeAnalysisConfig.triggerThreshold || 80;
    this._narrativeMaxWaitSeconds = narrativeAnalysisConfig.maxWaitSeconds || 300;
    this._narrativePollIntervalMs = narrativeAnalysisConfig.pollIntervalMs || 2000;

    if (this._narrativeAnalysisEnabled) {
      this.logger.info(this._experimentId, '_initializeBacktestComponents',
        `✅ 叙事分析已启用 (阈值: ${this._narrativeTriggerThreshold}%, 等待: ${this._narrativeMaxWaitSeconds}s)`);
    } else {
      this.logger.info(this._experimentId, '_initializeBacktestComponents', `⚠️ 叙事分析未启用`);
    }

    // 4. 初始化时序数据服务（用于读取源实验数据）
    const { ExperimentTimeSeriesService } = require('../../web/services/ExperimentTimeSeriesService');
    this.timeSeriesService = new ExperimentTimeSeriesService();
    this.logger.info(this._experimentId, '_initializeBacktestComponents', '✅ 时序数据服务初始化完成');

    // 5. 初始化购买前检查服务（回测模式：支持早期参与者检查，跳过持有者检查）
    const { PreBuyCheckService } = require('../pre-check/PreBuyCheckService');
    const { dbManager } = require('../../services/dbManager');
    const supabase = dbManager.getClient();

    // 合并配置：外部默认配置 + 实验配置
    const defaultConfig = require('../../../config/default.json');
    const experimentPreBuyConfig = this._experiment?.config?.preBuyCheck || {};
    const preBuyCheckConfig = {
      ...defaultConfig.preBuyCheck,
      ...experimentPreBuyConfig
    };

    this._preBuyCheckService = new PreBuyCheckService(supabase, this.logger, preBuyCheckConfig);
    this.logger.info(this._experimentId, '_initializeBacktestComponents', `✅ 购买前检查服务初始化完成 (earlyParticipantFilterEnabled=${preBuyCheckConfig.earlyParticipantFilterEnabled}, clusterBlockThreshold=${preBuyCheckConfig.clusterBlockThreshold || 7})`);
  }

  /**
   * 构建代币信息（用于回测时的早期参与者检查）
   * @private
   * @param {Object} tokenState - 代币状态
   * @returns {Object} tokenInfo（包含 innerPair 和 tokenCreatedAt）
   */
  _buildTokenInfoForBacktest(tokenState) {
    // 构建 innerPair（内盘交易对）
    let innerPair = null;
    const platform = tokenState.platform || 'fourmeme';

    // 优先使用已设置的 pairAddress（由数据加载时设置）
    if (tokenState.pairAddress) {
      innerPair = tokenState.pairAddress;
    } else if (platform === 'fourmeme') {
      innerPair = `${tokenState.token}_fo`;
    } else if (platform === 'flap') {
      innerPair = `${tokenState.token}_iportal`;
    } else if (tokenState.main_pair) {
      innerPair = tokenState.main_pair;
    } else if (tokenState.pair) {
      innerPair = tokenState.pair;
    } else {
      // 默认使用 fourmeme 格式
      innerPair = `${tokenState.token}_fo`;
    }

    return { innerPair, tokenCreatedAt: tokenState.tokenCreatedAt };
  }

  /**
   * 加载历史数据（带重试机制）
   * @private
   * @returns {Promise<void>}
   */
  async _loadHistoricalData() {
    const MAX_RETRIES = 5;
    let lastError = null;

    // 获取涨幅过滤参数
    const minMaxChangePercent = this._experiment.config?.backtest?.minMaxChangePercent || 0;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        this.logger.info(this._experimentId, 'BacktestEngine',
          `📊 开始加载历史数据 (尝试 ${attempt}/${MAX_RETRIES})，源实验: ${this._sourceExperimentId}`);

        // 如果设置了涨幅过滤，先筛选代币地址
        let filteredAddresses = null;
        if (minMaxChangePercent > 0) {
          filteredAddresses = await this._filterTokensByMaxChange(minMaxChangePercent);
          this.logger.info(this._experimentId, 'BacktestEngine',
            `📊 代币筛选: 总代币数=${this._backtestStats.totalTokens || 0}, 满足条件=${filteredAddresses.length}, 阈值=${minMaxChangePercent}%`);
        }

        let data;
        try {
          data = await this.timeSeriesService.getExperimentTimeSeries(
            this._sourceExperimentId,
            filteredAddresses,  // 传入筛选后的地址，null 表示不过滤
            {
              retryAttempt: attempt,
              maxRetries: MAX_RETRIES
            }
          );
        } catch (queryError) {
          this.logger.warn(this._experimentId, '_loadHistoricalData',
            `⚠️  时序数据查询出现问题 (尝试 ${attempt}/${MAX_RETRIES}): ${queryError.message}`);
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

          this.logger.info(this._experimentId, '_loadHistoricalData',
            `⏳ 等待 2 秒后重试...`);
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

        // 加载源实验的代币创建时间（discovered_at 与 launch_at 一致）
        // 注意：Supabase 有 1000 行的硬限制，需要使用分页查询
        const { dbManager } = require('../../services/dbManager');
        const supabase = dbManager.getClient();

        // 分页查询所有代币
        const PAGE_SIZE = 1000;
        let allTokensData = [];
        let page = 0;

        while (true) {
          const start = page * PAGE_SIZE;
          const end = start + PAGE_SIZE - 1;

          const { data: pageData, error: pageError } = await supabase
            .from('experiment_tokens')
            .select('token_address, discovered_at')
            .eq('experiment_id', this._sourceExperimentId)
            .range(start, end);

          if (pageError) {
            this.logger.warn(this._experimentId, '_loadHistoricalData',
              `⚠️  查询代币创建时间失败 (页 ${page + 1}): ${pageError.message}`);
            break;
          }

          if (!pageData || pageData.length === 0) {
            break; // 没有更多数据
          }

          allTokensData = allTokensData.concat(pageData);
          page++;

          // 如果返回的数据少于 PAGE_SIZE，说明已经是最后一页
          if (pageData.length < PAGE_SIZE) {
            break;
          }

          // 安全限制，最多查询 20 页
          if (page >= 20) {
            this.logger.warn(this._experimentId, '_loadHistoricalData',
              `⚠️  已达到最大查询页数限制 (20页)，停止查询`);
            break;
          }
        }

        // 存储 token 创建时间到 Map（discovered_at 就是代币的 launch_at）
        for (const row of allTokensData || []) {
          if (row.discovered_at) {
            this._tokenCreatedTimes.set(row.token_address, row.discovered_at);
          }
        }

        this.logger.info(this._experimentId, '_loadHistoricalData',
          `✅ 已加载 ${this._tokenCreatedTimes.size} 个代币的创建时间 (discovered_at, 分 ${page} 页)`);

        this._groupDataByLoopCount();

        // 预加载持有者历史数据到缓存（用于回测时计算持有者趋势因子）
        await this._preloadHolderHistory();

        this.logger.info(this._experimentId, 'BacktestEngine',
          `✅ 历史数据加载完成: ${this._historicalData.length} 条数据点，分为 ${this._groupedData.length} 个轮次`);
        return;

      } catch (error) {
        this.logger.error(this._experimentId, '_loadHistoricalData',
          `❌ 加载历史数据失败 (尝试 ${attempt}/${MAX_RETRIES}): ${error.message}`);
        lastError = error;

        if (attempt === MAX_RETRIES) {
          throw error;
        }

        this.logger.info(this._experimentId, '_loadHistoricalData',
          `⏳ 等待 2 秒后重试...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  /**
   * 根据最高涨幅筛选代币
   * @private
   * @param {number} threshold - 涨幅阈值（%）
   * @returns {Promise<Array<string>>} 筛选后的代币地址数组
   */
  async _filterTokensByMaxChange(threshold) {
    const { dbManager } = require('../../services/dbManager');
    const supabase = dbManager.getClient();

    // 查询源实验的所有代币
    const { data: allTokens, error } = await supabase
      .from('experiment_tokens')
      .select('token_address, analysis_results')
      .eq('experiment_id', this._sourceExperimentId);

    if (error) {
      this.logger.error(this._experimentId, '_filterTokensByMaxChange',
        `查询代币失败: ${error.message}`);
      throw new Error(`查询代币失败: ${error.message}`);
    }

    // 记录统计信息
    this._backtestStats = {
      totalTokens: allTokens?.length || 0,
      filteredTokens: 0
    };

    // 筛选代币
    const filteredAddresses = [];
    for (const token of allTokens || []) {
      if (this._shouldIncludeToken(token, threshold)) {
        filteredAddresses.push(token.token_address);
      }
    }

    this._backtestStats.filteredTokens = filteredAddresses.length;

    return filteredAddresses;
  }

  /**
   * 判断代币是否应该包含在回测中
   * @private
   * @param {Object} token - 代币数据
   * @param {number} threshold - 涨幅阈值（%）
   * @returns {boolean} 是否包含
   */
  _shouldIncludeToken(token, threshold) {
    // 无分析结果 -> 包含（待分析的代币）
    if (!token.analysis_results) {
      return true;
    }

    // 有分析结果 -> 检查最高涨幅
    const maxChange = token.analysis_results.max_change_percent;
    // null/undefined 视为待分析，包含
    if (maxChange === null || maxChange === undefined) {
      return true;
    }
    // 阈值为0 -> 包含所有
    if (threshold <= 0) {
      return true;
    }

    return maxChange >= threshold;
  }

  /**
   * 按轮次分组数据，支持 loop 范围过滤
   * @private
   */
  _groupDataByLoopCount() {
    const grouped = new Map();

    // 获取 loop 范围配置
    const loopConfig = this._experiment.config?.backtest?.loop;
    const loopStart = loopConfig?.start;
    const loopEnd = loopConfig?.end;

    if (loopStart !== undefined || loopEnd !== undefined) {
      this.logger.info(this._experimentId, 'BacktestEngine',
        `📊 Loop 范围过滤: start=${loopStart ?? '无'}, end=${loopEnd ?? '无'}`);
    }

    for (const dataPoint of this._historicalData) {
      const loopCount = dataPoint.loop_count || 0;

      // 应用 loop 范围过滤
      if (loopStart !== undefined && loopCount < loopStart) continue;
      if (loopEnd !== undefined && loopCount > loopEnd) continue;

      if (!grouped.has(loopCount)) {
        grouped.set(loopCount, []);
      }
      grouped.get(loopCount).push(dataPoint);
    }

    this._groupedData = Array.from(grouped.entries())
      .map(([loopCount, dataPoints]) => ({ loopCount, dataPoints }))
      .sort((a, b) => a.loopCount - b.loopCount);

    const loopCounts = this._groupedData.map(g => g.loopCount);
    const minLoop = loopCounts.length > 0 ? Math.min(...loopCounts) : 0;
    const maxLoop = loopCounts.length > 0 ? Math.max(...loopCounts) : 0;

    this.logger.info(this._experimentId, 'BacktestEngine',
      `📊 数据分为 ${this._groupedData.length} 个轮次 (loop_count: ${minLoop} - ${maxLoop})`);
  }

  /**
   * 预加载持有者历史数据到缓存
   * 在回测开始前，从时序数据中提取每个代币的 holder 历史数据，
   * 预填充到 _holderHistoryCache 中，以便后续计算持有者趋势因子。
   * @private
   * @returns {Promise<void>}
   */
  async _preloadHolderHistory() {
    if (!this._holderHistoryCache) {
      return;
    }

    this.logger.info(this._experimentId, '_preloadHolderHistory', '开始预加载持有者历史数据...');

    // 按代币分组时序数据
    const tokenDataMap = new Map();
    for (const dataPoint of this._historicalData) {
      const tokenAddress = dataPoint.token_address;
      if (!tokenDataMap.has(tokenAddress)) {
        tokenDataMap.set(tokenAddress, []);
      }
      tokenDataMap.get(tokenAddress).push(dataPoint);
    }

    // 为每个代币预加载 holder 历史
    let loadedTokens = 0;

    for (const [tokenAddress, dataPoints] of tokenDataMap) {
      const tokenKey = `${tokenAddress}-bsc`;

      // 按时间排序
      dataPoints.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      // 添加 holder 数据到缓存
      for (const dataPoint of dataPoints) {
        const holders = dataPoint.factor_values?.holders;
        if (holders !== undefined && holders !== null) {
          const timestamp = new Date(dataPoint.timestamp).getTime();
          this._holderHistoryCache.addHolderCount(tokenKey, holders, timestamp);
        }
      }

      loadedTokens++;
    }

    this.logger.info(this._experimentId, '_preloadHolderHistory',
      `✅ 预加载完成: ${loadedTokens} 个代币的 holder 历史数据已加载到缓存`);
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

      // 叙事分析触发检测
      if (this._narrativeAnalysisEnabled) {
        const satisfaction = this._calculateTrendFactorSatisfaction(factorResults);
        if (satisfaction >= this._narrativeTriggerThreshold) {
          await this._createOrUpdateNarrativeTask(tokenState, satisfaction);
        }
      }

      const strategy = this._strategyEngine.evaluate(
        factorResults,
        tokenAddress,
        timestamp.getTime(),
        { strategyExecutions: tokenState.strategyExecutions }
      );

      if (strategy) {
        if (strategy.action === 'buy') {
          // 买入行为完全由卡牌管理器控制，无需状态检查
        } else if (strategy.action === 'sell' && tokenState.status !== 'bought') {
          return;
        }

        // 获取策略的 preBuyCheckCondition（从原始配置中查找）
        const strategiesConfig = this._experiment?.config?.strategiesConfig || {};
        let preBuyCheckCondition = null;
        let repeatBuyCheckCondition = null;

        if (strategy.action === 'buy' && strategiesConfig.buyStrategies) {
          const buyStrategyConfig = strategiesConfig.buyStrategies.find(
            s => s.priority === strategy.priority
          );
          if (buyStrategyConfig) {
            preBuyCheckCondition = buyStrategyConfig.preBuyCheckCondition || null;
            repeatBuyCheckCondition = buyStrategyConfig.repeatBuyCheckCondition || null;
          }
        } else if (strategy.action === 'sell' && strategiesConfig.sellStrategies) {
          const sellStrategyConfig = strategiesConfig.sellStrategies.find(
            s => s.priority === strategy.priority
          );
          if (sellStrategyConfig) {
            preBuyCheckCondition = sellStrategyConfig.preBuyCheckCondition || null;
          }
        }

        // 将 preBuyCheckCondition 和 repeatBuyCheckCondition 添加到 strategy 对象中，供后续使用
        strategy.preBuyCheckCondition = preBuyCheckCondition;
        strategy.repeatBuyCheckCondition = repeatBuyCheckCondition;

        this.logger.info(this._experimentId, 'BacktestEngine',
          `${tokenSymbol} 触发策略: ${strategy.name} (${strategy.action}), hasPreBuyCheckCondition=${!!preBuyCheckCondition}`);

        // 调试日志：如果代币已买入，显示卖出相关因子
        if (tokenState.status === 'bought' && strategy.action === 'sell') {
          this.logger.info(this._experimentId, 'BacktestEngine',
            `  卖出因子检查: holders=${factorResults.holders}, ` +
            `holderDrawdown=${factorResults.holderDrawdownFromHighestSinceLastBuy?.toFixed(2) || 'NULL'}%, ` +
            `holdDuration=${factorResults.holdDuration}s, ` +
            `priceDrawdown=${factorResults.drawdownFromHighestSinceLastBuy?.toFixed(2) || 'NULL'}%`);
        }

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

      // 从 Map 获取 token 创建时间
      const tokenCreatedAt = this._tokenCreatedTimes.get(tokenAddress) || null;

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
        strategyExecutions: {},
        tokenCreatedAt: tokenCreatedAt
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
    // 使用统一的 FactorBuilder 构建因子
    const { buildFactorsFromTimeSeries } = require('../core/FactorBuilder');

    const factorValues = dataPoint.factor_values || {};
    const now = new Date(dataPoint.timestamp).getTime();
    const priceUsd = parseFloat(dataPoint.price_usd) || 0;

    // 更新最高价格状态
    if (priceUsd > (tokenState.highestPrice || 0)) {
      tokenState.highestPrice = priceUsd;
      tokenState.highestPriceTimestamp = now;
    }

    // 维护最近一次购买后的最高价状态（类似 profitPercent 的处理方式）
    if (tokenState.buyTime) {
      if (tokenState.highestPriceSinceLastBuy === null || priceUsd > tokenState.highestPriceSinceLastBuy) {
        tokenState.highestPriceSinceLastBuy = priceUsd;
        tokenState.highestPriceSinceLastBuyTimestamp = now;
      }

      // 维护最近一次购买后的最高持有者数量状态
      const currentHolderCount = factorValues.holders || 0;
      if (tokenState.highestHolderCountSinceLastBuy === null || currentHolderCount > tokenState.highestHolderCountSinceLastBuy) {
        tokenState.highestHolderCountSinceLastBuy = currentHolderCount;
        tokenState.highestHolderCountSinceLastBuyTimestamp = now;
      }
    }

    // 更新持有者历史缓存（包括 holders=0 的情况，以便累积足够数据点）
    const tokenKey = `${tokenState.token}-bsc`;
    const holderCount = factorValues.holders || 0;
    if (this._holderHistoryCache && holderCount >= 0) {
      this._holderHistoryCache.addHolderCount(tokenKey, holderCount, now);
    }

    // 调试日志：在构建因子前检查 tokenState.buyTime
    if (tokenState.buyTime) {
      this.logger.info(this._experimentId, '_buildFactorsFromData_PRE',
        `构建因子前: symbol=${tokenState.symbol}, buyTime=${new Date(tokenState.buyTime).toISOString()}, buyPrice=${tokenState.buyPrice}, highestHolder=${tokenState.highestHolderCountSinceLastBuy}`);
    }

    // 构建基础因子（FactorBuilder 会动态计算 drawdownFromHighestSinceLastBuy 等）
    let factors = buildFactorsFromTimeSeries(factorValues, tokenState, priceUsd, now);

    // 调试日志：检查持有者回撤因子计算
    if (tokenState.buyTime) {
      const holderDrawdown = factors.holderDrawdownFromHighestSinceLastBuy;
      const priceDrawdown = factors.drawdownFromHighestSinceLastBuy;

      this.logger.info(this._experimentId, '_buildFactorsFromData',
        `${tokenState.symbol}: ` +
        `buyTime=${new Date(tokenState.buyTime).toISOString()}, ` +
        `holders=${factorValues.holders}, ` +
        `highestHolder=${tokenState.highestHolderCountSinceLastBuy}, ` +
        `holderDrawdown=${holderDrawdown !== null ? holderDrawdown.toFixed(2) + '%' : 'NULL'}, ` +
        `priceDrawdown=${priceDrawdown !== null ? priceDrawdown.toFixed(2) + '%' : 'NULL'}, ` +
        `holdDuration=${factors.holdDuration}s`
      );
    }

    // 动态计算持有者趋势因子（如果时序数据中没有）
    if (!factors.holderTrendCV && this._holderHistoryCache) {
      const holderCounts = this._holderHistoryCache.getHolderCountArray(tokenKey);
      const maxPoints = 8;
      const _holderCounts = holderCounts.slice(-maxPoints);

      factors.holderTrendDataPoints = _holderCounts.length;

      if (_holderCounts.length >= 2) {
        // 基础指标
        const firstCount = _holderCounts[0];
        const lastCount = _holderCounts[_holderCounts.length - 1];
        factors.holderTrendGrowthRatio = firstCount > 0 ? ((lastCount - firstCount) / firstCount) * 100 : 0;

        let riseCount = 0;
        for (let i = 1; i < _holderCounts.length; i++) {
          if (_holderCounts[i] > _holderCounts[i - 1]) riseCount++;
        }
        factors.holderTrendRiseRatio = riseCount / Math.max(1, _holderCounts.length - 1);

        // 变异系数 CV
        if (this._holderTrendDetector) {
          factors.holderTrendCV = this._holderTrendDetector._calculateCV(_holderCounts);
        }

        // 减少统计
        const _checkSize = Math.min(5, _holderCounts.length);
        const _recentCounts = _holderCounts.slice(-_checkSize);
        let _decreaseCount = 0;
        for (let i = 1; i < _recentCounts.length; i++) {
          if (_recentCounts[i] < _recentCounts[i - 1]) _decreaseCount++;
        }
        factors.holderTrendRecentDecreaseCount = _decreaseCount;
        factors.holderTrendRecentDecreaseRatio = _decreaseCount / Math.max(1, _recentCounts.length - 1);

        // 连续减少次数
        let _consecutiveDecreases = 0;
        for (let i = _holderCounts.length - 1; i > 0; i--) {
          if (_holderCounts[i] < _holderCounts[i - 1]) {
            _consecutiveDecreases++;
          } else {
            break;
          }
        }
        factors.holderTrendConsecutiveDecreases = _consecutiveDecreases;

        // 需要至少 4 个数据点的指标
        if (_holderCounts.length >= 4 && this._holderTrendDetector) {
          const _direction = this._holderTrendDetector._confirmDirection(_holderCounts);
          factors.holderTrendHolderCountUp = _direction.holderCountUp;
          factors.holderTrendMedianUp = _direction.holderMedianUp;
          factors.holderTrendSlope = _direction.relativeSlope || 0;

          const _strength = this._holderTrendDetector._calculateTrendStrength(_holderCounts);
          factors.holderTrendStrengthScore = _strength.score;
        }
      }
    }

    return factors;
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

      // ========== 先创建并保存信号到数据库 ==========
      // 信号应该先被保存，然后再进行预检查
      // 这样即使预检查失败，信号记录也会被保存

      // 初始化 CardPositionManager（如果启用）
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

      // 构建初始信号（只有 trendFactors，preBuyCheckFactors 稍后填充）
      const initialSignalFactors = {
        trendFactors: factorResults || {},
        preBuyCheckFactors: {}  // 初始为空，预检查后填充
      };

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
        factors: initialSignalFactors,
        timestamp: timestamp
      };

      this.logger.info(this._experimentId, '_executeStrategy',
        `创建信号 | symbol=${tokenState.symbol}, action=${signal.action}`);

      // 先保存信号到数据库
      let signalId = null;
      try {
        const { TradeSignal } = require('../entities');
        const tradeSignal = new TradeSignal({
          experimentId: this._experimentId,
          tokenAddress: signal.tokenAddress,
          tokenSymbol: signal.symbol,
          signalType: signal.action.toUpperCase(),
          action: signal.action,
          confidence: signal.confidence,
          reason: signal.reason,
          metadata: {
            ...signal,
            price: signal.price,
            strategyId: signal.strategyId,
            strategyName: signal.strategyName,
            cards: signal.cards
          },
          createdAt: signal.timestamp || new Date()
        });

        signalId = await tradeSignal.save();
        // 将 signalId 添加到 signal 对象中，供后续使用
        signal.signalId = signalId;
        this.logger.info(this._experimentId, '_executeStrategy',
          `信号已保存 | symbol=${tokenState.symbol}, signalId=${signalId}`);
      } catch (saveError) {
        this.logger.error(this._experimentId, '_executeStrategy',
          `保存信号失败 | symbol=${tokenState.symbol}, error=${saveError.message}`);
        return false;
      }

      // ========== 叙事分析步骤（轮询获取结果） ==========
      let narrativeRating = 0; // 默认未完成
      if (this._narrativeAnalysisEnabled) {
        narrativeRating = await this._getNarrativeRating(tokenState.token);
        this.logger.info(this._experimentId, '_executeStrategy',
          `叙事评级 | symbol=${tokenState.symbol}, rating=${narrativeRating}`);
      }
      // ========== 叙事分析步骤结束 ==========

      // ========== 执行购买前检查 ==========
      let preCheckPassed = true;
      let preCheckReason = null;
      let preBuyCheckResult = null;

      // 根据交易轮数确定是否需要执行预检查
      const currentRound = tokenState.completedPairs ? tokenState.completedPairs.length : 0;
      let shouldPerformPreCheck = false;

      if (currentRound === 0) {
        // 首次买入：如果有 preBuyCheckCondition 则执行预检查
        shouldPerformPreCheck = !!(strategy.preBuyCheckCondition && String(strategy.preBuyCheckCondition).trim() !== '');
      } else {
        // 再次买入：只有明确配置了 repeatBuyCheckCondition 时才执行预检查
        shouldPerformPreCheck = !!(strategy.repeatBuyCheckCondition && String(strategy.repeatBuyCheckCondition).trim() !== '');
      }

      if (shouldPerformPreCheck && this._preBuyCheckService) {
        try {
          const tokenInfo = this._buildTokenInfoForBacktest(tokenState);

          let preBuyCheckCondition;
          if (currentRound === 0) {
            preBuyCheckCondition = strategy.preBuyCheckCondition;
          } else {
            preBuyCheckCondition = strategy.repeatBuyCheckCondition;
          }

          preBuyCheckCondition = String(preBuyCheckCondition).trim();

          // 获取上一对收益率
          const lastPairReturnRate = currentRound > 0 && tokenState.completedPairs
            ? tokenState.completedPairs[currentRound - 1].returnRate
            : 0;

          this.logger.info(this._experimentId, '_executeStrategy',
            `执行购买前检查（回测） | symbol=${tokenState.symbol}, round=${currentRound + 1}, condition=${preBuyCheckCondition}`);

          preBuyCheckResult = await this._preBuyCheckService.performAllChecks(
            tokenState.token,                    // tokenAddress
            tokenState.creatorAddress || null,   // creatorAddress
            this._experiment.id,                 // experimentId
            signalId,                            // signalId (回测也有signalId，用于保存早期交易数据)
            tokenState.chain || 'bsc',          // chain
            tokenInfo,                          // tokenInfo
            preBuyCheckCondition,               // preBuyCheckCondition
            {
              checkTime: Math.floor(timestamp.getTime() / 1000),
              skipHolderCheck: true,
              skipTwitterSearch: true,  // 回测时跳过Twitter搜索，因子使用默认值
              tokenBuyTime: tokenState.buyTime || null,  // 代币首次买入时间
              drawdownFromHighest: factorResults.drawdownFromHighest || null,  // 从最高价跌幅
              buyRound: currentRound + 1,  // 即将进行的轮数
              lastPairReturnRate: lastPairReturnRate ?? 0,
              narrativeRating: narrativeRating  // 叙事评级
            }
          );

          this.logger.info(this._experimentId, '_executeStrategy',
            `预检查完成 | symbol=${tokenState.symbol}, canBuy=${preBuyCheckResult.canBuy}, reason=${preBuyCheckResult.checkReason}`);

          if (!preBuyCheckResult.canBuy) {
            preCheckPassed = false;
            preCheckReason = preBuyCheckResult.checkReason || '预检查失败';
          }
        } catch (error) {
          this.logger.error(this._experimentId, '_executeStrategy',
            `购买前检查异常 | symbol=${tokenState.symbol}, error=${error.message}`);
          preCheckPassed = false;
          preCheckReason = `检查异常: ${error.message}`;
        }
      } else {
        this.logger.info(this._experimentId, '_executeStrategy',
          `跳过购买前检查 | symbol=${tokenState.symbol}, round=${currentRound + 1}, shouldPerformPreCheck=${shouldPerformPreCheck}`);
      }

      // ========== 更新信号 metadata（包含预检查结果） ==========
      try {
        const { buildFactorValuesForTimeSeries, buildPreBuyCheckFactorValues } = require('../core/FactorBuilder');

        // 提取 tokenCreateTime（用于记录使用的是哪种方法）
        const tokenCreateTime = tokenState.tokenCreatedAt
          ? Math.floor(new Date(tokenState.tokenCreatedAt).getTime() / 1000)
          : null;

        const signalMetadata = {
          tokenCreateTime: tokenCreateTime,
          trendFactors: buildFactorValuesForTimeSeries(factorResults),
          preBuyCheckFactors: preBuyCheckResult ? buildPreBuyCheckFactorValues(preBuyCheckResult) : {},
          preBuyCheckResult: preBuyCheckResult ? {
            canBuy: preBuyCheckResult.canBuy,
            reason: preBuyCheckResult.checkReason || (preCheckPassed ? 'passed' : 'failed'),
            failedConditions: preBuyCheckResult.failedConditions || null
          } : null
        };

        await this._updateSignalMetadata(signalId, signalMetadata);
        this.logger.info(this._experimentId, '_executeStrategy',
          `信号元数据已更新 | symbol=${tokenState.symbol}, signalId=${signalId}`);
      } catch (updateError) {
        this.logger.warn(this._experimentId, '_executeStrategy',
          `更新信号元数据失败 | symbol=${tokenState.symbol}, error=${updateError.message}`);
      }

      // ========== 如果预检查失败，更新信号状态并返回 ==========
      if (!preCheckPassed) {
        await this._updateSignalStatus(signalId, 'failed', {
          message: `预检查失败: ${preCheckReason}`,
          reason: preCheckReason
        });

        if (this._roundSummary) {
          this._roundSummary.recordSignalExecution(tokenState.token, false, preCheckReason);
        }

        this.logger.info(this._experimentId, '_executeStrategy',
          `预检查失败，信号已标记为失败 | symbol=${tokenState.symbol}, signalId=${signalId}`);
        return false;
      }

      // ========== 预检查通过，执行交易 ==========
      const result = await this.processSignal(signal, signalId);

      if (result && result.success) {
        tokenState.status = 'bought';
        tokenState.buyPrice = price;
        tokenState.buyTime = timestamp.getTime();

        // 调试日志：确认买入状态设置
        this.logger.info(this._experimentId, '_executeStrategy',
          `✅ 买入成功后设置 tokenState: symbol=${tokenState.symbol}, buyTime=${new Date(tokenState.buyTime).toISOString()}, buyPrice=${price}, holders=${factorResults.holders}`);

        // 重置最近一次购买后的最高价（用于止损/止盈）
        tokenState.highestPriceSinceLastBuy = price;
        tokenState.highestPriceSinceLastBuyTimestamp = timestamp.getTime();
        // 初始化持有者回撤基准（买入时的持有者数量）
        const currentHolderCount = factorResults.holders || 0;
        tokenState.highestHolderCountSinceLastBuy = currentHolderCount;
        tokenState.highestHolderCountSinceLastBuyTimestamp = timestamp.getTime();

        tokenState.strategyExecutions[strategy.id].count++;
        tokenState.strategyExecutions[strategy.id].lastExecution = timestamp.getTime();

        if (this._roundSummary) {
          this._roundSummary.recordSignalExecution(tokenState.token, true, null);
        }

        return true;
      }

      // 执行失败，更新信号状态
      const failureReason = result?.message || result?.reason || '执行失败';
      await this._updateSignalStatus(signalId, 'failed', {
        message: failureReason,
        reason: failureReason
      });

      if (this._roundSummary) {
        this._roundSummary.recordSignalExecution(tokenState.token, false, failureReason);
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

      // 构建两层结构的 factors（卖出只需要 trendFactors）
      const signalFactors = {
        trendFactors: factorResults || {}
      };

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
        factors: signalFactors,
        timestamp: timestamp
      };

      const result = await this.processSignal(signal);

      if (result && result.success) {
        tokenState.strategyExecutions[strategy.id].count++;
        tokenState.strategyExecutions[strategy.id].lastExecution = timestamp.getTime();

        // 检查是否全部卖出，更新状态
        const holding = this._getHolding(tokenState.token);
        const isAllSold = (cards === 'all') || !holding || holding.amount <= 0;

        if (isAllSold) {
          // 全部卖出，状态更新为 'sold'
          tokenState.status = 'sold';
          tokenState.soldAt = timestamp.getTime();
          this.logger.info(this._experimentId, '_executeStrategy',
            `代币 ${tokenState.symbol} 全部卖出，状态更新为 sold`);

          // 记录已完成的交易对
          if (tokenState.buyTime && tokenState.buyPrice) {
            const sellPrice = factorResults.currentPrice || 0;
            const buyPrice = tokenState.buyPrice;
            const returnRate = buyPrice > 0 ? ((sellPrice - buyPrice) / buyPrice * 100) : 0;

            // 计算盈亏 (回测中使用估算)
            const holding = this._getHolding(tokenState.token);
            const amountSold = holding ? holding.amount : 0;
            const received = amountSold * sellPrice;
            const cost = received / (1 + returnRate / 100);
            const pnl = received - cost;

            if (!tokenState.completedPairs) {
              tokenState.completedPairs = [];
            }
            tokenState.completedPairs.push({
              buyTime: tokenState.buyTime,
              sellTime: timestamp.getTime(),
              returnRate: returnRate,
              pnl: pnl
            });

            this.logger.info(this._experimentId, '_executeStrategy',
              `记录已完成交易对 | symbol=${tokenState.symbol}, buyPrice=${buyPrice}, sellPrice=${sellPrice}, returnRate=${returnRate.toFixed(2)}%, pnl=${pnl.toFixed(6)} BNB`);
          }
        } else {
          // 部分卖出，状态保持 'bought'
          this.logger.info(this._experimentId, '_executeStrategy',
            `代币 ${tokenState.symbol} 部分卖出，剩余 ${holding?.amount || 0}`);
        }

        if (this._roundSummary) {
          this._roundSummary.recordSignalExecution(tokenState.token, true, null);
        }

        return true;
      }

      // 执行失败，记录失败原因
      const failureReason = result?.message || result?.reason || '执行失败';
      console.error(`❌ 卖出策略执行失败: ${tokenState.symbol} (${tokenState.token})`);
      console.error(`   原因: ${failureReason}`);
      console.error(`   result:`, result);

      if (this._roundSummary) {
        this._roundSummary.recordSignalExecution(tokenState.token, false, failureReason);
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
    const cashBalance = portfolio?.cashBalance || 0;

    const cardManager = this._tokenPool.getCardPositionManager(signal.tokenAddress, signal.chain);
    if (cardManager) {
      const cards = signal.cards || 1;
      const amount = cardManager.calculateBuyAmount(cards);
      this.logger.debug(this._experimentId, '_calculateBuyAmount', `💰 计算买入金额: ${signal.symbol}, 卡牌管理器存在, cards=${cards}, amount=${amount}`);

      if (amount <= 0) {
        console.error(`❌ calculateBuyAmount 返回 0: ${signal.symbol}, cards=${cards}`);
        return 0;
      }
      // 转换 Decimal 为数字
      const amountValue = typeof amount === 'number' ? amount : amount.toNumber();
      const balanceValue = typeof cashBalance === 'number' ? cashBalance : cashBalance.toNumber();

      this.logger.debug(this._experimentId, '_calculateBuyAmount', `💰 余额检查: amountValue=${amountValue}, balanceValue=${balanceValue}`);

      if (balanceValue < amountValue) {
        console.error(`❌ 余额不足: 需要 ${amountValue}, 可用 ${balanceValue}`);
        return 0;
      }
      return amountValue;
    }

    this.logger.debug(this._experimentId, '_calculateBuyAmount', `💰 卡牌管理器不存在，使用默认金额: ${signal.symbol}`);
    const tradeAmount = this._experiment.config?.backtest?.tradeAmount || 0.1;
    const balanceValue = typeof cashBalance === 'number' ? cashBalance : cashBalance.toNumber();
    if (balanceValue < tradeAmount) {
      console.error(`❌ 余额不足(默认): 需要 ${tradeAmount}, 可用 ${balanceValue}`);
      return 0;
    }
    return tradeAmount;
  }

  /**
   * 回测结束前强制卖出所有剩余持仓
   * @private
   * @returns {Promise<void>}
   */
  async _forceSellAllRemaining() {
    this.logger.info(this._experimentId, 'BacktestEngine',
      `🔄 回测结束，开始强制卖出剩余持仓...`);

    // 1. 找出所有仍为 'bought' 状态的代币
    const remainingTokens = [];
    for (const [address, tokenState] of this._tokenStates) {
      if (tokenState.status === 'bought') {
        remainingTokens.push({ address, tokenState });
      }
    }

    if (remainingTokens.length === 0) {
      this.logger.info(this._experimentId, 'BacktestEngine',
        `✅ 无剩余持仓需要强制卖出`);
      return;
    }

    this.logger.info(this._experimentId, 'BacktestEngine',
      `📊 发现 ${remainingTokens.length} 个剩余持仓待卖出`);

    // 2. 获取最后的数据点时间戳（作为卖出时间）
    const lastRoundData = this._groupedData[this._groupedData.length - 1];
    const lastDataPoint = lastRoundData.dataPoints[lastRoundData.dataPoints.length - 1];
    const forceSellTime = new Date(lastDataPoint.timestamp);

    let successCount = 0;
    let failCount = 0;

    // 3. 逐个执行卖出
    for (const { address, tokenState } of remainingTokens) {
      try {
        // 使用当前价格或最后已知价格
        const sellPrice = tokenState.currentPrice || tokenState.highestPrice;

        if (!sellPrice || sellPrice <= 0) {
          this.logger.warn(this._experimentId, '_forceSellAllRemaining',
            `⚠️ 跳过 ${tokenState.symbol}: 无有效价格`);
          failCount++;
          continue;
        }

        // 获取持仓信息
        const holding = this._getHolding(address);
        if (!holding || holding.amount <= 0) {
          this.logger.warn(this._experimentId, '_forceSellAllRemaining',
            `⚠️ 跳过 ${tokenState.symbol}: 无有效持仓`);
          failCount++;
          continue;
        }

        // 计算收益率
        const buyPrice = tokenState.buyPrice || sellPrice;
        const profitPercent = ((sellPrice - buyPrice) / buyPrice * 100).toFixed(2);
        const holdDurationMinutes = tokenState.buyTime
          ? ((forceSellTime.getTime() - tokenState.buyTime) / 1000 / 60)
          : 0;

        // 创建强制卖出信号
        const signal = {
          action: 'sell',
          symbol: tokenState.symbol,
          tokenAddress: address,
          chain: 'bsc',
          price: sellPrice,
          confidence: 100,
          reason: '回测结束强制卖出',
          cards: 'all',
          buyPrice: buyPrice,
          profitPercent: parseFloat(profitPercent),
          holdDuration: holdDurationMinutes * 60,
          factors: {
            trendFactors: {
              forceSell: true,
              reason: 'backtest_end'
            }
          },
          timestamp: forceSellTime
        };

        // 执行卖出
        const result = await this._executeSell(signal, null, {
          forceSell: true,
          reason: 'backtest_end'
        }, forceSellTime);

        if (result && result.success) {
          successCount++;
          this.logger.info(this._experimentId, '_forceSellAllRemaining',
            `✅ 强制卖出成功: ${tokenState.symbol}, ` +
            `收益率: ${profitPercent}%, 持仓时长: ${holdDurationMinutes.toFixed(1)}分钟`);

          // 更新代币状态
          tokenState.status = 'sold';
        } else {
          failCount++;
          this.logger.warn(this._experimentId, '_forceSellAllRemaining',
            `❌ 强制卖出失败: ${tokenState.symbol}, 原因: ${result?.reason || '未知'}`);
        }

      } catch (error) {
        failCount++;
        this.logger.error(this._experimentId, '_forceSellAllRemaining',
          `❌ 强制卖出异常: ${tokenState.symbol} - ${error.message}`);
      }
    }

    this.logger.info(this._experimentId, 'BacktestEngine',
      `📊 强制卖出完成 | 成功: ${successCount}, 失败: ${failCount}`);
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

    // 调用基类 start 方法（会设置状态并调用 _updateExperimentStatus）
    await super.start();

    this.logger.info(this._experimentId, 'start', `🚀 回测引擎已启动: 实验 ${this._experimentId}`);
  }

  /**
   * 停止引擎（覆盖基类方法）
   * @returns {Promise<void>}
   */
  async stop() {
    if (this._status === EngineStatus.STOPPED) {
      return;
    }

    // 调用基类 stop 方法（会设置状态并调用 _updateExperimentStatus）
    await super.stop();

    this.logger.info(this._experimentId, 'stop', `🛑 回测引擎已停止: 实验 ${this._experimentId}`);
  }

  /**
   * 执行叙事分析（回测模式）
   * @private
   * @param {string} tokenAddress - 代币地址
   * @returns {Promise<number>} 叙事评级 (1=低质量, 2=中质量, 3=高质量, 9=未评级)
   */
  async _executeNarrativeAnalysis(tokenAddress) {
    const startTime = Date.now();
    try {
      const { NarrativeAnalyzer } = await import('../../narrative/analyzer/NarrativeAnalyzer.mjs');
      const result = await NarrativeAnalyzer.analyze(tokenAddress, {
        ignoreCache: this._narrativeReanalyze,
        experimentId: this._experimentId
      });
      const fromCache = result.meta?.fromCache ? '缓存' : 'LLM';
      const sourceExp = result.meta?.sourceExperimentId || 'N/A';
      const rating = this._mapCategoryToRating(result.llmAnalysis?.category);

      this.logger.info(this._experimentId, '_executeNarrativeAnalysis',
        `叙事分析完成 | token=${tokenAddress.slice(0, 10)}..., rating=${rating}, source=${fromCache}, sourceExp=${sourceExp}, duration=${Date.now() - startTime}ms`);

      return rating;
    } catch (error) {
      this.logger.warn(this._experimentId, '_executeNarrativeAnalysis',
        `叙事分析失败 | token=${tokenAddress.slice(0, 10)}..., error=${error.message}`);
      return 9; // 错误返回未评级
    }
  }

  /**
   * 获取叙事评级（带轮询等待）
   * @protected
   * @param {string} tokenAddress - 代币地址
   * @returns {Promise<number>} 叙事评级
   */
  async _getNarrativeRating(tokenAddress) {
    return this._pollNarrativeRating(this._experimentId, tokenAddress, {
      maxWaitSeconds: this._narrativeMaxWaitSeconds,
      pollIntervalMs: this._narrativePollIntervalMs
    });
  }

  /**
   * 计算趋势因子满足比例
   * @protected
   * @param {Object} factorResults - 因子结果
   * @returns {number} 满足比例（0-100）
   */
  _calculateTrendFactorSatisfaction(factorResults) {
    let satisfiedCount = 0;
    let totalCount = 3;

    // 条件1: earlyReturn 在范围内
    if (factorResults.earlyReturn >= 80 && factorResults.earlyReturn <= 120) {
      satisfiedCount++;
    }

    // 条件2: 有趋势数据且向上
    if (factorResults.trendDataPoints >= 4 && factorResults.trendPriceUp === true) {
      satisfiedCount++;
    }

    // 条件3: 价格上涨占比
    if (factorResults.trendRiseRatio >= 0.6) {
      satisfiedCount++;
    }

    return (satisfiedCount / totalCount) * 100;
  }

  /**
   * 将叙事分析类别映射到评级
   * @private
   * @param {string} category - 叙事类别 (high/mid/low/unrated)
   * @returns {number} 评级 (1=低质量, 2=中质量, 3=高质量, 9=未评级)
   */
  _mapCategoryToRating(category) {
    const mapping = {
      'high': 3,
      'mid': 2,
      'low': 1,
      'unrated': 9
    };
    return mapping[category] || 9;
  }


  // 注意：不再允许使用硬编码策略
  // 策略必须在实验配置中通过 config.strategiesConfig 明确定义
}

module.exports = { BacktestEngine };
