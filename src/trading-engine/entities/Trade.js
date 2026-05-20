/**
 * 交易实体 - 对应 trades 表
 * 参考 rich-js 的设计，使用 input/output 模式记录交易
 *
 * 买入时: input_currency=BNB, output_currency=代币
 *        input_amount=花费的BNB, output_amount=获得的代币数量
 * 卖出时: input_currency=代币, output_currency=BNB
 *        input_amount=卖出的代币数量, output_amount=获得的BNB
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
    this.signalId = tradeData.signalId || null;

    // 代币信息
    this.tokenAddress = tradeData.tokenAddress;
    this.tokenSymbol = tradeData.tokenSymbol;
    this.tokenId = tradeData.tokenId || null;
    this.chain = tradeData.chain || 'bsc';

    // 交易方向和状态
    this.tradeDirection = tradeData.tradeDirection || tradeData.direction;
    this.tradeStatus = tradeData.tradeStatus || tradeData.status || TradeStatus.PENDING;
    this.success = tradeData.success ?? false;
    this.isVirtualTrade = tradeData.isVirtualTrade !== undefined ? tradeData.isVirtualTrade : true;

    // 🔥 input/output 模式 - 参考 rich-js
    this.inputCurrency = tradeData.inputCurrency;   // 输入货币 (如 BNB, USDT)
    this.outputCurrency = tradeData.outputCurrency; // 输出货币 (如 代币符号)
    this.inputAmount = tradeData.inputAmount;       // 输入数量
    this.outputAmount = tradeData.outputAmount;     // 输出数量
    this.unitPrice = tradeData.unitPrice;           // 单价

    // 错误信息
    this.errorMessage = tradeData.errorMessage;

    // 实盘交易特有字段
    this.txHash = tradeData.txHash;
    this.gasUsed = tradeData.gasUsed;
    this.gasPrice = tradeData.gasPrice;

    // 元数据
    this.metadata = tradeData.metadata || {};

    // 时间字段
    // 优先使用 createdAt，如果没有则从 metadata.timestamp 获取（回测引擎使用历史时间）
    // 确保 createdAt 始终是 Date 对象
    const timestampSource = tradeData.createdAt || tradeData.metadata?.timestamp;
    this.createdAt = timestampSource ? new Date(timestampSource) : new Date();
    this.executedAt = tradeData.executedAt || null;
  }

  /**
   * 转换为数据库格式
   * @returns {Object} 数据库格式对象
   */
  toDatabaseFormat() {
    return {
      id: this.id,
      experiment_id: this.experimentId,
      signal_id: this.signalId,
      token_address: this.tokenAddress,
      token_symbol: this.tokenSymbol,
      token_id: this.tokenId,
      chain: this.chain,
      trade_direction: this.tradeDirection,
      trade_status: this.tradeStatus,
      input_currency: this.inputCurrency,
      output_currency: this.outputCurrency,
      input_amount: this.inputAmount ? this.inputAmount.toString() : null,
      output_amount: this.outputAmount ? this.outputAmount.toString() : null,
      unit_price: this.unitPrice ? this.unitPrice.toString() : null,
      success: this.success,
      is_virtual_trade: this.isVirtualTrade,
      created_at: this.createdAt.toISOString(),
      executed_at: this.executedAt ? this.executedAt.toISOString() : null,
      metadata: this.metadata
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
      signalId: dbRow.signal_id,
      tokenAddress: dbRow.token_address,
      tokenSymbol: dbRow.token_symbol,
      tokenId: dbRow.token_id,
      chain: dbRow.chain,
      tradeDirection: dbRow.trade_direction,
      tradeStatus: dbRow.trade_status,
      inputCurrency: dbRow.input_currency,
      outputCurrency: dbRow.output_currency,
      inputAmount: dbRow.input_amount,
      outputAmount: dbRow.output_amount,
      unitPrice: dbRow.unit_price,
      success: dbRow.success,
      isVirtualTrade: dbRow.is_virtual_trade,
      createdAt: new Date(dbRow.created_at),
      executedAt: dbRow.executed_at ? new Date(dbRow.executed_at) : null,
      metadata: dbRow.metadata || {}
    };

    return new Trade(tradeData);
  }

  /**
   * 从虚拟交易结果创建实例
   * @param {Object} tradeResult - 交易结果
   * @param {string} experimentId - 实验ID
   * @param {string} signalId - 信号ID（可选）
   * @param {string} nativeCurrency - 主币符号（如BNB）
   * @returns {Trade} 交易实例
   */
  static fromVirtualTrade(tradeResult, experimentId, signalId = null, nativeCurrency = 'BNB') {
    const isBuy = tradeResult.direction === 'buy';
    const tokenSymbol = tradeResult.symbol || 'UNKNOWN';

    let inputCurrency, outputCurrency, inputAmount, outputAmount, unitPrice;

    if (isBuy) {
      // 买入: 用BNB买代币
      inputCurrency = nativeCurrency;
      outputCurrency = tokenSymbol;
      // tradeResult.amount 是获得的代币数量
      // tradeResult.price 是单价（BNB per token）
      // 花费的BNB = amount * price
      outputAmount = tradeResult.amount || 0;
      unitPrice = tradeResult.price || 0;
      inputAmount = outputAmount * unitPrice;
    } else {
      // 卖出: 卖代币换BNB
      inputCurrency = tokenSymbol;
      outputCurrency = nativeCurrency;
      // tradeResult.amount 是卖出的代币数量
      // tradeResult.price 是单价（BNB per token）
      // 获得的BNB = amount * price
      inputAmount = tradeResult.amount || 0;
      unitPrice = tradeResult.price || 0;
      outputAmount = inputAmount * unitPrice;
    }

    return new Trade({
      experimentId,
      signalId,
      tokenAddress: tradeResult.tokenAddress,
      tokenSymbol,
      chain: tradeResult.chain || 'bsc',
      tradeDirection: tradeResult.direction,
      tradeStatus: tradeResult.success ? TradeStatus.SUCCESS : TradeStatus.FAILED,
      success: tradeResult.success,
      isVirtualTrade: true,
      inputCurrency,
      outputCurrency,
      inputAmount,
      outputAmount,
      unitPrice,
      errorMessage: tradeResult.error,
      executedAt: tradeResult.executedAt || new Date(),
      createdAt: tradeResult.timestamp || new Date(), // 🔥 使用传入的时间戳，如果没有则使用当前时间
      metadata: {
        ...tradeResult.metadata,
        cards: tradeResult.cards,
        cardConfig: tradeResult.cardConfig
      }
    });
  }

  /**
   * 从实盘交易结果创建实例
   * @param {Object} tradeResult - 交易结果
   * @param {string} experimentId - 实验ID
   * @param {string} signalId - 信号ID（可选）
   * @param {string} nativeCurrency - 主币符号（如BNB）
   * @returns {Trade} 交易实例
   */
  static fromLiveTrade(tradeResult, experimentId, signalId = null, nativeCurrency = 'BNB') {
    const isBuy = tradeResult.direction === 'buy';
    const tokenSymbol = tradeResult.symbol || 'UNKNOWN';

    let inputCurrency, outputCurrency, inputAmount, outputAmount, unitPrice;

    if (isBuy) {
      // 买入: 用BNB买代币
      inputCurrency = nativeCurrency;
      outputCurrency = tokenSymbol;
      outputAmount = tradeResult.amount || 0;
      unitPrice = tradeResult.price || 0;
      inputAmount = outputAmount * unitPrice;
    } else {
      // 卖出: 卖代币换BNB
      inputCurrency = tokenSymbol;
      outputCurrency = nativeCurrency;
      inputAmount = tradeResult.amount || 0;
      unitPrice = tradeResult.price || 0;
      outputAmount = inputAmount * unitPrice;
    }

    return new Trade({
      experimentId,
      signalId,
      tokenAddress: tradeResult.tokenAddress,
      tokenSymbol,
      chain: tradeResult.chain || 'bsc',
      tradeDirection: tradeResult.direction,
      tradeStatus: tradeResult.success ? TradeStatus.SUCCESS : TradeStatus.FAILED,
      success: tradeResult.success,
      isVirtualTrade: false,
      inputCurrency,
      outputCurrency,
      inputAmount,
      outputAmount,
      unitPrice,
      errorMessage: tradeResult.error,
      txHash: tradeResult.txHash,
      gasUsed: tradeResult.gasUsed,
      gasPrice: tradeResult.gasPrice,
      executedAt: tradeResult.executedAt || new Date(),
      metadata: {
        ...tradeResult.metadata,
        cards: tradeResult.cards,
        cardConfig: tradeResult.cardConfig
      }
    });
  }

  /**
   * 标记交易为成功
   */
  markAsSuccess() {
    this.tradeStatus = TradeStatus.SUCCESS;
    this.success = true;
    if (!this.executedAt) {
      this.executedAt = new Date();
    }
  }

  /**
   * 标记交易为失败
   * @param {string} errorMessage - 错误信息
   */
  markAsFailed(errorMessage) {
    this.tradeStatus = TradeStatus.FAILED;
    this.success = false;
    this.errorMessage = errorMessage;
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
    if (!this.tradeDirection) errors.push('tradeDirection is required');
    if (!['buy', 'sell'].includes(this.tradeDirection)) {
      errors.push('tradeDirection must be buy or sell');
    }
    if (!this.inputCurrency) errors.push('inputCurrency is required');
    if (!this.outputCurrency) errors.push('outputCurrency is required');
    if (this.inputAmount === null || this.inputAmount === undefined) {
      errors.push('inputAmount is required');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 保存交易到数据库
   * @returns {Promise<string>} 返回交易ID
   */
  async save() {
    const { dbManager } = require('../../services/dbManager');
    const supabase = dbManager.getClient();

    const dbData = this.toDatabaseFormat();
    const { data, error } = await supabase
      .from('trades')
      .insert([dbData])
      .select();

    if (error) {
      throw new Error(`保存交易失败: ${error.message}`);
    }

    // 返回插入的记录ID
    return data[0].id;
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
      direction: this.tradeDirection,
      inputCurrency: this.inputCurrency,
      outputCurrency: this.outputCurrency,
      inputAmount: this.inputAmount,
      outputAmount: this.outputAmount,
      unitPrice: this.unitPrice,
      status: this.tradeStatus,
      success: this.success,
      errorMessage: this.errorMessage,
      executedAt: this.executedAt
    };
  }

  /**
   * 转换为JSON格式（API响应）
   * @returns {Object} 交易数据的JSON对象
   */
  toJSON() {
    return {
      id: this.id,
      experiment_id: this.experimentId,
      signal_id: this.signalId,
      token_address: this.tokenAddress,
      token_symbol: this.tokenSymbol,
      token_id: this.tokenId,
      chain: this.chain,
      trade_direction: this.tradeDirection,
      trade_status: this.tradeStatus,
      status: this.tradeStatus,  // 兼容旧前端
      direction: this.tradeDirection,  // 兼容旧前端
      input_currency: this.inputCurrency,
      output_currency: this.outputCurrency,
      input_amount: this.inputAmount,
      output_amount: this.outputAmount,
      unit_price: this.unitPrice,
      success: this.success,
      is_virtual_trade: this.isVirtualTrade,
      error_message: this.errorMessage,
      tx_hash: this.txHash,
      gas_used: this.gasUsed,
      gas_price: this.gasPrice,
      metadata: this.metadata,
      created_at: this.createdAt,
      executed_at: this.executedAt,
      timestamp: this.createdAt
    };
  }
}

module.exports = { Trade, TradeStatus };
