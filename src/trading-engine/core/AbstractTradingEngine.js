/**
 * 抽象交易引擎基类
 * 提取 VirtualTradingEngine 和 BacktestEngine 的共同逻辑
 *
 * @abstract
 * @class
 */
const { ITradingEngine, TradingMode, EngineStatus } = require('../interfaces/ITradingEngine');
const { Experiment } = require('../entities/Experiment');
const { dbManager } = require('../../services/dbManager');
const { BlockchainConfig } = require('../../utils/BlockchainConfig');
const Logger = require('../../services/logger');

// 延迟导入以避免循环依赖
let TokenPool = null;
let StrategyEngine = null;
let PortfolioManager = null;
let RoundSummary = null;
let ExperimentTimeSeriesService = null;

/**
 * 获取延迟导入的模块
 */
function getLazyModules() {
  if (!TokenPool) {
    TokenPool = require('../../core/token-pool');
    const SE = require('../../strategies/StrategyEngine');
    StrategyEngine = SE.StrategyEngine;
    const PM = require('../../portfolio/core/PortfolioManager');
    PortfolioManager = PM.PortfolioManager;
    const RS = require('../utils/RoundSummary');
    RoundSummary = RS.RoundSummary;
    const ETSS = require('../../web/services/ExperimentTimeSeriesService');
    ExperimentTimeSeriesService = ETSS.ExperimentTimeSeriesService;
  }
  return { TokenPool, StrategyEngine, PortfolioManager, RoundSummary, ExperimentTimeSeriesService };
}

