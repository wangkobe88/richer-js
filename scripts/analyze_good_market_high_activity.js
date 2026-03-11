/**
 * 深度分析市场好实验中的 countPerMin >= 150 代币
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
  const [tradesData, signalsData] = await Promise.all([
    get('http://localhost:3010/api/experiment/1dde2be5-2f4e-49fb-9520-cb032e9ef759/trades?limit=10000'),
    get('http://localhost:3010/api/experiment/1dde2be5-2f4e-49fb-9520-cb032e9ef759/signals?limit=10000')
  ]);

  // 计算收益率
  const tokenPnL = {};
  tradesData.trades.forEach(t => {
    if (t.trade_status !== 'success') return;
    const addr = t.token_address;
    if (!tokenPnL[addr]) {
      tokenPnL[addr] = {
        symbol: t.token_symbol,
        address: addr,
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

  const tokenFactors = {};
  signalsData.signals.filter(s => s.action === 'buy' && s.executed === true).forEach(s => {
    if (!tokenFactors[s.token_address]) {
      const f = s.metadata?.preBuyCheckFactors || {};
      const tf = s.metadata?.trendFactors || {};
      tokenFactors[s.token_address] = {
        countPerMin: f.earlyTradesCountPerMin,
        top2Ratio: f.walletClusterTop2Ratio,
        secondToFirstRatio: f.walletClusterSecondToFirstRatio,
        megaRatio: f.walletClusterMegaRatio,
        earlyReturn: tf.earlyReturn,
        uniqueWallets: f.earlyTradesUniqueWallets,
        highValueCount: f.earlyTradesHighValueCount,
      };
    }
  });

  const dataset = tokens.map(t => ({
    ...t,
    factors: tokenFactors[t.address] || {}
  })).filter(t => Object.keys(t.factors).length > 0);

  const highActivity = dataset.filter(t => t.factors.countPerMin >= 150);

  console.log(`\n=== 市场好实验中 countPerMin >= 150 的代币分析 ===\n`);
  console.log(`共 ${highActivity.length} 个代币\n`);

  highActivity.forEach(t => {
    const isLosing = t.returnRate <= 0;
    const status = isLosing ? '❌ 亏损' : '✅ 盈利';
    console.log(`${status} ${t.symbol}: ${t.returnRate.toFixed(1)}%, countPerMin=${t.factors.countPerMin.toFixed(1)}, earlyReturn=${t.factors.earlyReturn?.toFixed(1) || 'N/A'}%`);
    console.log(`  top2Ratio=${t.factors.top2Ratio?.toFixed(2) || 'N/A'}, uniqueWallets=${t.factors.uniqueWallets}, highValueCount=${t.factors.highValueCount}`);
    console.log('');
  });

  // 分析为什么这些代币在市场好时盈利
  console.log('=== 为什么市场好时这些超活跃代币能盈利？===\n');

  const profitableHighActivity = highActivity.filter(t => t.returnRate > 0);
  const losingHighActivity = highActivity.filter(t => t.returnRate <= 0);

  if (profitableHighActivity.length > 0) {
    console.log(`盈利的${profitableHighActivity.length}个代币特征：`);
    profitableHighActivity.forEach(t => {
      console.log(`  ${t.symbol}:`);
      console.log(`    earlyReturn=${t.factors.earlyReturn?.toFixed(1)}%, top2Ratio=${t.factors.top2Ratio?.toFixed(2)}, uniqueWallets=${t.factors.uniqueWallets}`);
    });
  }

  if (losingHighActivity.length > 0) {
    console.log(`\n亏损的${losingHighActivity.length}个代币特征：`);
    losingHighActivity.forEach(t => {
      console.log(`  ${t.symbol}:`);
      console.log(`    earlyReturn=${t.factors.earlyReturn?.toFixed(1)}%, top2Ratio=${t.factors.top2Ratio?.toFixed(2)}, uniqueWallets=${t.factors.uniqueWallets}`);
    });
  }

  // 对比 countPerMin >= 100 的代币
  console.log('\n=== 对比：countPerMin >= 100 的代币 ===\n');

  const highActivity100 = dataset.filter(t => t.factors.countPerMin >= 100);
  const losing100 = highActivity100.filter(t => t.returnRate <= 0);
  const avgReturn100 = highActivity100.reduce((a, t) => a + t.returnRate, 0) / highActivity100.length;

  console.log(`countPerMin >= 100：${highActivity100.length} 个代币`);
  console.log(`  亏损：${losing100.length}/${highActivity100.length} (${(losing100.length/highActivity100.length*100).toFixed(1)}%)`);
  console.log(`  平均收益：${avgReturn100.toFixed(1)}%\n`);

  highActivity100.forEach(t => {
    const status = t.returnRate <= 0 ? '❌' : '✅';
    console.log(`  ${status} ${t.symbol}: ${t.returnRate.toFixed(1)}%, countPerMin=${t.factors.countPerMin.toFixed(1)}, earlyReturn=${t.factors.earlyReturn?.toFixed(1) || 'N/A'}%`);
  });
}

main().catch(console.error);
