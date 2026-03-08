/**
 * 使用前端页面的FIFO方法正确计算收益
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function correctAnalysis() {
  const experimentId = 'ab75cb2b-4930-4049-a3bd-f96e3de6af47';

  // 获取交易数据
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  if (!trades || trades.length === 0) {
    console.log('没有交易数据');
    return;
  }

  console.log(`总交易数: ${trades.length}\n`);

  // 按代币分组，使用FIFO计算收益（复用前端逻辑）
  const tokenAddresses = [...new Set(trades.map(t => t.token_address))];
  
  const results = tokenAddresses.map(tokenAddress => {
    // 获取该代币的所有成功交易，按时间排序
    const tokenTrades = trades
      .filter(t => t.token_address === tokenAddress && (t.status === 'success' || t.trade_status === 'success'))
      .sort((a, b) => new Date(a.created_at || a.executed_at) - new Date(b.created_at || b.executed_at));

    if (tokenTrades.length === 0) return null;

    // FIFO 队列跟踪买入成本
    const buyQueue = []; // { amount, cost, price }
    let totalRealizedPnL = 0;
    let totalBNBSpent = 0;
    let totalBNBReceived = 0;

    tokenTrades.forEach(trade => {
      const direction = trade.trade_direction || trade.direction || trade.action;
      const isBuy = direction === 'buy' || direction === 'BUY';

      if (isBuy) {
        // 买入
        const inputAmount = parseFloat(trade.input_amount || 0); // BNB 花费
        const outputAmount = parseFloat(trade.output_amount || 0); // 代币数量
        const unitPrice = parseFloat(trade.unit_price || 0);

        if (outputAmount > 0) {
          buyQueue.push({
            amount: outputAmount,
            cost: inputAmount,
            price: unitPrice
          });
          totalBNBSpent += inputAmount;
        }
      } else {
        // 卖出
        const inputAmount = parseFloat(trade.input_amount || 0); // 代币数量
        const outputAmount = parseFloat(trade.output_amount || 0); // BNB 收到
        
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

    // 计算剩余持仓
    let remainingAmount = 0;
    let remainingCost = 0;
    buyQueue.forEach(buy => {
      remainingAmount += buy.amount;
      remainingCost += buy.cost;
    });

    // 获取代币符号
    const symbol = tokenTrades[0]?.token_symbol || 'Unknown';

    return {
      tokenAddress,
      symbol,
      returnRate: totalBNBSpent > 0 ? ((totalBNBReceived + remainingCost - totalBNBSpent) / totalBNBSpent * 100) : 0,
      realizedPnL: totalRealizedPnL,
      totalSpent: totalBNBSpent,
      totalReceived: totalBNBReceived,
      remainingCost,
      buyCount: tokenTrades.filter(t => (t.trade_direction || t.direction || t.action) === 'buy' || (t.trade_direction || t.direction || t.action) === 'BUY').length,
      sellCount: tokenTrades.filter(t => (t.trade_direction || t.direction || t.action) === 'sell' || (t.trade_direction || t.direction || t.action) === 'SELL').length
    };
  }).filter(item => item !== null);

  // 按收益率排序
  results.sort((a, b) => b.returnRate - a.returnRate);

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    正确的收益分析（FIFO方法）                                   ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  console.log('序号  代币                      收益率%   已实现盈亏  总花费BNB  总收回BNB  买入次数  卖出次数');
  console.log('─'.repeat(106));

  const profitableTokens = results.filter(t => t.returnRate > 0);
  const lossTokens = results.filter(t => t.returnRate < 0);
  const winRate = results.length > 0 ? (profitableTokens.length / results.length * 100) : 0;

  results.forEach((t, index) => {
    const profitColor = t.returnRate >= 0 ? '\x1b[32m' : '\x1b[31m';
    const resetColor = '\x1b[0m';
    
    console.log(
      String(index + 1).padStart(4) + '. ' +
      (t.symbol || t.token_address.substring(0, 10)).padEnd(24) +
      profitColor + t.returnRate.toFixed(2).padStart(8) + '%' + resetColor +
      (t.realizedPnL >= 0 ? '+' : '') + t.realizedPnL.toFixed(4).padStart(10) +
      t.totalSpent.toFixed(4).padStart(10) +
      t.totalReceived.toFixed(4).padStart(10) +
      t.buyCount.toString().padStart(8) +
      t.sellCount.toString().padStart(8)
    );
  });
  console.log('');

  // 统计
  const totalSpent = results.reduce((sum, t) => sum + t.totalSpent, 0);
  const totalReceived = results.reduce((sum, t) => sum + t.totalReceived, 0);
  const totalProfit = totalReceived - totalSpent;
  const totalProfitPercent = totalSpent > 0 ? (totalProfit / totalSpent * 100) : 0;

  console.log('【整体统计】');
  console.log(`  总花费: ${totalSpent.toFixed(4)} BNB`);
  console.log(`  总收回: ${totalReceived.toFixed(4)} BNB`);
  console.log(`  净盈亏: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(4)} BNB (${totalProfitPercent >= 0 ? '+' : ''}${totalProfitPercent.toFixed(2)}%)`);
  console.log(`  胜率: ${winRate.toFixed(1)}% (${profitableTokens.length}胜 / ${results.length}总)`);
  console.log(`  盈利代币: ${profitableTokens.length}`);
  console.log(`  亏损代币: ${lossTokens.length}`);
}

correctAnalysis().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('分析失败:', error);
  process.exit(1);
});