class AbstractTradingEngine extends ITradingEngine {
  /**
   * 构造函数
   * @param {Object} config - 配置对象
   * @param {string} config.id - 引擎ID
   * @param {string} config.name - 引擎名称
   * @param {string} config.mode - 交易模式 (TradingMode.LIVE/VIRTUAL/BACKTEST)
   * @param {string} config.blockchain - 区块链类型
   */
  constructor(config = {}) {
    super();

    // 基本属性
    this._id = config.id || `engine_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this._name = config.name || 'AbstractTradingEngine';
    this._mode = config.mode || TradingMode.VIRTUAL;
    this._blockchain = config.blockchain || 'bsc';
    this._status = EngineStatus.STOPPED;

    // 核心组件（延迟初始化）
    this._tokenPool = null;
    this._strategyEngine = null;
    this._portfolioManager = null;
    this._roundSummary = null;
    this._timeSeriesService = null;
    this._logger = null;

    // 实验相关
    this._experiment = null;
    this._experimentId = null;
    this._portfolioId = null;

    // 运行状态
    this._loopCount = 0;
    this._isStopped = true;

    // 配置
    this._config = config;
  }

  // ==================== Getter 方法 ====================

  /** @type {string} */
  get id() {
    return this._id;
  }

  /** @type {string} */
  get name() {
    return this._name;
  }

  /** @type {string} */
  get mode() {
    return this._mode;
  }

  /** @type {string} */
  get status() {
    return this._status;
  }

  /** @type {Experiment} */
  get experiment() {
    return this._experiment;
  }

  /** @type {number} */
  get loopCount() {
    return this._loopCount;
  }

  /** @type {boolean} */
  get isStopped() {
    return this._isStopped;
  }

  // ==================== 生命周期方法 ====================

  /**
   * 初始化引擎
   * @param {import('../entities/Experiment').Experiment|string} experimentOrId - 实验实体或ID
   * @returns {Promise<void>}
   */
  async initialize(experimentOrId) {
    getLazyModules();

    // 加载实验
    if (typeof experimentOrId === 'string') {
      const supabase = dbManager.getClient();
      const { data, error } = await supabase
        .from('experiments')
        .select('*')
        .eq('id', experimentOrId)
        .single();

      if (error || !data) {
        throw new Error(`实验加载失败: ${error?.message || '未找到实验'}`);
      }

      this._experiment = new Experiment(data);
    } else {
      this._experiment = experimentOrId;
    }

    // 调试：输出 config 内容
    console.log(`🔍 实验 config 内容:`, JSON.stringify(this._experiment.config, null, 2));

    this._experimentId = this._experiment.id;
    this._portfolioId = `portfolio_${this._experimentId}`;
    this._blockchain = this._experiment.blockchain || 'bsc';

    // 初始化日志记录器
    this._logger = new Logger(this._experimentId);
    await this._logger.initialize();

    // 初始化核心组件
    await this._initializeComponents();

    // 初始化数据源（子类实现）
    await this._initializeDataSources();

    // 设置引擎状态
    this._status = EngineStatus.STOPPED;
    this._isStopped = true;

    this._logger.info(`引擎初始化完成`, {
      engine: this._name,
      mode: this._mode,
      blockchain: this._blockchain
    });
  }

  /**
   * 初始化核心组件
   * @private
   * @returns {Promise<void>}
   */
  async _initializeComponents() {
    const { TokenPool, StrategyEngine, PortfolioManager, RoundSummary, ExperimentTimeSeriesService } = getLazyModules();

    // TokenPool - 代币池管理
    this._tokenPool = new TokenPool({
      blockchain: this._blockchain
    });
    await this._tokenPool.initialize();

    // StrategyEngine - 策略引擎（由子类在各自的方法中初始化）
    // 留空，子类会覆盖或在 _initializeDataSources 中初始化

    // PortfolioManager - 投资组合管理
    this._portfolioManager = new PortfolioManager();
    await this._portfolioManager.initialize();

    // 创建实验投资组合
    const initialBalance = this._experiment.initial_capital || 10;
    const portfolioConfig = {
      id: this._portfolioId,
      blockchain: this._blockchain,
      initialCapital: initialBalance
    };
    this._portfolioId = await this._portfolioManager.createPortfolio(
      initialBalance,
      portfolioConfig
    );

    // RoundSummary - 轮次总结
    this._roundSummary = new RoundSummary(this._experimentId, this._logger, this._blockchain);

    // ExperimentTimeSeriesService - 时序数据服务
    if (this._shouldRecordTimeSeries()) {
      this._timeSeriesService = new ExperimentTimeSeriesService();
    }
  }

  /**
   * 启动引擎
   * @returns {Promise<void>}
   */
  async start() {
    if (!this._experiment) {
      throw new Error('引擎未初始化，请先调用 initialize()');
    }

    if (this._status === EngineStatus.RUNNING) {
      this._logger.warn('引擎已在运行中');
      return;
    }

    this._status = EngineStatus.RUNNING;
    this._isStopped = false;

    // 更新实验状态
    await this._updateExperimentStatus('running');

    this._logger.info('引擎启动', { mode: this._mode });

    // 运行主循环（子类实现）
    await this._runMainLoop();
  }

  /**
   * 停止引擎
   * @returns {Promise<void>}
   */
  async stop() {
    if (this._isStopped) {
      return;
    }

    this._isStopped = true;
    this._status = EngineStatus.STOPPED;

    this._logger.info('引擎停止', {
      loopCount: this._loopCount,
      totalTrades: this._roundSummary ? this._roundSummary.totalSignals : 0
    });

    // 创建最终快照
    await this._createPortfolioSnapshot();

    // 更新实验状态
    await this._updateExperimentStatus('stopped');
  }

  // ==================== 抽象方法（子类必须实现）====================

  /**
   * 初始化数据源
   * @abstract
   * @protected
   * @returns {Promise<void>}
   */
  async _initializeDataSources() {
    throw new Error('_initializeDataSources() 必须由子类实现');
  }

  /**
   * 运行主循环
   * @abstract
   * @protected
   * @returns {Promise<void>}
   */
  async _runMainLoop() {
    throw new Error('_runMainLoop() 必须由子类实现');
  }

  /**
   * 同步持仓数据
   * @abstract
   * @protected
   * @returns {Promise<void>}
   */
  async _syncHoldings() {
    throw new Error('_syncHoldings() 必须由子类实现');
  }

  /**
   * 执行买入
   * @abstract
   * @protected
   * @param {Object} signal - 交易信号
   * @param {string} signalId - 信号ID
   * @param {Object} metadata - 元数据
   * @returns {Promise<Object>} 交易结果
   */
  async _executeBuy(signal, signalId, metadata) {
    throw new Error('_executeBuy() 必须由子类实现');
  }

  /**
   * 执行卖出
   * @abstract
   * @protected
   * @param {Object} signal - 交易信号
   * @param {string} signalId - 信号ID
   * @param {Object} metadata - 元数据
   * @returns {Promise<Object>} 交易结果
   */
  async _executeSell(signal, signalId, metadata) {
    throw new Error('_executeSell() 必须由子类实现');
  }

  /**
   * 是否记录时序数据
   * @abstract
   * @protected
   * @returns {boolean}
   */
  _shouldRecordTimeSeries() {
    throw new Error('_shouldRecordTimeSeries() 必须由子类实现');
  }

  // ==================== 策略构建方法（共同逻辑）====================

  /**
   * 构建策略配置
   * @protected
   * @returns {Object} 策略配置
   */
  _buildStrategyConfig() {
    // 策略配置可能在 config.strategiesConfig 或直接在 experiment 上
    const strategiesConfig = this._experiment.config?.strategiesConfig || this._experiment.strategiesConfig;
    if (strategiesConfig && Object.keys(strategiesConfig).length > 0) {
      return strategiesConfig;
    }

    // 使用默认策略配置
    return this._buildDefaultStrategies();
  }

  /**
   * 从配置构建策略
   * @protected
   * @param {Object} strategiesConfig - 策略配置对象
   * @returns {Array} 策略数组
   */
  _buildStrategiesFromConfig(strategiesConfig) {
    const strategies = [];

    for (const [strategyName, config] of Object.entries(strategiesConfig)) {
      const strategy = this._strategyEngine.getStrategy(strategyName);
      if (strategy) {
        strategies.push({
          name: strategyName,
          strategy,
          config: config || {},
          enabled: config.enabled !== false
        });
      }
    }

    return strategies;
  }

  /**
   * 构建默认策略配置
   * @protected
   * @returns {Object} 默认策略配置
   */
  _buildDefaultStrategies() {
    return {
      momentum: {
        enabled: true,
        params: {
          buyThreshold: 0.3,
          sellThreshold: -0.2
        }
      },
      liquidity: {
        enabled: true,
        params: {
          minLiquidity: 10000,
          minLiquidityChange: 0.5
        }
      }
    };
  }

  // ==================== 信号处理方法（共同逻辑）====================

  /**
   * 处理策略信号
   * @param {Object} signal - 策略信号
   * @param {string} signal.tokenAddress - 代币地址
   * @param {string} signal.symbol - 代币符号
   * @param {string} signal.action - 动作 (buy/sell)
   * @param {number} [signal.confidence] - 置信度
   * @param {string} [signal.reason] - 原因
   * @param {Object} [signal.metadata] - 元数据
   * @returns {Promise<Object>} 处理结果
   */
  async processSignal(signal) {
    if (!this._experiment) {
      throw new Error('引擎未初始化');
    }

    const { TradeSignal } = require('../entities');

    // 检查引擎状态
    if (this._isStopped) {
      return { success: false, message: '引擎已停止' };
    }

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
      metadata: signalMetadata
    });

    // 保存信号到数据库
    const signalId = await tradeSignal.save();
    this._logger.info('信号已保存', {
      signalId,
      action: signal.action,
      symbol: signal.symbol,
      tokenAddress: signal.tokenAddress
    });

    // 执行交易
    let result;
    const metadata = {
      signalId,
      loopCount: this._loopCount,
      timestamp: new Date().toISOString()
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
      this._logger.error('信号执行失败', {
        signalId,
        error: error.message,
        stack: error.stack
      });

      await this._updateSignalStatus(signalId, 'failed', {
        error: error.message
      });

      result = { success: false, message: error.message };
    }

    return result;
  }

  /**
   * 更新信号状态
   * @private
   * @param {string} signalId - 信号ID
   * @param {string} status - 新状态 ('executed' | 'failed')
   * @param {Object} result - 执行结果
   * @returns {Promise<void>}
   */
  async _updateSignalStatus(signalId, status, result) {
    const supabase = dbManager.getClient();

    // 先获取当前信号数据（包括 metadata）
    const { data: currentSignal, error: fetchError } = await supabase
      .from('strategy_signals')
      .select('metadata')
      .eq('id', signalId)
      .single();

    if (fetchError) {
      this._logger.error('获取信号数据失败', { signalId, error: fetchError.message });
      return;
    }

    // 准备更新数据
    const updateData = {
      executed: status === 'executed'
    };

    if (result.tradeId) {
      updateData.trade_id = result.tradeId;
    }

    if (result.message) {
      updateData.execution_reason = result.message;
    }

    // 更新 metadata.tradeResult
    const newMetadata = { ...(currentSignal.metadata || {}) };
    if (result.trade || result.success !== undefined) {
      newMetadata.tradeResult = {
        success: result.success || false,
        trade: result.trade || null
      };
    }
    updateData.metadata = newMetadata;

    const { error } = await supabase
      .from('strategy_signals')
      .update(updateData)
      .eq('id', signalId);

    if (error) {
      this._logger.error('更新信号状态失败', { signalId, error: error.message });
    }
  }

  // ==================== 交易执行方法（共同逻辑）====================

  /**
   * 执行交易（统一入口）
   * @param {Object} tradeRequest - 交易请求
   * @param {string} tradeRequest.tokenAddress - 代币地址
   * @param {string} tradeRequest.symbol - 代币符号
   * @param {string} tradeRequest.direction - 交易方向 (buy/sell)
   * @param {string|number} tradeRequest.amount - 数量
   * @param {string|number} [tradeRequest.price] - 价格
   * @param {Object} [tradeRequest.metadata] - 元数据
   * @returns {Promise<Object>} 交易结果
   */
  async executeTrade(tradeRequest) {
    const { Trade } = require('../entities');

    // 获取当前持仓
    const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);
    if (!portfolio) {
      throw new Error('投资组合不存在');
    }

    const position = portfolio.positions.get(tradeRequest.tokenAddress.toLowerCase());
    const currentPrice = tradeRequest.price || (position ? position.currentPrice : 0);

    // 创建交易实体 (使用 input/output 模式)
    const isBuy = tradeRequest.direction.toLowerCase() === 'buy';
    const tokenAmount = parseFloat(tradeRequest.amount);
    const price = parseFloat(currentPrice);

    // 计算正确的 input/output 金额
    // 买入: input = BNB金额, output = 代币数量
    // 卖出: input = 代币数量, output = BNB金额
    const inputAmount = isBuy ? (tokenAmount * price) : tokenAmount;
    const outputAmount = isBuy ? tokenAmount : (tokenAmount * price);

    const trade = new Trade({
      experimentId: this._experimentId,
      signalId: tradeRequest.signalId || null,
      tokenAddress: tradeRequest.tokenAddress,
      tokenSymbol: tradeRequest.symbol,
      direction: tradeRequest.direction.toLowerCase(),
      // 买入: BNB -> 代币, 卖出: 代币 -> BNB
      inputCurrency: isBuy ? 'BNB' : tradeRequest.symbol,
      outputCurrency: isBuy ? tradeRequest.symbol : 'BNB',
      inputAmount: String(inputAmount),
      outputAmount: String(outputAmount),
      unitPrice: String(price),
      txHash: tradeRequest.txHash || null,
      metadata: tradeRequest.metadata || {}
    });

    // 调用投资组合管理器执行交易
    const result = await this._portfolioManager.executeTrade(
      this._portfolioId,
      tradeRequest.tokenAddress,
      tradeRequest.direction.toLowerCase(),
      tradeRequest.amount,
      currentPrice
    );

    if (result.success) {
      // 标记交易为成功
      trade.markAsSuccess();

      // 保存交易记录
      await trade.save();
      this._logger.info('交易已执行', {
        tradeId: trade.id,
        direction: tradeRequest.direction,
        symbol: tradeRequest.symbol,
        amount: tradeRequest.amount,
        price: currentPrice
      });

      return {
        success: true,
        tradeId: trade.id,
        trade: trade,
        ...result
      };
    } else {
      // 标记交易为失败
      trade.markAsFailed(result.message);

      this._logger.error('交易执行失败', {
        symbol: tradeRequest.symbol,
        error: result.message
      });

      return {
        success: false,
        message: result.message
      };
    }
  }

  // ==================== 辅助方法 ====================

  /**
   * 获取原生货币
   * @protected
   * @returns {string} 原生货币符号
   */
  _getNativeCurrency() {
    const tokenConfig = BlockchainConfig.getNativeToken(this._blockchain);
    return tokenConfig?.symbol || 'BNB';
  }

  /**
   * 获取指标
   * @returns {Object} 指标对象
   */
  getMetrics() {
    const portfolio = this._portfolioManager?.getPortfolio(this._portfolioId);

    return {
      engine: {
        id: this._id,
        name: this._name,
        mode: this._mode,
        status: this._status,
        loopCount: this._loopCount,
        blockchain: this._blockchain
      },
      portfolio: portfolio ? {
        totalValue: portfolio.totalValue,
        availableBalance: portfolio.availableBalance,
        totalInvested: portfolio.totalInvested,
        totalPnL: portfolio.totalPnL,
        totalPnLPercentage: portfolio.totalPnLPercentage,
        positionCount: portfolio.positions.size
      } : null,
      summary: this._roundSummary ? {
        totalSignals: this._roundSummary.totalSignals,
        buySignals: this._roundSummary.buySignals,
        sellSignals: this._roundSummary.sellSignals,
        executedTrades: this._roundSummary.executedTrades
      } : null
    };
  }

  /**
   * 获取状态
   * @returns {string} 引擎状态
   */
  getStatus() {
    return this._status;
  }

  /**
   * 创建投资组合快照
   * @protected
   * @returns {Promise<void>}
   */
  async _createPortfolioSnapshot() {
    const portfolio = this._portfolioManager?.getPortfolio(this._portfolioId);
    if (!portfolio) {
      return;
    }

    const supabase = dbManager.getClient();

    const snapshot = {
      experiment_id: this._experimentId,
      snapshot_time: new Date().toISOString(),
      total_value: String(portfolio.totalValue || 0),
      total_value_change: '0',
      total_value_change_percent: '0',
      cash_balance: String(portfolio.cashBalance || portfolio.availableBalance || 0),
      cash_native_balance: String(portfolio.cashBalance || portfolio.availableBalance || 0),
      total_portfolio_value_native: String(portfolio.totalValue || 0),
      token_positions: '[]',
      positions_count: portfolio.positions ? portfolio.positions.size : 0,
      metadata: JSON.stringify({
        loop_count: this._loopCount,
        availableBalance: String(portfolio.availableBalance || 0),
        totalInvested: String(portfolio.totalInvested || 0),
        totalPnL: String(portfolio.totalPnL || 0),
        timestamp: new Date().toISOString()
      })
    };

    const { error } = await supabase
      .from('portfolio_snapshots')
      .insert([snapshot]);

    if (error) {
      this._logger.error('创建投资组合快照失败', { error: error.message });
    } else {
      this._logger.info('投资组合快照已创建', {
        totalValue: portfolio.totalValue,
        totalPnL: portfolio.totalPnL
      });
    }
  }

  /**
   * 更新实验状态
   * @private
   * @param {string} status - 新状态
   * @returns {Promise<void>}
   */
  async _updateExperimentStatus(status) {
    const supabase = dbManager.getClient();

    const updateData = {
      status,
      updated_at: new Date().toISOString()
    };

    if (status === 'stopped' || status === 'completed' || status === 'error') {
      updateData.stopped_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from('experiments')
      .update(updateData)
      .eq('id', this._experimentId);

    if (error) {
      this._logger.error('更新实验状态失败', { status, error: error.message });
    }
  }

  /**
   * 计算买入数量
   * @protected
   * @param {Object} signal - 交易信号
   * @returns {string|number} 买入数量
   */
  _calculateBuyAmount(signal) {
    const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);

    // 默认使用可用余额的 20%
    const buyPercentage = signal.buyPercentage || 0.2;
    const amount = portfolio.availableBalance * buyPercentage;

    return amount;
  }

  /**
   * 获取持仓
   * @protected
   * @param {string} tokenAddress - 代币地址
   * @returns {Object|null} 持仓信息
   */
  _getHolding(tokenAddress) {
    const portfolio = this._portfolioManager?.getPortfolio(this._portfolioId);
    if (!portfolio) {
      return null;
    }

    return portfolio.positions.get(tokenAddress.toLowerCase()) || null;
  }

  /**
   * 获取所有持仓
   * @protected
   * @returns {Array} 持仓数组
   */
  _getAllHoldings() {
    const portfolio = this._portfolioManager?.getPortfolio(this._portfolioId);
    if (!portfolio) {
      return [];
    }

    return Array.from(portfolio.positions.values());
  }

  /**
   * 构建投资组合摘要
   * @protected
   * @returns {Object} 投资组合摘要
   */
  _buildPortfolioSummary() {
    const portfolio = this._portfolioManager?.getPortfolio(this._portfolioId);
    if (!portfolio) {
      return {};
    }

    // 兼容处理：PortfolioManager 使用 cashBalance，但某些地方可能期望 availableBalance
    const cashBalance = portfolio.cashBalance || portfolio.availableBalance || 0;

    return {
      totalValue: portfolio.totalValue,
      cashBalance: cashBalance,
      availableBalance: cashBalance, // 兼容性字段
      totalInvested: portfolio.totalInvested || 0,
      totalPnL: portfolio.totalPnL || 0,
      totalPnLPercentage: portfolio.totalPnLPercentage || 0,
      positionCount: portfolio.positions.size,
      positions: Array.from(portfolio.positions.values()).map(p => ({
        tokenAddress: p.tokenAddress,
        symbol: p.symbol,
        amount: p.amount,
        averagePurchasePrice: p.averagePurchasePrice,
        currentPrice: p.currentPrice,
        value: p.value,
        pnl: p.pnl,
        pnlPercentage: p.pnlPercentage
      }))
    };
  }
}

module.exports = { AbstractTradingEngine };
