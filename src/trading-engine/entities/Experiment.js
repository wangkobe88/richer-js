/**
 * 实验实体 - 对应 experiments 表
 * 用于 fourmeme 交易实验管理
 */

const { v4: uuidv4 } = require('uuid');

/**
 * 实验实体类
 * @class
 */
class Experiment {
  /**
   * 构造函数
   * @param {Object} experimentData - 实验数据
   */
  constructor(experimentData) {
    // 主键字段
    this.id = experimentData.id || uuidv4();

    // 基本信息
    this.experimentName = experimentData.experimentName;
    this.experimentDescription = experimentData.experimentDescription;

    // 状态和配置
    this.status = experimentData.status || 'initializing';
    this.config = experimentData.config || {};

    // 交易模式 - 只支持 virtual 和 live，不支持 backtest
    this.tradingMode = experimentData.tradingMode;
    this.strategyType = experimentData.strategyType || 'fourmeme_earlyreturn';
    this.blockchain = experimentData.blockchain || 'bsc';
    this.klineType = experimentData.klineType || '1m';

    // 时间字段
    this.startedAt = experimentData.startedAt || new Date();
    this.stoppedAt = experimentData.stoppedAt;
    this.createdAt = experimentData.createdAt || new Date();
    this.updatedAt = experimentData.updatedAt || this.createdAt;
  }

  /**
   * 转换为数据库格式
   * @returns {Object} 数据库格式对象
   */
  toDatabaseFormat() {
    return {
      id: this.id,
      experiment_name: this.experimentName,
      experiment_description: this.experimentDescription,
      status: this.status,
      config: this.config,
      trading_mode: this.tradingMode,
      strategy_type: this.strategyType,
      blockchain: this.blockchain,
      kline_type: this.klineType,
      started_at: this.startedAt.toISOString(),
      stopped_at: this.stoppedAt ? this.stoppedAt.toISOString() : null,
      created_at: this.createdAt.toISOString(),
      updated_at: this.updatedAt.toISOString()
    };
  }

  /**
   * 从数据库格式创建实例
   * @param {Object} dbRow - 数据库行数据
   * @returns {Experiment} 实验实例
   */
  static fromDatabaseFormat(dbRow) {
    const experimentData = {
      id: dbRow.id,
      experimentName: dbRow.experiment_name,
      experimentDescription: dbRow.experiment_description,
      status: dbRow.status,
      config: dbRow.config,
      tradingMode: dbRow.trading_mode,
      strategyType: dbRow.strategy_type,
      blockchain: dbRow.blockchain,
      klineType: dbRow.kline_type,
      startedAt: new Date(dbRow.started_at),
      stoppedAt: dbRow.stopped_at ? new Date(dbRow.stopped_at) : null,
      createdAt: new Date(dbRow.created_at),
      updatedAt: new Date(dbRow.updated_at || dbRow.created_at)
    };

    return new Experiment(experimentData);
  }

  /**
   * 从配置创建实验实例
   * @param {Object} config - 引擎配置
   * @param {string} tradingMode - 交易模式 ('virtual' | 'live')
   * @returns {Experiment} 实验实例
   */
  static fromConfig(config, tradingMode) {
    const experimentData = {
      experimentName: config.name || `${tradingMode.charAt(0).toUpperCase() + tradingMode.slice(1)} Trading Experiment`,
      experimentDescription: config.description || `Fourmeme ${tradingMode} trading experiment`,
      config: config,
      tradingMode: tradingMode,
      strategyType: 'fourmeme_earlyreturn',
      blockchain: config.blockchain || 'bsc',
      klineType: config.kline_type || '1m'
    };

    return new Experiment(experimentData);
  }

  /**
   * 更新实验状态
   * @param {string} newStatus - 新状态
   * @returns {Experiment} 返回自身支持链式调用
   */
  updateStatus(newStatus) {
    this.status = newStatus;
    if (newStatus === 'completed' || newStatus === 'stopped') {
      this.stoppedAt = new Date();
    }
    return this;
  }

  /**
   * 更新实验配置
   * @param {Object} updates - 更新的配置字段
   * @returns {Experiment} 返回自身支持链式调用
   */
  updateConfig(updates) {
    this.config = { ...this.config, ...updates };
    this.updatedAt = new Date();
    return this;
  }

  /**
   * 开始实验
   * @returns {Experiment} 返回自身支持链式调用
   */
  start() {
    this.status = 'running';
    this.startedAt = new Date();
    return this;
  }

  /**
   * 停止实验
   * @param {string} finalStatus - 最终状态 ('completed' | 'failed' | 'stopped')
   * @returns {Experiment} 返回自身支持链式调用
   */
  stop(finalStatus = 'stopped') {
    this.status = finalStatus;
    this.stoppedAt = new Date();
    return this;
  }

  /**
   * 获取实验持续时间（毫秒）
   * @returns {number} 持续时间
   */
  getDuration() {
    const endTime = this.stoppedAt || new Date();
    return endTime.getTime() - this.startedAt.getTime();
  }

  /**
   * 检查实验是否在运行中
   * @returns {boolean} 是否运行中
   */
  isRunning() {
    return this.status === 'running';
  }

  /**
   * 检查实验是否已完成
   * @returns {boolean} 是否已完成
   */
  isCompleted() {
    return ['completed', 'failed', 'stopped'].includes(this.status);
  }

  /**
   * 获取实验的简要信息
   * @returns {Object} 简要信息
   */
  getSummary() {
    return {
      id: this.id,
      name: this.experimentName,
      status: this.status,
      tradingMode: this.tradingMode,
      strategyType: this.strategyType,
      blockchain: this.blockchain,
      klineType: this.klineType,
      duration: this.getDuration(),
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt
    };
  }

  /**
   * 验证实验数据
   * @returns {Object} 验证结果
   */
  validate() {
    const errors = [];

    // 基础字段验证
    if (!this.experimentName) errors.push('experimentName is required');
    if (!this.tradingMode) errors.push('tradingMode is required');
    if (!this.strategyType) errors.push('strategyType is required');
    if (!this.blockchain) errors.push('blockchain is required');
    if (!this.klineType) errors.push('klineType is required');

    // 交易模式验证 - 只支持 virtual 和 live
    if (!['virtual', 'live'].includes(this.tradingMode)) {
      errors.push('tradingMode must be one of: virtual, live (backtest not supported)');
    }

    // 状态验证
    if (!['initializing', 'running', 'completed', 'failed', 'stopped'].includes(this.status)) {
      errors.push('status must be one of: initializing, running, completed, failed, stopped');
    }

    // K线类型验证
    const validKlineTypes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
    if (!validKlineTypes.includes(this.klineType)) {
      errors.push(`klineType must be one of: ${validKlineTypes.join(', ')}`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 序列化为JSON
   * @returns {Object} JSON对象
   */
  toJSON() {
    return {
      id: this.id,
      experimentName: this.experimentName,
      experimentDescription: this.experimentDescription,
      status: this.status,
      config: this.config,
      tradingMode: this.tradingMode,
      strategyType: this.strategyType,
      blockchain: this.blockchain,
      klineType: this.klineType,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      createdAt: this.createdAt,
      duration: this.getDuration(),
      isRunning: this.isRunning(),
      isCompleted: this.isCompleted()
    };
  }
}

module.exports = { Experiment };
