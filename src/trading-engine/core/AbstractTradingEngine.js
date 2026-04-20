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
const TelegramNotifier = require('../../services/TelegramNotifier');
const ExperimentEventService = require('../../web/services/ExperimentEventService');

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

    // Telegram 通知器（延迟初始化，需要实验配置）
    this._telegramNotifier = null;

    // 统计相关
    this._statsInterval = null;      // 统计间隔（毫秒）
    this._lastStatsTime = null;      // 上次统计时间
    this._statsEnabled = true;       // 是否启用定期统计

    // Per-token 买入通知追踪
    // key: tokenAddress(lowercase), value: { buySignalCount }
    this._tokenBuyNotificationState = new Map();

    // 事件写入服务
    this._eventService = new ExperimentEventService();
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
    this._logger = new Logger({ experimentId: this._experimentId });
    await this._logger.initialize();

    // 通知子类更新组件的 logger（如果有）
    if (typeof this._updateComponentLoggers === 'function') {
      await this._updateComponentLoggers();
    }

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

    // TelegramNotifier - 电报通知（根据实验配置初始化）
    await this._initializeTelegramNotifier();

    // 统计配置
    await this._initializeStatsConfig();

    // 创建实验投资组合
    // 优先使用子类设置的 initialBalance，再回退到实验配置中的 initial_capital
    const initialBalance = this.initialBalance || this._experiment.initial_capital || 10;
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
   * 初始化 Telegram 通知器
   * @private
   * @returns {Promise<void>}
   */
  async _initializeTelegramNotifier() {
    if (!this._experiment || !this._experiment.config) {
      // 没有实验配置，不初始化通知器
      return;
    }

    // 获取通知配置（从实验配置的 strategiesConfig 中读取）
    const strategiesConfig = this._experiment.config.strategiesConfig || {};
    const telegramConfig = strategiesConfig.telegramNotifications || {};

    // 获取引擎类型的默认配置
    const mode = this._mode;
    if (telegramConfig.enabled === undefined) {
      // 如果没有显式设置，根据引擎类型设置默认值
      if (mode === TradingMode.BACKTEST) {
        telegramConfig.enabled = false; // 回测默认关闭
      } else {
        telegramConfig.enabled = true; // 虚拟和实盘默认开启
      }
    }

    // 创建通知器实例
    this._telegramNotifier = new TelegramNotifier(telegramConfig);
    this._telegramNotifier.setDbManager(dbManager);

    if (telegramConfig.enabled) {
      this._logger.info('Telegram 通知已启用');
    } else {
      this._logger.debug('Telegram 通知已禁用');
    }
  }

  /**
   * 初始化统计配置
   * @private
   * @returns {Promise<void>}
   */
  async _initializeStatsConfig() {
    if (!this._experiment || !this._experiment.config) {
      // 没有实验配置，使用默认值
      this._statsInterval = 30 * 60 * 1000; // 默认30分钟
      this._statsEnabled = true;
      return;
    }

    // 从实验配置的 strategiesConfig 中读取统计配置
    const strategiesConfig = this._experiment.config.strategiesConfig || {};
    const statsConfig = strategiesConfig.stats || {};

    this._statsInterval = statsConfig.interval || 30 * 60 * 1000; // 默认30分钟
    this._statsEnabled = statsConfig.enabled !== false; // 默认启用

    this._logger.info('统计配置已初始化', {
      interval: `${this._statsInterval / 60000}分钟`,
      enabled: this._statsEnabled
    });
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
   * @throws {Error} 如果实验没有配置交易策略
   */
  _buildStrategyConfig() {
    // 策略配置可能在 config.strategiesConfig 或直接在 experiment 上
    const strategiesConfig = this._experiment.config?.strategiesConfig || this._experiment.strategiesConfig;
    if (strategiesConfig && Object.keys(strategiesConfig).length > 0) {
      return strategiesConfig;
    }

    // 不允许使用硬编码策略，必须明确配置
    throw new Error(
      `实验 ${this._experimentId} 没有配置交易策略。` +
      `请在实验配置中设置 config.strategiesConfig，` +
      `包含 buyStrategies 和 sellStrategies 数组。`
    );
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
    // 调试：记录 processSignal 被调用
    console.log(`🔔 processSignal 被调用: ${signal.symbol} ${signal.action} (${signal.tokenAddress})`);

    if (!this._experiment) {
      console.error(`❌ processSignal: this._experiment 为 null`);
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
      chain: this._blockchain,
      metadata: signalMetadata,
      createdAt: signal.timestamp || new Date()  // 使用信号中的时间戳（回测使用历史时间）
    });

    // 保存信号到数据库
    const signalId = await tradeSignal.save();
    console.log(`✅ 信号已保存: ${signal.symbol} ${signal.action}, signalId=${signalId}`);
    this._logger.info('信号已保存', {
      signalId,
      action: signal.action,
      symbol: signal.symbol,
      tokenAddress: signal.tokenAddress
    });

    // 执行交易
    let result = { success: false, message: '交易未执行' }; // 初始化 result
    // 使用 signal 中的时间戳（如果有），否则使用当前时间
    // 回测引擎会传入历史数据时间，虚拟引擎使用当前时间
    const signalTime = signal.timestamp || new Date();
    const metadata = {
      signalId,
      loopCount: this._loopCount,
      timestamp: signalTime instanceof Date ? signalTime.toISOString() : signalTime,
      factors: signal.factors || null  // 保存 factors 到交易 metadata
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
        stack: error.stack,
        errorName: error.name,
        errorCause: error.cause
      });

      // 确保 result 有正确的值
      result = {
        success: false,
        message: error.message || '未知错误',
        reason: error.message || '未知错误',
        error: error.message || '未知错误'
      };

      try {
        await this._updateSignalStatus(signalId, 'failed', result);
      } catch (updateError) {
        this._logger.error('更新信号状态失败', {
          signalId,
          error: updateError.message,
          stack: updateError.stack
        });
      }
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

    // 确保 result 是一个对象
    if (!result || typeof result !== 'object') {
      result = { success: false, message: 'Invalid result object' };
    }

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

    // 合并 metadata 并添加 execution_reason
    const newMetadata = { ...(currentSignal.metadata || {}) };

    // 将执行原因记录到 metadata 中（安全访问）
    if (result && result.message) {
      newMetadata.execution_reason = result.message;
    }
    if (result && result.reason) {
      newMetadata.execution_reason = result.reason;
    }
    if (result && result.error) {
      newMetadata.execution_error = result.error;
    }
    // 添加执行时间戳
    newMetadata.executed_at = new Date().toISOString();
    newMetadata.execution_status = status;

    // 交易结果（安全访问）
    if (result && (result.trade || result.success !== undefined)) {
      newMetadata.tradeResult = {
        success: result.success ?? false,
        tradeId: result.tradeId || null,
        trade: (result.trade && typeof result.trade === 'object') ? {
          id: result.trade.id || null,
          tokenSymbol: result.trade.tokenSymbol || 'UNKNOWN',
          tradeDirection: result.trade.tradeDirection || 'unknown',
          inputAmount: result.trade.inputAmount || '0',
          outputAmount: result.trade.outputAmount || '0',
          unitPrice: result.trade.unitPrice || '0',
          success: result.trade.success ?? false
        } : null
      };
    }

    updateData.metadata = newMetadata;

    const { error } = await supabase
      .from('strategy_signals')
      .update(updateData)
      .eq('id', signalId);

    if (error) {
      this._logger.error('更新信号状态失败', { signalId, error: error.message });
      return;
    }

    // 数据库更新成功后，发送 Telegram 通知（带过滤逻辑）
    await this._sendSignalNotificationWithFilter(signalId, newMetadata);
  }

  /**
   * 带过滤条件的信号通知
   * - 买入信号：仅在该代币第一个被执行的信号时通知，或第3个信号（如果均未执行）
   * - 卖出信号：每次都通知
   * @private
   * @param {string} signalId - 信号ID
   * @param {Object} metadata - 信号元数据
   * @returns {Promise<void>}
   */
  async _sendSignalNotificationWithFilter(signalId, metadata) {
    try {
      // 获取完整信号数据
      const supabase = dbManager.getClient();
      const { data: signal, error } = await supabase
        .from('strategy_signals')
        .select('*')
        .eq('id', signalId)
        .single();

      if (error || !signal) {
        this._logger.warn('获取信号数据失败，跳过通知', { signalId, error: error?.message });
        return;
      }

      // === 通知过滤逻辑 ===
      if (signal.action === 'buy') {
        const isExecuted = metadata.execution_status === 'executed';
        const shouldNotify = await this._shouldSendBuyNotification(signal, isExecuted);
        if (!shouldNotify) {
          this._logger.debug('买入信号跳过通知', {
            signalId,
            tokenAddress: signal.token_address
          });
          return;
        }
      }
      // 卖出信号：每次都通知，不添加过滤

      // 构建实验信息
      const experimentInfo = {
        id: this._experimentId,
        mode: this._mode,
        name: this._experiment?.experimentName || this._experiment?.config?.name || null
      };

      // 写入事件表
      await this._eventService.createEvent(signal, experimentInfo);

    } catch (notifyError) {
      this._logger.warn('发送信号通知失败', {
        signalId,
        error: notifyError.message
      });
    }
  }

  /**
   * 检查买入信号是否应触发通知
   * 规则：第一个被执行的买入信号触发，若无执行则第3个买入信号触发
   * @private
   * @param {Object} signal - 完整信号数据
   * @param {boolean} isExecuted - 信号是否执行成功
   * @returns {Promise<boolean>} 是否应发送通知
   */
  async _shouldSendBuyNotification(signal, isExecuted) {
    const tokenAddress = (signal.token_address || '').toLowerCase();
    if (!tokenAddress) return false;

    // 从内存状态获取，没有则初始化
    let state = this._tokenBuyNotificationState.get(tokenAddress);
    if (!state) {
      state = await this._initTokenNotificationState(tokenAddress, signal.experiment_id);
    }

    // 第3个信号之后不再发送
    if (state.buySignalCount >= 3) {
      return false;
    }

    // 递增买入信号计数
    state.buySignalCount += 1;

    // 只有第1和第3个买入信号触发事件（无论执行与否）
    if (state.buySignalCount === 1 || state.buySignalCount === 3) {
      return true;
    }

    return false;
  }

  /**
   * 从数据库初始化 token 通知状态（处理引擎重启的情况）
   * @private
   * @param {string} tokenAddress - 代币地址（小写）
   * @param {string} experimentId - 实验ID
   * @returns {Promise<Object>} 通知状态对象
   */
  async _initTokenNotificationState(tokenAddress, experimentId) {
    const state = {
      buySignalCount: 0
    };

    this._tokenBuyNotificationState.set(tokenAddress, state);
    return state;
  }

  /**
   * 计算并保存统计数据
   * @private
   * @returns {Promise<void>}
   */
  async _calculateAndSaveStats() {
    if (!this._statsEnabled) return;

    try {
      const { ExperimentStatsService } = require('../../web/services/ExperimentStatsService');
      const statsService = new ExperimentStatsService();

      // 计算统计数据
      const stats = await statsService.calculateExperimentStats(this._experimentId);

      // 保存到数据库
      const supabase = dbManager.getClient();
      const { error } = await supabase
        .from('experiments')
        .update({ stats })
        .eq('id', this._experimentId);

      if (error) {
        throw new Error(`保存统计数据失败: ${error.message}`);
      }

      this._logger.info(this._experimentId, 'Stats', '统计数据已更新', {
        tokenCount: stats.tokenCount,
        totalReturn: stats.totalReturn,
        winRate: stats.winRate
      });

      // 发送电报通知（如果启用）
      // await this._sendStatsNotification(stats); // 暂时关闭统计报告通知

    } catch (error) {
      this._logger.error('计算统计数据失败', { error: error.message });
    }
  }

  /**
   * 发送统计数据通知
   * @private
   * @param {Object} stats - 统计数据
   * @returns {Promise<void>}
   */
  async _sendStatsNotification(stats) {
    if (!this._telegramNotifier) return;

    try {
      // 获取实验名称，提供多个后备选项
      const experimentName = this._experiment?.experimentName ||
                             this._experiment?.config?.name ||
                             `实验 ${this._experimentId?.substring(0, 8)}`;

      await this._telegramNotifier.sendStatsNotification(
        this._experimentId,
        experimentName,
        stats,
        this._mode
      );
    } catch (error) {
      this._logger.warn('发送统计通知失败', { error: error.message });
    }
  }

  /**
   * 检查是否需要统计（虚拟/实盘用）
   * @protected
   * @returns {Promise<void>}
   */
  async _checkAndCalculateStats() {
    if (!this._statsEnabled || !this._statsInterval) return;

    const now = Date.now();
    if (!this._lastStatsTime || now - this._lastStatsTime >= this._statsInterval) {
      await this._calculateAndSaveStats();
      this._lastStatsTime = now;
    }
  }

  /**
   * 检查是否需要统计（回测用）
   * @protected
   * @param {number} virtualTime - 当前虚拟时间戳
   * @returns {Promise<void>}
   */
  async _checkAndCalculateStatsForBacktest(virtualTime) {
    if (!this._statsEnabled || !this._statsInterval) return;

    if (!this._lastStatsTime || virtualTime - this._lastStatsTime >= this._statsInterval) {
      await this._calculateAndSaveStats();
      this._lastStatsTime = virtualTime;
    }
  }

  /**
   * 计算代币涨幅分析
   * @protected
   * @param {string} tokenAddress - 代币地址
   * @returns {Promise<Object|null>} 分析结果
   */
  async _calculateTokenAnalysis(tokenAddress) {
    try {
      const { TokenAnalysisService } = require('../../web/services/TokenAnalysisService');
      const analysisService = new TokenAnalysisService();

      const result = await analysisService.analyzeToken(this._experimentId, tokenAddress);

      // TokenAnalysisService.analyzeToken 返回 { success, data: { max_change_percent, ... } }
      // 我们需要提取 data 部分，以便正确保存到数据库
      const analysisData = result.success ? result.data : null;

      if (analysisData) {
        this._logger.info(this._experimentId, 'TokenAnalysis', '代币涨幅分析完成', {
          tokenAddress,
          maxChangePercent: analysisData.max_change_percent,
          finalChangePercent: analysisData.final_change_percent,
          dataPoints: analysisData.data_points
        });

        return analysisData;
      } else {
        this._logger.warn(this._experimentId, 'TokenAnalysis', '代币涨幅分析失败', {
          tokenAddress,
          reason: result.reason || 'unknown'
        });
        return null;
      }
    } catch (error) {
      this._logger.error('计算代币涨幅分析失败', {
        tokenAddress,
        error: error.message
      });
      return null;
    }
  }

  /**
   * 保存代币涨幅分析结果
   * @protected
   * @param {string} tokenAddress - 代币地址
   * @param {Object} analysisResult - 分析结果
   * @returns {Promise<boolean>} 是否保存成功
   */
  async _saveTokenAnalysis(tokenAddress, analysisResult) {
    try {
      const supabase = dbManager.getClient();

      const { error } = await supabase
        .from('experiment_tokens')
        .update({ analysis_results: analysisResult })
        .eq('token_address', tokenAddress)
        .eq('experiment_id', this._experimentId);

      if (error) {
        throw new Error(`保存分析结果失败: ${error.message}`);
      }

      return true;
    } catch (error) {
      this._logger.error('保存代币涨幅分析失败', {
        tokenAddress,
        error: error.message
      });
      return false;
    }
  }

  /**
   * 批量计算代币涨幅分析
   * @protected
   * @param {Array<string>} tokenAddresses - 代币地址列表
   * @returns {Promise<void>}
   */
  async _calculateTokensAnalysis(tokenAddresses) {
    if (!tokenAddresses || tokenAddresses.length === 0) {
      return;
    }

    this._logger.info(this._experimentId, 'TokenAnalysis',
      `开始计算 ${tokenAddresses.length} 个代币的涨幅分析`);

    // 逐个计算（避免并发压力）
    for (const tokenAddress of tokenAddresses) {
      const result = await this._calculateTokenAnalysis(tokenAddress);
      if (result) {
        await this._saveTokenAnalysis(tokenAddress, result);
      }
      // 短暂延迟，避免请求过快
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this._logger.info(this._experimentId, 'TokenAnalysis', '涨幅分析计算完成');
  }

  /**
   * 更新信号元数据（用于添加预检查因子等）
   * @private
   * @param {string} signalId - 信号ID
   * @param {Object} additionalMetadata - 要添加的元数据
   * @param {Object} directFields - 直接更新的表字段（非metadata），如 twitter_search_result, twitter_search_duration
   * @returns {Promise<void>}
   */
  async _updateSignalMetadata(signalId, additionalMetadata, directFields = null) {
    const supabase = dbManager.getClient();

    if (!additionalMetadata || typeof additionalMetadata !== 'object') {
      this._logger.warn('无效的元数据对象', { signalId });
      return;
    }

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

    // 合并 metadata
    const newMetadata = { ...(currentSignal.metadata || {}), ...additionalMetadata };

    // 构建更新数据
    const updateData = { metadata: newMetadata };

    // 如果有直接字段需要更新，添加到更新数据中
    if (directFields && typeof directFields === 'object') {
      if (directFields.twitter_search_result !== undefined) {
        updateData.twitter_search_result = directFields.twitter_search_result;
      }
      if (directFields.twitter_search_duration !== undefined) {
        updateData.twitter_search_duration = directFields.twitter_search_duration;
      }
    }

    const { error } = await supabase
      .from('strategy_signals')
      .update(updateData)
      .eq('id', signalId);

    if (error) {
      this._logger.error('更新信号元数据失败', { signalId, error: error.message });
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
    let result;
    try {
      result = await this._portfolioManager.executeTrade(
        this._portfolioId,
        tradeRequest.tokenAddress,
        tradeRequest.direction.toLowerCase(),
        tradeRequest.amount,
        currentPrice
      );

      this.logger.info('PortfolioManager.executeTrade 返回', {
        success: result?.success,
        hasPortfolio: !!result?.portfolio,
        error: result?.error || result?.message || 'none'
      });
    } catch (pmError) {
      // PortfolioManager.executeTrade 抛出了异常
      this.logger.error('PortfolioManager.executeTrade 异常', {
        error: pmError.message,
        errorName: pmError.name,
        stack: pmError.stack,
        symbol: tradeRequest.symbol,
        tokenAddress: tradeRequest.tokenAddress,
        amount: tradeRequest.amount,
        price: currentPrice,
        errorCause: pmError.cause,
        pmErrorString: String(pmError)
      });

      // 标记交易为失败
      trade.markAsFailed(pmError.message || '交易执行异常');

      return {
        success: false,
        message: pmError.message || '交易执行异常',
        reason: pmError.message || '交易执行异常',
        error: pmError.message || '交易执行异常'
      };
    }

    // 检查 result 是否存在
    if (!result) {
      this.logger.error('PortfolioManager.executeTrade 返回 null/undefined');
      return {
        success: false,
        message: 'PortfolioManager.executeTrade 返回空值',
        error: 'PortfolioManager.executeTrade 返回空值'
      };
    }

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
        portfolio: result.portfolio  // 只提取 portfolio，不覆盖 trade
      };
    } else {
      // 标记交易为失败
      const failureReason = result.message || result.reason || result.error || '未知失败原因';
      trade.markAsFailed(failureReason);

      this._logger.error('交易执行失败', {
        symbol: tradeRequest.symbol,
        error: failureReason,
        resultKeys: result ? Object.keys(result) : 'result is null/undefined',
        resultSuccess: result?.success,
        hasMessage: !!result?.message,
        hasReason: !!result?.reason,
        hasError: !!result?.error
      });

      return {
        success: false,
        message: failureReason,
        reason: failureReason,
        error: failureReason
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

  // ==================== 叙事评级相关方法 ====================

  /**
   * 获取叙事评级（带轮询等待）- 抽象方法，由子类实现
   * @protected
   * @param {string} tokenAddress - 代币地址
   * @param {Object} options - 选项
   * @returns {Promise<number>} 叙事评级
   */
  async _getNarrativeRating(tokenAddress, options = {}) {
    throw new Error('_getNarrativeRating 必须由子类实现');
  }

  /**
   * 轮询获取叙事评级：直接查询 token_narrative 表，不依赖 narrative_analysis_tasks 状态
   * @protected
   * @param {string} experimentId - 实验ID（用于日志）
   * @param {string} tokenAddress - 代币地址
   * @param {Object} options - 选项
   * @param {number} options.maxWaitSeconds - 最大等待秒数（默认10秒）
   * @param {number} options.pollIntervalMs - 轮询间隔毫秒（默认2000ms）
   * @returns {Promise<number>} 叙事评级
   */
  async _pollNarrativeRating(experimentId, tokenAddress, options = {}) {
    const {
      maxWaitSeconds = 10,
      pollIntervalMs = 2000
    } = options;

    const maxAttempts = Math.ceil((maxWaitSeconds * 1000) / pollIntervalMs);

    // 叙事分析表使用小写地址存储
    const normalizedAddress = tokenAddress.toLowerCase();

    this._logger.info(experimentId, '_pollNarrativeRating',
      `开始轮询叙事评级 | token=${tokenAddress}, maxWait=${maxWaitSeconds}s, interval=${pollIntervalMs}ms`);

    const supabase = dbManager.getClient();

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // 直接查询 token_narrative 表获取结果
      const { data: narrative } = await supabase
        .from('token_narrative')
        .select('*')
        .eq('token_address', normalizedAddress)
        .maybeSingle();

      if (narrative) {
        // 通过 NarrativeAnalyzer 统一获取 rating，不直接操作列名
        const { NarrativeAnalyzer } = await import('../../narrative/analyzer/NarrativeAnalyzer.mjs');
        const llmAnalysis = NarrativeAnalyzer.buildLLMAnalysis(narrative);
        const rating = llmAnalysis?.summary?.numericRating ?? 0;
        this._logger.info(experimentId, '_pollNarrativeRating',
          `叙事评级获取成功 | token=${tokenAddress}, category=${llmAnalysis?.summary?.category}, rating=${rating}, attempt=${attempt + 1}/${maxAttempts}`);
        return rating;
      }

      // 未就绪，等待后重试
      if (attempt < maxAttempts - 1) {
        this._logger.debug(experimentId, '_pollNarrativeRating',
          `尝试 ${attempt + 1}/${maxAttempts}: 叙事数据未就绪, ${pollIntervalMs}ms 后重试`);
        await this._sleep(pollIntervalMs);
      } else {
        this._logger.warn(experimentId, '_pollNarrativeRating',
          `尝试 ${attempt + 1}/${maxAttempts}: 超时, 无叙事数据 | token=${tokenAddress}`);
      }
    }

    return 0;
  }



  /**
   * 睡眠指定毫秒数
   * @protected
   * @param {number} ms - 毫秒数
   * @returns {Promise<void>}
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 创建或更新叙事分析任务
   *
   * 逻辑：
   * 1. 如果不重新分析（reanalyze=false）：
   *    - 检查叙事结果是否已存在，存在则不创建任务（直接用缓存）
   * 2. 如果重新分析（reanalyze=true）：
   *    - 检查当前实验是否已创建过任务，避免重复创建
   * 3. 使用 INSERT 而不是 UPSERT，避免覆盖已完成任务的状态
   *
   * @protected
   * @param {Object} token - 代币对象
   * @param {number} satisfaction - 因子满足比例（0-100）
   * @returns {Promise<void>}
   */
  async _createOrUpdateNarrativeTask(token, satisfaction) {
    const supabase = dbManager.getClient();
    const reanalyze = this._narrativeReanalyze || false;

    // 叙事分析表使用小写地址存储
    const normalizedAddress = token.token.toLowerCase();

    // 1. 如果不重新分析，检查叙事结果是否已存在（使用小写地址）
    if (!reanalyze) {
      const { data: existingNarrative, error: queryError } = await supabase
        .from('token_narrative')
        .select('id, analyzed_at, experiment_id')
        .eq('token_address', normalizedAddress)
        .maybeSingle();

      if (!queryError && existingNarrative) {
        this._logger.info(this._experimentId, '_createOrUpdateNarrativeTask',
          `叙事结果已存在，不创建任务 | symbol=${token.symbol}, ` +
          `analyzed_at=${existingNarrative.analyzed_at}, source_experiment=${existingNarrative.experiment_id || 'N/A'}`);
        return; // 不创建任务，NarrativeAnalyzer 会直接使用缓存
      }
    }

    // 2. 检查当前实验是否已创建过任务（避免重复创建，使用小写地址）
    const { data: existingTask, error: taskQueryError } = await supabase
      .from('narrative_analysis_tasks')
      .select('id, status, priority')
      .eq('token_address', normalizedAddress)
      .eq('triggered_by_experiment_id', this._experimentId)
      .maybeSingle();

    if (!taskQueryError && existingTask) {
      // 任务已存在，如果是 pending 状态且新优先级更高，更新优先级
      const newPriority = Math.floor(satisfaction);
      if (existingTask.status === 'pending' && existingTask.priority < newPriority) {
        const { error: updateError } = await supabase
          .from('narrative_analysis_tasks')
          .update({
            priority: newPriority,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingTask.id);

        if (!updateError) {
          this._logger.debug(this._experimentId, '_createOrUpdateNarrativeTask',
            `任务优先级已更新 | symbol=${token.symbol}, oldPriority=${existingTask.priority}, newPriority=${newPriority}`);
        } else {
          this._logger.warn(this._experimentId, '_createOrUpdateNarrativeTask',
            `更新任务优先级失败 | symbol=${token.symbol}, error=${updateError.message}`);
        }
      } else {
        this._logger.debug(this._experimentId, '_createOrUpdateNarrativeTask',
          `任务已存在 | symbol=${token.symbol}, status=${existingTask.status}, priority=${existingTask.priority}, ` +
          `reanalyze=${reanalyze}, 满足度=${satisfaction.toFixed(0)}%`);
      }
      return;
    }

    // 3. 创建新任务（使用 INSERT 而不是 UPSERT，避免覆盖已完成任务的状态，使用小写地址）
    const { error: insertError } = await supabase
      .from('narrative_analysis_tasks')
      .insert({
        token_address: normalizedAddress,
        token_symbol: token.symbol,
        triggered_by_experiment_id: this._experimentId,
        priority: Math.floor(satisfaction),
        status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    if (insertError) {
      // 忽略唯一约束冲突（并发情况下可能多次尝试创建）
      if (insertError.code === '23505') {
        this._logger.debug(this._experimentId, '_createOrUpdateNarrativeTask',
          `任务已存在（并发） | symbol=${token.symbol}`);
      } else {
        this._logger.warn(this._experimentId, '_createOrUpdateNarrativeTask',
          `任务创建失败 | symbol=${token.symbol}, error=${insertError.message}`);
      }
    } else {
      this._logger.info(this._experimentId, '_createOrUpdateNarrativeTask',
        `任务已创建 | symbol=${token.symbol}, priority=${Math.floor(satisfaction)}, reanalyze=${reanalyze}`);
    }
  }
}

module.exports = { AbstractTradingEngine };
