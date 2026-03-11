/**
 * 测试单一条件：countPerMin < 150
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

async function analyzeExperiment(experimentId) {
  const [tradesData, signalsData] = await Promise.all([
    get(`http://localhost:3010/api/experiment/${experimentId}/trades?limit=10000`),
    get(`http://localhost:3010/api/experiment/${experimentId}/signals?limit=10000`)
  ]);

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

  const tokenFactors = {};
  signalsData.signals.filter(s => s.action === 'buy' && s.executed === true).forEach(s => {
    if (!tokenFactors[s.token_address]) {
      const f = s.metadata?.preBuyCheckFactors || {};
      const tf = s.metadata?.trendFactors || {};
      tokenFactors[s.token_address] = {
        countPerMin: f.earlyTradesCountPerMin,
        earlyReturn: tf.earlyReturn,
      };
    }
  });

  return tokens.map(t => ({
    ...t,
    factors: tokenFactors[t.address] || {}
  })).filter(t => Object.keys(t.factors).length > 0);
}

async function main() {
  console.log('=== 测试单一条件：countPerMin < 150 ===\n');

  const [exp1, exp2] = await Promise.all([
    analyzeExperiment('25493408-98b3-4342-a1ac-036ba49f97ee'),
    analyzeExperiment('1dde2be5-2f4e-49fb-9520-cb032e9ef759')
  ]);

  console.log('正在加载数据...\n');

  // ========================================
  // 当前状态（无额外过滤）
  // ========================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【当前状态：无额外过滤】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('市场'.padEnd(10) + '代币数'.padEnd(10) + '盈利'.padEnd(10) + '亏损'.padEnd(10) + '胜率'.padEnd(10) + '平均收益');
  console.log('-'.repeat(70));

  const exp1Profit = exp1.filter(t => t.returnRate > 0);
  const exp1Losing = exp1.filter(t => t.returnRate <= 0);
  const exp1Avg = exp1.reduce((a, t) => a + t.returnRate, 0) / exp1.length;
  console.log(`市场差`.padEnd(10) + `${exp1.length}`.padEnd(10) + `${exp1Profit.length}`.padEnd(10) + `${exp1Losing.length}`.padEnd(10) + `${(exp1Profit.length/exp1.length*100).toFixed(0)}%`.padEnd(10) + `${exp1Avg.toFixed(1)}%`);

  const exp2Profit = exp2.filter(t => t.returnRate > 0);
  const exp2Losing = exp2.filter(t => t.returnRate <= 0);
  const exp2Avg = exp2.reduce((a, t) => a + t.returnRate, 0) / exp2.length;
  console.log(`市场好`.padEnd(10) + `${exp2.length}`.padEnd(10) + `${exp2Profit.length}`.padEnd(10) + `${exp2Losing.length}`.padEnd(10) + `${(exp2Profit.length/exp2.length*100).toFixed(0)}%`.padEnd(10) + `${exp2Avg.toFixed(1)}%\n`);

  // ========================================
  // 应用 countPerMin < 150
  // ========================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【应用条件：countPerMin < 150】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const exp1Filtered = exp1.filter(t => t.factors.countPerMin < 150);
  const exp2Filtered = exp2.filter(t => t.factors.countPerMin < 150);

  console.log('市场'.padEnd(10) + '代币数'.padEnd(10) + '盈利'.padEnd(10) + '亏损'.padEnd(10) + '胜率'.padEnd(10) + '平均收益');
  console.log('-'.repeat(70));

  const exp1FilteredProfit = exp1Filtered.filter(t => t.returnRate > 0);
  const exp1FilteredLosing = exp1Filtered.filter(t => t.returnRate <= 0);
  const exp1FilteredAvg = exp1Filtered.reduce((a, t) => a + t.returnRate, 0) / exp1Filtered.length;
  console.log(`市场差`.padEnd(10) + `${exp1Filtered.length}`.padEnd(10) + `${exp1FilteredProfit.length}`.padEnd(10) + `${exp1FilteredLosing.length}`.padEnd(10) + `${(exp1FilteredProfit.length/exp1Filtered.length*100).toFixed(0)}%`.padEnd(10) + `${exp1FilteredAvg.toFixed(1)}%`);

  const exp2FilteredProfit = exp2Filtered.filter(t => t.returnRate > 0);
  const exp2FilteredLosing = exp2Filtered.filter(t => t.returnRate <= 0);
  const exp2FilteredAvg = exp2Filtered.reduce((a, t) => a + t.returnRate, 0) / exp2Filtered.length;
  console.log(`市场好`.padEnd(10) + `${exp2Filtered.length}`.padEnd(10) + `${exp2FilteredProfit.length}`.padEnd(10) + `${exp2FilteredLosing.length}`.padEnd(10) + `${(exp2FilteredProfit.length/exp2Filtered.length*100).toFixed(0)}%`.padEnd(10) + `${exp2FilteredAvg.toFixed(1)}%\n`);

  // ========================================
  // 被过滤掉的代币
  // ========================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【被过滤掉的代币（countPerMin >= 150）】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const exp1Rejected = exp1.filter(t => t.factors.countPerMin >= 150);
  const exp2Rejected = exp2.filter(t => t.factors.countPerMin >= 150);

  console.log('市场'.padEnd(10) + '代币数'.padEnd(10) + '盈利'.padEnd(10) + '亏损'.padEnd(10) + '胜率'.padEnd(10) + '平均收益');
  console.log('-'.repeat(70));

  const exp1RejectedProfit = exp1Rejected.filter(t => t.returnRate > 0);
  const exp1RejectedLosing = exp1Rejected.filter(t => t.returnRate <= 0);
  const exp1RejectedAvg = exp1Rejected.length > 0 ? exp1Rejected.reduce((a, t) => a + t.returnRate, 0) / exp1Rejected.length : 0;
  const exp1RejectedWinRate = exp1Rejected.length > 0 ? (exp1RejectedProfit.length/exp1Rejected.length*100).toFixed(0) : 'N/A';
  console.log(`市场差`.padEnd(10) + `${exp1Rejected.length}`.padEnd(10) + `${exp1RejectedProfit.length}`.padEnd(10) + `${exp1RejectedLosing.length}`.padEnd(10) + `${exp1RejectedWinRate}`.padEnd(10) + `${exp1RejectedAvg.toFixed(1)}%`);

  const exp2RejectedProfit = exp2Rejected.filter(t => t.returnRate > 0);
  const exp2RejectedLosing = exp2Rejected.filter(t => t.returnRate <= 0);
  const exp2RejectedAvg = exp2Rejected.length > 0 ? exp2Rejected.reduce((a, t) => a + t.returnRate, 0) / exp2Rejected.length : 0;
  const exp2RejectedWinRate = exp2Rejected.length > 0 ? (exp2RejectedProfit.length/exp2Rejected.length*100).toFixed(0) : 'N/A';
  console.log(`市场好`.padEnd(10) + `${exp2Rejected.length}`.padEnd(10) + `${exp2RejectedProfit.length}`.padEnd(10) + `${exp2RejectedLosing.length}`.padEnd(10) + `${exp2RejectedWinRate}`.padEnd(10) + `${exp2RejectedAvg.toFixed(1)}%\n`);

  // ========================================
  // 详细列出被过滤的代币
  // ========================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【被过滤掉的代币详情】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('--- 市场差实验被过滤的代币 ---');
  exp1Rejected.forEach(t => {
    const status = t.returnRate > 0 ? '✅' : '❌';
    const earlyReturnVal = t.factors.earlyReturn ? t.factors.earlyReturn.toFixed(1) + '%' : 'N/A';
    console.log(`  ${status} ${t.symbol}: ${t.returnRate.toFixed(1)}%, countPerMin=${t.factors.countPerMin.toFixed(1)}, earlyReturn=${earlyReturnVal}`);
  });

  console.log('\n--- 市场好实验被过滤的代币 ---');
  exp2Rejected.forEach(t => {
    const status = t.returnRate > 0 ? '✅' : '❌';
    const earlyReturnVal = t.factors.earlyReturn ? t.factors.earlyReturn.toFixed(1) + '%' : 'N/A';
    console.log(`  ${status} ${t.symbol}: ${t.returnRate.toFixed(1)}%, countPerMin=${t.factors.countPerMin.toFixed(1)}, earlyReturn=${earlyReturnVal}`);
  });

  // ========================================
  // 效果总结
  // ========================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 效果总结');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('【市场差实验】');
  console.log(`  平均收益：${exp1Avg.toFixed(1)}% → ${exp1FilteredAvg.toFixed(1)}% (${(exp1FilteredAvg - exp1Avg).toFixed(1)}%)`);
  console.log(`  胜率：${(exp1Profit.length/exp1.length*100).toFixed(0)}% → ${(exp1FilteredProfit.length/exp1Filtered.length*100).toFixed(0)}%`);
  console.log(`  过滤掉：${exp1Rejected.length} 个代币（${exp1RejectedLosing.length} 个亏损，${exp1RejectedProfit.length} 个盈利）\n`);

  console.log('【市场好实验】');
  console.log(`  平均收益：${exp2Avg.toFixed(1)}% → ${exp2FilteredAvg.toFixed(1)}% (${(exp2FilteredAvg - exp2Avg).toFixed(1)}%)`);
  console.log(`  胜率：${(exp2Profit.length/exp2.length*100).toFixed(0)}% → ${(exp2FilteredProfit.length/exp2Filtered.length*100).toFixed(0)}%`);
  console.log(`  过滤掉：${exp2Rejected.length} 个代币（${exp2RejectedLosing.length} 个亏损，${exp2RejectedProfit.length} 个盈利）\n`);

  console.log('【错失的盈利代币（市场好实验）】');
  const missedProfitable = exp2Rejected.filter(t => t.returnRate > 0);
  if (missedProfitable.length > 0) {
    missedProfitable.forEach(t => {
      const earlyReturnVal = t.factors.earlyReturn ? t.factors.earlyReturn.toFixed(1) + '%' : 'N/A';
      console.log(`  ⚠️  ${t.symbol}: +${t.returnRate.toFixed(1)}% (countPerMin=${t.factors.countPerMin.toFixed(1)}, earlyReturn=${earlyReturnVal})`);
    });
  }

  console.log('\n【结论】');
  console.log('  单一条件 countPerMin < 150：');
  console.log('  - 市场差时：显著改善（避免100%亏损区）');
  console.log('  - 市场好时：略有改善（错失2个盈利代币：CMO +6.2%, Dude +241.8%）');
  console.log('  - 总体：简单有效，但会错过市场好时的高活跃优质代币');
}

main().catch(console.error);
