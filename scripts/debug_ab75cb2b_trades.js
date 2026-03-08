const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function debug() {
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', 'ab75cb2b-4930-4049-a3bd-f96e3de6af47')
    .order('created_at', { ascending: true });

  console.log('总交易数:', trades?.length || 0);

  if (trades && trades.length > 0) {
    console.log('\n前几条交易:');
    trades.slice(0, 10).forEach((t, i) => {
      console.log(`${i+1}. ${t.action} ${t.token_symbol} - ${t.amount} BNB - ${t.created_at}`);
    });

    // 按代币分组
    const groups = new Map();
    trades.forEach(t => {
      if (!groups.has(t.token_address)) {
        groups.set(t.token_address, []);
      }
      groups.get(t.token_address).push(t);
    });

    console.log('\n代币数量:', groups.size);

    // 计算每个代币的收益
    console.log('\n代币收益分析:');
    let idx = 1;
    for (const [addr, ts] of groups) {
      const buys = ts.filter(t => t.action === 'buy');
      const sells = ts.filter(t => t.action === 'sell');
      const symbol = ts[0].token_symbol || addr.substring(0, 8);

      let totalBuyAmount = 0;
      let totalSellAmount = 0;

      buys.forEach(t => totalBuyAmount += t.amount || 0);
      sells.forEach(t => totalSellAmount += t.amount || 0);

      const profit = totalSellAmount - totalBuyAmount;
      const profitPercent = totalBuyAmount > 0 ? (profit / totalBuyAmount) * 100 : 0;

      console.log(`${idx++}. ${symbol}: ${buys.length}买${sells.length}卖, 投入${totalBuyAmount.toFixed(4)}, 返回${totalSellAmount.toFixed(4)}, 收益${profitPercent.toFixed(2)}%`);

      if (idx > 20) break;
    }
  }
}

debug().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
