/**
 * 分析买卖时序，理解为什么会接近100%亏损
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function analyzeTradeTiming() {
  const experimentId = 'ab75cb2b-4930-4049-a3bd-f96e3de6af47';

  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  if (!trades || trades.length === 0) return;

  // 按代币分组
  const tokenTrades = new Map();
  trades.forEach(t => {
    if (!tokenTrades.has(t.token_address)) {
      tokenTrades.set(t.token_address, []);
    }
    tokenTrades.get(t.token_address).push(t);
  });

  console.log('【买卖时序分析 - 随机抽查几个代币】\n');

  let count = 0;
  for (const [address, tokenTradesList] of tokenTrades.entries()) {
    if (count >= 5) break;

    const buyTrade = tokenTradesList.find(t => t.trade_direction === 'buy');
    const sellTrade = tokenTradesList.find(t => t.trade_direction === 'sell');

    if (buyTrade && sellTrade) {
      const buyMetadata = buyTrade.metadata?.factors?.trendFactors;
      const buyPrice = buyTrade.unit_price;
      const sellPrice = sellTrade.unit_price;
      
      const priceDrop = ((buyPrice - sellPrice) / buyPrice) * 100;
      
      console.log(`${buyTrade.token_symbol}:`);
      console.log(`  买入价格: ${buyPrice.toFixed(10)} BNB (时间: ${new Date(buyTrade.executed_at).toLocaleString()})`);
      console.log(`  卖出价格: ${sellPrice.toFixed(10)} BNB (时间: ${new Date(sellTrade.executed_at).toLocaleString()})`);
      console.log(`  价格跌幅: ${priceDrop.toFixed(2)}%`);
      
      if (buyMetadata) {
        console.log(`  买入时趋势因子:`);
        console.log(`    earlyReturn: ${buyMetadata.earlyReturn?.toFixed(2) || 'N/A'}%`);
        console.log(`    highestPrice: ${buyMetadata.highestPrice?.toFixed(10) || 'N/A'} BNB`);
        console.log(`    drawdownFromHighest: ${buyMetadata.drawdownFromHighest?.toFixed(2) || 'N/A'}%`);
      }
      console.log('');
      
      count++;
    }
  }

  // 分析卖出时机
  console.log('【卖出触发条件分析】\n');
  console.log('卖出条件: drawdownFromHighest <= -20');
  console.log('这意味着从最高点回落20%时卖出\n');

  // 检查是否有代币在买入后立即触发卖出
  const quickSellCount = [];
  
  for (const [address, tokenTradesList] of tokenTrades.entries()) {
    const buyTrade = tokenTradesList.find(t => t.trade_direction === 'buy');
    const sellTrade = tokenTradesList.find(t => t.trade_direction === 'sell');
    
    if (buyTrade && sellTrade) {
      const buyTime = new Date(buyTrade.executed_at).getTime();
      const sellTime = new Date(sellTrade.executed_at).getTime();
      const holdMinutes = (sellTime - buyTime) / 60000;
      
      if (holdMinutes < 5) {
        quickSellCount.push({
          symbol: buyTrade.token_symbol,
          holdMinutes,
          buyTime: new Date(buyTrade.executed_at).toLocaleString(),
          sellTime: new Date(sellTrade.executed_at).toLocaleString()
        });
      }
    }
  }

  if (quickSellCount.length > 0) {
    console.log(`快速卖出（5分钟内）的代币: ${quickSellCount.length} 个\n`);
    quickSellCount.slice(0, 10).forEach(t => {
      console.log(`  ${t.symbol}: 持仓 ${t.holdMinutes.toFixed(2)} 分钟`);
      console.log(`    买入: ${t.buyTime}`);
      console.log(`    卖出: ${t.sellTime}`);
    });
  }

  // 分析价格走势
  console.log('\n【价格走势分析】\n');
  console.log('可能的情况:');
  console.log('1. 代币在买入后短暂上涨，然后急剧下跌');
  console.log('2. 卖出时价格已接近归零');
  console.log('3. -20%的止损触发太晚，价格已经大幅下跌\n');

  console.log('建议优化:');
  console.log('1. 更紧密的止损策略（如 -10% 或 -15%）');
  console.log('2. 时间止损（如持仓超过5分钟无上涨就卖出）');
  console.log('3. 结合价格变动率止损');
}

analyzeTradeTiming().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('分析失败:', error);
  process.exit(1);
});
