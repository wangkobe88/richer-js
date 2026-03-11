/**
 * 分析 b3a9cbef 实验
 * 看看 top2Ratio 和 countPerMin 的真实分布
 */

const http = require('http');

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function main() {
  console.log('=== 分析实验 b3a9cbef ===\n');

  const [tradesData, signalsData, tokensData] = await Promise.all([
    get('http://localhost:3010/api/experiment/b3a9cbef-8d89-4203-b090-e12bca06c511/trades?limit=10000'),
    get('http://localhost:3010/api/experiment/b3a9cbef-8d89-4203-b090-e12bca06c511/signals?limit=10000'),
    get('http://localhost:3010/api/experiment/b3a9cbef-8d89-4203-b090-e12bca06c511/tokens?limit=1000')
  ]);

  console.log(`Trades: ${tradesData.trades?.length || 0}`);
  console.log(`Signals: ${signalsData.signals?.length || 0}`);
  console.log(`Tokens: ${tokensData.tokens?.length || 0}\n`);

  // 分析 buy 信号
  const buySignals = signalsData.signals?.filter(s => s.action === 'buy' && s.executed === true) || [];
  console.log(`执行的 buy 信号: ${buySignals.length}\n`);

  if (buySignals.length > 0) {
    console.log('前 5 个 buy 信号的因子：');
    buySignals.slice(0, 5).forEach(s => {
      const f = s.metadata?.preBuyCheckFactors || {};
      const tf = s.metadata?.trendFactors || {};
      console.log(`\n  ${s.token_symbol}:`);
      console.log(`    countPerMin: ${f.earlyTradesCountPerMin || 'N/A'}`);
      console.log(`    top2Ratio: ${f.walletClusterTop2Ratio || 'N/A'}`);
      console.log(`    uniqueWallets: ${f.earlyTradesUniqueWallets || 'N/A'}`);
      console.log(`    earlyReturn: ${tf.earlyReturn || 'N/A'}%`);
    });
  }

  // 计算代币收益
  const tokenPnL = {};
  tradesData.trades?.forEach(t => {
    if (t.trade_status !== 'success') return;
    const addr = t.token_address;
    if (!tokenPnL[addr]) {
      tokenPnL[addr] = {
        symbol: t.token_symbol,
        totalSpent: 0,
        totalReceived: 0
      };
    }
    if (t.direction === 'buy') {
      tokenPnL[addr].totalSpent += parseFloat(t.input_amount || 0);
    } else if (t.direction === 'sell') {
      tokenPnL[addr].totalReceived += parseFloat(t.output_amount || 0);
    }
  });

  const tokens = Object.values(tokenPnL).map(t => ({
    ...t,
    returnRate: t.totalSpent > 0 ? ((t.totalReceived - t.totalSpent) / t.totalSpent * 100) : 0
  }));

  // 构建因子映射
  const tokenFactors = {};
  buySignals.forEach(s => {
    if (!tokenFactors[s.token_address]) {
      const f = s.metadata?.preBuyCheckFactors || {};
      const tf = s.metadata?.trendFactors || {};
      tokenFactors[s.token_address] = {
        countPerMin: f.earlyTradesCountPerMin,
        top2Ratio: f.walletClusterTop2Ratio,
        uniqueWallets: f.earlyTradesUniqueWallets,
        earlyReturn: tf.earlyReturn,
      };
    }
  });

  const dataset = tokens.map(t => ({
    ...t,
    factors: tokenFactors[t.address] || {}
  }));

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【所有代币的收益和因子】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  dataset.sort((a, b) => b.returnRate - a.returnRate);

  dataset.forEach(t => {
    const status = t.returnRate > 0 ? '✅' : '❌';
    console.log(`${status} ${t.symbol}: ${t.returnRate.toFixed(1)}%`);
    console.log(`   countPerMin=${t.factors.countPerMin || 'N/A'}, top2Ratio=${t.factors.top2Ratio || 'N/A'}, earlyReturn=${t.factors.earlyReturn || 'N/A'}%`);
    console.log('');
  });

  // 分析 countPerMin < 150 的过滤效果
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【过滤效果分析】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const testFilter = (name, filterFn) => {
    const passed = dataset.filter(filterFn);
    const filtered = dataset.filter(t => !filterFn(t));
    const passedProfit = passed.filter(t => t.returnRate > 0);
    const filteredProfit = filtered.filter(t => t.returnRate > 0);
    const passedAvg = passed.length > 0 ? passed.reduce((a, t) => a + t.returnRate, 0) / passed.length : 0;
    const filteredAvg = filtered.length > 0 ? filtered.reduce((a, t) => a + t.returnRate, 0) / filtered.length : 0;

    console.log(`${name}:`);
    console.log(`  通过: ${passed.length} 个（${passedProfit.length} 盈利），平均 ${passedAvg.toFixed(1)}%`);
    console.log(`  过滤: ${filtered.length} 个（${filteredProfit.length} 盈利），平均 ${filteredAvg.toFixed(1)}%`);
    console.log('');
  };

  testFilter('countPerMin < 150', t => t.factors.countPerMin < 150 || t.factors.countPerMin === undefined);
  testFilter('top2Ratio < 0.7', t => t.factors.top2Ratio < 0.7 || t.factors.top2Ratio === undefined);
  testFilter('countPerMin < 150 AND top2Ratio < 0.7', t =>
    (t.factors.countPerMin < 150 || t.factors.countPerMin === undefined) &&
    (t.factors.top2Ratio < 0.7 || t.factors.top2Ratio === undefined)
  );
  testFilter('top2Ratio < 0.8', t => t.factors.top2Ratio < 0.8 || t.factors.top2Ratio === undefined);
  testFilter('top2Ratio < 0.85', t => t.factors.top2Ratio < 0.85 || t.factors.top2Ratio === undefined);
}

main().catch(console.error);
