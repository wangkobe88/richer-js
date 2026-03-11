/**
 * 在多个实验上验证 countPerMin < 150 的有效性
 * 检查是否真的稳定有效
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

  // 构建因子
  const buySignals = signalsData.signals?.filter(s => s.action === 'buy' && s.executed === true) || [];
  const tokenFactors = {};
  buySignals.forEach(s => {
    const addr = s.token_address.toLowerCase();
    if (!tokenFactors[addr]) {
      const f = s.metadata?.preBuyCheckFactors || {};
      tokenFactors[addr] = {
        countPerMin: f.earlyTradesCountPerMin,
        top2Ratio: f.walletClusterTop2Ratio,
      };
    }
  });

  const dataset = tokens.map(t => ({
    ...t,
    factors: tokenFactors[t.address.toLowerCase()] || {}
  })).filter(t => t.factors.countPerMin !== undefined);

  // 分析 countPerMin >= 150 的代币
  const highActivity = dataset.filter(t => t.factors.countPerMin >= 150);
  const highActivityLosing = highActivity.filter(t => t.returnRate <= 0);
  const highActivityAvg = highActivity.length > 0 ? highActivity.reduce((a, t) => a + t.returnRate, 0) / highActivity.length : 0;

  // 分析 countPerMin < 150 的代币
  const lowActivity = dataset.filter(t => t.factors.countPerMin < 150);
  const lowActivityLosing = lowActivity.filter(t => t.returnRate <= 0);
  const lowActivityAvg = lowActivity.length > 0 ? lowActivity.reduce((a, t) => a + t.returnRate, 0) / lowActivity.length : 0;

  return {
    label,
    experimentId,
    dataset,
    highActivity,
    highActivityLosing,
    highActivityAvg,
    lowActivity,
    lowActivityLosing,
    lowActivityAvg,
  };
}

async function main() {
  console.log('=== 验证 countPerMin < 150 的有效性 ===\n');

  // 分析多个实验
  const experiments = [
    { id: '25493408-98b3-4342-a1ac-036ba49f97ee', label: '市场差（原分析）' },
    { id: '1dde2be5-2f4e-49fb-9520-cb032e9ef759', label: '市场好（原分析）' },
    { id: 'b3a9cbef-8d89-4203-b090-e12bca06c511', label: '用户新实验' },
  ];

  const results = [];
  for (const exp of experiments) {
    try {
      const result = await analyzeExperiment(exp.id, exp.label);
      results.push(result);
      console.log(`✅ ${exp.label}: ${result.dataset.length} 个代币`);
    } catch (e) {
      console.log(`❌ ${exp.label}: 加载失败 - ${e.message}`);
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【countPerMin >= 150 的效果分析】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('实验'.padEnd(25) + '代币数'.padEnd(10) + '亏损数'.padEnd(10) + '亏损率'.padEnd(10) + '平均收益');
  console.log('-'.repeat(75));

  results.forEach(r => {
    const losingRate = r.highActivity.length > 0 ? (r.highActivityLosing.length / r.highActivity.length * 100).toFixed(0) : 'N/A';
    console.log(`${r.label.padEnd(25)}${r.highActivity.length.toString().padEnd(10)}${r.highActivityLosing.length.toString().padEnd(10)}${losingRate.padEnd(10)}${r.highActivityAvg.toFixed(1)}%`);

    // 显示被过滤的盈利代币
    const missedProfit = r.highActivity.filter(t => t.returnRate > 0);
    if (missedProfit.length > 0) {
      console.log(`  ⚠️  错失盈利: ${missedProfit.map(t => `${t.symbol}+${t.returnRate.toFixed(0)}%`).join(', ')}`);
    }
    console.log('');
  });

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【应用 countPerMin < 150 后的效果】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('实验'.padEnd(25) + '代币数'.padEnd(10) + '亏损数'.padEnd(10) + '亏损率'.padEnd(10) + '平均收益');
  console.log('-'.repeat(75));

  results.forEach(r => {
    const losingRate = r.lowActivity.length > 0 ? (r.lowActivityLosing.length / r.lowActivity.length * 100).toFixed(0) : 'N/A';
    console.log(`${r.label.padEnd(25)}${r.lowActivity.length.toString().padEnd(10)}${r.lowActivityLosing.length.toString().padEnd(10)}${losingRate.padEnd(10)}${r.lowActivityAvg.toFixed(1)}%`);
    console.log('');
  });

  // ========================================
  // 统计分析
  // ========================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【综合统计分析】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const allHighActivity = results.flatMap(r => r.highActivity);
  const allHighActivityLosing = allHighActivity.filter(t => t.returnRate <= 0);
  const allHighActivityAvg = allHighActivity.reduce((a, t) => a + t.returnRate, 0) / allHighActivity.length;

  const allLowActivity = results.flatMap(r => r.lowActivity);
  const allLowActivityLosing = allLowActivity.filter(t => t.returnRate <= 0);
  const allLowActivityAvg = allLowActivity.reduce((a, t) => a + t.returnRate, 0) / allLowActivity.length;

  console.log('【countPerMin >= 150 的所有代币】');
  console.log(`  总数: ${allHighActivity.length} 个`);
  console.log(`  亏损: ${allHighActivityLosing.length} 个 (${(allHighActivityLosing.length / allHighActivity.length * 100).toFixed(1)}%)`);
  console.log(`  平均收益: ${allHighActivityAvg.toFixed(1)}%\n`);

  console.log('【countPerMin < 150 的所有代币】');
  console.log(`  总数: ${allLowActivity.length} 个`);
  console.log(`  亏损: ${allLowActivityLosing.length} 个 (${(allLowActivityLosing.length / allLowActivity.length * 100).toFixed(1)}%)`);
  console.log(`  平均收益: ${allLowActivityAvg.toFixed(1)}%\n`);

  // ========================================
  // 结论
  // ========================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎯 结论');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const improvement = allLowActivityAvg - allHighActivityAvg;
  console.log(`【过滤效果】`);
  console.log(`  过滤掉 ${allHighActivity.length} 个高活跃代币`);
  console.log(`  平均收益改善: ${improvement >= 0 ? '+' : ''}${improvement.toFixed(1)}%`);
  console.log('');

  if (allHighActivity.length >= 10) {
    const losingRate = allHighActivityLosing.length / allHighActivity.length;
    if (losingRate >= 0.7) {
      console.log('✅ countPerMin >= 150 是明确的危险信号');
      console.log(`   亏损率 ${ (losingRate * 100).toFixed(0) }%，建议过滤`);
    } else if (losingRate >= 0.5) {
      console.log('⚠️  countPerMin >= 150 有一定风险');
      console.log(`   亏损率 ${ (losingRate * 100).toFixed(0) }%，可以考虑过滤`);
    } else {
      console.log('❌ countPerMin >= 150 不是可靠的过滤条件');
      console.log(`   亏损率仅 ${ (losingRate * 100).toFixed(0) }%，误伤可能大于收益`);
    }
  } else {
    console.log('⚠️  样本量太小（<10），无法得出可靠结论');
  }

  console.log('');
  console.log('【错失的盈利代币】');
  const missedProfit = allHighActivity.filter(t => t.returnRate > 0);
  if (missedProfit.length > 0) {
    console.log(`  共 ${missedProfit.length} 个盈利代币被过滤：`);
    missedProfit.forEach(t => {
      console.log(`    ${t.symbol}: +${t.returnRate.toFixed(1)}%, countPerMin=${t.factors.countPerMin?.toFixed(1)}`);
    });
  } else {
    console.log('  无（所有 countPerMin >= 150 的代币都亏损）');
  }
}

main().catch(console.error);
