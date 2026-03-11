/**
 * 基于 known good results 的因子分析
 * 找出除 countPerMin 外的其他宝藏因子
 */

// 基于之前分析结果，我们知道：
// 1. countPerMin >= 150 在市场差时是100%亏损（7个代币）
// 2. 在市场好时，countPerMin >= 150 的5个代币中，3个亏损，2个盈利（CMO +6.2%, Dude +241.8%）
// 3. uniqueWallets >= 150 在市场好时效果很好（1/3亏损，平均+79.4%）
// 4. volumePerMin >= 20000 在市场好时有效

// 让我们分析其他可能被忽略的因子

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
  console.log('=== 寻找除 countPerMin 外的其他宝藏因子 ===\n');

  const [trades1, signals1, trades2, signals2] = await Promise.all([
    get('http://localhost:3010/api/experiment/25493408-98b3-4342-a1ac-036ba49f97ee/trades?limit=10000'),
    get('http://localhost:3010/api/experiment/25493408-98b3-4342-a1ac-036ba49f97ee/signals?limit=10000'),
    get('http://localhost:3010/api/experiment/1dde2be5-2f4e-49fb-9520-cb032e9ef759/trades?limit=10000'),
    get('http://localhost:3010/api/experiment/1dde2be5-2f4e-49fb-9520-cb032e9ef759/signals?limit=10000'),
  ]);

  // 构建代币PnL数据
  const buildPnL = (trades) => {
    const pnl = {};
    trades.trades.forEach(t => {
      if (t.trade_status !== 'success') return;
      const addr = t.token_address;
      if (!pnl[addr]) {
        pnl[addr] = { symbol: t.token_symbol, spent: 0, received: 0 };
      }
      if (t.direction === 'buy') pnl[addr].spent += parseFloat(t.input_amount || 0);
      else pnl[addr].received += parseFloat(t.output_amount || 0);
    });
    return Object.entries(pnl).map(([addr, data]) => ({
      address: addr,
      symbol: data.symbol,
      returnRate: data.spent > 0 ? ((data.received - data.spent) / data.spent * 100) : 0
    }));
  };

  // 构建因子数据
  const buildFactors = (signals) => {
    const factors = {};
    signals.signals.filter(s => s.action === 'buy' && s.executed === true).forEach(s => {
      if (!factors[s.token_address]) {
        const f = s.metadata?.preBuyCheckFactors || {};
        const tf = s.metadata?.trendFactors || {};
        factors[s.token_address] = {
          countPerMin: f.earlyTradesCountPerMin,
          volumePerMin: f.earlyTradesVolumePerMin,
          walletsPerMin: f.earlyTradesWalletsPerMin,
          uniqueWallets: f.earlyTradesUniqueWallets,
          highValueCount: f.earlyTradesHighValueCount,
          actualSpan: f.earlyTradesActualSpan,
          clusterCount: f.walletClusterCount,
          top2Ratio: f.walletClusterTop2Ratio,
          secondToFirstRatio: f.walletClusterSecondToFirstRatio,
          megaRatio: f.walletClusterMegaRatio,
          earlyReturn: tf.earlyReturn,
          trendCV: tf.trendCV,
          trendStrengthScore: tf.trendStrengthScore,
          trendTotalReturn: tf.trendTotalReturn,
          trendRiseRatio: tf.trendRiseRatio,
        };
      }
    });
    return factors;
  };

  const pnl1 = buildPnL(trades1);
  const pnl2 = buildPnL(trades2);
  const factors1 = buildFactors(signals1);
  const factors2 = buildFactors(signals2);

  const dataset1 = pnl1.map(t => ({ ...t, factors: factors1[t.address] || {} })).filter(t => Object.keys(t.factors).length > 0);
  const dataset2 = pnl2.map(t => ({ ...t, factors: factors2[t.address] || {} })).filter(t => Object.keys(t.factors).length > 0);

  console.log(`市场差：${dataset1.length} 个代币`);
  console.log(`市场好：${dataset2.length} 个代币\n`);

  // ========================================
  // 重点分析：除了 countPerMin，还有什么因子能区分？
  // ========================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【排除 countPerMin >= 150 后的代币分析】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 先排除 countPerMin >= 150 的代币
  const exp1Filtered = dataset1.filter(t => t.factors.countPerMin < 150);
  const exp2Filtered = dataset2.filter(t => t.factors.countPerMin < 150);

  console.log(`排除 countPerMin >= 150 后：`);
  console.log(`  市场差：${exp1Filtered.length} 个代币（排除 ${dataset1.length - exp1Filtered.length} 个）`);
  console.log(`  市场好：${exp2Filtered.length} 个代币（排除 ${dataset2.length - exp2Filtered.length} 个）\n`);

  // 在剩余代币中，寻找其他有效因子
  const testFactor = (factor, threshold, direction, dataset) => {
    const test = direction === '<'
      ? (t) => t.factors[factor] < threshold
      : (t) => t.factors[factor] >= threshold;

    const matched = dataset.filter(t => {
      const val = t.factors[factor];
      if (val === undefined || val === null) return true;
      return test(t);
    });

    if (matched.length === 0) return null;

    const avgReturn = matched.reduce((a, t) => a + t.returnRate, 0) / matched.length;
    const losingRate = matched.filter(t => t.returnRate <= 0).length / matched.length;

    return { matched, avgReturn, losingRate };
  };

  // 测试多个因子
  const additionalFactors = [
    { name: 'uniqueWallets >= 15', factor: 'uniqueWallets', threshold: 15, direction: '>=' },
    { name: 'uniqueWallets >= 20', factor: 'uniqueWallets', threshold: 20, direction: '>=' },
    { name: 'uniqueWallets >= 30', factor: 'uniqueWallets', threshold: 30, direction: '>=' },
    { name: 'volumePerMin >= 3000', factor: 'volumePerMin', threshold: 3000, direction: '>=' },
    { name: 'volumePerMin >= 5000', factor: 'volumePerMin', threshold: 5000, direction: '>=' },
    { name: 'highValueCount >= 10', factor: 'highValueCount', threshold: 10, direction: '>=' },
    { name: 'highValueCount >= 15', factor: 'highValueCount', threshold: 15, direction: '>=' },
    { name: 'actualSpan >= 50', factor: 'actualSpan', threshold: 50, direction: '>=' },
    { name: 'actualSpan >= 60', factor: 'actualSpan', threshold: 60, direction: '>=' },
    { name: 'walletsPerMin >= 10', factor: 'walletsPerMin', threshold: 10, direction: '>=' },
    { name: 'walletsPerMin >= 15', factor: 'walletsPerMin', threshold: 15, direction: '>=' },
    { name: 'top2Ratio < 0.7', factor: 'top2Ratio', threshold: 0.7, direction: '<' },
    { name: 'top2Ratio < 0.75', factor: 'top2Ratio', threshold: 0.75, direction: '<' },
    { name: 'top2Ratio < 0.8', factor: 'top2Ratio', threshold: 0.8, direction: '<' },
    { name: 'earlyReturn < 100', factor: 'earlyReturn', threshold: 100, direction: '<' },
    { name: 'earlyReturn < 150', factor: 'earlyReturn', threshold: 150, direction: '<' },
    { name: 'earlyReturn < 200', factor: 'earlyReturn', threshold: 200, direction: '<' },
    { name: 'trendCV >= 0.02', factor: 'trendCV', threshold: 0.02, direction: '>=' },
    { name: 'trendStrengthScore >= 30', factor: 'trendStrengthScore', threshold: 30, direction: '>=' },
    { name: 'trendTotalReturn >= 10', factor: 'trendTotalReturn', threshold: 10, direction: '>=' },
  ];

  console.log('【在 countPerMin < 150 的基础上，测试额外因子】\n');
  console.log('因子'.padEnd(30) + '市场差改善'.padEnd(15) + '市场好改善'.padEnd(15) + '综合改善');
  console.log('-'.repeat(85));

  const results = [];
  const exp1Baseline = exp1Filtered.reduce((a, t) => a + t.returnRate, 0) / exp1Filtered.length;
  const exp2Baseline = exp2Filtered.reduce((a, t) => a + t.returnRate, 0) / exp2Filtered.length;

  additionalFactors.forEach(({ name, factor, threshold, direction }) => {
    const r1 = testFactor(factor, threshold, direction, exp1Filtered);
    const r2 = testFactor(factor, threshold, direction, exp2Filtered);

    if (r1 && r2 && r1.matched.length >= 5 && r2.matched.length >= 3) {
      const exp1Improvement = r1.avgReturn - exp1Baseline;
      const exp2Improvement = r2.avgReturn - exp2Baseline;
      const totalImprovement = exp1Improvement + exp2Improvement;

      results.push({
        name,
        exp1Improvement,
        exp2Improvement,
        totalImprovement,
        exp1Avg: r1.avgReturn,
        exp2Avg: r2.avgReturn,
        exp1Count: r1.matched.length,
        exp2Count: r2.matched.length,
      });

      const exp1Str = (exp1Improvement >= 0 ? '+' : '') + exp1Improvement.toFixed(1) + '%';
      const exp2Str = (exp2Improvement >= 0 ? '+' : '') + exp2Improvement.toFixed(1) + '%';
      const totalStr = (totalImprovement >= 0 ? '+' : '') + totalImprovement.toFixed(1) + '%';

      console.log(`${name.padEnd(30)}${exp1Str.padEnd(15)}${exp2Str.padEnd(15)}${totalStr}`);
    }
  });

  // ========================================
  // 找出最佳的额外因子
  // ========================================
  results.sort((a, b) => b.totalImprovement - a.totalImprovement);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🏆 Top 10 额外宝藏因子（在 countPerMin < 150 基础上）');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  results.slice(0, 10).forEach((r, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
    console.log(`${medal} ${r.name}`);
    console.log(`   市场差: ${r.exp1Count} 个, 平均 ${r.exp1Avg.toFixed(1)}% (改善 ${r.exp1Improvement >= 0 ? '+' : ''}${r.exp1Improvement.toFixed(1)}%)`);
    console.log(`   市场好: ${r.exp2Count} 个, 平均 ${r.exp2Avg.toFixed(1)}% (改善 ${r.exp2Improvement >= 0 ? '+' : ''}${r.exp2Improvement.toFixed(1)}%)`);
    console.log('');
  });

  // ========================================
  // 推荐组合
  // ========================================
  if (results.length > 0) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎯 推荐配置');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const best = results[0];
    console.log('【最佳组合】countPerMin < 150 + 额外因子');
    console.log(`  1. earlyTradesCountPerMin < 150`);
    console.log(`  2. ${best.name}`);
    console.log('');
    console.log('配置代码：');
    console.log('```json');
    console.log('{');
    console.log('  "preBuyCheckCondition": "walletClusterCount < 4 OR walletClusterTop2Ratio <= 0.85" +');

    // 转换因子名称
    let config = best.name;
    config = config.replace(/uniqueWallets/, 'earlyTradesUniqueWallets');
    config = config.replace(/volumePerMin/, 'earlyTradesVolumePerMin');
    config = config.replace(/highValueCount/, 'earlyTradesHighValueCount');
    config = config.replace(/actualSpan/, 'earlyTradesActualSpan');
    config = config.replace(/walletsPerMin/, 'earlyTradesWalletsPerMin');
    config = config.replace(/top2Ratio/, 'walletClusterTop2Ratio');
    config = config.replace(/earlyReturn/, 'trendFactors.earlyReturn');
    config = config.replace(/trendCV/, 'trendFactors.trendCV');
    config = config.replace(/trendStrengthScore/, 'trendFactors.trendStrengthScore');
    config = config.replace(/trendTotalReturn/, 'trendFactors.trendTotalReturn');

    console.log('                           " AND earlyTradesCountPerMin < 150" +');
    console.log(`                           " AND ${config}"`);
    console.log('}');
    console.log('```');
  }
}

main().catch(console.error);
