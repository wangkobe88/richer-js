/**
 * 分析器基类
 * 所有分析器的基础类
 */

class AnalyzerBase {
  constructor(dataLoader) {
    this.dataLoader = dataLoader;
    this.results = null;
  }

  /**
   * 分析方法，子类必须实现
   */
  async analyze() {
    throw new Error('子类必须实现 analyze() 方法');
  }

  /**
   * 获取分析结果
   */
  getResults() {
    return this.results;
  }

  /**
   * 格式化报告
   */
  formatReport() {
    return JSON.stringify(this.results, null, 2);
  }

  /**
   * 打印报告到控制台
   */
  printReport() {
    console.log(this.formatReport());
  }

  /**
   * 计算代币收益（FIFO）
   */
  calculateTokenPnL(tokenAddress, trades) {
    const tokenTrades = trades
      .filter(t => t.token_address === tokenAddress && (t.status === 'success' || t.trade_status === 'success'))
      .sort((a, b) => new Date(a.created_at || a.executed_at) - new Date(b.created_at || b.executed_at));

    if (tokenTrades.length === 0) return null;

    const buyQueue = [];
    let totalRealizedPnL = 0;
    let totalBNBSpent = 0;
    let totalBNBReceived = 0;

    tokenTrades.forEach(trade => {
      const direction = trade.trade_direction || trade.direction || trade.action;
      const isBuy = direction === 'buy' || direction === 'BUY';

      if (isBuy) {
        const inputAmount = parseFloat(trade.input_amount || 0);
        const outputAmount = parseFloat(trade.output_amount || 0);
        const unitPrice = parseFloat(trade.unit_price || 0);

        if (outputAmount > 0) {
          buyQueue.push({ amount: outputAmount, cost: inputAmount, price: unitPrice });
          totalBNBSpent += inputAmount;
        }
      } else {
        const inputAmount = parseFloat(trade.input_amount || 0);
        const outputAmount = parseFloat(trade.output_amount || 0);

        let remainingToSell = inputAmount;
        let costOfSold = 0;

        while (remainingToSell > 0 && buyQueue.length > 0) {
          const oldestBuy = buyQueue[0];
          const sellAmount = Math.min(remainingToSell, oldestBuy.amount);
          const unitCost = oldestBuy.cost / oldestBuy.amount;
          costOfSold += unitCost * sellAmount;
          remainingToSell -= sellAmount;
          oldestBuy.amount -= sellAmount;
          oldestBuy.cost -= unitCost * sellAmount;

          if (oldestBuy.amount <= 0.00000001) {
            buyQueue.shift();
          }
        }

        totalBNBReceived += outputAmount;
        totalRealizedPnL += (outputAmount - costOfSold);
      }
    });

    let remainingAmount = 0;
    let remainingCost = 0;
    buyQueue.forEach(buy => {
      remainingAmount += buy.amount;
      remainingCost += buy.cost;
    });

    const totalCost = totalBNBSpent || 1;
    const totalValue = totalBNBReceived + remainingCost;
    const returnRate = ((totalValue - totalCost) / totalCost) * 100;

    let status = 'monitoring';
    if (buyQueue.length === 0) status = 'exited';
    else if (totalBNBReceived > 0) status = 'bought';

    return {
      returnRate,
      realizedPnL: totalRealizedPnL,
      totalSpent: totalBNBSpent,
      totalReceived: totalBNBReceived,
      remainingAmount,
      remainingCost,
      status
    };
  }

  /**
   * 从买入交易中提取因子
   */
  extractFactors(buyTrade) {
    return buyTrade?.metadata?.factors?.trendFactors || {};
  }

  /**
   * 格式化百分比
   */
  formatPercent(value) {
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
  }

  /**
   * 格式化BNB
   */
  formatBNB(value) {
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(4)} BNB`;
  }
}

module.exports = { AnalyzerBase };
