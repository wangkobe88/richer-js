/**
 * 交易信号实体 - 对应 strategy_signals 表
 * 用于 fourmeme 策略信号记录
 */

const { v4: uuidv4 } = require('uuid');

/**
 * 交易信号实体类
 * @class
 */
class TradeSignal {
  /**
   * 构造函数
   * @param {Object} signalData - 信号数据
   */
  constructor(signalData) {
    // 主键字段
    this.id = signalData.id || uuidv4();

    // 关联字段
    this.experimentId = signalData.experimentId;

    // 代币信息
    this.tokenAddress = signalData.tokenAddress;
    this.tokenSymbol = signalData.tokenSymbol;
    this.chain = signalData.chain || 'bsc';

    // 信号类型和动作
    this.signalType = signalData.signalType; // 'BUY' | 'SELL'
    this.action = signalData.action || signalData.signalType?.toLowerCase(); // 'buy' | 'sell' | 'hold'

    // 置信度和原因
    this.confidence = signalData.confidence;
    this.reason = signalData.reason;

    // 元数据（包含价格信息）
    this.metadata = signalData.metadata || {};

    // 执行状态
    this.executed = signalData.executed || false;

    // 时间字段
    this.createdAt = signalData.createdAt || new Date();
  }

  /**
   * 转换为数据库格式
   * @returns {Object} 数据库格式对象
   */
  toDatabaseFormat() {
    return {
      id: this.id,
      experiment_id: this.experimentId,
      token_address: this.tokenAddress,
      token_symbol: this.tokenSymbol,
      chain: this.chain,
      signal_type: this.signalType,
      action: this.action,
      confidence: this.confidence,
      reason: this.reason,
      metadata: this.metadata,
      executed: this.executed,
      created_at: this.createdAt.toISOString()
    };
  }

  /**
   * 从数据库格式创建实例
   * @param {Object} dbRow - 数据库行数据
   * @returns {TradeSignal} 信号实例
   */
  static fromDatabaseFormat(dbRow) {
    const signalData = {
      id: dbRow.id,
      experimentId: dbRow.experiment_id,
      tokenAddress: dbRow.token_address,
      tokenSymbol: dbRow.token_symbol,
      chain: dbRow.chain,
      signalType: dbRow.signal_type,
      action: dbRow.action,
      confidence: dbRow.confidence,
      reason: dbRow.reason,
      metadata: dbRow.metadata || {},
      executed: dbRow.executed || false,
      createdAt: new Date(dbRow.created_at)
    };

    return new TradeSignal(signalData);
  }

  /**
   * 从策略信号格式创建实例（兼容现有策略代码）
   * @param {Object} strategySignal - 策略信号对象
   * @param {string} experimentId - 实验ID
   * @returns {TradeSignal} 信号实例
   */
  static fromStrategySignal(strategySignal, experimentId) {
    return new TradeSignal({
      experimentId,
      tokenAddress: strategySignal.tokenAddress,
      tokenSymbol: strategySignal.symbol,
      chain: strategySignal.chain || 'bsc',
      signalType: strategySignal.signalType || (strategySignal.action === 'buy' ? 'BUY' : 'SELL'),
      action: strategySignal.action,
      confidence: strategySignal.confidence,
      reason: strategySignal.reason,
      metadata: {
        // 价格相关
        price: strategySignal.price || null,
        earlyReturn: strategySignal.earlyReturn,
        buyPrice: strategySignal.buyPrice,
        currentPrice: strategySignal.currentPrice,
        collectionPrice: strategySignal.collectionPrice,
        // 卖出相关
        sellRatio: strategySignal.sellRatio,
        profitPercent: strategySignal.profitPercent,
        holdDuration: strategySignal.holdDuration,
        // 卡牌管理相关
        cards: strategySignal.cards || null,
        cardConfig: strategySignal.cardConfig || null
      },
      executed: false  // 初始为未执行，成功执行后更新为 true
    });
  }

  /**
   * 标记信号为已执行
   * @param {Object} tradeResult - 交易结果（可选）
   */
  markAsExecuted(tradeResult = null) {
    this.executed = true;

    // 如果有交易结果，更新元数据
    if (tradeResult) {
      this.metadata.tradeResult = {
        success: tradeResult.success,
        trade: tradeResult.trade || null
      };
    }
  }

  /**
   * 获取信号的唯一标识
   * @returns {string} 唯一标识
   */
  getUniqueKey() {
    return `${this.experimentId}_${this.tokenAddress}_${this.signalType}_${this.createdAt.getTime()}`;
  }

  /**
   * 验证信号数据
   * @returns {Object} 验证结果
   */
  validate() {
    const errors = [];

    if (!this.experimentId) errors.push('experimentId is required');
    if (!this.tokenAddress) errors.push('tokenAddress is required');
    if (!this.tokenSymbol) errors.push('tokenSymbol is required');
    if (!this.signalType) errors.push('signalType is required');
    if (!['BUY', 'SELL'].includes(this.signalType)) {
      errors.push('signalType must be BUY or SELL');
    }
    if (!this.action || !['buy', 'sell', 'hold'].includes(this.action)) {
      errors.push('action must be buy, sell, or hold');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 转换为简化的日志格式
   * @returns {Object} 日志格式对象
   */
  toLogFormat() {
    return {
      id: this.id,
      signalType: this.signalType,
      action: this.action,
      symbol: this.tokenSymbol,
      tokenAddress: this.tokenAddress,
      confidence: this.confidence,
      reason: this.reason,
      executed: this.executed,
      timestamp: this.createdAt
    };
  }

  /**
   * 转换为JSON格式
   * @returns {Object} 交易信号数据的JSON对象
   */
  toJSON() {
    return {
      id: this.id,
      experiment_id: this.experimentId,
      token_address: this.tokenAddress,
      token_symbol: this.tokenSymbol,
      chain: this.chain,
      signal_type: this.signalType,
      action: this.action,
      confidence: this.confidence,
      reason: this.reason,
      metadata: this.metadata,
      executed: this.executed,
      created_at: this.createdAt,
      timestamp: this.createdAt
    };
  }
}

module.exports = { TradeSignal };
