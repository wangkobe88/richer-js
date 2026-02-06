/**
 * 回测引擎 - 简化版
 * 用于 fourmeme 交易实验的历史数据回放
 */

const { ITradingEngine, TradingMode, EngineStatus } = require('../interfaces/ITradingEngine');
const { Experiment, Trade, TradeSignal, TradeStatus } = require('../entities');
const { ExperimentFactory } = require('../factories/ExperimentFactory');
const { ExperimentDataService } = require('../../web/services/ExperimentDataService');
const { ExperimentTimeSeriesService } = require('../../web/services/ExperimentTimeSeriesService');
const { dbManager } = require('../../services/dbManager');
const Logger = require('../../services/logger');

// 复用组件
const TokenPool = require('../../core/token-pool');
const { StrategyEngine } = require('../../strategies/StrategyEngine');
const { CardPositionManager } = require('../../portfolio/CardPositionManager');
const { PortfolioManager } = require('../../portfolio');
const { RoundSummary } = require('../utils/RoundSummary');

// 加载配置
const config = require('../../../config/default.json');

/**
 * 回测引擎
 * @class
 * @implements ITradingEngine
 */
class BacktestEngine {
  /**
   * 构造函数
   * @param {Object} options - 配置选项
   */
  constructor(options = {}) {
    this._id = `backtest_${Date.now()}`;
    this._name = 'Fourmeme Backtest Engine';
    this._mode = TradingMode.BACKTEST;
    this._status = EngineStatus.STOPPED;

    // 实验相关
    this._experiment = null;
    this._experimentId = null;

    // 回测相关
    this._sourceExperimentId = null;
    this._historicalData = [];
    this._currentDataIndex = 0;

    // 虚拟资金管理
    this.initialBalance = 100; // 默认100 BNB
    this.currentBalance = this.initialBalance;

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
    this.timeSeriesService = new ExperimentTimeSeriesService();
    this.logger = new Logger({ dir: './logs', experimentId: null });

    // 数据库客户端
    this.supabase = dbManager.getClient();

    // 核心组件
    this._tokenPool = null;
    this._strategyEngine = null;
    this._portfolioManager = null;
    this._portfolioId = null;
    this._roundSummary = null;
    this._positionManagement = null;

    // 代币追踪
    this._seenTokens = new Set();
    this._tokenStates = new Map(); // 记录每个代币的状态（模拟 TokenPool）

    console.log(`📊 回测引擎已创建: ${this.id}`);
  }

  // Getter 方法
  get id() { return this._id; }
  get name() { return this._name; }
  get mode() { return this._mode; }
  get status() { return this._status; }
  get experiment() { return this._experiment; }

  /**
   * 初始化引擎
   * @param {Experiment|string} experimentOrId - 实验实体或实验ID
   * @returns {Promise<void>}
   */
  async initialize(experimentOrId) {
    try {
      // 加载或创建实验
      if (typeof experimentOrId === 'string') {
        const factory = ExperimentFactory.getInstance();
        this._experiment = await factory.load(experimentOrId);
        if (!this._experiment) {
          throw new Error(`实验不存在: ${experimentOrId}`);
        }
      } else if (experimentOrId instanceof Experiment) {
        this._experiment = experimentOrId;
      } else {
        throw new Error('无效的实验参数');
      }

      this._experimentId = this._experiment.id;

      // 更新 logger 的 experimentId
      this.logger.experimentId = this._experimentId;

      // 从配置获取源实验ID
      this._sourceExperimentId = this._experiment.config?.backtest?.sourceExperimentId;
      if (!this._sourceExperimentId) {
        throw new Error('回测实验缺少源实验ID配置 (config.backtest.sourceExperimentId)');
      }

      // 从配置获取初始余额
      if (this._experiment.config?.backtest?.initialBalance) {
        this.initialBalance = this._experiment.config.backtest.initialBalance;
        this.currentBalance = this.initialBalance;
      }

      // 验证源实验存在
      const factory = ExperimentFactory.getInstance();
      const sourceExp = await factory.load(this._sourceExperimentId);
      if (!sourceExp) {
        throw new Error(`源实验不存在: ${this._sourceExperimentId}`);
      }

      console.log(`📊 回测配置: 源实验=${this._sourceExperimentId}, 初始余额=${this.initialBalance}`);

      // 初始化核心组件
      await this._initializeComponents();

      // 加载历史数据
      await this._loadHistoricalData();

      // 初始化投资组合管理器
      this._portfolioManager = new PortfolioManager({
        targetTokens: [],
        blockchain: 'bsc'
      });

      const initialCash = this.initialBalance;
      this._portfolioId = await this._portfolioManager.createPortfolio(
        initialCash,
        {
          blockchain: 'bsc',
          experimentId: this._experimentId,
          tradingMode: 'backtest'
        }
      );

      console.log(`✅ 回测引擎初始化完成，PortfolioID: ${this._portfolioId}`);
      console.log(`📊 加载了 ${this._historicalData.length} 条历史数据点`);

      this._status = EngineStatus.STOPPED;

    } catch (error) {
      console.error('❌ 回测引擎初始化失败:', error.message);
      this._status = EngineStatus.ERROR;
      throw error;
    }
  }

