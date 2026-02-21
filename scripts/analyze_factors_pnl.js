require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

(async () => {
  // 获取所有交易
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', '0cc6804d-834e-44f8-8287-c4b4a78abd30')
    .order('created_at', { ascending: true });

  console.log('总交易数:', trades.length);

  // 获取所有买入信号（包含 factors）
  const { data: buySignals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', '0cc6804d-834e-44f8-8287-c4b4a78abd30')
    .eq('action', 'buy')
    .order('created_at', { ascending: true });

  console.log('买入信号数:', buySignals.length);

  // 按代币分组交易
  const byToken = {};
  trades.forEach(t => {
    const symbol = t.token_symbol || 'Unknown';
    if (!byToken[symbol]) {
      byToken[symbol] = { buyTrades: [], sellTrades: [], symbol };
    }
    if (t.trade_direction === 'buy') {
      byToken[symbol].buyTrades.push(t);
    } else {
      byToken[symbol].sellTrades.push(t);
    }
  });

  // 获取每个代币的首次买入信号 factors
  const tokenBuyFactors = {};
  buySignals.forEach(s => {
    const symbol = s.token_symbol;
    if (!tokenBuyFactors[symbol] && s.metadata) {
      tokenBuyFactors[symbol] = s.metadata;
    }
  });

  // 计算每个代币的收益
  const results = [];
  for (const [symbol, data] of Object.entries(byToken)) {
    const buyInput = data.buyTrades.reduce((sum, t) => sum + parseFloat(t.input_amount || 0), 0);
    const sellOutput = data.sellTrades.reduce((sum, t) => sum + parseFloat(t.output_amount || 0), 0);
    const profit = sellOutput - buyInput;
    const roi = buyInput > 0 ? (profit / buyInput * 100) : 0;

    const factors = tokenBuyFactors[symbol] || {};

    results.push({
      symbol,
      buyInput,
      sellOutput,
      profit,
      roi,
      factors
    });
  }

  // 按收益排序
  results.sort((a, b) => b.roi - a.roi);

  console.log('\n=== 代币收益与买入因子分析 ===\n');

  // 表头
  console.log('代币'.padEnd(18) + ' | 收益率'.padEnd(10) + ' | holders'.padEnd(10) + ' | earlyReturn'.padEnd(12) + ' | fdv');
  console.log('-'.repeat(95));

  results.forEach(r => {
    const f = r.factors;
    const holders = f.holders ?? 'N/A';
    const earlyReturn = f.earlyReturn ?? 'N/A';
    const fdv = f.fdv ?? 'N/A';

    console.log(
      r.symbol.padEnd(18) + ' | ' +
      (r.roi >= 0 ? '+' : '') + r.roi.toFixed(2).padEnd(9) + '% | ' +
      String(holders).padEnd(10) + ' | ' +
      String(earlyReturn).padEnd(12) + ' | ' +
      String(fdv)
    );
  });

  // 分析盈利和亏损代币的因子分布
  console.log('\n=== 盈利 vs 亏损代币因子对比 ===');

  const profitable = results.filter(r => r.roi > 0);
  const loss = results.filter(r => r.roi <= 0);

  console.log('\n盈利代币: ' + profitable.length + ' 个');
  console.log('亏损代币: ' + loss.length + ' 个');

  const analyzeFactor = (name, getter) => {
    const pValues = profitable.map(r => getter(r.factors)).filter(v => v != null && !isNaN(v));
    const lValues = loss.map(r => getter(r.factors)).filter(v => v != null && !isNaN(v));

    if (pValues.length === 0 || lValues.length === 0) {
      console.log(`${name}: 数据不足`);
      return;
    }

    const pAvg = pValues.reduce((a, b) => a + b, 0) / pValues.length;
    const lAvg = lValues.reduce((a, b) => a + b, 0) / lValues.length;

    // 排序看中位数
    const pSorted = [...pValues].sort((a, b) => a - b);
    const lSorted = [...lValues].sort((a, b) => a - b);
    const pMedian = pSorted[Math.floor(pSorted.length / 2)];
    const lMedian = lSorted[Math.floor(lSorted.length / 2)];

    console.log(`\n${name}:`);
    console.log(`  盈利代币 - 平均: ${pAvg.toFixed(2)}, 中位数: ${pMedian.toFixed(2)}`);
    console.log(`  亏损代币 - 平均: ${lAvg.toFixed(2)}, 中位数: ${lMedian.toFixed(2)}`);
    console.log(`  差异: ${pAvg > lAvg ? '盈利高' : '亏损高'} ${Math.abs((pAvg - lAvg) / (lAvg || 1) * 100).toFixed(2)}%`);

    // 找最佳阈值
    const avgThreshold = (pAvg + lAvg) / 2;
    const medianThreshold = (pMedian + lMedian) / 2;
    console.log(`  建议阈值: 平均 ${avgThreshold.toFixed(2)}, 中位数 ${medianThreshold.toFixed(2)}`);
  };

  analyzeFactor('holders', f => f.holders);
  analyzeFactor('earlyReturn', f => f.earlyReturn);
  analyzeFactor('fdv', f => f.fdv);
  analyzeFactor('marketCap', f => f.marketCap);
  analyzeFactor('tvl', f => f.tvl);
  analyzeFactor('txVolumeU24h', f => f.txVolumeU24h);
})();
