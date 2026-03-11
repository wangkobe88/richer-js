/**
 * 分析 top2Ratio < 0.7 过滤掉的代币
 * 找出为什么它过滤掉了太多高收益代币
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
  console.log('=== 分析 top2Ratio < 0.7 的过滤效果 ===\n');
  console.log('实验: b3a9cbef-8d89-4203-b090-e12bca06c511\n');

  const [tradesData, signalsData] = await Promise.all([
    get('http://localhost:3010/api/experiment/b3a9cbef-8d89-4203-b090-e12bca06c511/trades?limit=10000'),
    get('http://localhost:3010/api/experiment/b3a9cbef-8d89-4203-b090-e12bca06c511/signals?limit=10000')
  ]);

  // 构建代币PnL
  const tokenPnL = {};
  tradesData.trades.forEach(t => {
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

  // 构建因子
  const tokenFactors = {};
  signalsData.signals.filter(s => s.action === 'buy' && s.executed === true).forEach(s => {
    if (!tokenFactors[s.token_address]) {
      const f = s.metadata?.preBuyCheckFactors || {};
      const tf = s.metadata?.trendFactors || {};
      tokenFactors[s.token_address] = {
        countPerMin: f.earlyTradesCountPerMin,
        volumePerMin: f.earlyTradesVolumePerMin,
        uniqueWallets: f.earlyTradesUniqueWallets,
        highValueCount: f.earlyTradesHighValueCount,
        top2Ratio: f.walletClusterTop2Ratio,
        secondToFirstRatio: f.walletClusterSecondToFirstRatio,
        megaRatio: f.walletClusterMegaRatio,
        clusterCount: f.walletClusterCount,
        earlyReturn: tf.earlyReturn,
      };
    }
  });

  const dataset = tokens.map(t => ({
    ...t,
    factors: tokenFactors[t.address] || {}
  })).filter(t => Object.keys(t.factors).length > 0);

  const profitable = dataset.filter(t => t.returnRate > 0);
  const losing = dataset.filter(t => t.returnRate <= 0);

  console.log(`数据集：${dataset.length} 个代币 (盈利: ${profitable.length}, 亏损: ${losing.length})\n`);

  // 按 top2Range 分组
  const top2Ranges = [
    { max: 0.7, label: '< 0.7' },
    { min: 0.7, max: 0.75, label: '0.7-0.75' },
    { min: 0.75, max: 0.8, label: '0.75-0.8' },
    { min: 0.8, max: 0.85, label: '0.8-0.85' },
    { min: 0.85, max: 0.9, label: '0.85-0.9' },
    { min: 0.9, max: 0.95, label: '0.9-0.95' },
    { min: 0.95, label: '>= 0.95' },
  ];

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【top2Ratio 分布分析】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('top2Ratio 范围'.padEnd(15) + '代币数'.padEnd(10) + '盈利数'.padEnd(10) + '亏损数'.padEnd(10) + '胜率'.padEnd(10) + '平均收益');
  console.log('-'.repeat(85));

  top2Ranges.forEach(({ min, max, label }) => {
    const subset = dataset.filter(t => {
      const val = t.factors.top2Ratio;
      if (val === undefined || val === null) return false;
      if (min !== undefined && max !== undefined) return val >= min && val < max;
      if (min !== undefined) return val >= min;
      if (max !== undefined) return val < max;
      return true;
    });

    if (subset.length > 0) {
      const losing = subset.filter(t => t.returnRate <= 0);
      const profitableCount = subset.filter(t => t.returnRate > 0).length;
      const winRate = (profitableCount / subset.length * 100).toFixed(1);
      const avgReturn = subset.reduce((a, t) => a + t.returnRate, 0) / subset.length;

      const marker = label === '< 0.7' ? ' ⬅️ 会通过' : ' ❌ 被过滤';
      console.log(`${label.padEnd(15)}${subset.length.toString().padEnd(10)}${profitableCount.toString().padEnd(10)}${losing.length.toString().padEnd(10)}${winRate.padEnd(10)}${avgReturn.toFixed(1)}%${marker}`);
    }
  });

  // 详细列出被过滤的高收益代币
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【被 top2Ratio < 0.7 过滤掉的高收益代币】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const filteredOut = dataset.filter(t => t.factors.top2Ratio >= 0.7);
  const filteredOutProfitable = filteredOut.filter(t => t.returnRate > 0);

  console.log(`被过滤代币：${filteredOut.length} 个（其中 ${filteredOutProfitable.length} 个盈利）\n`);

  if (filteredOutProfitable.length > 0) {
    console.log('盈利代币详情：');
    filteredOutProfitable.sort((a, b) => b.returnRate - a.returnRate).forEach(t => {
      console.log(`  ✅ ${t.symbol}: +${t.returnRate.toFixed(1)}%`);
      console.log(`     top2Ratio=${t.factors.top2Ratio?.toFixed(2) || 'N/A'}, countPerMin=${t.factors.countPerMin?.toFixed(1) || 'N/A'}, earlyReturn=${t.factors.earlyReturn?.toFixed(1) || 'N/A'}%`);
      console.log(`     uniqueWallets=${t.factors.uniqueWallets || 'N/A'}, clusterCount=${t.factors.clusterCount || 'N/A'}`);
      console.log('');
    });
  }

  // 分析通过 top2Ratio < 0.7 的代币
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【通过 top2Ratio < 0.7 的代币】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const passed = dataset.filter(t => t.factors.top2Ratio < 0.7);
  const passedProfitable = passed.filter(t => t.returnRate > 0);
  const passedAvg = passed.reduce((a, t) => a + t.returnRate, 0) / passed.length;

  console.log(`通过代币：${passed.length} 个（其中 ${passedProfitable.length} 个盈利）`);
  console.log(`平均收益：${passedAvg.toFixed(1)}%\n`);

  if (passedProfitable.length > 0) {
    console.log('盈利代币详情：');
    passedProfitable.sort((a, b) => b.returnRate - a.returnRate).forEach(t => {
      console.log(`  ✅ ${t.symbol}: +${t.returnRate.toFixed(1)}%`);
      console.log(`     top2Ratio=${t.factors.top2Ratio?.toFixed(2) || 'N/A'}, countPerMin=${t.factors.countPerMin?.toFixed(1) || 'N/A'}, earlyReturn=${t.factors.earlyReturn?.toFixed(1) || 'N/A'}%`);
      console.log('');
    });
  }

  // ========================================
  // 测试不同的 top2Ratio 阈值
  // ========================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【测试不同的 top2Ratio 阈值】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const thresholds = [0.65, 0.7, 0.75, 0.8, 0.85, 0.9];

  console.log('阈值'.padEnd(10) + '通过数'.padEnd(10) + '过滤数'.padEnd(10) + '错失盈利'.padEnd(12) + '平均收益'.padEnd(12) + '最高收益');
  console.log('-'.repeat(85));

  thresholds.forEach(threshold => {
    const passedSet = dataset.filter(t => {
      const val = t.factors.top2Ratio;
      return val !== undefined && val < threshold;
    });
    const filteredSet = dataset.filter(t => {
      const val = t.factors.top2Ratio;
      return val === undefined || val >= threshold;
    });

    const missedProfitable = filteredSet.filter(t => t.returnRate > 0);
    const avgReturn = passedSet.length > 0 ? passedSet.reduce((a, t) => a + t.returnRate, 0) / passedSet.length : 0;
    const maxReturn = passedSet.length > 0 ? Math.max(...passedSet.map(t => t.returnRate)) : 0;

    console.log(`${('< ' + threshold).padEnd(10)}${passedSet.length.toString().padEnd(10)}${filteredSet.length.toString().padEnd(10)}${missedProfitable.length.toString().padEnd(12)}${avgReturn.toFixed(1).padEnd(12)}${maxReturn.toFixed(1)}%`);
  });

  // ========================================
  // 最终建议
  // ========================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎯 分析结论');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('【问题】');
  console.log('  top2Ratio < 0.7 过于严格，过滤掉了太多高收益代币');
  console.log('  许多优质的 pump & dump 代币的 top2Ratio 都在 0.7-0.9 之间\n');

  console.log('【建议】');
  console.log('  1. 不建议使用 top2Ratio < 0.7 作为硬性过滤条件');
  console.log('  2. 如果要使用，建议阈值放宽到 0.8 或 0.85');
  console.log('  3. 或者保持现有的 walletClusterTop2Ratio <= 0.85 不变\n');

  console.log('【推荐配置】');
  console.log('  只使用 countPerMin < 150：');
  console.log('  ```json');
  console.log('  {');
  console.log('    "preBuyCheckCondition": "walletClusterCount < 4 OR walletClusterTop2Ratio <= 0.85" +');
  console.log('                             " AND earlyTradesCountPerMin < 150"');
  console.log('  }');
  console.log('  ```');
}

main().catch(console.error);
