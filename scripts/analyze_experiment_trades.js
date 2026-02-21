require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

(async () => {
  // 按代币分组分析
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', '0cc6804d-834e-44f8-8287-c4b4a78abd30')
    .order('created_at', { ascending: true });

  const byToken = {};
  trades.forEach(t => {
    const symbol = t.token_symbol || 'Unknown';
    if (!byToken[symbol]) {
      byToken[symbol] = [];
    }
    byToken[symbol].push(t);
  });

  console.log('=== 按代币分析 ===');
  const results = [];

  for (const [symbol, tokenTrades] of Object.entries(byToken)) {
    let tokenInput = 0;
    let tokenOutput = 0;

    tokenTrades.forEach(t => {
      if (t.trade_direction === 'buy') {
        // 买入：input_amount 是花费的 BNB
        tokenInput += parseFloat(t.input_amount) || 0;
      } else {
        // 卖出：output_amount 是获得的 BNB
        tokenOutput += parseFloat(t.output_amount) || 0;
      }
    });

    const profit = tokenOutput - tokenInput;
    const roi = tokenInput > 0 ? (profit / tokenInput * 100) : 0;

    results.push({
      symbol,
      tokenInput,
      tokenOutput,
      profit,
      roi,
      tradeCount: tokenTrades.length
    });

    console.log(symbol + ':');
    console.log('   买入: ' + tokenInput.toFixed(4) + ' BNB');
    console.log('  卖出: ' + tokenOutput.toFixed(4) + ' BNB');
    console.log('  净收益: ' + profit.toFixed(4) + ' BNB');
    console.log('  收益率: ' + roi.toFixed(2) + '%');
    console.log('  交易次数: ' + tokenTrades.length);
    console.log('');
  }

  // 统计
  const totalInput = results.reduce((s, t) => s + t.tokenInput, 0);
  const totalOutput = results.reduce((s, t) => s + t.tokenOutput, 0);
  const totalProfit = totalOutput - totalInput;
  const totalRoi = totalInput > 0 ? (totalProfit / totalInput * 100) : 0;

  console.log('=== 总体统计 ===');
  console.log('买入代币数: ' + results.length);
  console.log('总投入: ' + totalInput.toFixed(4) + ' BNB');
  console.log('总回报: ' + totalOutput.toFixed(4) + ' BNB');
  console.log('净收益: ' + totalProfit.toFixed(4) + ' BNB');
  console.log('收益率: ' + totalRoi.toFixed(2) + '%');

  // 显示盈利和亏损的代币
  const profitable = results.filter(t => t.profit > 0);
  const loss = results.filter(t => t.profit <= 0);

  console.log('');
  console.log('=== 盈利代币 (' + profitable.length + ') ===');
  profitable.sort((a, b) => b.roi - a.roi).forEach((t, i) => {
    console.log((i + 1) + '. ' + t.symbol.padEnd(12) + ' | 收益率: ' + t.roi.toFixed(2) + '%');
  });

  console.log('');
  console.log('=== 亏损代币 (' + loss.length + ') ===');
  loss.sort((a, b) => a.roi - b.roi).forEach((t, i) => {
    console.log((i + 1) + '. ' + t.symbol.padEnd(12) + ' | 收益率: ' + t.roi.toFixed(2) + '%');
  });
})();
