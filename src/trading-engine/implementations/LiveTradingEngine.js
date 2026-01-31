/**
 * 实盘交易引擎 - 简化版
 * 用于 fourmeme 交易实验的实盘交易执行
 * 注意：实盘交易需要配置钱包私钥，实际交易会使用真实资金
 */

const { ITradingEngine, TradingMode, EngineStatus } = require('../interfaces/ITradingEngine');
const { Experiment, Trade, TradeSignal, TradeStatus } = require('../entities');
const { ExperimentFactory } = require('../factories/ExperimentFactory');
const { ExperimentDataService } = require('../../web/services/ExperimentDataService');
const { dbManager } = require('../../services/dbManager');
const Logger = require('../../services/logger');

/**
 * 实盘交易引擎
 * @class
 * @implements ITradingEngine
 */
class LiveTradingEngine {
  /**
   * 构造函数
   * @param {Object} config - 配置对象
   * @param {string} config.privateKey - 钱包私钥
   */
  constructor(config = {}) {
    this.id = `live_${Date.now()}`;
    this.name = 'Fourmeme Live Trading Engine';
    this.mode = TradingMode.LIVE;
    this.status = EngineStatus.STOPPED;

    // 实验相关
    this.experiment = null;
    this.experimentId = null;

    // 钱包相关
    this.privateKey = config.privateKey;
    this.walletAddress = null;

    // 统计信息
    this.metrics = {
      totalTrades: 0,
      successfulTrades: 0,
      failedTrades: 0,
      totalSignals: 0,
      executedSignals: 0,
      totalGasUsed: 0,
      totalGasCost: 0
    };

    // 服务
    this.dataService = new ExperimentDataService();
    this.logger = new Logger({ dir: './logs' });

    // 数据库客户端
    this.supabase = dbManager.getClient();

    console.log(`💰 实盘交易引擎已创建: ${this.id}`);
    console.log(`⚠️ 警告: 实盘交易将使用真实资金，请谨慎操作！`);
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
      // 检查私钥配置
      if (!this.privateKey) {
        this.privateKey = process.env.WALLET_PRIVATE_KEY;
      }
      if (!this.privateKey) {
        throw new Error('未配置钱包私钥，请在配置文件或环境变量中设置 WALLET_PRIVATE_KEY');
      }

      // 从实验配置中获取私钥
      if (typeof experimentOrId === 'string') {
        const factory = ExperimentFactory.getInstance();
        this.experiment = await factory.load(experimentOrId);
        if (!this.experiment) {
          throw new Error(`实验不存在: ${experimentOrId}`);
        }
      } else if (experimentOrId instanceof Experiment) {
        this.experiment = experimentOrId;
      } else {
        throw new Error('无效的实验参数');
      }

      this.experimentId = this.experiment.id;

      // 从实验配置中获取私钥
      if (this.experiment.config?.wallet?.privateKey) {
        this.privateKey = this.experiment.config.wallet.privateKey;
      }

      // 验证私钥格式
      if (!this.privateKey.startsWith('0x') || this.privateKey.length !== 66) {
        throw new Error('私钥格式无效，必须是0x开头的66字符十六进制字符串');
      }

      // TODO: 从私钥推导钱包地址
      // this.walletAddress = deriveAddressFromPrivateKey(this.privateKey);

      this.status = EngineStatus.STOPPED;

      console.log(`✅ 实盘交易引擎初始化完成: 实验 ${this.experimentId}`);
      console.log(`⚠️ 钱包地址: ${this.walletAddress || '未设置'}`);
      this.logger.info(this.experimentId, 'LiveTradingEngine', '引擎初始化完成', {
        walletAddress: this.walletAddress
      });

    } catch (error) {
      console.error('❌ 实盘交易引擎初始化失败:', error.message);
      this.status = EngineStatus.ERROR;
      throw error;
    }
  }

  /**
   * 启动引擎
   * @returns {Promise<void>}
   */
  async start() {
    if (this.status === EngineStatus.RUNNING) {
      console.warn('⚠️ 引擎已在运行');
      return;
    }

    // 再次确认警告
    console.log(`⚠️ 警告: 即将启动实盘交易引擎！`);
    console.log(`⚠️ 所有交易将使用真实资金执行！`);
    console.log(`⚠️ 请确认您已了解风险并做好资金管理！`);

    this.status = EngineStatus.RUNNING;

    // 更新实验状态
    if (this.experiment) {
      this.experiment.start();
      const factory = ExperimentFactory.getInstance();
      await factory.updateStatus(this.experimentId, 'running');
    }

    console.log(`🚀 实盘交易引擎已启动: 实验 ${this.experimentId}`);
    this.logger.info(this.experimentId, 'LiveTradingEngine', '引擎已启动');
  }

  /**
   * 停止引擎
   * @returns {Promise<void>}
   */
  async stop() {
    if (this.status === EngineStatus.STOPPED) {
      console.warn('⚠️ 引擎已停止');
      return;
    }

    this.status = EngineStatus.STOPPED;

    // 更新实验状态
    if (this.experiment) {
      this.experiment.stop('stopped');
      const factory = ExperimentFactory.getInstance();
      await factory.updateStatus(this.experimentId, 'stopped', {
        results: this.getMetrics()
      });
    }

    console.log(`🛑 实盘交易引擎已停止: 实验 ${this.experimentId}`);
    this.logger.info(this.experimentId, 'LiveTradingEngine', '引擎已停止', {
      metrics: this.metrics
    });
  }

  /**
   * 处理策略信号
   * @param {Object} signal - 策略信号
   * @returns {Promise<Object>} 处理结果
   */
  async processSignal(signal) {
    if (this.status !== EngineStatus.RUNNING) {
      console.warn('⚠️ 引擎未运行，忽略信号');
      return { executed: false, reason: '引擎未运行' };
    }

    this.metrics.totalSignals++;

    // 记录信号到数据库
    const tradeSignal = TradeSignal.fromStrategySignal(signal, this.experimentId);
    await this.dataService.saveSignal(tradeSignal);

    console.log(`📊 收到实盘信号: ${signal.action} ${signal.symbol} (${signal.tokenAddress})`);
    console.log(`   原因: ${signal.reason}`);
    console.log(`   置信度: ${signal.confidence}%`);
    console.log(`⚠️ 即将执行实盘交易！`);

    // 根据信号类型执行交易
    let tradeResult = null;
    if (signal.action === 'buy') {
      tradeResult = await this._executeBuy(signal);
    } else if (signal.action === 'sell') {
      tradeResult = await this._executeSell(signal);
    } else {
      console.log(`ℹ️ 忽略 hold 信号: ${signal.symbol}`);
      return { executed: false, reason: 'hold信号' };
    }

    if (tradeResult && tradeResult.success) {
      this.metrics.executedSignals++;
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
      // TODO: 实现实盘买入逻辑
      // 1. 计算交易金额
      // 2. 调用DEX合约执行交易
      // 3. 等待交易确认
      // 4. 返回交易结果

      console.warn(`⚠️ 实盘买入功能暂未实现: ${signal.symbol}`);
      return {
        success: false,
        reason: '实盘买入功能暂未实现'
      };

    } catch (error) {
      console.error(`❌ 实盘买入失败: ${error.message}`);
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
      // TODO: 实现实盘卖出逻辑
      // 1. 查询钱包中代币余额
      // 2. 调用DEX合约执行交易
      // 3. 等待交易确认
      // 4. 返回交易结果

      console.warn(`⚠️ 实盘卖出功能暂未实现: ${signal.symbol}`);
      return {
        success: false,
        reason: '实盘卖出功能暂未实现'
      };

    } catch (error) {
      console.error(`❌ 实盘卖出失败: ${error.message}`);
      return { success: false, reason: error.message };
    }
  }

  /**
   * 执行交易
   * @param {Object} tradeRequest - 交易请求
   * @returns {Promise<Object>} 交易结果
   */
  async executeTrade(tradeRequest) {
    this.metrics.totalTrades++;

    const trade = Trade.fromLiveTrade({
      tokenAddress: tradeRequest.tokenAddress,
      symbol: tradeRequest.symbol,
      chain: this.experiment.blockchain || 'bsc',
      direction: tradeRequest.direction,
      amount: tradeRequest.amount,
      price: tradeRequest.price,
      success: false,
      error: null
    }, this.experimentId);

    try {
      // TODO: 实现实际交易执行
      throw new Error('实盘交易功能暂未实现');

    } catch (error) {
      trade.markAsFailed(error.message);
      this.metrics.failedTrades++;

      // 保存失败交易记录
      await this.dataService.saveTrade(trade);

      return {
        success: false,
        error: error.message,
        trade: trade.toJSON()
      };
    }
  }

  /**
   * 获取状态
   * @returns {string}
   */
  getStatus() {
    return this.status;
  }

  /**
   * 获取指标
   * @returns {Object}
   */
  getMetrics() {
    return {
      ...this.metrics,
      walletAddress: this.walletAddress
    };
  }

  /**
   * 保存运行时指标
   * @param {string} metricName - 指标名称
   * @param {number} metricValue - 指标值
   */
  async saveMetric(metricName, metricValue) {
    await this.dataService.saveRuntimeMetric(
      this.experimentId,
      metricName,
      metricValue,
      { timestamp: new Date().toISOString() }
    );
  }
}

module.exports = { LiveTradingEngine };