  /**
   * 初始化核心组件
   * @private
   * @returns {Promise<void>}
   */
  async _initializeComponents() {
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

    // 4. 初始化 RoundSummary
    const blockchain = this._experiment.blockchain || 'bsc';
    this._roundSummary = new RoundSummary(this._experimentId, this.logger, blockchain);
  }

  /**
   * 加载历史数据
   * @private
   * @returns {Promise<void>}
   */
  async _loadHistoricalData() {
    try {
      console.log(`📊 开始加载历史数据，源实验: ${this._sourceExperimentId}`);

      // 从时序数据表获取历史数据（不设置 limit 获取全部数据）
      let data;
      try {
        data = await this.timeSeriesService.getExperimentTimeSeries(
          this._sourceExperimentId,
          null,
          {} // 不设置 limit，获取全部数据
        );
      } catch (queryError) {
        // 如果查询超时或失败，尝试检查是否有任何数据
        console.warn(`⚠️  时序数据查询出现问题: ${queryError.message}`);
        console.warn(`⚠️  尝试使用简化查询...`);

        // 简化查询：只检查是否存在数据
        try {
          const { ExperimentFactory } = require('../factories/ExperimentFactory');
          const factory = ExperimentFactory.getInstance();
          const sourceExp = await factory.load(this._sourceExperimentId);

          if (!sourceExp) {
            throw new Error(`源实验不存在: ${this._sourceExperimentId}`);
          }

          // 检查源实验是否是虚拟交易模式
          if (sourceExp.tradingMode !== 'virtual') {
            throw new Error(`源实验必须是虚拟交易模式，当前模式: ${sourceExp.tradingMode}`);
          }

          throw new Error(`无法获取源实验的时序数据。请确保源实验已运行并收集了数据。`);
        } catch (sourceError) {
          throw new Error(`源实验验证失败: ${sourceError.message}`);
        }
      }

      if (!data || data.length === 0) {
        throw new Error(`源实验没有时序数据。请确保源实验已运行并收集了足够的时序数据。`);
      }

      // 按时间戳排序
      this._historicalData = data.sort((a, b) => {
        const timeA = new Date(a.timestamp).getTime();
        const timeB = new Date(b.timestamp).getTime();
        return timeA - timeB;
      });

      // 按 loop_count 分组（用于模拟轮次处理）
      this._groupDataByLoopCount();

      console.log(`✅ 历史数据加载完成: ${this._historicalData.length} 条数据点`);

    } catch (error) {
      console.error('❌ 加载历史数据失败:', error.message);
      throw error;
    }
  }

  /**
   * 按轮次分组数据
   * @private
   */
  _groupDataByLoopCount() {
    // 按loop_count分组，便于模拟轮次处理
    const grouped = new Map();
    for (const dataPoint of this._historicalData) {
      const loopCount = dataPoint.loop_count || 0;
      if (!grouped.has(loopCount)) {
        grouped.set(loopCount, []);
      }
      grouped.get(loopCount).push(dataPoint);
    }

    // 转换为数组格式
    this._groupedData = Array.from(grouped.entries())
      .map(([loopCount, dataPoints]) => ({ loopCount, dataPoints }))
      .sort((a, b) => a.loopCount - b.loopCount);

    console.log(`📊 数据分为 ${this._groupedData.length} 个轮次`);
  }

