/**
 * 验证推荐规则在不同市场环境下的效果
 * 对比两个实验：
 * 1. 当前分析实验：25493408-98b3-4342-a1ac-036ba49f97ee
 * 2. 市场好的实验：1dde2be5-2f4e-49fb-9520-cb032e9ef759
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
  console.log(`\n${'='.repeat(80)}`);
  console.log(`分析实验：${label}`);
  console.log(`实验ID：${experimentId}`);
  console.log(`${'='.repeat(80)}\n`);

  const [tradesData, signalsData] = await Promise.all([
    get(`http://localhost:3010/api/experiment/${experimentId}/trades?limit=10000`),
    get(`http://localhost:3010/api/experiment/${experimentId}/signals?limit=10000`)
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
        megaRatio: f.walletClusterMegaRatio,
        secondToFirstRatio: f.walletClusterSecondToFirstRatio,
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

  // 计算整体表现
  const totalSpent = dataset.reduce((a, t) => a + t.pnl?.totalSpent || 0, 0);
  const totalReceived = dataset.reduce((a, t) => a + t.pnl?.totalReceived || 0, 0);
  const totalReturn = totalSpent > 0 ? ((totalReceived - totalSpent) / totalSpent * 100) : 0;

  console.log('整体表现：');
  console.log(`  总收益率：${totalReturn.toFixed(2)}%`);
  console.log(`  总盈亏：${(totalReceived - totalSpent).toFixed(4)} BNB\n`);

  // 测试我们发现的规则
  const rules = [
    {
      name: '【必亏规则A】earlyReturn >= 200 AND countPerMin >= 150',
      test: (f) => f.earlyReturn >= 200 && f.countPerMin >= 150
    },
    {
      name: '【必亏规则B】earlyReturn >= 300 AND countPerMin >= 100',
      test: (f) => f.earlyReturn >= 300 && f.countPerMin >= 100
    },
    {
      name: '【必亏规则C】countPerMin >= 150',
      test: (f) => f.countPerMin >= 150
    },
    {
      name: '【推荐规则】countPerMin < 150 AND (countPerMin < 100 OR earlyReturn < 200)',
      test: (f) => f.countPerMin < 150 && (f.countPerMin < 100 || f.earlyReturn < 200)
    },
    {
      name: '【严格规则】countPerMin < 100 OR earlyReturn < 200',
      test: (f) => f.countPerMin < 100 || f.earlyReturn < 200
    },
  ];

  console.log('=== 规则效果测试 ===\n');
  console.log('规则'.padEnd(60) + '命中数'.padEnd(10) + '亏损数'.padEnd(10) + '亏损率'.padEnd(10) + '平均收益');
  console.log('-'.repeat(110));

  rules.forEach(rule => {
    const matched = dataset.filter(t => rule.test(t.factors));
    const matchedLosing = matched.filter(t => t.returnRate <= 0);

    if (matched.length > 0) {
      const avgReturn = matched.reduce((a, t) => a + t.returnRate, 0) / matched.length;
      const losingRate = matchedLosing.length / matched.length;

      console.log(`${rule.name.padEnd(60)}${matched.length.toString().padEnd(10)}${matchedLosing.length.toString().padEnd(10)}${(losingRate * 100).toFixed(1).padEnd(10)}${avgReturn.toFixed(1)}%`);

      // 如果命中了全部亏损，显示详情
      if (matchedLosing.length === matched.length && matched.length >= 3) {
        console.log(`  ⚠️  ${matched.length}个代币全部亏损！`);
        matched.slice(0, 10).forEach(t => {
          console.log(`    ${t.symbol}: ${t.returnRate.toFixed(1)}%, earlyReturn=${t.factors.earlyReturn?.toFixed(1) || 'N/A'}%, countPerMin=${t.factors.countPerMin?.toFixed(1) || 'N/A'}`);
        });
      }
    }
  });

  // 分析 countPerMin 的分布
  console.log('\n=== countPerMin 分布分析 ===\n');

  const countRanges = [
    { max: 20, label: '< 20' },
    { min: 20, max: 50, label: '20-50' },
    { min: 50, max: 100, label: '50-100' },
    { min: 100, max: 150, label: '100-150' },
    { min: 150, label: '>= 150' },
  ];

  console.log('countPerMin 范围'.padEnd(15) + '代币数'.padEnd(10) + '盈利数'.padEnd(10) + '亏损数'.padEnd(10) + '胜率'.padEnd(10) + '平均收益');
  console.log('-'.repeat(85));

  countRanges.forEach(({ min, max, label }) => {
    const subset = dataset.filter(t => {
      const val = t.factors.countPerMin;
      if (val === undefined || val === null) return false;
      if (min !== undefined && max !== undefined) return val >= min && val < max;
      if (min !== undefined) return val >= min;
      if (max !== undefined) return val < max;
      return true;
    });

    if (subset.length > 0) {
      const losing = subset.filter(t => t.returnRate <= 0);
      const profitable = subset.filter(t => t.returnRate > 0);
      const winRate = (profitable.length / subset.length * 100).toFixed(1);
      const avgReturn = subset.reduce((a, t) => a + t.returnRate, 0) / subset.length;

      console.log(`${label.padEnd(15)}${subset.length.toString().padEnd(10)}${profitable.length.toString().padEnd(10)}${losing.length.toString().padEnd(10)}${winRate.padEnd(10)}${avgReturn.toFixed(1)}%`);
    }
  });

  // 分析 earlyReturn 的分布
  console.log('\n=== earlyReturn 分布分析 ===\n');

  const erRanges = [
    { max: 100, label: '< 100%' },
    { min: 100, max: 200, label: '100-200%' },
    { min: 200, max: 400, label: '200-400%' },
    { min: 400, max: 600, label: '400-600%' },
    { min: 600, label: '>= 600%' },
  ];

  console.log('earlyReturn 范围'.padEnd(15) + '代币数'.padEnd(10) + '盈利数'.padEnd(10) + '亏损数'.padEnd(10) + '胜率'.padEnd(10) + '平均收益');
  console.log('-'.repeat(85));

  erRanges.forEach(({ min, max, label }) => {
    const subset = dataset.filter(t => {
      const val = t.factors.earlyReturn;
      if (val === undefined || val === null) return false;
      if (min !== undefined && max !== undefined) return val >= min && val < max;
      if (min !== undefined) return val >= min;
      if (max !== undefined) return val < max;
      return true;
    });

    if (subset.length > 0) {
      const losing = subset.filter(t => t.returnRate <= 0);
      const profitable = subset.filter(t => t.returnRate > 0);
      const winRate = (profitable.length / subset.length * 100).toFixed(1);
      const avgReturn = subset.reduce((a, t) => a + t.returnRate, 0) / subset.length;

      console.log(`${label.padEnd(15)}${subset.length.toString().padEnd(10)}${profitable.length.toString().padEnd(10)}${losing.length.toString().padEnd(10)}${winRate.padEnd(10)}${avgReturn.toFixed(1)}%`);
    }
  });

  return {
    dataset,
    profitable,
    losing,
    totalReturn
  };
}

async function main() {
  console.log('正在加载数据...\n');

  const [exp1Data, exp2Data] = await Promise.all([
    analyzeExperiment('25493408-98b3-4342-a1ac-036ba49f97ee', '原实验（当前分析）'),
    analyzeExperiment('1dde2be5-2f4e-49fb-9520-cb032e9ef759', '市场好的实验')
  ]);

  console.log('\n\n' + '='.repeat(80));
  console.log('对比总结');
  console.log('='.repeat(80) + '\n');

  console.log('实验'.padEnd(20) + '代币数'.padEnd(10) + '胜率'.padEnd(10) + '总收益率');
  console.log('-'.repeat(60));

  const exp1WinRate = (exp1Data.profitable.length / exp1Data.dataset.length * 100).toFixed(1);
  const exp2WinRate = (exp2Data.profitable.length / exp2Data.dataset.length * 100).toFixed(1);

  console.log(`原实验`.padEnd(20) + `${exp1Data.dataset.length}`.padEnd(10) + `${exp1WinRate}%`.padEnd(10) + `${exp1Data.totalReturn.toFixed(2)}%`);
  console.log(`市场好实验`.padEnd(20) + `${exp2Data.dataset.length}`.padEnd(10) + `${exp2WinRate}%`.padEnd(10) + `${exp2Data.totalReturn.toFixed(2)}%\n`);

  // 分析规则在不同市场环境下的效果差异
  console.log('=== 规则在不同市场的适用性 ===\n');

  const rulesToTest = [
    {
      name: 'countPerMin >= 150',
      test: (f) => f.countPerMin >= 150
    },
    {
      name: 'earlyReturn >= 200 AND countPerMin >= 150',
      test: (f) => f.earlyReturn >= 200 && f.countPerMin >= 150
    },
    {
      name: 'countPerMin >= 100',
      test: (f) => f.countPerMin >= 100
    },
  ];

  rulesToTest.forEach(rule => {
    const exp1Matched = exp1Data.dataset.filter(t => rule.test(t.factors));
    const exp1Losing = exp1Matched.filter(t => t.returnRate <= 0);
    const exp1AvgReturn = exp1Matched.length > 0 ? exp1Matched.reduce((a, t) => a + t.returnRate, 0) / exp1Matched.length : 0;

    const exp2Matched = exp2Data.dataset.filter(t => rule.test(t.factors));
    const exp2Losing = exp2Matched.filter(t => t.returnRate <= 0);
    const exp2AvgReturn = exp2Matched.length > 0 ? exp2Matched.reduce((a, t) => a + t.returnRate, 0) / exp2Matched.length : 0;

    console.log(`规则：${rule.name}`);
    console.log(`  原实验：命中 ${exp1Matched.length} 个，${exp1Losing.length} 个亏损，平均收益 ${exp1AvgReturn.toFixed(1)}%`);
    console.log(`  市场好：命中 ${exp2Matched.length} 个，${exp2Losing.length} 个亏损，平均收益 ${exp2AvgReturn.toFixed(1)}%`);

    // 如果规则在两个市场中效果不同
    const exp1LosingRate = exp1Matched.length > 0 ? exp1Losing.length / exp1Matched.length : 0;
    const exp2LosingRate = exp2Matched.length > 0 ? exp2Losing.length / exp2Matched.length : 0;

    if (Math.abs(exp1LosingRate - exp2LosingRate) > 0.3) {
      console.log(`  ⚠️  规则在市场好时失效！市场差时亏损率${(exp1LosingRate * 100).toFixed(0)}%，市场好时${(exp2LosingRate * 100).toFixed(0)}%`);
    } else {
      console.log(`  ✅ 规则在两个市场都有效`);
    }
    console.log('');
  });
}

main().catch(console.error);
