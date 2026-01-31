/**
 * 交易实体 - 对应 trades 表
 * 用于 fourmeme 交易记录（虚拟和实盘）
 */

const { v4: uuidv4 } = require('uuid');

// 交易状态枚举
const TradeStatus = {
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILED: 'failed'
};

/**
 * 交易实体类
 * @class
 */
class Trade {
  /**
   * 构造函数
   * @param {Object} tradeData - 交易数据
   */
  constructor(tradeData) {
    // 主键字段
    this.id = tradeData.id || uuidv4();

    // 关联字段
    this.experimentId = tradeData.experimentId;

    // 代币信息
    this.tokenAddress = tradeData.tokenAddress;
    this.tokenSymbol = tradeData.tokenSymbol;
    this.chain = tradeData.chain || 'bsc';

    // 交易类型和方向
    this.tradeType = tradeData.tradeType; // 'virtual' | 'live'
    this.direction = tradeData.direction; // 'buy' | 'sell'

    // 数量和价格
    this.amount = tradeData.amount;
    this.price = tradeData.price;

    // 交易状态
    this.status = tradeData.status || TradeStatus.PENDING;
    this.success = tradeData.success;

    // 错误信息
    this.errorMessage = tradeData.errorMessage;

    // 实盘交易特有字段
    this.txHash = tradeData.txHash;
    this.gasUsed = tradeData.gasUsed;
    this.gasPrice = tradeData.gasPrice;

    // 元数据
    this.metadata = tradeData.metadata || {};

    // 时间字段
    this.createdAt = tradeData.createdAt || new Date();
    this.updatedAt = tradeData.updatedAt || this.createdAt;
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
      trade_type: this.tradeType,
      direction: this.direction,
      amount: this.amount ? this.amount.toString() : null,
      price: this.price ? this.price.toString() : null,
      status: this.status,
      success: this.success,
      error_message: this.errorMessage,
      tx_hash: this.txHash,
      gas_used: this.gasUsed,
      gas_price: this.gasPrice ? this.gasPrice.toString() : null,
      metadata: this.metadata,
      created_at: this.createdAt.toISOString(),
      updated_at: this.updatedAt.toISOString()
    };
  }

  /**
   * 从数据库格式创建实例
   * @param {Object} dbRow - 数据库行数据
   * @returns {Trade} 交易实例
   */
  static fromDatabaseFormat(dbRow) {
    const tradeData = {
      id: dbRow.id,
      experimentId: dbRow.experiment_id,
      tokenAddress: dbRow.token_address,
      tokenSymbol: dbRow.token_symbol,
      chain: dbRow.chain,
      tradeType: dbRow.trade_type,
      direction: dbRow.direction,
      amount: dbRow.amount,
      price: dbRow.price,
      status: dbRow.status,
      success: dbRow.success,
      errorMessage: dbRow.error_message,
      txHash: dbRow.tx_hash,
      gasUsed: dbRow.gas_used,
      gasPrice: dbRow.gas_price,
      metadata: dbRow.metadata || {},
      createdAt: new Date(dbRow.created_at),
      updatedAt: new Date(dbRow.updated_at)
    };

    return new Trade(tradeData);
  }

  /**
   * 从虚拟交易结果创建实例
   * @param {Object} tradeResult - 交易结果
   * @param {string} experimentId - 实验ID
   * @returns {Trade} 交易实例
   */
  static fromVirtualTrade(tradeResult, experimentId) {
    return new Trade({
      experimentId,
      tokenAddress: tradeResult.tokenAddress,
      tokenSymbol: tradeResult.symbol,
      chain: tradeResult.chain || 'bsc',
      tradeType: 'virtual',
      direction: tradeResult.direction,
      amount: tradeResult.amount,
      price: tradeResult.price,
      status: tradeResult.success ? TradeStatus.SUCCESS : TradeStatus.FAILED,
      success: tradeResult.success,
      errorMessage: tradeResult.error,
      metadata: {
        ...tradeResult
      }
    });
  }

  /**
   * 从实盘交易结果创建实例
   * @param {Object} tradeResult - 交易结果
   * @param {string} experimentId - 实验ID
   * @returns {Trade} 交易实例
   */
  static fromLiveTrade(tradeResult, experimentId) {
    return new Trade({
      experimentId,
      tokenAddress: tradeResult.tokenAddress,
      tokenSymbol: tradeResult.symbol,
      chain: tradeResult.chain || 'bsc',
      tradeType: 'live',
      direction: tradeResult.direction,
      amount: tradeResult.amount,
      price: tradeResult.price,
      status: tradeResult.success ? TradeStatus.SUCCESS : TradeStatus.FAILED,
      success: tradeResult.success,
      errorMessage: tradeResult.error,
      txHash: tradeResult.txHash,
      gasUsed: tradeResult.gasUsed,
      gasPrice: tradeResult.gasPrice,
      metadata: {
        ...tradeResult
      }
    });
  }

  /**
   * 标记交易为成功
   */
  markAsSuccess() {
    this.status = TradeStatus.SUCCESS;
    this.success = true;
    this.updatedAt = new Date();
  }

  /**
   * 标记交易为失败
   * @param {string} errorMessage - 错误信息
   */
  markAsFailed(errorMessage) {
    this.status = TradeStatus.FAILED;
    this.success = false;
    this.errorMessage = errorMessage;
    this.updatedAt = new Date();
  }

  /**
   * 验证交易数据
   * @returns {Object} 验证结果
   */
  validate() {
    const errors = [];

    if (!this.experimentId) errors.push('experimentId is required');
    if (!this.tokenAddress) errors.push('tokenAddress is required');
    if (!this.tokenSymbol) errors.push('tokenSymbol is required');
    if (!this.tradeType) errors.push('tradeType is required');
    if (!['virtual', 'live'].includes(this.tradeType)) {
      errors.push('tradeType must be virtual or live');
    }
    if (!this.direction) errors.push('direction is required');
    if (!['buy', 'sell'].includes(this.direction)) {
      errors.push('direction must be buy or sell');
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
      symbol: this.tokenSymbol,
      tokenAddress: this.tokenAddress,
      tradeType: this.tradeType,
      direction: this.direction,
      amount: this.amount,
      price: this.price,
      status: this.status,
      success: this.success,
      errorMessage: this.errorMessage,
      timestamp: this.createdAt
    };
  }

  /**
   * 转换为JSON格式
   * @returns {Object} 交易数据的JSON对象
   */
  toJSON() {
    return {
      id: this.id,
      experiment_id: this.experimentId,
      token_address: this.tokenAddress,
      token_symbol: this.tokenSymbol,
      chain: this.chain,
      trade_type: this.tradeType,
      direction: this.direction,
      amount: this.amount,
      price: this.price,
      status: this.status,
      success: this.success,
      error_message: this.errorMessage,
      tx_hash: this.txHash,
      gas_used: this.gasUsed,
      gas_price: this.gasPrice,
      metadata: this.metadata,
      created_at: this.createdAt,
      updated_at: this.updatedAt,
      timestamp: this.createdAt
    };
  }
}

module.exports = { Trade, TradeStatus };
