/**
 * 虚拟交易引擎 - 简化版
 * 用于 fourmeme 交易实验的虚拟交易模拟
 */

const { ITradingEngine, TradingMode, EngineStatus } = require('../interfaces/ITradingEngine');
const { Experiment, Trade, TradeSignal, TradeStatus } = require('../entities');
const { ExperimentFactory } = require('../factories/ExperimentFactory');
const { ExperimentDataService } = require('../../web/services/ExperimentDataService');
const { ExperimentTimeSeriesService } = require('../../web/services/ExperimentTimeSeriesService');
const { dbManager } = require('../../services/dbManager');
const Logger = require('../../services/logger');

// 新增导入
const TokenPool = require('../../core/token-pool');
const FourmemeCollector = require('../../collectors/fourmeme-collector');
const { StrategyEngine } = require('../../strategies/StrategyEngine');
const { AveKlineAPI, AveTokenAPI } = require('../../core/ave-api');
const { RSIIndicator } = require('../../indicators/RSIIndicator');
const { RoundSummary } = require('../utils/RoundSummary');
const { PortfolioManager } = require('../../portfolio');
const { BlockchainConfig } = require('../../utils/BlockchainConfig');
const { CardPositionManager } = require('../../portfolio/CardPositionManager');

// 加载配置
const config = require('../../../config/default.json');

/**
 * 虚拟交易引擎
 * @class
 * @implements ITradingEngine
 */
class VirtualTradingEngine {
  /**
   * 构造函数
   * @param {Object} config - 配置对象
   * @param {number} config.initialBalance - 初始余额 (默认 100 BNB)
   */
  constructor(config = {}) {
    this._id = `virtual_${Date.now()}`;
    this._name = 'Fourmeme Virtual Trading Engine';
    this._mode = TradingMode.VIRTUAL;
    this._status = EngineStatus.STOPPED;

    // 实验相关
    this._experiment = null;
    this._experimentId = null;

    // 虚拟资金管理 (使用区块链主币，BSC为BNB)
    this.initialBalance = config.initialBalance || 100; // BNB
    this.currentBalance = this.initialBalance;
    this.holdings = new Map(); // tokenAddress -> { amount, avgBuyPrice }

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
    this.timeSeriesService = new ExperimentTimeSeriesService();
    this.logger = new Logger({ dir: './logs', experimentId: null }); // 初始无 experimentId，将在 initialize 中设置

    // 数据库客户端
    this.supabase = dbManager.getClient();

    // 新增：监控循环相关
    this._tokenPool = null;
    this._fourmemeCollector = null;
    this._strategyEngine = null;
    this._aveApi = null;
    this._rsiIndicator = null;
    this._monitoringTimer = null;
    this._loopCount = 0;
    this._roundSummary = null;
    this._portfolioManager = null;
    this._portfolioId = null;

    // 代币追踪：记录已处理过的代币（用于数据库记录）
    this._seenTokens = new Set();

    console.log(`🎮 虚拟交易引擎已创建: ${this.id}, 初始余额: ${this.initialBalance}`);
  }

