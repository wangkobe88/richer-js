/**
 * 虚拟交易引擎
 * 用于 fourmeme 交易实验的虚拟交易模拟
 * 继承自 AbstractTradingEngine
 */

const { TradingMode, EngineStatus } = require('../interfaces/ITradingEngine');
const { AbstractTradingEngine } = require('../core/AbstractTradingEngine');
const { ExperimentDataService } = require('../../web/services/ExperimentDataService');
const Logger = require('../../services/logger');
const Decimal = require('decimal.js');

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
    // 先创建一个临时 Logger（experimentId=null），在 initialize() 中会被替换
    this.logger = new Logger({ dir: './logs', experimentId: null });

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

      this.logger.info(this._experimentId, '_executeBuy',
        `获取卡牌管理器 | symbol=${signal.symbol}, cardManager=${cardManager ? '存在' : '不存在'}`);

      if (!cardManager) {
        this.logger.error(this._experimentId, '_executeBuy',
          `卡牌管理器未初始化 | tokenAddress=${signal.tokenAddress}, chain=${signal.chain}`);
        this.logger.error(this._experimentId, '_executeBuy',
          `positionManagement配置 | ${JSON.stringify(this._positionManagement || 'null')}`);
        return { success: false, reason: '卡牌管理器未初始化，无法执行买入' };
      }

      // 注意：Dev持仓检查已在预检查阶段完成，此处不再重复检查

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
      // 使用 Decimal 进行除法，避免浮点数精度问题
      const tokenAmount = price > 0 ? new Decimal(amountInBNB).div(price).toNumber() : 0;

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

      // 安全地访问 result 属性
      const resultSuccess = result?.success ?? false;
      const resultReason = result?.reason || result?.message || result?.error || 'none';

      this.logger.info(this._experimentId, '_executeBuy',
        `交易结果 | success=${resultSuccess}, reason=${resultReason}`);

      // 买入成功后更新卡牌分配和状态
      if (result && resultSuccess) {
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

        // 安全地访问 result.trade
        if (result.trade && typeof result.trade === 'object') {
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

          const tradeId = result.trade.id;
          if (tradeId) {
            this.logger.info(this._experimentId, '_executeBuy',
              `更新交易记录 | tradeId=${tradeId}, after状态已更新`);
            try {
              await this.dataService.updateTrade(tradeId, {
                metadata: result.trade.metadata
              });
            } catch (updateError) {
              this.logger.error(this._experimentId, '_executeBuy',
                `更新交易记录失败 | tradeId=${tradeId}, error=${updateError.message}`);
            }
          }
        } else {
          this.logger.warn(this._experimentId, '_executeBuy',
            `result.trade 不存在或不是对象 | type=${typeof result?.trade}`);
        }
      }

      return result || { success: false, reason: 'executeTrade 返回空值' };

    } catch (error) {
      this.logger.error(this._experimentId, '_executeBuy',
        `异常 | error=${error.message}, stack=${error.stack}`);
      return {
        success: false,
        reason: error.message || '买入执行异常',
        error: error.message || '买入执行异常'
      };
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
      // 使用 Decimal 进行乘法，避免浮点数精度问题
      const amountOutBNB = price > 0 ? new Decimal(amountToSell).mul(price).toNumber() : 0;

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

        // 🔥 卖出成功后，检查是否还有剩余持仓
        // 如果tokenCards为0，说明已全部卖出，更新状态为sold（交易后观察期）
        if (cardManager.tokenCards === 0) {
          this.logger.info(this._experimentId, '_executeSell',
            `已全部卖出，更新代币状态为sold(观察30分钟) | tokenAddress=${signal.tokenAddress}, symbol=${signal.symbol}`);
          this._tokenPool.markAsSold(signal.tokenAddress, signal.chain);
          await this.dataService.updateTokenStatus(this._experimentId, signal.tokenAddress, 'sold');
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

  /**
   * 覆盖 processSignal 方法，避免重复创建信号
   * 在 VirtualTradingEngine._executeStrategy() 中已经创建并保存了信号
   *
   * @param {Object} signal - 信号对象
   * @param {string} existingSignalId - 已存在的信号ID（已在_executeStrategy中保存）
   * @returns {Promise<Object>} 处理结果
   */
  async processSignal(signal, existingSignalId = null) {
    // 调试：记录 processSignal 被调用
    console.log(`🔔 VirtualTradingEngine.processSignal 被调用: ${signal.symbol} ${signal.action} (${signal.tokenAddress}), existingSignalId=${existingSignalId}`);

    if (!this._experiment) {
      console.error(`❌ processSignal: this._experiment 为 null`);
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

      // 创建信号实体 - 合并 factors 到 metadata
      const signalMetadata = {
        ...signal.metadata,
        ...(signal.factors || {}),
        price: signal.price,
        strategyId: signal.strategyId,
        strategyName: signal.strategyName,
        cards: signal.cards,
        cardConfig: signal.cardConfig
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
      console.log(`✅ [卖出] 信号已保存: ${signal.symbol} ${signal.action}, signalId=${signalId}`);
    } else {
      console.log(`♻️  [买入] 使用已存在的信号: ${signal.symbol} ${signal.action}, signalId=${signalId}`);
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
      if (signalId) {
        await this._updateSignalStatus(signalId, result.success ? 'executed' : 'failed', result);
      }

    } catch (error) {
      this._logger.error('信号执行失败', {
        signalId,
        error: error.message,
        stack: error.stack
      });

      if (signalId) {
        await this._updateSignalStatus(signalId, 'failed', {
          message: error.message,
          error: error.stack
        });
      }

      result = { success: false, message: error.message };
    }

    return result;
  }

  // ==================== Virtual 特有方法 ====================

  /**
   * 更新所有组件的 logger experimentId
   * @private
   * @returns {Promise<void>}
   */
  async _updateComponentLoggers() {
    // 更新 VirtualTradingEngine 自己的 logger experimentId
    if (this.logger && this.logger.setExperimentId) {
      this.logger.setExperimentId(this._experimentId);
    }

    // 更新 PlatformCollector 的 logger experimentId
    if (this._fourmemeCollector) {
      this._fourmemeCollector.logger.setExperimentId(this._experimentId);
    }
  }

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

    // 2.2 初始化购买前检查服务
    const { PreBuyCheckService } = require('../pre-check/PreBuyCheckService');

    // 合并配置：外部默认配置 + 实验配置
    const defaultConfig = require('../../../config/default.json');
    const experimentPreBuyConfig = this._experiment?.config?.preBuyCheck || {};
    const preBuyCheckConfig = {
      ...defaultConfig.preBuyCheck,
      ...experimentPreBuyConfig
    };

    this._preBuyCheckService = new PreBuyCheckService(supabase, this.logger, preBuyCheckConfig);
    console.log(`✅ 购买前检查服务初始化完成 (earlyParticipantFilterEnabled=${preBuyCheckConfig.earlyParticipantFilterEnabled})`);

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

    // 3. 初始化收集器（传递实验ID和区块链配置）
    this._fourmemeCollector = new PlatformCollector(
      config,
      this.logger,
      this._tokenPool,
      this._experimentId,  // 传递实验ID
      this._blockchain    // 传递区块链配置，用于过滤平台
    );
    console.log(`✅ Fourmeme收集器初始化完成 [实验ID: ${this._experimentId}, 区块链: ${this._blockchain}]`);

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
          preBuyCheckCondition: s.preBuyCheckCondition || null,
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

    console.log(`🔍 卡牌管理配置检查 | positionManagement=${JSON.stringify(this._positionManagement || 'null')}`);

    if (this._positionManagement && this._positionManagement.enabled) {
      console.log(`✅ 卡牌仓位管理已启用: 总卡牌数=${this._positionManagement.totalCards || 4}, 单卡BNB=${this._positionManagement.perCardMaxBNB || 0.025}`);
    } else {
      console.log(`⚠️ 卡牌仓位管理未启用: positionManagement=${!!this._positionManagement}, enabled=${this._positionManagement?.enabled}`);
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
      const { buildPreBuyCheckFactorValues } = require('../core/FactorBuilder');

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
        if (strategy.action === 'buy') {
          // 只排除 sold 状态（已完全卖出的代币）
          // bought 状态允许再次买入（通过卡牌机制控制，有BNB卡就能买）
          if (token.status === 'sold') {
            this.logger.debug(this._experimentId, 'ProcessToken',
              `${token.symbol} 买入策略跳过 (状态: ${token.status}，已完全卖出)`);
            return;
          }
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

        const executionResult = await this._executeStrategy(strategy, token, factorResults);

        if (this._roundSummary) {
          this._roundSummary.recordSignalExecution(
            token.token,
            executionResult.success,
            executionResult.success ? null : (executionResult.reason || '执行失败')
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

    // collectionPrice 保留用于兼容和调试
    const collectionPrice = token.collectionPrice || currentPrice;

    // 使用 launchPrice 作为基准，如果没有则使用 collectionPrice（收集价格）
    // 这样可以确保即使 AVE API 没有返回 launch_price，earlyReturn 也能基于收集价格计算
    const launchPrice = token.launchPrice || collectionPrice || 0;

    let earlyReturn = 0;
    if (launchPrice > 0 && currentPrice > 0) {
      earlyReturn = ((currentPrice - launchPrice) / launchPrice) * 100;
    }

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

    const collectionTime = token.collectionTime || token.addedAt || now;
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

    // 趋势检测指标因子（使用固定窗口：最多8个点）
    const prices = this._tokenPool.getTokenPrices(token.token, token.chain);

    // 固定窗口：只使用最近8个点
    const maxPoints = 8;
    const _prices = prices.slice(-maxPoints);

    // 记录实际使用的数据点数量
    factors.trendDataPoints = _prices.length;

    // 渐进式计算：根据可用数据点数量计算不同指标
    if (_prices.length >= 2) {
      // 基础指标（需要至少 2 个数据点）

      // 1. 总收益率和上涨占比（需要 2 个点）
      const firstPrice = _prices[0];
      const lastPrice = _prices[_prices.length - 1];
      factors.trendTotalReturn = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;

      // 计算上涨次数占比
      let riseCount = 0;
      for (let i = 1; i < _prices.length; i++) {
        if (_prices[i] > _prices[i - 1]) riseCount++;
      }
      factors.trendRiseRatio = riseCount / Math.max(1, _prices.length - 1);

      // 2. 变异系数 CV（需要 2 个点）
      if (this._trendDetector) {
        factors.trendCV = this._trendDetector._calculateCV(_prices);
      }

      // 3. 最近的下跌统计（检查最近 5 个或所有数据点）
      const _checkSize = Math.min(5, _prices.length);
      const _recentPrices = _prices.slice(-_checkSize);
      let _downCount = 0;
      for (let i = 1; i < _recentPrices.length; i++) {
        if (_recentPrices[i] < _recentPrices[i - 1]) _downCount++;
      }
      factors.trendRecentDownCount = _downCount;
      factors.trendRecentDownRatio = _downCount / Math.max(1, _recentPrices.length - 1);

      // 4. 连续下跌次数
      let _consecutiveDowns = 0;
      for (let i = _prices.length - 1; i > 0; i--) {
        if (_prices[i] < _prices[i - 1]) {
          _consecutiveDowns++;
        } else {
          break;
        }
      }
      factors.trendConsecutiveDowns = _consecutiveDowns;

      // 需要至少 4 个数据点的指标
      if (_prices.length >= 4 && this._trendDetector) {
        // 方向确认（2个独立指标 + 斜率数值）
        const _direction = this._trendDetector._confirmDirection(_prices);
        factors.trendPriceUp = _direction.trendPriceUp;
        factors.trendMedianUp = _direction.trendMedianUp;
        factors.trendSlope = _direction.relativeSlope || 0; // 相对斜率（百分比）

        // 趋势强度评分
        const _strength = this._trendDetector._calculateTrendStrength(_prices);
        factors.trendStrengthScore = _strength.score;
      }
    }
    // 数据不足时（< 2 个点），保持指标未定义（undefined）

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
    // 返回格式: { success: boolean, reason?: string }
    const successResult = (success) => ({ success });
    const failResult = (reason) => ({ success: false, reason });

    // 导入 FactorBuilder 函数（用于序列化因子）
    const { buildFactorValuesForTimeSeries, buildPreBuyCheckFactorValues } = require('../core/FactorBuilder');

    const { CardPositionManager } = getLazyModules();
    const latestPrice = token.currentPrice || 0;

    if (!factorResults) {
      factorResults = this._buildFactors(token);
    }

    if (strategy.action === 'buy') {
      // 状态检查 - 只排除 sold 状态（已完全卖出的代币）
      // bought 状态允许再次买入（通过卡牌机制控制）
      if (token.status === 'sold') {
        return failResult(`代币状态为 sold (已完全卖出，无法再次买入)`);
      }

      // ========== 先创建并保存信号到数据库 ==========
      // 信号应该先被保存，然后再进行预检查
      // 这样即使预检查失败，信号记录也会被保存

      // 初始化 strategyExecutions
      if (!token.strategyExecutions) {
        const strategyIds = this._strategyEngine.getAllStrategies().map(s => s.id);
        this._tokenPool.initStrategyExecutions(token.token, token.chain, strategyIds);
      }

      // 初始化 CardPositionManager（如果启用）
      this.logger.info(this._experimentId, '_executeStrategy',
        `卡牌管理器检查 | enabled=${this._positionManagement?.enabled}, hasConfig=${!!this._positionManagement}`);

      if (this._positionManagement && this._positionManagement.enabled) {
        this.logger.info(this._experimentId, '_executeStrategy',
          `卡牌管理器已启用，准备创建 | symbol=${token.symbol}`);

        let cardManager = this._tokenPool.getCardPositionManager(token.token, token.chain);
        if (!cardManager) {
          this.logger.info(this._experimentId, '_executeStrategy',
            `卡牌管理器不存在，开始创建 | symbol=${token.symbol}`);
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

      // 创建信号对象
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
          // 趋势/技术指标 factors
          trendFactors: {
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
            trendPriceUp: factorResults.trendPriceUp,
            trendMedianUp: factorResults.trendMedianUp,
            trendSlope: factorResults.trendSlope,
            trendStrengthScore: factorResults.trendStrengthScore,
            trendTotalReturn: factorResults.trendTotalReturn,
            trendRiseRatio: factorResults.trendRiseRatio,
            trendRecentDownCount: factorResults.trendRecentDownCount,
            trendRecentDownRatio: factorResults.trendRecentDownRatio,
            trendConsecutiveDowns: factorResults.trendConsecutiveDowns,
            trendPriceChangeFromDetect: factorResults.trendPriceChangeFromDetect,
            trendSinceBuyReturn: factorResults.trendSinceBuyReturn,
            trendSinceBuyDataPoints: factorResults.trendSinceBuyDataPoints
          },
          // 购买前检查 factors（初始为空，检查通过后更新）
          preBuyCheckFactors: {
            preBuyCheck: factorResults.preBuyCheck || 0,
            checkTimestamp: factorResults.checkTimestamp || null,
            checkDuration: factorResults.checkDuration || null,
            holderWhitelistCount: factorResults.holderWhitelistCount || 0,
            holderBlacklistCount: factorResults.holderBlacklistCount || 0,
            holdersCount: factorResults.holdersCount || 0,
            devHoldingRatio: factorResults.devHoldingRatio || 0,
            maxHoldingRatio: factorResults.maxHoldingRatio || 0,
            holderCanBuy: factorResults.holderCanBuy ?? null,
            preTraderCanBuy: factorResults.preTraderCanBuy ?? null,
            preTraderCheckReason: factorResults.preTraderCheckReason ?? null,
            // 早期参与者检查因子
            earlyTradesChecked: factorResults.earlyTradesChecked || 0,
            earlyTradesCheckTimestamp: factorResults.earlyTradesCheckTimestamp || null,
            earlyTradesCheckDuration: factorResults.earlyTradesCheckDuration || null,
            earlyTradesCheckTime: factorResults.earlyTradesCheckTime || null,
            earlyTradesWindow: factorResults.earlyTradesWindow || null,
            earlyTradesExpectedFirstTime: factorResults.earlyTradesExpectedFirstTime || null,
            earlyTradesExpectedLastTime: factorResults.earlyTradesExpectedLastTime || null,
            earlyTradesDataFirstTime: factorResults.earlyTradesDataFirstTime || null,
            earlyTradesDataLastTime: factorResults.earlyTradesDataLastTime || null,
            earlyTradesDataCoverage: factorResults.earlyTradesDataCoverage || 0,
            earlyTradesActualSpan: factorResults.earlyTradesActualSpan || 0,
            earlyTradesRateCalcWindow: factorResults.earlyTradesRateCalcWindow || 1,
            earlyTradesVolumePerMin: factorResults.earlyTradesVolumePerMin || 0,
            earlyTradesCountPerMin: factorResults.earlyTradesCountPerMin || 0,
            earlyTradesWalletsPerMin: factorResults.earlyTradesWalletsPerMin || 0,
            earlyTradesHighValuePerMin: factorResults.earlyTradesHighValuePerMin || 0,
            earlyTradesTotalCount: factorResults.earlyTradesTotalCount || 0,
            earlyTradesVolume: factorResults.earlyTradesVolume || 0,
            earlyTradesUniqueWallets: factorResults.earlyTradesUniqueWallets || 0,
            earlyTradesHighValueCount: factorResults.earlyTradesHighValueCount || 0,
            earlyTradesFilteredCount: factorResults.earlyTradesFilteredCount || 0,
            // 钱包簇检查因子
            walletClusterSecondToFirstRatio: factorResults.walletClusterSecondToFirstRatio || 0,
            walletClusterMegaRatio: factorResults.walletClusterMegaRatio || 0,
            walletClusterTop2Ratio: factorResults.walletClusterTop2Ratio || 0,
            walletClusterCount: factorResults.walletClusterCount || 0,
            walletClusterMaxSize: factorResults.walletClusterMaxSize || 0,
            walletClusterSecondSize: factorResults.walletClusterSecondSize || 0,
            walletClusterAvgSize: factorResults.walletClusterAvgSize || 0,
            walletClusterMinSize: factorResults.walletClusterMinSize || 0,
            walletClusterMegaCount: factorResults.walletClusterMegaCount || 0,
            walletClusterMaxClusterWallets: factorResults.walletClusterMaxClusterWallets || 0,
            walletClusterIntervalMean: factorResults.walletClusterIntervalMean || null,
            walletClusterThreshold: factorResults.walletClusterThreshold || null
          }
        } : null
      };

      this.logger.info(this._experimentId, '_executeStrategy',
        `创建信号 | symbol=${token.symbol}, action=${signal.action}`);

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
            ...signal.cardConfig,
            price: signal.price,
            strategyId: signal.strategyId,
            strategyName: signal.strategyName,
            cards: signal.cards,
            ...signal.factors
          }
        });
        signalId = await tradeSignal.save();
        this.logger.info(this._experimentId, '_executeStrategy',
          `信号已保存 | symbol=${token.symbol}, signalId=${signalId}`);
      } catch (saveError) {
        this.logger.error(this._experimentId, '_executeStrategy',
          `保存信号失败 | symbol=${token.symbol}, error=${saveError.message}`);
        return false;
      }

      // ========== 然后进行预检查 ==========
      let preCheckPassed = true;
      let blockReason = null;

      // 1. 验证 creator_address
      if (!token.creator_address) {
        this.logger.warn(this._experimentId, '_executeStrategy',
          `代币 creator_address 为 null，重新获取并验证 | symbol=${token.symbol}, address=${token.token}`);

        try {
          const creatorInfo = await this._fourMemeApi.getCreatorAddress(token.token);
          if (creatorInfo.creator_address) {
            token.creator_address = creatorInfo.creator_address;
            await this.dataService.updateTokenCreatorAddress(this._experimentId, token.token, creatorInfo.creator_address);
            this.logger.info(this._experimentId, '_executeStrategy',
              `重新获取成功，继续 Dev 钱包检查 | symbol=${token.symbol}, creator=${creatorInfo.creator_address}`);
          }
        } catch (error) {
          this.logger.warn(this._experimentId, '_executeStrategy',
            `重新获取 creator_address 失败，跳过 Dev 钱包检查 | symbol=${token.symbol}, error=${error.message}`);
        }
      }

      // 2. Dev 钱包检查
      if (token.creator_address) {
        this.logger.info(this._experimentId, '_executeStrategy',
          `开始 Dev 钱包检查 | symbol=${token.symbol}, creator=${token.creator_address}`);
        const isNegativeDevWallet = await this.isNegativeDevWallet(token.creator_address);
        if (isNegativeDevWallet) {
          this.logger.error(this._experimentId, '_executeStrategy',
            `代币创建者为 Dev 钱包，拒绝购买 | symbol=${token.symbol}, creator=${token.creator_address}`);
          preCheckPassed = false;
          blockReason = 'negative_dev_wallet';
        } else {
          this.logger.info(this._experimentId, '_executeStrategy',
            `Dev 钱包检查通过 | symbol=${token.symbol}`);
        }
      }

      // 3. 综合购买前检查（使用 PreBuyCheckService）
      let preBuyCheckResult = null;
      if (preCheckPassed && this._preBuyCheckService) {
        try {
          this.logger.info(this._experimentId, '_executeStrategy',
            `开始购买前检查 | symbol=${token.symbol}, creator=${token.creator_address || 'none'}`);

          // 构建代币信息（用于早期参与者检查）
          const tokenInfo = this._buildTokenInfo(token);

          // 只使用策略级别的预检查条件，不再使用默认配置
          const preBuyCheckCondition = strategy.preBuyCheckCondition || null;

          preBuyCheckResult = await this._preBuyCheckService.performAllChecks(
            token.token,
            token.creator_address || null,
            this._experimentId,
            token.chain || 'bsc',
            tokenInfo,
            preBuyCheckCondition
          );

          if (!preBuyCheckResult.canBuy) {
            this.logger.warn(this._experimentId, '_executeStrategy',
              `购买前检查失败 | symbol=${token.symbol}, holderCanBuy=${preBuyCheckResult.holderCanBuy}, preTraderCanBuy=${preBuyCheckResult.preTraderCanBuy}, ` +
              `reason=${preBuyCheckResult.checkReason}, ` +
              `whitelist=${preBuyCheckResult.holderWhitelistCount}, blacklist=${preBuyCheckResult.holderBlacklistCount}, ` +
              `devHoldingRatio=${(isNaN(preBuyCheckResult.devHoldingRatio) ? 'N/A' : preBuyCheckResult.devHoldingRatio.toFixed(1))}%, maxHoldingRatio=${(isNaN(preBuyCheckResult.maxHoldingRatio) ? 'N/A' : preBuyCheckResult.maxHoldingRatio.toFixed(1))}%`);
            preCheckPassed = false;
            blockReason = preBuyCheckResult.checkReason || 'pre_buy_check_failed';
          } else {
            this.logger.info(this._experimentId, '_executeStrategy',
              `购买前检查通过 | symbol=${token.symbol}, holderCanBuy=${preBuyCheckResult.holderCanBuy}, preTraderCanBuy=${preBuyCheckResult.preTraderCanBuy}, ` +
              `reason=${preBuyCheckResult.checkReason}, ` +
              `whitelist=${preBuyCheckResult.holderWhitelistCount}, blacklist=${preBuyCheckResult.holderBlacklistCount}, ` +
              `devHoldingRatio=${(isNaN(preBuyCheckResult.devHoldingRatio) ? 'N/A' : preBuyCheckResult.devHoldingRatio.toFixed(1))}%, maxHoldingRatio=${(isNaN(preBuyCheckResult.maxHoldingRatio) ? 'N/A' : preBuyCheckResult.maxHoldingRatio.toFixed(1))}%`);
          }
        } catch (checkError) {
          const errorMsg = checkError?.message || String(checkError);
          this.logger.error(this._experimentId, '_executeStrategy',
            `购买前检查异常: ${token.symbol} - ${errorMsg}`);
          // 检测失败时拒绝购买，保守处理
          preCheckPassed = false;
          blockReason = `购买前检查异常: ${errorMsg}`;
        }
      }

      // 如果预检查失败，更新信号状态为 failed 并返回
      if (!preCheckPassed) {
        this.logger.warn(this._experimentId, '_executeStrategy',
          `预检查失败 | symbol=${token.symbol}, reason=${blockReason}`);

        // 即使预检查失败，也要保存购买前置检查结果到 metadata（用于分析）
        if (preBuyCheckResult && signalId) {
          // 构建常规因子快照（购买时点的代币状态）
          const regularFactors = buildFactorValuesForTimeSeries(factorResults);

          // 构建购买前置检查因子
          const preBuyCheckFactors = buildPreBuyCheckFactorValues(preBuyCheckResult);

          const failedCheckMetadata = {
            regularFactors: regularFactors,
            preBuyCheckFactors: preBuyCheckFactors,
            preBuyCheckResult: {
              canBuy: preBuyCheckResult.canBuy,
              reason: preBuyCheckResult.checkReason || 'pre_buy_check_failed'
            }
          };

          try {
            await this._updateSignalMetadata(signalId, failedCheckMetadata);
            this.logger.info(this._experimentId, '_executeStrategy',
              `预检查失败，但已保存购买前置检查数据 | symbol=${token.symbol}, signalId=${signalId}`);
          } catch (updateError) {
            this.logger.warn(this._experimentId, '_executeStrategy',
              `更新信号元数据失败 | symbol=${token.symbol}, error=${updateError.message}`);
          }
        }

        // 更新信号状态为 failed（预检查失败）
        if (signalId) {
          await this._updateSignalStatus(signalId, 'failed', {
            message: `预检查失败: ${blockReason}`,
            reason: blockReason
          });
        }

        // 记录到 RoundSummary
        if (this._roundSummary) {
          this._roundSummary.recordSignal(token.token, {
            direction: 'BUY',
            action: 'buy',
            confidence: 0,
            reason: `预检查失败: ${blockReason}`
          });
          this._roundSummary.recordSignalExecution(token.token, false, `预检查失败: ${blockReason}`);
        }

        return failResult(`预检查失败: ${blockReason}`);
      }

      // ========== 预检查通过，构建信号元数据并执行交易 ==========
      this.logger.info(this._experimentId, '_executeStrategy',
        `预检查通过，构建信号元数据 | symbol=${token.symbol}`);

      // 构建信号元数据（包含趋势因子和购买前检查因子）
      if (preBuyCheckResult && signalId) {
        // 构建趋势因子快照（购买时点的代币状态）
        const trendFactors = buildFactorValuesForTimeSeries(factorResults);

        // 构建购买前检查因子
        const preBuyCheckFactors = buildPreBuyCheckFactorValues(preBuyCheckResult);

        const signalMetadata = {
          trendFactors: trendFactors,
          preBuyCheckFactors: preBuyCheckFactors,
          preBuyCheckResult: {
            canBuy: preBuyCheckResult.canBuy,
            reason: preBuyCheckResult.checkReason || 'passed'
          }
        };

        try {
          await this._updateSignalMetadata(signalId, signalMetadata);
          this.logger.info(this._experimentId, '_executeStrategy',
            `信号元数据已更新 | symbol=${token.symbol}, signalId=${signalId}`);
        } catch (updateError) {
          this.logger.warn(this._experimentId, '_executeStrategy',
            `更新信号元数据失败 | symbol=${token.symbol}, error=${updateError.message}`);
        }
      }

      this.logger.info(this._experimentId, '_executeStrategy',
        `调用 processSignal | symbol=${token.symbol}`);

      const result = await this.processSignal(signal, signalId);

      this.logger.info(this._experimentId, '_executeStrategy',
        `processSignal 返回 | symbol=${token.symbol}, success=${result?.success}, reason=${result?.reason || result?.message || 'none'}`);

      if (result && result.success) {
        this._tokenPool.markAsBought(token.token, token.chain, {
          buyPrice: latestPrice,
          buyTime: Date.now()
        });

        this._tokenPool.recordStrategyExecution(token.token, token.chain, strategy.id);

        await this.dataService.updateTokenStatus(this._experimentId, token.token, 'bought');

        return successResult(true);
      }

      return failResult('交易执行失败: result.success 为 false');

    } else if (strategy.action === 'sell') {
      if (token.status !== 'bought') {
        return failResult(`代币状态不是 bought (当前: ${token.status})`);
      }

      const cardManager = this._tokenPool.getCardPositionManager(token.token, token.chain);

      if (!cardManager) {
        this.logger.warn(this._experimentId, '_executeStrategy',
          `代币 ${token.symbol} 没有卡牌管理器，跳过卖出`);
        return failResult('没有卡牌管理器');
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
          // 趋势/技术指标 factors
          trendFactors: {
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
            trendPriceUp: factorResults.trendPriceUp,
            trendMedianUp: factorResults.trendMedianUp,
            trendSlope: factorResults.trendSlope,
            trendStrengthScore: factorResults.trendStrengthScore,
            trendTotalReturn: factorResults.trendTotalReturn,
            trendRiseRatio: factorResults.trendRiseRatio,
            trendRecentDownCount: factorResults.trendRecentDownCount,
            trendRecentDownRatio: factorResults.trendRecentDownRatio,
            trendConsecutiveDowns: factorResults.trendConsecutiveDowns,
            trendPriceChangeFromDetect: factorResults.trendPriceChangeFromDetect,
            trendSinceBuyReturn: factorResults.trendSinceBuyReturn,
            trendSinceBuyDataPoints: factorResults.trendSinceBuyDataPoints
          }
        } : null
      };

      const result = await this.processSignal(signal);

      if (result && result.success) {
        this._tokenPool.recordStrategyExecution(token.token, token.chain, strategy.id);
        return successResult(true);
      }

      return failResult('卖出交易执行失败: result.success 为 false');
    }

    return failResult('未知策略类型');
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
   * 构建代币信息（用于早期参与者检查）
   * @private
   * @param {Object} token - 代币对象
   * @returns {Object} tokenInfo
   */
  _buildTokenInfo(token) {
    // 获取 launchAt（代币创建时间戳）
    let launchAt = null;

    // 尝试多个来源获取 launchAt
    // 1. 直接从 token.launchAt 获取
    if (token.launchAt) {
      launchAt = token.launchAt;
    }
    // 2. 从 token.raw_api_data.token.launch_at 获取
    else if (token.raw_api_data) {
      try {
        const rawApiData = typeof token.raw_api_data === 'string'
          ? JSON.parse(token.raw_api_data)
          : token.raw_api_data;

        // 尝试从不同的路径获取
        if (rawApiData.token?.launch_at) {
          launchAt = rawApiData.token.launch_at;
        } else if (rawApiData.launch_at) {
          launchAt = rawApiData.launch_at;
        }
      } catch (e) {
        // 忽略解析错误
      }
    }

    // 3. 如果还是没有，使用 createdAt 作为备选（ createdAt 和 launch_at 通常是接近的）
    if (!launchAt && token.createdAt) {
      launchAt = token.createdAt;
    }

    // 确定内盘交易对
    let innerPair = null;
    const platform = token.platform || 'fourmeme';

    // 优先使用已设置的 pairAddress（由 PlatformCollector 设置）
    if (token.pairAddress) {
      innerPair = token.pairAddress;
    } else if (platform === 'fourmeme') {
      innerPair = `${token.token}_fo`;
    } else if (platform === 'flap') {
      innerPair = `${token.token}_iportal`;
    } else if (token.main_pair) {
      innerPair = token.main_pair;
    } else if (token.pair) {
      innerPair = token.pair;
    } else {
      // 默认使用 fourmeme 格式
      innerPair = `${token.token}_fo`;
    }

    const result = {
      launchAt,
      innerPair
    };

    // 记录调试信息
    this.logger.info(this._experimentId, '_buildTokenInfo',
      `代币信息构建 | symbol=${token.symbol}, launchAt=${launchAt}, innerPair=${innerPair}`);

    return result;
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

    // 初始化钱包缓存（黑白名单）
    console.log(`🔄 正在加载钱包缓存...`);
    await this._preBuyCheckService.initialize();

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
