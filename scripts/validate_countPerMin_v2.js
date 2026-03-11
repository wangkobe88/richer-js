/**
 * 验证 countPerMin 的有效性 - 修复版
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

async function analyzeExperiment(experimentId, label) {
  const [tradesData, signalsData] = await Promise.all([
    get(`http://localhost:3010/api/experiment/${experimentId}/trades?limit=10000`),
    get(`http://localhost:3010/api/experiment/${experimentId}/signals?limit=10000`)
  ]);

  // 计算 PnL
  const tokenPnL = {};
  tradesData.trades?.forEach(t => {
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

  // 构建因子 - 先从 signals 中提取
  const buySignals = signalsData.signals?.filter(s => s.action === 'buy' && s.executed === true) || [];
  const signalFactors = {};
  buySignals.forEach(s => {
    const addr = s.token_address.toLowerCase();
    if (!signalFactors[addr]) {
      const f = s.metadata?.preBuyCheckFactors || {};
      signalFactors[addr] = {
        countPerMin: f.earlyTradesCountPerMin,
        symbol: s.token_symbol,
      };
    }
  });

  // 组合数据
  const dataset = Object.values(tokenPnL).map(t => ({
    ...t,
    returnRate: t.totalSpent > 0 ? ((t.totalReceived - t.totalSpent) / t.totalSpent * 100) : 0,
    factors: signalFactors[t.address.toLowerCase()] || {}
  })).filter(t => t.factors.countPerMin !== undefined);

  // 分析
  const highActivity = dataset.filter(t => t.factors.countPerMin >= 150);
  const lowActivity = dataset.filter(t => t.factors.countPerMin < 150);

  return {
    label,
    dataset,
    highActivity,
    lowActivity,
  };
}

async function main() {
  console.log('=== 验证 countPerMin < 150 的有效性 ===\n');

  const experiments = [
    { id: '25493408-98b3-4342-a1ac-036ba49f97ee', label: '市场差' },
    { id: '1dde2be5-2f4e-49fb-9520-cb032e9ef759', label: '市场好' },
    { id: 'b3a9cbef-8d89-4203-b090-e12bca06c511', label: '用户实验' },
  ];

  const results = [];
  for (const exp of experiments) {
    try {
      const result = await analyzeExperiment(exp.id, exp.label);
      results.push(result);
      console.log(`✅ ${exp.label}: ${result.dataset.length} 个代币`);
    } catch (e) {
      console.log(`❌ ${exp.label}: 加载失败`);
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【countPerMin >= 150 的效果分析】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('实验'.padEnd(15) + '代币数'.padEnd(10) + '亏损数'.padEnd(10) + '亏损率'.padEnd(10) + '平均收益');
  console.log('-'.repeat(65));

  results.forEach(r => {
    const losing = r.highActivity.filter(t => t.returnRate <= 0);
    const losingRate = r.highActivity.length > 0 ? (losing.length / r.highActivity.length * 100).toFixed(0) : 'N/A';
    const avg = r.highActivity.length > 0 ? r.highActivity.reduce((a, t) => a + t.returnRate, 0) / r.highActivity.length : 0;

    console.log(`${r.label.padEnd(15)}${r.highActivity.length.toString().padEnd(10)}${losing.length.toString().padEnd(10)}${losingRate.padEnd(10)}${avg.toFixed(1)}%`);

    if (r.highActivity.length > 0) {
      console.log(`  详情: ${r.highActivity.map(t => `${t.symbol}${t.returnRate > 0 ? '+' : ''}${t.returnRate.toFixed(0)}%`).join(', ')}`);
    }
    console.log('');
  });

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【应用 countPerMin < 150 后的效果】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('实验'.padEnd(15) + '代币数'.padEnd(10) + '亏损数'.padEnd(10) + '亏损率'.padEnd(10) + '平均收益');
  console.log('-'.repeat(65));

  results.forEach(r => {
    const losing = r.lowActivity.filter(t => t.returnRate <= 0);
    const losingRate = r.lowActivity.length > 0 ? (losing.length / r.lowActivity.length * 100).toFixed(0) : 'N/A';
    const avg = r.lowActivity.length > 0 ? r.lowActivity.reduce((a, t) => a + t.returnRate, 0) / r.lowActivity.length : 0;

    console.log(`${r.label.padEnd(15)}${r.lowActivity.length.toString().padEnd(10)}${losing.length.toString().padEnd(10)}${losingRate.padEnd(10)}${avg.toFixed(1)}%`);
    console.log('');
  });

  // 综合分析
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【综合分析 - 三个实验汇总】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const allHigh = results.flatMap(r => r.highActivity);
  const allLow = results.flatMap(r => r.lowActivity);

  console.log(`countPerMin >= 150: ${allHigh.length} 个代币`);
  if (allHigh.length > 0) {
    const losing = allHigh.filter(t => t.returnRate <= 0);
    const avg = allHigh.reduce((a, t) => a + t.returnRate, 0) / allHigh.length;
    console.log(`  亏损: ${losing.length}/${allHigh.length} (${(losing.length / allHigh.length * 100).toFixed(1)}%)`);
    console.log(`  平均收益: ${avg.toFixed(1)}%`);
    console.log(`  详情: ${allHigh.map(t => `${t.symbol}${t.returnRate > 0 ? '+' : ''}${t.returnRate.toFixed(0)}%`).join(', ')}`);
  }
  console.log('');

  console.log(`countPerMin < 150: ${allLow.length} 个代币`);
  const losingLow = allLow.filter(t => t.returnRate <= 0);
  const avgLow = allLow.reduce((a, t) => a + t.returnRate, 0) / allLow.length;
  console.log(`  亏损: ${losingLow.length}/${allLow.length} (${(losingLow.length / allLow.length * 100).toFixed(1)}%)`);
  console.log(`  平均收益: ${avgLow.toFixed(1)}%`);
  console.log('');

  // 最终结论
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎯 最终结论');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (allHigh.length >= 10) {
    const losingHigh = allHigh.filter(t => t.returnRate <= 0);
    const losingRate = losingHigh.length / allHigh.length;
    const avgHigh = allHigh.reduce((a, t) => a + t.returnRate, 0) / allHigh.length;
    const improvement = avgLow - avgHigh;

    console.log(`countPerMin >= 150 的统计特征：`);
    console.log(`  样本量: ${allHigh.length} 个代币`);
    console.log(`  亏损率: ${(losingRate * 100).toFixed(1)}%`);
    console.log(`  平均收益: ${avgHigh.toFixed(1)}%`);
    console.log(`  vs countPerMin < 150: ${improvement >= 0 ? '低' : '高'} ${Math.abs(improvement).toFixed(1)}%`);
    console.log('');

    if (losingRate >= 0.7 && avgHigh < 0) {
      console.log('✅ 结论: countPerMin >= 150 是可靠的过滤条件');
      console.log('   亏损率 > 70% 且平均收益为负，建议过滤');
    } else if (losingRate >= 0.5) {
      console.log('⚠️  结论: countPerMin >= 150 有一定风险');
      console.log(`   亏损率 ${ (losingRate * 100).toFixed(0) }%，可考虑过滤`);
    } else {
      console.log('❌ 结论: countPerMin >= 150 不是可靠的过滤条件');
      console.log('   亏损率不够高，可能误伤盈利机会');
    }
  } else {
    console.log('⚠️  样本量不足（<10），无法得出可靠结论');
  }

  console.log('');
  console.log('【错失的盈利机会】');
  const profitHigh = allHigh.filter(t => t.returnRate > 0);
  if (profitHigh.length > 0) {
    console.log(`  过滤掉 ${profitHigh.length} 个盈利代币:`);
    profitHigh.forEach(t => {
      console.log(`    ${t.symbol}: +${t.returnRate.toFixed(1)}% (countPerMin=${t.factors.countPerMin?.toFixed(1)})`);
    });
  } else {
    console.log('  无（所有 countPerMin >= 150 的代币都亏损）');
  }
}

main().catch(console.error);