  /**
   * 启动引擎
   * @returns {Promise<void>}
   */
  async start() {
    if (this._status === EngineStatus.RUNNING) {
      console.warn('⚠️ 引擎已在运行');
      return;
    }

    this._status = EngineStatus.RUNNING;

    // 更新实验状态
    if (this._experiment) {
      this._experiment.start();
      const factory = ExperimentFactory.getInstance();
      await factory.updateStatus(this._experimentId, 'running');
    }

    console.log(`🚀 回测引擎已启动: 实验 ${this._experimentId}`);

    // 开始回测循环
    await this._runBacktest();
  }

  /**
   * 运行回测主循环
   * @private
   * @returns {Promise<void>}
   */
  async _runBacktest() {
    const startTime = Date.now();
    console.log(`📊 开始回测，共 ${this._groupedData.length} 个轮次`);

    // 遍历每个轮次
    for (const roundData of this._groupedData) {
      const { loopCount, dataPoints } = roundData;

      // 更新当前轮次
      this._currentLoopCount = loopCount;

      this.logger.info(this._experimentId, 'BacktestEngine',
        `开始处理第 ${loopCount} 轮，数据点数: ${dataPoints.length}`);

      // 开始新轮次记录
      if (this._roundSummary) {
        this._roundSummary.startRound(loopCount);
      }

      // 处理该轮次的每个数据点（每个代币）
      for (const dataPoint of dataPoints) {
        await this._processTimePoint(dataPoint);
      }

      // 创建投资组合快照
      await this._createPortfolioSnapshot();

      // 输出轮次摘要
      if (this._roundSummary) {
        this._roundSummary.printToConsole();
        this._roundSummary.writeToLog();
      }

      this.metrics.processedDataPoints += dataPoints.length;
    }

    const duration = Date.now() - startTime;
    console.log(`✅ 回测完成，耗时: ${duration}ms`);
    console.log(`📊 处理了 ${this.metrics.processedDataPoints} 个数据点`);

    // 标记实验完成
    const factory = ExperimentFactory.getInstance();
    await factory.updateStatus(this._experimentId, 'completed');
    this._status = EngineStatus.STOPPED;
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

      // 获取或创建代币状态
      const tokenState = this._getOrCreateTokenState(tokenAddress, tokenSymbol, dataPoint);

      // 更新价格（使用历史价格）
      const priceUsd = parseFloat(dataPoint.price_usd) || 0;
      tokenState.currentPrice = priceUsd;

      // 更新代币池中的价格
      this._tokenPool.updatePrice(tokenAddress, 'bsc', priceUsd, timestamp.getTime(), {
        txVolumeU24h: dataPoint.factor_values?.txVolumeU24h || 0,
        holders: dataPoint.factor_values?.holders || 0,
        tvl: dataPoint.factor_values?.tvl || 0,
        fdv: dataPoint.factor_values?.fdv || 0,
        marketCap: dataPoint.factor_values?.marketCap || 0
      });

      // 构建因子结果（从历史数据）
      const factorResults = this._buildFactorsFromData(tokenState, dataPoint);

      // 记录代币指标
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

      // 策略分析
      const strategy = this._strategyEngine.evaluate(
        factorResults,
        tokenAddress,
        timestamp.getTime(),
        { strategyExecutions: tokenState.strategyExecutions }
      );

      // 验证策略是否适用于当前代币状态
      if (strategy) {
        if (strategy.action === 'buy' && tokenState.status !== 'monitoring') {
          return; // 买入策略只对监控中代币有效
        }
        if (strategy.action === 'sell' && tokenState.status !== 'bought') {
          return; // 卖出策略只对已买入代币有效
        }

        this.logger.info(this._experimentId, 'BacktestEngine',
          `${tokenSymbol} 触发策略: ${strategy.name} (${strategy.action})`);

        // 记录信号
        if (this._roundSummary) {
          this._roundSummary.recordSignal(tokenAddress, {
            direction: strategy.action.toUpperCase(),
            action: strategy.action,
            confidence: 80,
            reason: strategy.name
          });
        }

        // 执行策略（传递历史时间戳）
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
      // 初始化代币状态
      const factorValues = dataPoint.factor_values || {};

      this._tokenStates.set(tokenAddress, {
        token: tokenAddress,
        symbol: tokenSymbol,
        chain: 'bsc',
        status: 'monitoring', // 初始状态为监控中
        currentPrice: parseFloat(dataPoint.price_usd) || 0,
        collectionPrice: factorValues.collectionPrice || parseFloat(dataPoint.price_usd) || 0,
        collectionTime: new Date(dataPoint.timestamp).getTime(),
        buyPrice: 0,
        buyTime: null,
        highestPrice: factorValues.highestPrice || parseFloat(dataPoint.price_usd) || 0,
        highestPriceTimestamp: factorValues.highestPriceTimestamp || new Date(dataPoint.timestamp).getTime(),
        strategyExecutions: {} // 策略执行次数追踪
      });

      // 🔥 将代币注册到 TokenPool，以便 setCardPositionManager/getCardPositionManager 可以工作
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

    // 计算年龄（分钟）
    const collectionTime = tokenState.collectionTime || now;
    const age = (now - collectionTime) / 1000 / 60;

    // 计算持仓时长（秒）
    const holdDuration = tokenState.buyTime ? (now - tokenState.buyTime) / 1000 : 0;

    // 计算盈利百分比
    let profitPercent = 0;
    if (tokenState.buyPrice && tokenState.buyPrice > 0 && priceUsd > 0) {
      profitPercent = ((priceUsd - tokenState.buyPrice) / tokenState.buyPrice) * 100;
    }

    // 计算距离最高价跌幅
    const highestPrice = tokenState.highestPrice || priceUsd;
    let drawdownFromHighest = 0;
    if (highestPrice > 0 && priceUsd > 0) {
      drawdownFromHighest = ((priceUsd - highestPrice) / highestPrice) * 100;
    }

    // 更新历史最高价
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
    const price = tokenState.currentPrice || 0;

    if (strategy.action === 'buy') {
      // 初始化策略执行追踪
      if (!tokenState.strategyExecutions[strategy.id]) {
        tokenState.strategyExecutions[strategy.id] = { count: 0, lastExecution: 0 };
      }

      // 检查执行次数限制
      if (strategy.maxExecutions &&
          tokenState.strategyExecutions[strategy.id].count >= strategy.maxExecutions) {
        return false;
      }

      // 创建卡牌管理器（如果启用）
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
        timestamp: timestamp // 🔥 使用历史时间戳
      };

      const result = await this.processSignal(signal);

      if (result && result.success) {
        // 更新代币状态（使用历史时间）
        tokenState.status = 'bought';
        tokenState.buyPrice = price;
        tokenState.buyTime = timestamp.getTime(); // 🔥 使用历史时间

        // 记录策略执行
        tokenState.strategyExecutions[strategy.id].count++;
        tokenState.strategyExecutions[strategy.id].lastExecution = timestamp.getTime();

        // 记录执行状态
        if (this._roundSummary) {
          this._roundSummary.recordSignalExecution(tokenState.token, true, null);
        }

        return true;
      }

      return false;

    } else if (strategy.action === 'sell') {
      // 获取卡牌管理器
      const cardManager = this._tokenPool.getCardPositionManager(tokenState.token, tokenState.chain);
      if (!cardManager) {
        this.logger.warn(this._experimentId, '_executeStrategy',
          `代币 ${tokenState.symbol} 没有卡牌管理器，跳过卖出`);
        return false;
      }

      // 获取持仓
      const holding = this._getHolding(tokenState.token);
      if (!holding || holding.amount <= 0) {
        return false;
      }

      // 初始化策略执行追踪
      if (!tokenState.strategyExecutions[strategy.id]) {
        tokenState.strategyExecutions[strategy.id] = { count: 0, lastExecution: 0 };
      }

      // 检查执行次数限制
      if (strategy.maxExecutions &&
          tokenState.strategyExecutions[strategy.id].count >= strategy.maxExecutions) {
        return false;
      }

      const cards = strategy.cards || 'all';
      const sellAll = (cards === 'all');

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
        holdDuration: tokenState.buyTime ? ((timestamp.getTime() - tokenState.buyTime) / 1000) : null, // 🔥 使用历史时间
        factors: factorResults,
        timestamp: timestamp // 🔥 使用历史时间戳
      };

      const result = await this.processSignal(signal);

      if (result && result.success) {
        // 记录策略执行（使用历史时间）
        tokenState.strategyExecutions[strategy.id].count++;
        tokenState.strategyExecutions[strategy.id].lastExecution = timestamp.getTime();

        // 记录执行状态
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
   * 构建策略配置
   * @private
   * @returns {Array} 策略配置数组
   */
  _buildStrategyConfig() {
    const experimentConfig = this._experiment?.config || {};

    // 优先使用前端配置的卡牌策略系统
    if (experimentConfig.strategiesConfig) {
      return this._buildStrategiesFromConfig(experimentConfig.strategiesConfig);
    }

    // 兼容旧格式：使用硬编码的默认策略
    return this._buildDefaultStrategies();
  }

  /**
   * 从前端配置构建策略
   * @private
   * @param {Object} strategiesConfig - 策略配置
   * @returns {Array} 策略配置数组
   */
  _buildStrategiesFromConfig(strategiesConfig) {
    const strategies = [];
    let buyIndex = 0;
    let sellIndex = 0;

    if (strategiesConfig.buyStrategies && Array.isArray(strategiesConfig.buyStrategies)) {
      for (const buyStrategy of strategiesConfig.buyStrategies) {
        buyIndex++;
        strategies.push({
          id: `custom_buy_${buyIndex}`,
          name: buyStrategy.description || `买入策略 #${buyIndex}`,
          action: 'buy',
          priority: buyStrategy.priority !== undefined ? buyStrategy.priority : 10,
          cooldown: buyStrategy.cooldown !== undefined ? buyStrategy.cooldown : 60,
          enabled: true,
          cards: buyStrategy.cards !== undefined ? buyStrategy.cards : 1,
          condition: buyStrategy.condition || 'true',
          maxExecutions: buyStrategy.maxExecutions
        });
      }
    }

    if (strategiesConfig.sellStrategies && Array.isArray(strategiesConfig.sellStrategies)) {
      for (const sellStrategy of strategiesConfig.sellStrategies) {
        sellIndex++;
        const cards = sellStrategy.cards !== undefined ? sellStrategy.cards : 'all';
        strategies.push({
          id: `custom_sell_${sellIndex}`,
          name: sellStrategy.description || `卖出策略 #${sellIndex}`,
          action: 'sell',
          priority: sellStrategy.priority !== undefined ? sellStrategy.priority : 10,
          cooldown: sellStrategy.cooldown !== undefined ? sellStrategy.cooldown : 30,
          enabled: true,
          cards: cards,
          condition: sellStrategy.condition || 'true',
          maxExecutions: sellStrategy.maxExecutions
        });
      }
    }

    return strategies;
  }

  /**
   * 构建默认策略
   * @private
   * @returns {Array} 策略配置数组
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

    return [
      {
        id: 'early_return_buy',
        name: `早止买入 (${earlyReturnMin}-${earlyReturnMax}%收益率)`,
        action: 'buy',
        priority: 1,
        cooldown: 60,
        enabled: true,
        cards: 1,
        condition: `age < ${buyTimeMinutes} AND earlyReturn >= ${earlyReturnMin} AND earlyReturn < ${earlyReturnMax} AND currentPrice > 0`
      },
      {
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
      {
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
      {
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
    ];
  }

  /**
   * 获取持仓
   * @param {string} tokenAddress - 代币地址
   * @returns {Object|null} 持仓对象
   * @private
   */
  _getHolding(tokenAddress) {
    if (!this._portfolioManager || !this._portfolioId) {
      return null;
    }
    const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);
    if (!portfolio) {
      return null;
    }

    const normalizedAddress = this._portfolioManager._normalizeAddress(tokenAddress);
    const position = portfolio.positions.get(normalizedAddress);
    if (!position) {
      return null;
    }
    return {
      amount: position.amount.toNumber(),
      avgBuyPrice: position.averagePrice.toNumber()
    };
  }

  /**
   * 处理策略信号
   * @param {Object} signal - 策略信号
   * @returns {Promise<Object>} 处理结果
   */
  async processSignal(signal) {
    if (this._status !== EngineStatus.RUNNING) {
      return { executed: false, reason: '引擎未运行' };
    }

    this.metrics.totalSignals++;

    // 记录信号到数据库
    const tradeSignal = TradeSignal.fromStrategySignal(signal, this._experimentId);
    await this.dataService.saveSignal(tradeSignal);

    let tradeResult = null;
    if (signal.action === 'buy') {
      tradeResult = await this._executeBuy(signal, tradeSignal.id, signal.metadata, signal.timestamp);
    } else if (signal.action === 'sell') {
      tradeResult = await this._executeSell(signal, tradeSignal.id, signal.metadata, signal.timestamp);
    } else {
      return { executed: false, reason: 'hold信号' };
    }

    // 如果交易成功，更新信号状态
    if (tradeResult && tradeResult.success) {
      this.metrics.executedSignals++;
      tradeSignal.markAsExecuted(tradeResult);
      await this.dataService.updateSignal(tradeSignal);
    }

    return tradeResult;
  }

  /**
   * 执行买入交易
   * @param {Object} signal - 买入信号
   * @param {string} signalId - 信号ID
   * @param {Object} metadata - 元数据
   * @param {Date} timestamp - 历史时间戳
   * @returns {Promise<Object>} 交易结果
   * @private
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
        timestamp: timestamp, // 🔥 传递历史时间戳
        metadata: {
          ...metadata,
          cards: signal.cards,
          cardPositionChange: {
            before: { ...beforeCardState }
          }
        }
      };

      const result = await this.executeTrade(tradeRequest);

      if (result && result.success) {
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
      }

      return result;

    } catch (error) {
      return { success: false, reason: error.message };
    }
  }

  /**
   * 执行卖出交易
   * @param {Object} signal - 卖出信号
   * @param {string} signalId - 信号ID
   * @param {Object} metadata - 元数据
   * @param {Date} timestamp - 历史时间戳
   * @returns {Promise<Object>} 交易结果
   * @private
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
        timestamp: timestamp, // 🔥 传递历史时间戳
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

      if (result && result.success) {
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
      }

      return result;

    } catch (error) {
      return { success: false, reason: error.message };
    }
  }

  /**
   * 计算买入金额
   * @param {Object} signal - 信号
   * @returns {number} BNB金额
   * @private
   */
  _calculateBuyAmount(signal) {
    const cardManager = this._tokenPool.getCardPositionManager(signal.tokenAddress, signal.chain);
    if (cardManager) {
      const cards = signal.cards || 1;
      const amount = cardManager.calculateBuyAmount(cards);
      if (amount <= 0) {
        return 0;
      }
      if (this.currentBalance < amount) {
        return 0;
      }
      return amount;
    }

    const tradeAmount = this._experiment.config?.backtest?.tradeAmount || 0.1;
    if (this.currentBalance < tradeAmount) {
      return 0;
    }
    return tradeAmount;
  }

  /**
   * 获取主币符号
   * @returns {string} 主币符号
   * @private
   */
  _getNativeCurrency() {
    const blockchain = this._experiment.blockchain || 'bsc';
    const nativeCurrencyMap = {
      'bsc': 'BNB',
      'bnb': 'BNB',
      'ethereum': 'ETH',
      'eth': 'ETH',
      'solana': 'SOL',
      'sol': 'SOL',
      'base': 'ETH',
      'polygon': 'MATIC',
      'matic': 'MATIC'
    };
    return nativeCurrencyMap[blockchain.toLowerCase()] || 'BNB';
  }

  /**
   * 执行交易
   * @param {Object} tradeRequest - 交易请求
   * @returns {Promise<Object>} 交易结果
   */
  async executeTrade(tradeRequest) {
    this.metrics.totalTrades++;

    const nativeCurrency = this._getNativeCurrency();

    const trade = Trade.fromVirtualTrade({
      tokenAddress: tradeRequest.tokenAddress,
      symbol: tradeRequest.symbol,
      chain: this._experiment.blockchain || 'bsc',
      direction: tradeRequest.direction,
      amount: tradeRequest.amount,
      price: tradeRequest.price,
      success: false,
      error: null,
      metadata: tradeRequest.metadata || {},
      timestamp: tradeRequest.timestamp || new Date() // 🔥 使用请求中的时间戳，如果没有则使用当前时间
    }, this._experimentId, tradeRequest.signalId, nativeCurrency);

    try {
      const Decimal = require('decimal.js');
      const result = await this._portfolioManager.executeTrade(
        this._portfolioId,
        tradeRequest.tokenAddress,
        tradeRequest.direction,
        new Decimal(tradeRequest.amount),
        new Decimal(tradeRequest.price),
        0.001
      );

      if (result.success) {
        trade.markAsSuccess();
        this.metrics.successfulTrades++;

        await this.dataService.saveTrade(trade);

        return {
          success: true,
          trade: trade.toJSON(),
          portfolio: result.portfolio
        };
      } else {
        throw new Error(result.error || '交易执行失败');
      }

    } catch (error) {
      trade.markAsFailed(error.message);
      this.metrics.failedTrades++;

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 停止引擎
   * @returns {Promise<void>}
   */
  async stop() {
    if (this._status === EngineStatus.STOPPED) {
      return;
    }

    this._status = EngineStatus.STOPPED;

    if (this._experiment) {
      this._experiment.stop('stopped');
      const factory = ExperimentFactory.getInstance();
      await factory.updateStatus(this._experimentId, 'stopped');
    }

    console.log(`🛑 回测引擎已停止: 实验 ${this._experimentId}`);
  }

  /**
   * 创建投资组合快照
   * @private
   * @returns {Promise<void>}
   */
  async _createPortfolioSnapshot() {
    if (!this._portfolioManager || !this._portfolioId) {
      return;
    }

    try {
      const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);
      if (!portfolio) {
        return;
      }

      const snapshot = await this._portfolioManager.tracker.createSnapshot(
        this._portfolioId,
        portfolio.positions,
        portfolio.cashBalance,
        {
          walletAddress: this._experimentId,
          blockchain: 'bsc',
          tradingMode: 'backtest',
          strategy: 'fourmeme',
          experimentId: this._experimentId,
          version: '1.0.0',
          loopCount: this._currentLoopCount
        }
      );

      if (snapshot && this.dataService) {
        await this.dataService.savePortfolioSnapshot(this._experimentId, snapshot);
      }

    } catch (error) {
      this.logger.error(this._experimentId, 'BacktestEngine',
        `创建快照失败: ${error.message}`);
    }
  }

  /**
   * 获取状态
   * @returns {string}
   */
  getStatus() {
    return this._status;
  }

  /**
   * 获取指标
   * @returns {Object}
   */
  getMetrics() {
    const portfolio = this._portfolioManager
      ? this._portfolioManager.getPortfolio(this._portfolioId)
      : null;

    if (portfolio) {
      const Decimal = require('decimal.js');
      const initialBalance = portfolio.metadata.initialBalance
        ? portfolio.metadata.initialBalance.toNumber()
        : this.initialBalance;
      const currentBalance = portfolio.cashBalance.toNumber();
      const totalValue = portfolio.totalValue.toNumber();
      const profit = totalValue - initialBalance;
      const profitRate = (profit / initialBalance) * 100;

      return {
        ...this.metrics,
        initialBalance: initialBalance,
        currentBalance: currentBalance,
        totalValue: totalValue,
        profit: profit,
        profitRate: profitRate,
        holdingsCount: portfolio.positions.size,
        holdings: Array.from(portfolio.positions.values()).map(p => ({
          tokenAddress: p.tokenAddress,
          symbol: p.tokenSymbol,
          amount: p.amount.toNumber(),
          avgBuyPrice: p.averagePrice.toNumber(),
          currentPrice: p.currentPrice.toNumber(),
          value: p.value.toNumber()
        }))
      };
    }

    const profit = this.currentBalance - this.initialBalance;
    const profitRate = (profit / this.initialBalance) * 100;

    return {
      ...this.metrics,
      initialBalance: this.initialBalance,
      currentBalance: this.currentBalance,
      totalValue: this.currentBalance,
      profit: profit,
      profitRate: profitRate,
      holdingsCount: 0,
      holdings: []
    };
  }
}

module.exports = { BacktestEngine };
