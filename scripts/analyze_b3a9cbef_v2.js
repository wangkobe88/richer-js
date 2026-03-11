/**
 * 分析 b3a9cbef 实验 - 修复版
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

  const [tradesData, signalsData] = await Promise.all([
    get('http://localhost:3010/api/experiment/b3a9cbef-8d89-4203-b090-e12bca06c511/trades?limit=10000'),
    get('http://localhost:3010/api/experiment/b3a9cbef-8d89-4203-b090-e12bca06c511/signals?limit=10000')
  ]);

  // 分析 buy 信号
  const buySignals = signalsData.signals?.filter(s => s.action === 'buy' && s.executed === true) || [];
  console.log(`执行的 buy 信号: ${buySignals.length}\n`);

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

  const tokens = Object.entries(tokenPnL).map(([addr, data]) => ({
    address: addr,
    symbol: data.symbol,
    returnRate: data.totalSpent > 0 ? ((data.totalReceived - data.totalSpent) / data.totalSpent * 100) : 0
  }));

  // 构建因子映射 - 使用正确的地址匹配
  const tokenFactors = {};
  buySignals.forEach(s => {
    // 使用 lowercase 来匹配地址
    const addr = s.token_address.toLowerCase();
    if (!tokenFactors[addr]) {
      const f = s.metadata?.preBuyCheckFactors || {};
      const tf = s.metadata?.trendFactors || {};
      tokenFactors[addr] = {
        countPerMin: f.earlyTradesCountPerMin,
        top2Ratio: f.walletClusterTop2Ratio,
        uniqueWallets: f.earlyTradesUniqueWallets,
        earlyReturn: tf.earlyReturn,
        symbol: s.token_symbol
      };
    }
  });

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【所有代币的收益和因子】（按收益排序）');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const dataset = tokens.map(t => ({
    ...t,
    factors: tokenFactors[t.address.toLowerCase()] || {}
  }));

  dataset.sort((a, b) => b.returnRate - a.returnRate);

  // 只显示有因子数据的代币
  const withFactors = dataset.filter(t => Object.keys(t.factors).length > 0 && t.factors.countPerMin !== undefined);
  const withoutFactors = dataset.filter(t => Object.keys(t.factors).length === 0 || t.factors.countPerMin === undefined);

  console.log(`有因子数据的代币: ${withFactors.length}`);
  console.log(`无因子数据的代币: ${withoutFactors.length}\n`);

  console.log('【有因子数据的代币】\n');
  withFactors.forEach(t => {
    const status = t.returnRate > 0 ? '✅' : '❌';
    console.log(`${status} ${t.symbol}: ${t.returnRate.toFixed(1)}%`);
    console.log(`   countPerMin=${t.factors.countPerMin?.toFixed(1) || 'N/A'}, top2Ratio=${t.factors.top2Ratio?.toFixed(2) || 'N/A'}, uniqueWallets=${t.factors.uniqueWallets || 'N/A'}`);
    console.log('');
  });

  // 分析过滤效果
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【过滤效果分析】（基于有因子数据的代币）');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const testFilter = (name, filterFn) => {
    const passed = withFactors.filter(filterFn);
    const filtered = withFactors.filter(t => !filterFn(t));
    const passedProfit = passed.filter(t => t.returnRate > 0);
    const filteredProfit = filtered.filter(t => t.returnRate > 0);
    const passedAvg = passed.length > 0 ? passed.reduce((a, t) => a + t.returnRate, 0) / passed.length : 0;
    const filteredAvg = filtered.length > 0 ? filtered.reduce((a, t) => a + t.returnRate, 0) / filtered.length : 0;

    console.log(`${name}:`);
    console.log(`  通过: ${passed.length} 个（${passedProfit.length} 盈利），平均 ${passedAvg.toFixed(1)}%`);
    if (filtered.length > 0) {
      console.log(`  过滤: ${filtered.length} 个（${filteredProfit.length} 盈利），平均 ${filteredAvg.toFixed(1)}%`);
      if (filteredProfit.length > 0) {
        console.log(`  错失的盈利代币:`);
        filteredProfit.forEach(t => {
          console.log(`    ${t.symbol}: +${t.returnRate.toFixed(1)}%, countPerMin=${t.factors.countPerMin?.toFixed(1)}, top2Ratio=${t.factors.top2Ratio?.toFixed(2)}`);
        });
      }
    }
    console.log('');
  };

  testFilter('countPerMin < 150', t => t.factors.countPerMin < 150);
  testFilter('top2Ratio < 0.7', t => t.factors.top2Ratio < 0.7);
  testFilter('top2Ratio < 0.75', t => t.factors.top2Ratio < 0.75);
  testFilter('top2Ratio < 0.8', t => t.factors.top2Ratio < 0.8);
  testFilter('top2Ratio < 0.85', t => t.factors.top2Ratio < 0.85);
  testFilter('countPerMin < 150 AND top2Ratio < 0.7', t =>
    t.factors.countPerMin < 150 && t.factors.top2Ratio < 0.7
  );
}

main().catch(console.error);
