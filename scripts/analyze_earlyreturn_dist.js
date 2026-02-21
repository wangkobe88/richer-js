require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

(async () => {
  // 按代币统计买入次数
  const { data: allBuys } = await supabase
    .from('strategy_signals')
    .select('token_symbol, token_address, metadata')
    .eq('experiment_id', '0cc6804d-834e-44f8-8287-c4b4a78abd30')
    .eq('action', 'buy');

  const byToken = {};
  for (const buy of (allBuys || [])) {
    const symbol = buy.token_symbol;
    if (!byToken[symbol]) {
      byToken[symbol] = { count: 0, returns: [], address: buy.token_address };
    }
    byToken[symbol].count++;
    byToken[symbol].returns.push(buy.metadata?.earlyReturn || 0);
  }

  console.log('各代币买入次数和平均 earlyReturn:');
  Object.entries(byToken)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20)
    .forEach(([symbol, data]) => {
      const avgReturn = data.returns.reduce((a, b) => a + b, 0) / data.returns.length;
      console.log(`  ${symbol}: ${data.count}次, avg earlyReturn=${avgReturn.toFixed(2)}%`);
    });

  // 查看 earlyReturn > 200 的代币
  console.log('\nearlyReturn > 200% 的代币:');
  Object.entries(byToken)
    .filter(([_, data]) => data.returns.some(r => r > 200))
    .forEach(([symbol, data]) => {
      data.returns.forEach((r, i) => {
        if (r > 200) {
          console.log(`  ${symbol}: ${r.toFixed(2)}%`);
        }
      });
    });

  // 统计 earlyReturn 分布
  const allReturns = (allBuys || []).map(s => s.metadata?.earlyReturn || 0).filter(r => r > 0);
  allReturns.sort((a, b) => a - b);

  console.log('\nearlyReturn 分布:');
  console.log(`  总样本: ${allReturns.length}`);
  console.log(`  最小值: ${allReturns[0]?.toFixed(2)}%`);
  console.log(`  25%: ${allReturns[Math.floor(allReturns.length * 0.25)]?.toFixed(2)}%`);
  console.log(`  50%: ${allReturns[Math.floor(allReturns.length * 0.5)]?.toFixed(2)}%`);
  console.log(`  75%: ${allReturns[Math.floor(allReturns.length * 0.75)]?.toFixed(2)}%`);
  console.log(`  90%: ${allReturns[Math.floor(allReturns.length * 0.9)]?.toFixed(2)}%`);
  console.log(`  最大值: ${allReturns[allReturns.length - 1]?.toFixed(2)}%`);
})();
