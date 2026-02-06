/**
 * 交易引擎接口 - 简化版
 * 用于 fourmeme 交易实验
 */

// 交易模式
const TradingMode = {
  LIVE: 'live',
  VIRTUAL: 'virtual',
  BACKTEST: 'backtest'
};

// 引擎状态
const EngineStatus = {
  STOPPED: 'stopped',
  RUNNING: 'running',
  ERROR: 'error'
};

/**
 * 交易引擎接口
 * @interface ITradingEngine
 */
class ITradingEngine {
  /**
   * 获取引擎ID
   * @type {string}
   */
  get id() {
    throw new Error('Must implement getter');
  }

  /**
   * 获取引擎名称
   * @type {string}
   */
  get name() {
    throw new Error('Must implement getter');
  }

  /**
   * 获取交易模式
   * @type {string}
   */
  get mode() {
    throw new Error('Must implement getter');
  }

  /**
   * 获取引擎状态
   * @type {string}
   */
  get status() {
    throw new Error('Must implement getter');
  }

  /**
   * 获取实验实体
   * @type {import('../entities/Experiment').Experiment}
   */
  get experiment() {
    throw new Error('Must implement getter');
  }

  // 生命周期管理
  /**
   * 初始化引擎
   * @param {import('../entities/Experiment').Experiment} experiment - 实验实体
   * @returns {Promise<void>}
   */
  async initialize(experiment) {
    throw new Error('Method must be implemented');
  }

  /**
   * 启动引擎
   * @returns {Promise<void>}
   */
  async start() {
    throw new Error('Method must be implemented');
  }

  /**
   * 停止引擎
   * @returns {Promise<void>}
   */
  async stop() {
    throw new Error('Method must be implemented');
  }

  // 信号处理
  /**
   * 处理策略信号
   * @param {Object} signal - 策略信号
   * @param {string} signal.tokenAddress - 代币地址
   * @param {string} signal.symbol - 代币符号
   * @param {string} signal.action - 动作 (buy/sell)
   * @param {number} signal.confidence - 置信度
   * @param {string} signal.reason - 原因
   * @returns {Promise<Object>} 交易结果
   */
  async processSignal(signal) {
    throw new Error('Method must be implemented');
  }

  // 交易执行
  /**
   * 执行交易
   * @param {Object} tradeRequest - 交易请求
   * @param {string} tradeRequest.tokenAddress - 代币地址
   * @param {string} tradeRequest.symbol - 代币符号
   * @param {string} tradeRequest.direction - 交易方向 (buy/sell)
   * @param {string|number} tradeRequest.amount - 数量
   * @param {string|number} tradeRequest.price - 价格
   * @returns {Promise<Object>} 交易结果
   */
  async executeTrade(tradeRequest) {
    throw new Error('Method must be implemented');
  }

  // 状态和监控
  /**
   * 获取状态
   * @returns {string}
   */
  getStatus() {
    throw new Error('Method must be implemented');
  }

  /**
   * 获取指标
   * @returns {Object}
   */
  getMetrics() {
    throw new Error('Method must be implemented');
  }
}

module.exports = {
  TradingMode,
  EngineStatus,
  ITradingEngine
};
