/**
 * 交易解析工具
 * 将 AVE API 返回的交易数据转换为 <钱包, 数额> 序列
 */

class TradeParser {
  /**
   * 从 AVE API 响应中解析交易序列
   * @param {Object} aveApiResponse - 完整的 AVE API 响应
   * @param {string} tokenAddress - 目标代币地址
   * @returns {Array<Array>} [[wallet, amount], ...] 按时间排序的交易序列
   */
  static parseSequence(aveApiResponse, tokenAddress) {
    const trades = aveApiResponse.data?.earlyTrades || [];

    return trades
      .sort((a, b) => a.time - b.time)
      .map(t => this.parseTrade(t, tokenAddress));
  }

  /**
   * 解析单笔交易
   * 通过代币地址判断买卖（支持 USDT/WBNB/USDC 等任何交易对）
   * @param {Object} trade - 单笔交易记录
   * @param {string} tokenAddress - 目标代币地址
   * @returns {Array} [wallet_address, amount] amount>0为买入，amount<0为卖出
   */
  static parseTrade(trade, tokenAddress) {
    // to_token 是目标代币 → 买入
    // from_token 是目标代币 → 卖出
    const isBuy = trade.to_token === tokenAddress;
    const amount = isBuy ? trade.to_usd : -trade.from_usd;

    return [trade.wallet_address, amount];
  }

  /**
   * 计算序列统计信息
   * @param {Array} sequence - 交易序列 [[wallet, amount], ...]
   * @returns {Object} 统计信息
   */
  static calculateStats(sequence) {
    const length = sequence.length;
    const uniqueWallets = new Set(sequence.map(s => s[0])).size;

    const buys = sequence.filter(s => s[1] > 0);
    const sells = sequence.filter(s => s[1] < 0);

    const totalBuyAmount = buys.reduce((sum, s) => sum + s[1], 0);
    const totalSellAmount = sells.reduce((sum, s) => sum + Math.abs(s[1]), 0);
    const netFlow = totalBuyAmount - totalSellAmount;

    return {
      length,
      unique_wallets: uniqueWallets,
      total_buys: buys.length,
      total_sells: sells.length,
      total_buy_amount: totalBuyAmount,
      total_sell_amount: totalSellAmount,
      net_flow: netFlow
    };
  }

  /**
   * 验证交易数据完整性
   * @param {Object} aveApiResponse - AVE API 响应
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  static validateResponse(aveApiResponse) {
    const errors = [];

    if (!aveApiResponse) {
      errors.push('API 响应为空');
      return { valid: false, errors };
    }

    if (!aveApiResponse.success) {
      errors.push(`API 返回失败: ${aveApiResponse.error || '未知错误'}`);
    }

    if (!aveApiResponse.data) {
      errors.push('响应中缺少 data 字段');
      return { valid: false, errors };
    }

    const trades = aveApiResponse.data.earlyTrades;
    if (!Array.isArray(trades)) {
      errors.push('earlyTrades 不是数组');
      return { valid: false, errors };
    }

    return { valid: errors.length === 0, errors };
  }
}

module.exports = { TradeParser };