  // Getter 方法 - 返回私有属性
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
        // 加载现有实验
        const factory = ExperimentFactory.getInstance();
        this._experiment = await factory.load(experimentOrId);
        if (!this._experiment) {
          throw new Error(`实验不存在: ${experimentOrId}`);
        }
      } else if (experimentOrId instanceof Experiment) {
        // 使用提供的实验
        this._experiment = experimentOrId;
      } else {
        throw new Error('无效的实验参数');
      }

      this._experimentId = this._experiment.id;

      // 更新 logger 的 experimentId
      this.logger.experimentId = this._experimentId;

      // 初始化 RoundSummary (传递区块链信息)
      const blockchain = this._experiment.blockchain || 'bsc';
      this._roundSummary = new RoundSummary(this._experimentId, this.logger, blockchain);

      // 从实验配置中获取初始余额
      if (this._experiment.config?.virtual?.initialBalance) {
        this.initialBalance = this._experiment.config.virtual.initialBalance;
        this.currentBalance = this.initialBalance;
      }

      // 加载持仓数据
      await this._loadHoldings();

      // 新增：初始化监控模块
      await this._initializeMonitoring();

      this._status = EngineStatus.STOPPED;

      console.log(`✅ 虚拟交易引擎初始化完成: 实验 ${this._experimentId}`);
      this.logger.info(this._experimentId, 'VirtualTradingEngine', '引擎初始化完成', {
        initialBalance: this.initialBalance,
        currentBalance: this.currentBalance,
        holdingsCount: this.holdings.size
      });

    } catch (error) {
      console.error('❌ 虚拟交易引擎初始化失败:', error.message);
      this._status = EngineStatus.ERROR;
      throw error;
    }
  }

  /**
   * 初始化监控模块
   * @private
   * @returns {Promise<void>}
   */
  async _initializeMonitoring() {
    // 1. 初始化代币池
    this._tokenPool = new TokenPool(this.logger);
    console.log(`✅ 代币池初始化完成`);

    // 2. 初始化AVE API
    const apiKey = process.env.AVE_API_KEY;
    this._aveApi = new AveKlineAPI(
      config.ave.apiUrl,
      config.ave.timeout,
      apiKey
    );
    this._aveTokenApi = new AveTokenAPI(
      config.ave.apiUrl,
      config.ave.timeout,
      apiKey
    );
    console.log(`✅ AVE API初始化完成`);

    // 3. 初始化收集器
    this._fourmemeCollector = new FourmemeCollector(
      config,
      this.logger,
      this._tokenPool
    );
    console.log(`✅ Fourmeme收集器初始化完成`);

    // 4. 初始化RSI指标
    this._rsiIndicator = new RSIIndicator({
      period: 14,
      smoothingPeriod: 9,
      smoothingType: 'EMA'
    });
    console.log(`✅ RSI指标初始化完成`);

    // 5. 初始化策略引擎
    const strategies = this._buildStrategyConfig();
    this._strategyEngine = new StrategyEngine({ strategies });

    // 构建可用因子集合
    const availableFactorIds = new Set([
      'age', 'currentPrice', 'collectionPrice', 'earlyReturn', 'buyPrice', 'holdDuration', 'profitPercent'
    ]);

    // 加载策略（带验证）
    this._strategyEngine.loadStrategies(strategies, availableFactorIds);
    console.log(`✅ 策略引擎初始化完成，加载了 ${this._strategyEngine.getStrategyCount()} 个策略`);

    // 6. 初始化卡牌仓位管理配置
    const experimentConfig = this._experiment?.config || {};
    const defaultStrategyConfig = config.strategy || {};
    const strategyConfig = experimentConfig.strategy || defaultStrategyConfig;
    this._positionManagement = strategyConfig.positionManagement || null;
    if (this._positionManagement && this._positionManagement.enabled) {
      console.log(`✅ 卡牌仓位管理已启用: 总卡牌数=${this._positionManagement.totalCards || 4}, 单卡BNB=${this._positionManagement.perCardMaxBNB || 0.025}`);
    }

    // 7. 初始化投资组合管理器
    this._portfolioManager = new PortfolioManager({
      targetTokens: [],  // fourmeme 代币是动态的，不需要预设
      blockchain: 'bsc'
    });

    // 创建投资组合
    const initialCash = this.initialBalance;  // 使用 USD 计价
    this._portfolioId = await this._portfolioManager.createPortfolio(
      initialCash,
      {
        blockchain: 'bsc',
        experimentId: this._experimentId,
        tradingMode: 'virtual'
      }
    );
    console.log(`✅ 投资组合管理器初始化完成，PortfolioID: ${this._portfolioId}`);
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

    // 新增：启动收集器（后台每10秒收集新代币）
    this._fourmemeCollector.start();
    console.log(`🔄 Fourmeme收集器已启动 (${config.collector.interval}ms间隔)`);
    this.logger.info(this._experimentId, 'VirtualTradingEngine', 'Fourmeme收集器已启动');

    // 新增：启动监控循环
    this._startMonitoringLoop();

    console.log(`🚀 虚拟交易引擎已启动: 实验 ${this._experimentId}`);
    this.logger.info(this._experimentId, 'VirtualTradingEngine', '引擎已启动');
  }

  /**
   * 停止引擎
   * @returns {Promise<void>}
   */
  async stop() {
    if (this._status === EngineStatus.STOPPED) {
      console.warn('⚠️ 引擎已停止');
      return;
    }

    this._status = EngineStatus.STOPPED;

    // 新增：停止收集器
    if (this._fourmemeCollector) {
      this._fourmemeCollector.stop();
      console.log(`⏹️ Fourmeme收集器已停止`);
    }

    // 新增：停止监控循环
    if (this._monitoringTimer) {
      clearInterval(this._monitoringTimer);
      this._monitoringTimer = null;
      console.log(`⏹️ 监控循环已停止`);
    }

    // 更新实验状态
    if (this._experiment) {
      this._experiment.stop('stopped');
      const factory = ExperimentFactory.getInstance();
      await factory.updateStatus(this._experimentId, 'stopped');
    }

    console.log(`🛑 虚拟交易引擎已停止: 实验 ${this._experimentId}`);
    this.logger.info(this._experimentId, 'VirtualTradingEngine', '引擎已停止', {
      metrics: this.metrics,
      loopCount: this._loopCount
    });
  }

  /**
   * 启动监控循环
   * @private
   */
  _startMonitoringLoop() {
    const interval = config.monitor.interval || 10000; // 默认10秒

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

    // 开始新轮次记录
    if (this._roundSummary) {
      this._roundSummary.startRound(this._loopCount);
    }

    this.logger.info(this._experimentId, 'MonitoringCycle',
      `开始第 ${this._loopCount} 轮监控`);

    try {
      // 记录收集器统计
      if (this._roundSummary) {
        const collectorStats = this._fourmemeCollector.getStats();
        this._roundSummary.recordCollectorStats({
          lastFetched: collectorStats.totalCollected - (collectorStats.lastCollectionTime ? 0 : collectorStats.totalCollected),
          lastAdded: 0, // 将在处理时更新
          lastSkipped: collectorStats.totalSkipped,
          poolSize: collectorStats.poolSize,
          monitoringCount: collectorStats.monitoringCount,
          boughtCount: collectorStats.boughtCount
        });
      }

      // 1. 获取池中需要监控的代币
      const tokens = this._tokenPool.getMonitoringTokens();
      this.logger.debug(this._experimentId, 'MonitoringCycle',
        `池中监控代币数: ${tokens.length} (monitoring+bought)`);

      if (tokens.length === 0) {
        this.logger.debug(this._experimentId, 'MonitoringCycle',
          `第 ${this._loopCount} 轮监控: 无代币需要处理`);
        // 即使没有代币，也输出摘要（显示收集器统计）
        if (this._roundSummary) {
          this._roundSummary.printToConsole();
          this._roundSummary.writeToLog();
        }
        return;
      }

      // 2. 批量获取所有监控代币的实时价格（替代K线数据）
      await this._fetchBatchPrices(tokens);

      // 3. 处理每个代币
      for (const token of tokens) {
        await this._processToken(token);
      }

      // 3. 清理过期代币
      const removed = this._tokenPool.cleanup();
      if (removed.length > 0) {
        this.logger.info(this._experimentId, 'MonitoringCycle',
          `清理过期代币: ${removed.length} 个`);
      }

      // 4. 记录投资组合总览
      if (this._roundSummary) {
        const portfolio = this._buildPortfolioSummary();
        this._roundSummary.recordPortfolio(portfolio);
      }

      // 5. 创建并保存投资组合快照
      await this._createPortfolioSnapshot();

      // 6. 输出轮次摘要
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
      // 0. 记录代币到数据库（首次发现时）
      const tokenKey = `${token.token}-${token.chain}`;
      if (!this._seenTokens.has(tokenKey)) {
        await this.dataService.saveToken(this._experimentId, {
          token: token.token,
          symbol: token.symbol,
          chain: token.chain,
          created_at: token.createdAt,
          raw_api_data: token.rawApiData || null
        });
        this._seenTokens.add(tokenKey);
      }

      // 1. 检查是否有有效价格（价格已在 _monitoringCycle 中通过 _fetchBatchPrices 批量更新）
      const currentPrice = token.currentPrice || 0;
      if (currentPrice === 0) {
        // 记录到 Summary：无法获取有效价格
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
              collectionPrice: token.collectionPrice
            }
          );
        }
        return;
      }

      // 2. 构建因子结果（不再依赖K线数据）
      const factorResults = this._buildFactors(token);

      // 保存时序数据到数据库
      await this.timeSeriesService.recordRoundData({
        experimentId: this._experimentId,
        tokenAddress: token.token,
        tokenSymbol: token.symbol,
        timestamp: new Date(),
        loopCount: this._loopCount,
        priceUsd: factorResults.currentPrice,
        priceNative: null,
        factorValues: {
          age: factorResults.age,
          currentPrice: factorResults.currentPrice,
          collectionPrice: factorResults.collectionPrice,
          earlyReturn: factorResults.earlyReturn,
          buyPrice: factorResults.buyPrice,
          holdDuration: factorResults.holdDuration,
          profitPercent: factorResults.profitPercent
        },
        blockchain: this._experiment.blockchain || 'bsc'
      });

      // 记录代币指标到 RoundSummary
      if (this._roundSummary) {
        this._roundSummary.recordTokenIndicators(
          token.token,
          token.symbol,
          {
            type: 'factor-based',
            factorCount: Object.keys(factorResults).length,
            strategyCount: this._strategyEngine.getStrategyCount(),
            factorValues: factorResults,
            triggeredStrategy: null // 将在策略触发时更新
          },
          factorResults.currentPrice,
          {
            createdAt: token.createdAt,
            addedAt: token.addedAt,
            status: token.status,
            collectionPrice: token.collectionPrice
          }
        );
      }

      // 3. 策略分析 - 根据代币状态过滤策略
      const strategy = this._strategyEngine.evaluate(
        factorResults,
        token.token,
        Date.now(),
        token  // 传递 token 数据用于检查执行次数
      );

      // 验证策略是否适用于当前代币状态
      if (strategy) {
        // 买入策略只对监控中代币有效
        if (strategy.action === 'buy' && token.status !== 'monitoring') {
          this.logger.debug(this._experimentId, 'ProcessToken',
            `${token.symbol} 买入策略跳过 (状态: ${token.status})`);
          return; // 不再处理此代币
        }
        // 卖出策略只对已买入代币有效
        if (strategy.action === 'sell' && token.status !== 'bought') {
          this.logger.debug(this._experimentId, 'ProcessToken',
            `${token.symbol} 卖出策略跳过 (状态: ${token.status})`);
          return; // 不再处理此代币
        }
      }

      if (strategy) {
        this.logger.info(this._experimentId, 'ProcessToken',
          `${token.symbol} 触发策略: ${strategy.name} (${strategy.action})`);

        // 记录信号到 RoundSummary
        if (this._roundSummary) {
          this._roundSummary.recordSignal(token.token, {
            direction: strategy.action.toUpperCase(),
            action: strategy.action,
            confidence: 80,
            reason: strategy.name
          });

          // 更新触发策略信息
          const tokenData = this._roundSummary.getRoundData()?.tokens?.find(t => t.address === token.token);
          if (tokenData && tokenData.indicators) {
            tokenData.indicators.triggeredStrategy = strategy;
          }
        }

        // 4. 执行交易（不再传递 klineData）
        const executed = await this._executeStrategy(strategy, token);

        // 记录执行状态
        if (this._roundSummary) {
          this._roundSummary.recordSignalExecution(
            token.token,
            executed,
            executed ? null : '执行失败'
          );
        }
      }

      // 记录持仓信息（如果有）
      if (this._roundSummary && token.status === 'bought') {
        const holding = this.holdings.get(token.token);
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
   * 获取代币K线数据
   * @private
   * @param {Object} token - 代币数据
   * @returns {Promise<Array>} K线数据
   */
  async _fetchKlineData(token) {
    try {
      // 构建 tokenId，格式为 address-chain
      const tokenId = `${token.token}-${token.chain}`;
      const interval = 1; // 1分钟K线
      const limit = config.monitor?.klineLimit || 35;

      const result = await this._aveApi.getKlineDataByToken(tokenId, interval, limit);

      if (!result.points || result.points.length === 0) {
        return [];
      }

      // 格式化K线数据
      const formattedData = AveKlineAPI.formatKlinePoints(result.points);

      return formattedData;

    } catch (error) {
      // 只在错误时记录日志
      this.logger.debug('获取K线失败', {
        symbol: token.symbol,
        error: error.message
      });
      return [];
    }
  }

  /**
   * 批量获取代币价格（替代K线数据）
   * @private
   * @param {Array} tokens - 代币数组
   * @returns {Promise<Object>} 价格信息字典 {tokenId: priceInfo}
   */
  async _fetchBatchPrices(tokens) {
    try {
      if (!tokens || tokens.length === 0) {
        return {};
      }

      // 1. 构建 tokenId 列表
      const tokenIds = tokens.map(t => `${t.token}-${t.chain}`);

      // 2. 分批处理（API最多支持200个）
      const batchSize = 200;
      const allPrices = {};

      for (let i = 0; i < tokenIds.length; i += batchSize) {
        const batchIds = tokenIds.slice(i, i + batchSize);

        // 3. 调用批量 API
        const prices = await this._aveTokenApi.getTokenPrices(
          batchIds,
          0,   // tvlMin: 0 表示不限制
          0    // tx24hVolumeMin: 0 表示不限制
        );

        // 4. 更新 TokenPool 中的价格
        for (const token of tokens) {
          const tokenId = `${token.token}-${token.chain}`;
          const priceInfo = prices[tokenId];

          if (priceInfo && priceInfo.current_price_usd) {
            const price = parseFloat(priceInfo.current_price_usd);
            if (price > 0) {
              this._tokenPool.updatePrice(token.token, token.chain, price, Date.now());
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

    // 获取当前价格（已在 _fetchBatchPrices 中更新）
    const currentPrice = token.currentPrice || 0;

    // 获取收集时的价格作为基准价格
    const collectionPrice = token.collectionPrice || currentPrice;

    // 计算 earlyReturn: (当前价格 - 收集时价格) / 收集时价格 * 100%
    let earlyReturn = 0;
    if (collectionPrice > 0 && currentPrice > 0) {
      earlyReturn = ((currentPrice - collectionPrice) / collectionPrice) * 100;
    }

    // 计算代币年龄（分钟）- 使用收集时间计算
    const collectionTime = token.collectionTime || token.addedAt;
    const age = (now - collectionTime) / 1000 / 60;

    // 计算持仓时长（秒）
    const holdDuration = token.buyTime ? (now - token.buyTime) / 1000 : 0;

    // 计算盈利百分比（只对已买入的代币）
    let profitPercent = 0;
    if (token.buyPrice && token.buyPrice > 0 && currentPrice > 0) {
      profitPercent = ((currentPrice - token.buyPrice) / token.buyPrice) * 100;
    }

    const factors = {
      age: age,
      currentPrice: currentPrice,
      collectionPrice: collectionPrice,  // 新增：收集时的基准价格
      earlyReturn: earlyReturn,          // 新增：基于价格计算的 earlyReturn
      buyPrice: token.buyPrice || 0,
      holdDuration: holdDuration,
      profitPercent: profitPercent
    };

    return factors;
  }

  /**
   * 执行策略
   * @private
   * @param {Object} strategy - 策略对象
   * @param {Object} token - 代币数据
   * @returns {Promise<boolean>} 是否执行成功
   */
  async _executeStrategy(strategy, token) {
    // 使用当前价格（已在 _fetchBatchPrices 中更新）
    const latestPrice = token.currentPrice || 0;

    if (strategy.action === 'buy') {
      // 只对监控中的代币执行买入
      if (token.status !== 'monitoring') {
        return false;
      }

      // 初始化策略执行跟踪
      if (!token.strategyExecutions) {
        const strategyIds = this._strategyEngine.getAllStrategies().map(s => s.id);
        this._tokenPool.initStrategyExecutions(token.token, token.chain, strategyIds);
      }

      // 执行买入
      const signal = {
        action: 'buy',
        symbol: token.symbol,
        tokenAddress: token.token,
        price: latestPrice,
        confidence: 80,
        reason: strategy.name,
        cards: strategy.cards || 1  // 传递卡牌数量
      };

      const result = await this.processSignal(signal);

      if (result && result.success) {
        // 标记为已买入
        this._tokenPool.markAsBought(token.token, token.chain, {
          buyPrice: latestPrice,
          buyTime: Date.now()
        });

        // 初始化卡牌仓位管理器
        if (this._positionManagement && this._positionManagement.enabled) {
          const cardManager = new CardPositionManager({
            totalCards: this._positionManagement.totalCards || 4,
            perCardMaxBNB: this._positionManagement.perCardMaxBNB || 0.025,
            minCardsForTrade: 1,
            initialAllocation: {
              bnbCards: (this._positionManagement.totalCards || 4) - (strategy.cards || 1),
              tokenCards: strategy.cards || 1
            }
          });
          this._tokenPool.setCardPositionManager(token.token, token.chain, cardManager);
          this.logger.info(this._experimentId, '_executeStrategy',
            `初始化卡牌管理器: ${token.symbol}, 转移${strategy.cards}卡`);
        }

        // 记录策略执行
        this._tokenPool.recordStrategyExecution(token.token, token.chain, strategy.id);

        // 同步更新持仓
        const holding = this.holdings.get(token.token);
        if (holding) {
          holding.avgBuyPrice = latestPrice;
        }

        return true;
      }

      return false;

    } else if (strategy.action === 'sell') {
      // 只对已买入的代币执行卖出
      if (token.status !== 'bought') {
        return false;
      }

      // 获取卡牌管理器
      const cardManager = this._tokenPool.getCardPositionManager(token.token, token.chain);
      let sellRatio = 1.0;  // 默认全部卖出
      let sellAll = false;

      if (cardManager) {
        // 使用卡牌管理器计算卖出数量
        const cards = strategy.cards || 'all';
        sellAll = (cards === 'all');
        if (!sellAll) {
          // 根据卡牌数量计算卖出比例
          sellRatio = cards / cardManager.totalCards;
        }
      } else {
        // 回退到原来的逻辑
        sellRatio = strategy.sellRatio || 1.0;
        sellAll = (sellRatio >= 1.0);
      }

      // 执行卖出
      const signal = {
        action: 'sell',
        symbol: token.symbol,
        tokenAddress: token.token,
        price: latestPrice,
        confidence: 80,
        reason: strategy.name,
        sellRatio: sellRatio,
        cards: strategy.cards || 'all'  // 传递卡牌数量
      };

      const result = await this.processSignal(signal);

      if (result && result.success) {
        // 更新卡牌分配
        if (cardManager) {
          const cards = strategy.cards || 'all';
          const cardsToTransfer = (cards === 'all') ? null : cards;
          cardManager.afterSell(token.symbol, cardsToTransfer, (cards === 'all'));
          this.logger.info(this._experimentId, '_executeStrategy',
            `卡牌更新: ${token.symbol}, 转移${(cards === 'all') ? '全部' : cards + '卡'}`);
        }

        // 记录策略执行
        this._tokenPool.recordStrategyExecution(token.token, token.chain, strategy.id);

        // 卖出成功后，不再标记为exited
        // 代币将保持bought状态，继续在池中监控30分钟用于数据收集
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
    // 优先使用实验配置中的策略参数，否则使用默认配置
    const experimentConfig = this._experiment?.config || {};
    const defaultStrategyConfig = config.strategy || {};
    const strategyConfig = experimentConfig.strategy || defaultStrategyConfig;

    // 策略参数值
    const buyTimeMinutes = strategyConfig.buyTimeMinutes !== undefined ? strategyConfig.buyTimeMinutes : 1.33;
    const earlyReturnMin = strategyConfig.earlyReturnMin !== undefined ? strategyConfig.earlyReturnMin : 80;
    const earlyReturnMax = strategyConfig.earlyReturnMax !== undefined ? strategyConfig.earlyReturnMax : 120;
    const takeProfit1 = strategyConfig.takeProfit1 !== undefined ? strategyConfig.takeProfit1 : 30;
    const takeProfit2 = strategyConfig.takeProfit2 !== undefined ? strategyConfig.takeProfit2 : 50;
    const stopLossMinutes = strategyConfig.stopLossMinutes !== undefined ? strategyConfig.stopLossMinutes : 5;

    // 卡牌管理配置
    const positionManagement = strategyConfig.positionManagement || {};
    const totalCards = positionManagement.totalCards || 4;

    // 计算每个策略对应的卡牌数量
    // 止盈1: 默认卖出1卡 (25% if totalCards=4)
    // 止盈2: 默认卖出全部剩余 (cards='all')
    // 止损: 默认卖出全部 (cards='all')
    const takeProfit1Cards = strategyConfig.takeProfit1Cards !== undefined
      ? strategyConfig.takeProfit1Cards
      : 1;
    const takeProfit2Cards = strategyConfig.takeProfit2Cards !== undefined
      ? strategyConfig.takeProfit2Cards
      : 'all';
    const stopLossCards = 'all';

    // 预计算需要用算术表达式的值（ConditionEvaluator不支持算术运算）
    const stopLossSeconds = stopLossMinutes * 60;

    return [
      {
        id: 'early_return_buy',
        name: `早止买入 (${earlyReturnMin}-${earlyReturnMax}%收益率)`,
        action: 'buy',
        priority: 1,
        cooldown: 60,
        enabled: true,
        cards: 1,  // 买入使用1卡
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
        maxExecutions: 1,  // 止盈1只执行一次
        condition: `profitPercent >= ${takeProfit1} AND holdDuration > 0`,
        sellRatio: strategyConfig.takeProfit1Sell !== undefined ? strategyConfig.takeProfit1Sell : 0.25  // 1卡 = 25%
      },
      {
        id: 'take_profit_2',
        name: `止盈2 (${takeProfit2}%卖出全部)`,
        action: 'sell',
        priority: 2,
        cooldown: 30,
        enabled: true,
        cards: takeProfit2Cards,
        maxExecutions: 1,  // 止盈2只执行一次
        condition: `profitPercent >= ${takeProfit2} AND holdDuration > 0`,
        sellRatio: 1.0
      },
      {
        id: 'stop_loss',
        name: `时间止损 (${stopLossMinutes}分钟)`,
        action: 'sell',
        priority: 10,
        cooldown: 60,
        enabled: true,
        cards: stopLossCards,
        maxExecutions: 1,  // 止损只执行一次
        condition: `holdDuration >= ${stopLossSeconds} AND profitPercent <= 0`,
        sellRatio: 1.0
      }
    ];
  }

  /**
   * 处理策略信号
   * @param {Object} signal - 策略信号
   * @returns {Promise<Object>} 处理结果
   */
  async processSignal(signal) {
    if (this._status !== EngineStatus.RUNNING) {
      console.warn('⚠️ 引擎未运行，忽略信号');
      return { executed: false, reason: '引擎未运行' };
    }

    this.metrics.totalSignals++;

    // 记录信号到数据库（初始状态为未执行）
    const tradeSignal = TradeSignal.fromStrategySignal(signal, this._experimentId);
    await this.dataService.saveSignal(tradeSignal);

    // 根据信号类型执行交易
    let tradeResult = null;
    if (signal.action === 'buy') {
      tradeResult = await this._executeBuy(signal);
    } else if (signal.action === 'sell') {
      tradeResult = await this._executeSell(signal);
    } else {
      return { executed: false, reason: 'hold信号' };
    }

    // 如果交易成功，更新信号状态为已执行
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
   * @returns {Promise<Object>} 交易结果
   * @private
   */
  async _executeBuy(signal) {
    try {
      const amountInBNB = this._calculateBuyAmount(signal);
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
        price: price
      };

      const result = await this.executeTrade(tradeRequest);

      // 买入成功后更新代币状态
      if (result && result.success) {
        await this.dataService.updateTokenStatus(this._experimentId, signal.tokenAddress, 'bought');
      }

      return result;

    } catch (error) {
      return { success: false, reason: error.message };
    }
  }

  /**
   * 执行卖出交易
   * @param {Object} signal - 卖出信号
   * @returns {Promise<Object>} 交易结果
   * @private
   */
  async _executeSell(signal) {
    try {
      const holding = this.holdings.get(signal.tokenAddress);
      if (!holding || holding.amount <= 0) {
        return { success: false, reason: '无持仓' };
      }

      let amountToSell;
      let sellAll = false;

      // 优先使用卡牌管理器计算卖出数量
      const cardManager = this._tokenPool.getCardPositionManager(signal.tokenAddress, signal.symbol);
      if (cardManager) {
        const cards = signal.cards || 'all';
        sellAll = (cards === 'all');
        const cardsToUse = sellAll ? null : cards;
        amountToSell = cardManager.calculateSellAmount(holding.amount, signal.symbol, cardsToUse, sellAll);
      } else {
        // 回退到原来的逻辑：使用 sellRatio
        const sellRatio = signal.sellRatio || signal.metadata?.sellRatio || 1.0;
        sellAll = (sellRatio >= 1.0);
        amountToSell = holding.amount * sellRatio;
      }

      const price = signal.price || 0;
      const amountOutBNB = price > 0 ? amountToSell * price : 0;

      const tradeRequest = {
        tokenAddress: signal.tokenAddress,
        symbol: signal.symbol,
        direction: 'sell',
        amount: amountToSell,
        price: price
      };

      const result = await this.executeTrade(tradeRequest);

      // 卖出成功后，不再更新代币状态为exited
      // 代币将保持bought状态，继续在池中监控30分钟用于数据收集

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
    // 优先使用卡牌管理器计算金额
    const cardManager = this._tokenPool.getCardPositionManager(signal.tokenAddress, signal.symbol);
    if (cardManager) {
      const cards = signal.cards || 1;
      const amount = cardManager.calculateBuyAmount(cards);
      if (amount <= 0) {
        this.logger.warn(this._experimentId, 'CalculateBuyAmount',
          `卡牌管理器返回金额为0: ${signal.symbol}`);
        return 0;
      }
      // 检查余额是否足够
      if (this.currentBalance < amount) {
        this.logger.warn(this._experimentId, 'CalculateBuyAmount',
          `余额不足: 需要 ${amount} BNB, 当前 ${this.currentBalance.toFixed(4)} BNB`);
        return 0;
      }
      return amount;
    }

    // 回退到固定金额模式
    const tradeAmount = this._experiment.config?.virtual?.tradeAmount || 0.1;

    // 检查余额是否足够
    if (this.currentBalance < tradeAmount) {
      this.logger.warn(this._experimentId, 'CalculateBuyAmount',
        `余额不足: 需要 ${tradeAmount} BNB, 当前 ${this.currentBalance.toFixed(4)} BNB`);
      return 0;
    }

    return tradeAmount;
  }

  /**
   * 执行交易
   * @param {Object} tradeRequest - 交易请求
   * @returns {Promise<Object>} 交易结果
   */
  async executeTrade(tradeRequest) {
    this.metrics.totalTrades++;

    const trade = Trade.fromVirtualTrade({
      tokenAddress: tradeRequest.tokenAddress,
      symbol: tradeRequest.symbol,
      chain: this._experiment.blockchain || 'bsc',
      direction: tradeRequest.direction,
      amount: tradeRequest.amount,
      price: tradeRequest.price,
      success: false,
      error: null
    }, this._experimentId);

    try {
      // 使用 PortfolioManager 执行交易
      const Decimal = require('decimal.js');
      const result = await this._portfolioManager.executeTrade(
        this._portfolioId,
        tradeRequest.tokenAddress,
        tradeRequest.direction,
        new Decimal(tradeRequest.amount),
        new Decimal(tradeRequest.price),
        0.001  // 0.1% 手续费
      );

      if (result.success) {
        trade.markAsSuccess();
        this.metrics.successfulTrades++;

        // 同步更新本地 holdings (用于兼容旧代码)
        this._syncHoldingsFromPortfolio();

        // 保存交易记录
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

      await this.dataService.saveTrade(trade);

      return {
        success: false,
        error: error.message,
        trade: trade.toJSON()
      };
    }
  }

  /**
   * 处理买入 (已废弃，使用 PortfolioManager)
   * @param {Trade} trade - 交易实体
   * @private
   * @deprecated
   */
  async _processBuy(trade) {
    // 此方法已废弃，交易通过 PortfolioManager.executeTrade() 执行
    throw new Error('_processBuy 已废弃，请使用 PortfolioManager.executeTrade()');
  }

  /**
   * 处理卖出 (已废弃，使用 PortfolioManager)
   * @param {Trade} trade - 交易实体
   * @private
   * @deprecated
   */
  async _processSell(trade) {
    // 此方法已废弃，交易通过 PortfolioManager.executeTrade() 执行
    throw new Error('_processSell 已废弃，请使用 PortfolioManager.executeTrade()');
  }

  /**
   * 从 PortfolioManager 同步 holdings 到本地 (兼容性方法)
   * @private
   */
  _syncHoldingsFromPortfolio() {
    const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);
    if (!portfolio) return;

    const Decimal = require('decimal.js');
    this.currentBalance = portfolio.cashBalance.toNumber();

    // 转换 positions Map 到 holdings Map
    this.holdings.clear();
    for (const [address, position] of portfolio.positions) {
      this.holdings.set(address, {
        amount: position.amount.toNumber(),
        avgBuyPrice: position.averagePrice.toNumber()
      });
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
        // 没有交易历史，使用初始余额
        this._syncHoldingsFromPortfolio();
        return;
      }

      // 使用 PortfolioManager 重放交易
      const Decimal = require('decimal.js');

      for (const trade of trades.sort((a, b) => a.createdAt - b.createdAt)) {
        if (!trade.success) continue;

        try {
          await this._portfolioManager.executeTrade(
            this._portfolioId,
            trade.tokenAddress,
            trade.direction,
            new Decimal(trade.amount),
            new Decimal(trade.price),
            0.001  // 0.1% 手续费
          );
        } catch (error) {
          console.error(`重放交易失败: ${trade.tokenSymbol} - ${error.message}`);
        }
      }

      // 同步到本地 holdings
      this._syncHoldingsFromPortfolio();

      const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);
      console.log(`📦 持仓加载完成: ${this.holdings.size} 个代币, 余额 $${portfolio.cashBalance.toFixed(2)}`);

    } catch (error) {
      console.error('❌ 加载持仓失败:', error.message);
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
    // 从 PortfolioManager 获取最新数据
    const portfolio = this._portfolioManager ? this._portfolioManager.getPortfolio(this._portfolioId) : null;

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

    // 回退到本地数据
    const profit = this.currentBalance - this.initialBalance;
    const profitRate = (profit / this.initialBalance) * 100;

    return {
      ...this.metrics,
      initialBalance: this.initialBalance,
      currentBalance: this.currentBalance,
      totalValue: this.currentBalance,
      profit: profit,
      profitRate: profitRate,
      holdingsCount: this.holdings.size,
      holdings: Array.from(this.holdings.entries()).map(([addr, h]) => ({
        tokenAddress: addr,
        amount: h.amount,
        avgBuyPrice: h.avgBuyPrice
      }))
    };
  }

  /**
   * 构建投资组合摘要
   * @private
   * @returns {Object} 投资组合数据
   */
  _buildPortfolioSummary() {
    if (!this._portfolioManager || !this._portfolioId) {
      // 回退到本地数据
      let totalValue = this.currentBalance;
      const positions = [];

      for (const [tokenAddress, holding] of this.holdings.entries()) {
        if (holding.amount > 0) {
          const token = this._tokenPool.getToken(tokenAddress, 'bsc');
          const currentPrice = (token && token.currentPrice) || holding.avgBuyPrice;
          const value = holding.amount * currentPrice;
          totalValue += value;

          positions.push({
            symbol: token?.symbol || 'UNKNOWN',
            amount: holding.amount,
            value: value,
            buyPrice: holding.avgBuyPrice,
            currentPrice: currentPrice
          });
        }
      }

      return {
        totalValue: totalValue,
        cashBalance: this.currentBalance,
        positions: positions
      };
    }

    // 使用 PortfolioManager 数据
    const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);
    if (!portfolio) {
      return { totalValue: 0, cashBalance: 0, positions: [] };
    }

    const positions = [];
    for (const [address, position] of portfolio.positions) {
      positions.push({
        symbol: position.tokenSymbol || 'UNKNOWN',
        amount: position.amount.toNumber(),
        value: position.value.toNumber(),
        buyPrice: position.averagePrice.toNumber(),
        currentPrice: position.currentPrice.toNumber()
      });
    }

    return {
      totalValue: portfolio.totalValue.toNumber(),
      cashBalance: portfolio.cashBalance.toNumber(),
      positions: positions
    };
  }

  /**
   * 创建并保存投资组合快照
   * @private
   * @returns {Promise<void>}
   */
  async _createPortfolioSnapshot() {
    if (!this._portfolioManager || !this._portfolioId) {
      return;
    }

    try {
      // 获取投资组合数据
      const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);
      if (!portfolio) {
        return;
      }

      // 使用 PortfolioTracker 创建快照
      const snapshot = await this._portfolioManager.tracker.createSnapshot(
        this._portfolioId,
        portfolio.positions,
        portfolio.cashBalance,
        {
          walletAddress: this._experimentId,
          blockchain: 'bsc',
          tradingMode: 'virtual',
          strategy: 'fourmeme',
          experimentId: this._experimentId,
          version: '1.0.0'
        }
      );

      // 保存到数据库（通过 ExperimentDataService）
      if (snapshot && this.dataService) {
        await this.dataService.savePortfolioSnapshot(this._experimentId, snapshot);
      }

    } catch (error) {
      this.logger.error(this._experimentId, 'PortfolioSnapshot',
        `创建快照失败: ${error.message}`);
    }
  }
}

module.exports = { VirtualTradingEngine };
