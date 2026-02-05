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
    // holdings 由 PortfolioManager 统一管理，不再缓存

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
   * 获取持仓（从PortfolioManager，统一处理地址规范化）
   * @param {string} tokenAddress - 代币地址
   * @returns {Object|null} 持仓对象 { amount, avgBuyPrice } 或 null
   * @private
   */
  _getHolding(tokenAddress) {
    if (!this._portfolioManager || !this._portfolioId) {
      console.log('🔍 [_getHolding] PortfolioManager或portfolioId不存在');
      return null;
    }
    const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);
    if (!portfolio) {
      console.log('🔍 [_getHolding] Portfolio未找到, portfolioId=', this._portfolioId);
      return null;
    }

    // 🔍 调试：列出所有position的key
    const allKeys = Array.from(portfolio.positions.keys());
    console.log('🔍 [_getHolding] 查询tokenAddress=', tokenAddress, ', 所有position keys=', allKeys);

    // 使用与PortfolioManager相同的地址规范化方法
    const normalizedAddress = this._portfolioManager._normalizeAddress(tokenAddress);
    console.log('🔍 [_getHolding] 规范化后地址=', normalizedAddress);

    const position = portfolio.positions.get(normalizedAddress);
    if (!position) {
      console.log('🔍 [_getHolding] Position未找到, normalizedAddress=', normalizedAddress);
      return null;
    }
    return {
      amount: position.amount.toNumber(),
      avgBuyPrice: position.averagePrice.toNumber()
    };
  }

  /**
   * 获取所有持仓（从PortfolioManager）
   * @returns {Array} 持仓数组
   * @private
   */
  _getAllHoldings() {
    if (!this._portfolioManager || !this._portfolioId) {
      return [];
    }
    const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);
    if (!portfolio) {
      return [];
    }
    const holdings = [];
    for (const [address, position] of portfolio.positions) {
      holdings.push({
        tokenAddress: address,
        amount: position.amount.toNumber(),
        avgBuyPrice: position.averagePrice.toNumber()
      });
    }
    return holdings;
  }

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
      const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);
      this.logger.info(this._experimentId, 'VirtualTradingEngine', '引擎初始化完成', {
        initialBalance: this.initialBalance,
        currentBalance: this.currentBalance,
        holdingsCount: portfolio ? portfolio.positions.size : 0
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
      'age', 'currentPrice', 'collectionPrice', 'earlyReturn', 'buyPrice',
      'holdDuration', 'profitPercent',
      // 历史最高价格相关因子
      'highestPrice', 'highestPriceTimestamp', 'drawdownFromHighest'
    ]);

    // 加载策略（带验证）
    this._strategyEngine.loadStrategies(strategies, availableFactorIds);
    console.log(`✅ 策略引擎初始化完成，加载了 ${this._strategyEngine.getStrategyCount()} 个策略`);

    // 6. 初始化卡牌仓位管理配置
    const experimentConfig = this._experiment?.config || {};
    // 新格式：positionManagement 直接在 config 下
    // 旧格式：positionManagement 在 config.strategy 下
    this._positionManagement = experimentConfig.positionManagement || experimentConfig.strategy?.positionManagement || null;
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

      // 调试日志：即将保存时序数据
      console.log(`📊 [时序数据] 准备保存 | symbol=${token.symbol}, tokenAddress=${token.token}, price=${factorResults.currentPrice}`);

      // 保存时序数据到数据库
      const recordResult = await this.timeSeriesService.recordRoundData({
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
          riseSpeed: factorResults.riseSpeed,
          buyPrice: factorResults.buyPrice,
          holdDuration: factorResults.holdDuration,
          profitPercent: factorResults.profitPercent,
          // 历史最高价格相关因子
          highestPrice: factorResults.highestPrice,
          highestPriceTimestamp: factorResults.highestPriceTimestamp,
          drawdownFromHighest: factorResults.drawdownFromHighest,
          // AVE API 因子
          txVolumeU24h: factorResults.txVolumeU24h,
          holders: factorResults.holders,
          tvl: factorResults.tvl,
          fdv: factorResults.fdv,
          marketCap: factorResults.marketCap
        },
        blockchain: this._experiment.blockchain || 'bsc'
      });

      // 调试日志：记录时序数据保存结果
      console.log(`📊 [时序数据] 保存结果 | symbol=${token.symbol}, result=${recordResult}`);
      if (!recordResult) {
        this.logger.warn(this._experimentId, 'ProcessToken',
          `时序数据保存失败 | symbol=${token.symbol}, tokenAddress=${token.token}`);
      }

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

        // 4. 执行交易（传递 factorResults 用于信号 metadata）
        const executed = await this._executeStrategy(strategy, token, factorResults);

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

        // 4. 更新 TokenPool 中的价格和因子数据
        for (const token of tokens) {
          const tokenId = `${token.token}-${token.chain}`;
          const priceInfo = prices[tokenId];

          if (priceInfo && priceInfo.current_price_usd) {
            const price = parseFloat(priceInfo.current_price_usd);
            if (price > 0) {
              // 构建额外因子数据
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

    // 计算涨速 (riseSpeed): 每分钟涨幅
    // riseSpeed = earlyReturn / age
    let riseSpeed = 0;
    if (age > 0) {
      riseSpeed = earlyReturn / age;
    }

    // 计算持仓时长（秒）
    const holdDuration = token.buyTime ? (now - token.buyTime) / 1000 : 0;

    // 计算盈利百分比（只对已买入的代币）
    let profitPercent = 0;
    if (token.buyPrice && token.buyPrice > 0 && currentPrice > 0) {
      profitPercent = ((currentPrice - token.buyPrice) / token.buyPrice) * 100;
    }

    // 获取历史最高价格
    const highestPrice = token.highestPrice || collectionPrice || currentPrice;
    const highestPriceTimestamp = token.highestPriceTimestamp || collectionTime;

    // 计算距离最高价的跌幅 %
    let drawdownFromHighest = 0;
    if (highestPrice > 0 && currentPrice > 0) {
      drawdownFromHighest = ((currentPrice - highestPrice) / highestPrice) * 100;
    }

    const factors = {
      age: age,
      currentPrice: currentPrice,
      collectionPrice: collectionPrice,  // 新增：收集时的基准价格
      earlyReturn: earlyReturn,          // 新增：基于价格计算的 earlyReturn
      riseSpeed: riseSpeed,              // 新增：涨速 (每分钟涨幅 %/min)
      buyPrice: token.buyPrice || 0,
      holdDuration: holdDuration,
      profitPercent: profitPercent,
      // 新增：历史最高价格相关因子
      highestPrice: highestPrice,
      highestPriceTimestamp: highestPriceTimestamp,
      drawdownFromHighest: drawdownFromHighest,
      // 新增：AVE API 因子
      txVolumeU24h: token.txVolumeU24h || 0,
      holders: token.holders || 0,
      tvl: token.tvl || 0,
      fdv: token.fdv || 0,
      marketCap: token.marketCap || 0
    };

    return factors;
  }

  /**
   * 执行策略
   * @private
   * @param {Object} strategy - 策略对象
   * @param {Object} token - 代币数据
   * @param {Object} factorResults - 因子计算结果（用于信号 metadata）
   * @returns {Promise<boolean>} 是否执行成功
   */
  async _executeStrategy(strategy, token, factorResults = null) {
    // 使用当前价格（已在 _fetchBatchPrices 中更新）
    const latestPrice = token.currentPrice || 0;

    // 如果没有传入 factorResults，重新计算一次
    if (!factorResults) {
      factorResults = this._buildFactors(token);
    }

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

      // 🔥 修复：在执行买入前先创建卡牌管理器
      // 因为 _executeBuy 需要卡牌管理器存在才能执行交易
      if (this._positionManagement && this._positionManagement.enabled) {
        let cardManager = this._tokenPool.getCardPositionManager(token.token, token.chain);
        if (!cardManager) {
          // 卡牌管理器不存在，创建一个新的（初始状态：全部BNB卡）
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

      // 执行买入
      const signal = {
        action: 'buy',
        symbol: token.symbol,
        tokenAddress: token.token,
        chain: token.chain,  // 🔥 添加 chain 字段，卡牌管理器需要用它作为 key
        price: latestPrice,
        confidence: 80,
        reason: strategy.name,
        cards: strategy.cards || 1,  // 传递卡牌数量
        // 新增：策略信息（用于追踪触发哪一条策略）
        strategyId: strategy.id,
        strategyName: strategy.name,
        // 新增：卡牌管理配置（用于分析）
        cardConfig: this._positionManagement?.enabled ? {
          totalCards: this._positionManagement.totalCards || 4,
          perCardMaxBNB: this._positionManagement.perCardMaxBNB || 0.25
        } : null,
        // 新增：因子信息（用于分析和调整策略）
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
          marketCap: factorResults.marketCap
        } : null
      };

      // 🔍 诊断日志：准备调用 processSignal
      this.logger.info(this._experimentId, '_executeStrategy',
        `准备调用 processSignal | symbol=${signal.symbol}, action=${signal.action}, tokenAddress=${signal.tokenAddress}, chain=${signal.chain}, price=${signal.price}, cards=${signal.cards}`);

      const result = await this.processSignal(signal);

      // 🔍 诊断日志：processSignal 返回结果
      this.logger.info(this._experimentId, '_executeStrategy',
        `processSignal 返回 | symbol=${signal.symbol}, result=${JSON.stringify(result)}`);

      if (result && result.success) {
        // 标记为已买入
        this._tokenPool.markAsBought(token.token, token.chain, {
          buyPrice: latestPrice,
          buyTime: Date.now()
        });

        // 🔍 诊断日志：标记为已买入
        this.logger.info(this._experimentId, '_executeStrategy',
          `标记为已买入 | symbol=${token.symbol}, tokenAddress=${token.token}, chain=${token.chain}, buyPrice=${latestPrice}`);

        // 记录策略执行
        this._tokenPool.recordStrategyExecution(token.token, token.chain, strategy.id);

        // 同步更新持仓（PortfolioManager会自动计算平均价格）

        // 🔥 重要：更新代币状态到数据库
        // 注意：卡牌分配的更新已经在 _executeBuy 方法中完成了，这里不需要重复
        const updateResult = await this.dataService.updateTokenStatus(this._experimentId, token.token, 'bought');
        this.logger.info(this._experimentId, '_executeStrategy',
          `更新代币状态 | symbol=${token.symbol}, status=bought, updateResult=${updateResult}`);

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

      // 检查卡牌管理器是否可用
      if (!cardManager) {
        this.logger.warn(this._experimentId, '_executeStrategy',
          `代币 ${token.symbol} 没有卡牌管理器，跳过卖出`);
        return false;
      }

      // 获取卖出卡牌数量
      const cards = strategy.cards || 'all';
      const sellAll = (cards === 'all');

      // 计算实际卖出比例（用于分析）
      let sellCalculatedRatio = 1.0;
      if (!sellAll) {
        const cardNum = parseInt(cards);
        if (!isNaN(cardNum) && cardNum > 0) {
          sellCalculatedRatio = cardNum / cardManager.totalCards;
        }
      }

      // 执行卖出
      const signal = {
        action: 'sell',
        symbol: token.symbol,
        tokenAddress: token.token,
        chain: token.chain,  // 🔥 添加 chain 字段，卡牌管理器需要用它作为 key
        price: latestPrice,
        confidence: 80,
        reason: strategy.name,
        cards: strategy.cards || 'all',  // 传递卡牌数量
        // 新增：策略信息（用于追踪触发哪一条策略）
        strategyId: strategy.id,
        strategyName: strategy.name,
        // 新增：买入价格和收益信息
        buyPrice: token.buyPrice || null,
        profitPercent: token.buyPrice && latestPrice ? ((latestPrice - token.buyPrice) / token.buyPrice * 100) : null,
        holdDuration: token.buyTime ? ((Date.now() - token.buyTime) / 1000) : null,
        // 新增：卡牌管理配置（用于分析）
        cardConfig: this._positionManagement?.enabled ? {
          totalCards: this._positionManagement.totalCards || 4,
          perCardMaxBNB: this._positionManagement.perCardMaxBNB || 0.25
        } : null,
        // 新增：实际计算出的卖出比例（仅用于分析）
        sellCalculatedRatio: sellCalculatedRatio,
        // 新增：因子信息（用于分析和调整策略）
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
          marketCap: factorResults.marketCap
        } : null
      };

      const result = await this.processSignal(signal);

      if (result && result.success) {
        // 🔍 诊断日志：卖出成功
        this.logger.info(this._experimentId, '_executeStrategy',
          `卖出成功 | symbol=${token.symbol}, result=${JSON.stringify(result)}`);

        // 记录策略执行
        this._tokenPool.recordStrategyExecution(token.token, token.chain, strategy.id);

        // 卖出成功后，不再标记为exited
        // 代币将保持bought状态，继续在池中监控30分钟用于数据收集
        // 注意：卡牌分配的更新已经在 _executeSell 方法中完成了，这里不需要重复
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

    // 优先使用前端配置的卡牌策略系统 (strategiesConfig)
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
   * @param {Array} strategiesConfig.buyStrategies - 买入策略数组
   * @param {Array} strategiesConfig.sellStrategies - 卖出策略数组
   * @returns {Array} 策略配置数组
   */
  _buildStrategiesFromConfig(strategiesConfig) {
    const strategies = [];
    let buyIndex = 0;
    let sellIndex = 0;

    // 处理买入策略
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
      console.log(`📋 加载了 ${buyIndex} 个自定义买入策略`);
    }

    // 处理卖出策略
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
      console.log(`📋 加载了 ${sellIndex} 个自定义卖出策略`);
    }

    return strategies;
  }

  /**
   * 构建默认策略（向后兼容）
   * @private
   * @returns {Array} 策略配置数组
   */
  _buildDefaultStrategies() {
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

    console.log('⚠️ 使用默认硬编码策略（未配置自定义策略）');

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
        maxExecutions: 1,  // 止盈2只执行一次
        condition: `profitPercent >= ${takeProfit2} AND holdDuration > 0`
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
        condition: `holdDuration >= ${stopLossSeconds} AND profitPercent <= 0`
      }
    ];
  }

  /**
   * 处理策略信号
   * @param {Object} signal - 策略信号
   * @returns {Promise<Object>} 处理结果
   */
  async processSignal(signal) {
    // 🔍 诊断日志：processSignal 被调用
    this.logger.info(this._experimentId, 'processSignal',
      `processSignal 被调用 | action=${signal.action}, symbol=${signal.symbol}, tokenAddress=${signal.tokenAddress}, chain=${signal.chain}`);
    this.logger.info(this._experimentId, 'processSignal',
      `引擎状态 | status=${this._status}, RUNNING=${EngineStatus.RUNNING}`);

    if (this._status !== EngineStatus.RUNNING) {
      console.warn('⚠️ 引擎未运行，忽略信号');
      this.logger.warn(this._experimentId, 'processSignal',
        `引擎未运行，忽略信号 | status=${this._status}`);
      return { executed: false, reason: '引擎未运行' };
    }

    this.metrics.totalSignals++;

    // 记录信号到数据库（初始状态为未执行）
    const tradeSignal = TradeSignal.fromStrategySignal(signal, this._experimentId);
    await this.dataService.saveSignal(tradeSignal);

    // 🔍 诊断日志：准备执行交易
    this.logger.info(this._experimentId, 'processSignal',
      `准备执行交易 | action=${signal.action}, signalId=${tradeSignal.id}`);

    // 根据信号类型执行交易，传递 signalId 和元数据
    let tradeResult = null;
    if (signal.action === 'buy') {
      this.logger.info(this._experimentId, 'processSignal',
        `调用 _executeBuy | symbol=${signal.symbol}, signalId=${tradeSignal.id}`);
      tradeResult = await this._executeBuy(signal, tradeSignal.id, signal.metadata);
      this.logger.info(this._experimentId, 'processSignal',
        `_executeBuy 返回 | result=${JSON.stringify(tradeResult)}`);
    } else if (signal.action === 'sell') {
      tradeResult = await this._executeSell(signal, tradeSignal.id, signal.metadata);
    } else {
      this.logger.warn(this._experimentId, 'processSignal',
        `未知信号类型 | action=${signal.action}`);
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
   * @param {string} signalId - 信号ID
   * @param {Object} metadata - 信号元数据
   * @returns {Promise<Object>} 交易结果
   * @private
   */
  async _executeBuy(signal, signalId = null, metadata = {}) {
    // 🔍 诊断日志：_executeBuy 被调用
    this.logger.info(this._experimentId, '_executeBuy',
      `========== _executeBuy 被调用 ==========`);
    this.logger.info(this._experimentId, '_executeBuy',
      `signal | action=${signal.action}, symbol=${signal.symbol}, tokenAddress=${signal.tokenAddress}, chain=${signal.chain}, price=${signal.price}, cards=${signal.cards}, signalId=${signalId}`);

    try {
      // 获取卡牌管理器（买入时必须存在）
      // 🔥 修复：使用 chain 而不是 symbol 作为 key
      this.logger.info(this._experimentId, '_executeBuy',
        `获取卡牌管理器 | tokenAddress=${signal.tokenAddress}, chain=${signal.chain}, symbol=${signal.symbol}`);
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
          // 记录买入前的卡牌状态
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
        // 更新卡牌分配
        const cards = parseInt(signal.cards) || 1;
        this.logger.info(this._experimentId, '_executeBuy',
          `更新卡牌分配 | cards=${cards}, before: bnbCards=${cardManager.bnbCards}, tokenCards=${cardManager.tokenCards}`);
        cardManager.afterBuy(signal.symbol, cards);
        this.logger.info(this._experimentId, '_executeBuy',
          `更新卡牌分配完成 | after: bnbCards=${cardManager.bnbCards}, tokenCards=${cardManager.tokenCards}`);

        // 记录买入后的状态
        const afterCardState = {
          bnbCards: cardManager.bnbCards,
          tokenCards: cardManager.tokenCards,
          totalCards: cardManager.totalCards
        };
        const afterBalance = {
          bnbBalance: this.currentBalance,
          tokenBalance: this._getHolding(signal.tokenAddress)?.amount || 0
        };

        // 更新元数据中的卡牌变化记录
        // 🔥 修复：metadata 在 result.trade.metadata 中，不是 result.metadata
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

        // 🔥 修复：更新数据库中的交易记录，添加 after 状态
        const tradeId = result.trade?.id;
        if (tradeId) {
          this.logger.info(this._experimentId, '_executeBuy',
            `更新交易记录 | tradeId=${tradeId}, after状态已更新`);
          await this.dataService.updateTrade(tradeId, {
            metadata: result.trade.metadata
          });
        } else {
          this.logger.warn(this._experimentId, '_executeBuy',
            `无法更新交易记录 | tradeId不存在`);
        }

        // 🔥 注意：代币状态的更新移到 _executeStrategy 方法中统一处理
        // 避免在这里和 _executeStrategy 中重复调用
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
   * @param {Object} metadata - 信号元数据
   * @returns {Promise<Object>} 交易结果
   * @private
   */
  async _executeSell(signal, signalId = null, metadata = {}) {
    try {
      // 🔍 诊断日志：检查持仓
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

      // 获取卡牌管理器（必须存在）
      // 🔥 修复：使用 chain 而不是 symbol 作为 key
      const cardManager = this._tokenPool.getCardPositionManager(signal.tokenAddress, signal.chain);
      if (!cardManager) {
        this.logger.warn(this._experimentId, '_executeSell',
          `卡牌管理器未初始化 | tokenAddress=${signal.tokenAddress}, chain=${signal.chain}`);
        return { success: false, reason: '卡牌管理器未初始化，无法执行卖出' };
      }

      // 记录卖出前的卡牌和余额状态
      const beforeCardState = {
        bnbCards: cardManager.bnbCards,
        tokenCards: cardManager.tokenCards,
        totalCards: cardManager.totalCards
      };
      const beforeBalance = {
        bnbBalance: this.currentBalance,
        tokenBalance: holding.amount
      };

      // 计算卖出数量
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
          // 记录卖出前的卡牌状态
          cardPositionChange: {
            before: {
              ...beforeCardState,
              ...beforeBalance
            }
          }
        }
      };

      const result = await this.executeTrade(tradeRequest);

      // 卖出成功后更新卡牌分配和状态
      if (result && result.success) {
        // 更新卡牌分配
        const actualCards = sellAll ? beforeCardState.tokenCards : cardsToUse;
        this.logger.info(this._experimentId, '_executeSell',
          `更新卡牌分配 | actualCards=${actualCards}, sellAll=${sellAll}, before: bnbCards=${cardManager.bnbCards}, tokenCards=${cardManager.tokenCards}`);
        cardManager.afterSell(signal.symbol, actualCards);
        this.logger.info(this._experimentId, '_executeSell',
          `更新卡牌分配完成 | after: bnbCards=${cardManager.bnbCards}, tokenCards=${cardManager.tokenCards}`);

        // 记录卖出后的状态
        const afterCardState = {
          bnbCards: cardManager.bnbCards,
          tokenCards: cardManager.tokenCards,
          totalCards: cardManager.totalCards
        };
        const afterBalance = {
          bnbBalance: this.currentBalance,
          tokenBalance: this._getHolding(signal.tokenAddress)?.amount || 0
        };

        // 更新元数据中的卡牌变化记录
        // 🔥 修复：metadata 在 result.trade.metadata 中，不是 result.metadata
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

        // 🔥 修复：更新数据库中的交易记录，添加 after 状态
        const tradeId = result.trade?.id;
        if (tradeId) {
          this.logger.info(this._experimentId, '_executeSell',
            `更新交易记录 | tradeId=${tradeId}, after状态已更新`);
          await this.dataService.updateTrade(tradeId, {
            metadata: result.trade.metadata
          });
        } else {
          this.logger.warn(this._experimentId, '_executeSell',
            `无法更新交易记录 | tradeId不存在`);
        }
      }

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
    // 🔍 诊断日志：_calculateBuyAmount 被调用
    this.logger.info(this._experimentId, '_calculateBuyAmount',
      `_calculateBuyAmount 被调用 | symbol=${signal.symbol}, tokenAddress=${signal.tokenAddress}, chain=${signal.chain}, cards=${signal.cards}`);

    // 优先使用卡牌管理器计算金额
    // 🔥 修复：使用 chain 而不是 symbol 作为 key
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
      // 检查余额是否足够
      if (this.currentBalance < amount) {
        this.logger.warn(this._experimentId, '_calculateBuyAmount',
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

    // 获取主币符号
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
      metadata: tradeRequest.metadata || {}
    }, this._experimentId, tradeRequest.signalId, nativeCurrency);

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

      // 失败的交易不再保存到 trades 表，只在信号表中记录

      return {
        success: false,
        error: error.message
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
        return;
      }

      // 使用 PortfolioManager 重放交易
      const Decimal = require('decimal.js');

      for (const trade of trades.sort((a, b) => a.createdAt - b.createdAt)) {
        if (!trade.success) continue;

        try {
          // 从新的 input/output 字段获取交易信息
          // PortfolioManager.executeTrade 期望的参数:
          // - amount: 代币数量 (买入时是获得的代币数量，卖出时是卖出的代币数量)
          // - price: 代币单价
          let tokenAmount, tokenPrice;

          if (trade.tradeDirection === 'buy' || trade.direction === 'buy') {
            // 买入: output_amount 是获得的代币数量
            tokenAmount = trade.outputAmount || 0;
            tokenPrice = trade.unitPrice || 0;
          } else {
            // 卖出: input_amount 是卖出的代币数量
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
            0.001  // 0.1% 手续费
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
    const allHoldings = this._getAllHoldings();

    return {
      ...this.metrics,
      initialBalance: this.initialBalance,
      currentBalance: this.currentBalance,
      totalValue: this.currentBalance,
      profit: profit,
      profitRate: profitRate,
      holdingsCount: allHoldings.length,
      holdings: allHoldings
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
      const allHoldings = this._getAllHoldings();

      for (const holding of allHoldings) {
        if (holding.amount > 0) {
          const token = this._tokenPool.getToken(holding.tokenAddress, 'bsc');
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
