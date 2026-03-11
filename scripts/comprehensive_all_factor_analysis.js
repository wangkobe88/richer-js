/**
 * 全面分析所有因子（第一阶段 + 购买前检查）
 * 不停挖掘，找出所有有价值的规律
 */

const http = require('http');
const fs = require('fs');

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
  console.log('正在加载数据...\n');

  const [tradesData, signalsData, timeSeriesData] = await Promise.all([
    get('http://localhost:3010/api/experiment/25493408-98b3-4342-a1ac-036ba49f97ee/trades?limit=10000'),
    get('http://localhost:3010/api/experiment/25493408-98b3-4342-a1ac-036ba49f97ee/signals?limit=10000'),
    get('http://localhost:3010/api/experiment/6b17ff18-002d-4ce0-a745-b8e02676abd4/time-series?limit=10000')
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

  // 从 signals 获取购买前检查因子
  const signalFactors = {};
  signalsData.signals.filter(s => s.action === 'buy' && s.executed === true).forEach(s => {
    if (!signalFactors[s.token_address]) {
      const f = s.metadata?.preBuyCheckFactors || {};
      const tf = s.metadata?.trendFactors || {};
      signalFactors[s.token_address] = {
        // 购买前检查因子
        clusterCount: f.walletClusterCount,
        secondToFirstRatio: f.walletClusterSecondToFirstRatio,
        megaRatio: f.walletClusterMegaRatio,
        top2Ratio: f.walletClusterTop2Ratio,
        maxBlockBuyRatio: f.walletClusterMaxBlockBuyRatio,
        countPerMin: f.earlyTradesCountPerMin,
        volumePerMin: f.earlyTradesVolumePerMin,
        uniqueWallets: f.earlyTradesUniqueWallets,
        highValueCount: f.earlyTradesHighValueCount,
        actualSpan: f.earlyTradesActualSpan,
        blacklistCount: f.holderBlacklistCount,
        whitelistCount: f.holderWhitelistCount,
        // 趋势因子（从signal的trendFactors）
        earlyReturn: tf.earlyReturn,
        trendCV: tf.trendCV,
        trendPriceUp: tf.trendPriceUp,
        trendMedianUp: tf.trendMedianUp,
        trendStrengthScore: tf.trendStrengthScore,
        trendTotalReturn: tf.trendTotalReturn,
        trendRiseRatio: tf.trendRiseRatio,
        trendSlope: tf.trendSlope,
      };
    }
  });

  // 从 timeSeries 获取更多因子
  const seriesFactors = {};
  if (timeSeriesData.success && timeSeriesData.timeSeriesList) {
    timeSeriesData.timeSeriesList.forEach(ts => {
      if (!seriesFactors[ts.token_address]) {
        const fv = ts.factor_values || {};
        seriesFactors[ts.token_address] = {
          age: fv.age,
          currentPrice: fv.currentPrice,
          earlyReturn: fv.earlyReturn,
          trendCV: fv.trendCV,
          trendPriceUp: fv.trendPriceUp,
          trendMedianUp: fv.trendMedianUp,
          trendStrengthScore: fv.trendStrengthScore,
          trendTotalReturn: fv.trendTotalReturn,
          trendRiseRatio: fv.trendRiseRatio,
          trendSlope: fv.trendSlope,
          trendDataPoints: fv.trendDataPoints,
          trendRecentDownCount: fv.trendRecentDownCount,
          trendRecentDownRatio: fv.trendRecentDownRatio,
          trendConsecutiveDowns: fv.trendConsecutiveDowns,
          tvl: fv.tvl,
          fdv: fv.fdv,
          marketCap: fv.marketCap,
        };
      }
    });
  }

  // 合并数据
  const dataset = tokens.map(t => ({
    ...t,
    factors: {
      ...signalFactors[t.address],
      ...seriesFactors[t.address]
    }
  })).filter(t => Object.keys(t.factors).length > 0);

  const profitable = dataset.filter(t => t.returnRate > 0);
  const losing = dataset.filter(t => t.returnRate <= 0);

  console.log(`数据集：${dataset.length} 个代币 (盈利: ${profitable.length}, 亏损: ${losing.length})\n`);

  // ========================================
  // 第一部分：所有因子的单因子测试
  // ========================================
  console.log('=== 第一部分：所有因子的单因子测试 ===\n');

  const allTests = [];

  // 定义所有要测试的因子和阈值
  const factorTests = [
    // 购买前检查 - 钱包簇
    { name: 'secondToFirstRatio', field: 'secondToFirstRatio', thresholds: [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5], compare: '>' },
    { name: 'megaRatio', field: 'megaRatio', thresholds: [0.3, 0.4, 0.5, 0.6, 0.7, 0.8], compare: '<' },
    { name: 'top2Ratio', field: 'top2Ratio', thresholds: [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9], compare: '<' },
    { name: 'maxBlockBuyRatio', field: 'maxBlockBuyRatio', thresholds: [0.05, 0.1, 0.15, 0.2, 0.25], compare: '<' },

    // 购买前检查 - 早期交易
    { name: 'countPerMin', field: 'countPerMin', thresholds: [20, 30, 40, 50, 60, 80, 100, 120, 150, 180], compare: '>=' },
    { name: 'countPerMin_max', field: 'countPerMin', thresholds: [100, 120, 140, 150, 160, 180, 200, 250], compare: '<' },
    { name: 'volumePerMin', field: 'volumePerMin', thresholds: [1000, 2000, 3000, 4000, 5000, 6000, 8000, 10000], compare: '>=' },
    { name: 'volumePerMin_max', field: 'volumePerMin', thresholds: [3000, 5000, 8000, 10000, 15000], compare: '<' },
    { name: 'uniqueWallets', field: 'uniqueWallets', thresholds: [5, 8, 10, 12, 15, 20, 30], compare: '>=' },
    { name: 'uniqueWallets_max', field: 'uniqueWallets', thresholds: [5, 10, 15], compare: '<' },
    { name: 'highValueCount', field: 'highValueCount', thresholds: [3, 5, 8, 10, 15, 20], compare: '>=' },
    { name: 'actualSpan', field: 'actualSpan', thresholds: [30, 40, 45, 50, 60, 70, 80], compare: '>=' },

    // 购买前检查 - 持有者
    { name: 'blacklistCount', field: 'blacklistCount', thresholds: [0, 1, 2, 3], compare: '<=' },
    { name: 'whitelistCount', field: 'whitelistCount', thresholds: [1, 2, 3, 5], compare: '>=' },

    // 趋势因子（第一阶段）
    { name: 'earlyReturn', field: 'earlyReturn', thresholds: [50, 80, 100, 120, 150, 200, 250, 300], compare: '>' },
    { name: 'earlyReturn_max', field: 'earlyReturn', thresholds: [200, 300, 400, 500, 600, 800], compare: '<' },
    { name: 'trendCV', field: 'trendCV', thresholds: [0.01, 0.015, 0.02, 0.025, 0.03, 0.04], compare: '>' },
    { name: 'trendStrengthScore', field: 'trendStrengthScore', thresholds: [20, 25, 30, 35, 40, 45, 50], compare: '>=' },
    { name: 'trendTotalReturn', field: 'trendTotalReturn', thresholds: [5, 8, 10, 12, 15, 20], compare: '>=' },
    { name: 'trendRiseRatio', field: 'trendRiseRatio', thresholds: [0.4, 0.5, 0.6, 0.7, 0.8], compare: '>=' },
    { name: 'trendSlope', field: 'trendSlope', thresholds: [0.01, 0.015, 0.02, 0.025, 0.03], compare: '>' },
    { name: 'trendRecentDownRatio', field: 'trendRecentDownRatio', thresholds: [0.2, 0.3, 0.4, 0.5, 0.6], compare: '<' },
    { name: 'trendConsecutiveDowns', field: 'trendConsecutiveDowns', thresholds: [0, 1, 2, 3], compare: '<=' },
    { name: 'trendDataPoints', field: 'trendDataPoints', thresholds: [3, 4, 5, 6, 7], compare: '>=' },

    // 其他
    { name: 'tvl', field: 'tvl', thresholds: [1000, 3000, 5000, 8000, 10000, 15000], compare: '>=' },
    { name: 'marketCap', field: 'marketCap', thresholds: [5000, 10000, 20000, 50000, 100000], compare: '>=' },
  ];

  // 运行所有测试
  factorTests.forEach(config => {
    config.thresholds.forEach(threshold => {
      const testName = `${config.name} ${config.compare} ${threshold}`;
      const test = (f) => {
        const val = f[config.field];
        if (val === undefined || val === null) return false;
        if (config.compare === '>=') return val >= threshold;
        if (config.compare === '<=') return val <= threshold;
        if (config.compare === '>') return val > threshold;
        if (config.compare === '<') return val < threshold;
        return false;
      };

      const wouldRejectLosing = losing.filter(t => !test(t.factors));
      const wouldRejectProfitable = profitable.filter(t => !test(t.factors));
      const recall = wouldRejectLosing.length / losing.length;
      const precision = (wouldRejectLosing.length + wouldRejectProfitable.length) > 0
        ? wouldRejectLosing.length / (wouldRejectLosing.length + wouldRejectProfitable.length)
        : 0;
      const f1 = precision > 0 ? (2 * precision * recall) / (precision + recall) : 0;

      allTests.push({
        name: testName,
        config,
        threshold,
        test,
        precision,
        recall,
        f1,
        rejectLosing: wouldRejectLosing.length,
        rejectProfitable: wouldRejectProfitable.length
      });
    });
  });

  // 显示最佳单因子
  console.log('最佳单因子（按F1分数排序）：\n');
  allTests.sort((a, b) => b.f1 - a.f1);

  console.log('规则'.padEnd(35) + 'F1分数'.padEnd(10) + '精确率'.padEnd(10) + '召回率'.padEnd(10) + '筛掉/误杀');
  console.log('-'.repeat(90));
  allTests.slice(0, 30).forEach(t => {
    if (t.rejectLosing >= 5) {
      console.log(`${t.name.padEnd(35)}${(t.f1 * 100).toFixed(1).padEnd(10)}${(t.precision * 100).toFixed(1).padEnd(10)}${(t.recall * 100).toFixed(1).padEnd(10)}${t.rejectLosing}/${t.rejectProfitable}`);
    }
  });

  // ========================================
  // 第二部分：双因子组合搜索
  // ========================================
  console.log('\n=== 第二部分：双因子组合搜索 ===\n');

  const highPrecisionTests = allTests.filter(t => t.precision > 0.65 && t.rejectLosing >= 5);
  console.log(`从 ${allTests.length} 个单因子测试中筛选出 ${highPrecisionTests.length} 个高精确率规则进行组合...\n`);

  const combinations = [];
  const processed = new Set();

  for (let i = 0; i < Math.min(20, highPrecisionTests.length); i++) {
    for (let j = i + 1; j < Math.min(40, highPrecisionTests.length); j++) {
      const test1 = highPrecisionTests[i];
      const test2 = highPrecisionTests[j];

      // 跳过相同字段的规则
      if (test1.config.field === test2.config.field) continue;

      // 避免重复组合
      const key = [test1.name, test2.name].sort().join('|');
      if (processed.has(key)) continue;
      processed.add(key);

      const test = (f) => test1.test(f) && test2.test(f);
      const wouldRejectLosing = losing.filter(t => !test(t.factors));
      const wouldRejectProfitable = profitable.filter(t => !test(t.factors));
      const recall = wouldRejectLosing.length / losing.length;
      const precision = (wouldRejectLosing.length + wouldRejectProfitable.length) > 0
        ? wouldRejectLosing.length / (wouldRejectLosing.length + wouldRejectProfitable.length)
        : 0;
      const f1 = precision > 0 ? (2 * precision * recall) / (precision + recall) : 0;

      // 只保留有意义的组合
      if (wouldRejectLosing.length >= 8 && precision > 0.70 && wouldRejectProfitable < 8) {
        combinations.push({
          name: `${test1.name} AND ${test2.name}`,
          precision,
          recall,
          f1,
          rejectLosing: wouldRejectLosing.length,
          rejectProfitable: wouldRejectProfitable.length
        });
      }
    }
  }

  console.log(`找到 ${combinations.length} 个有效双因子组合\n`);

  console.log('规则'.padEnd(80) + 'F1分数'.padEnd(10) + '精确率'.padEnd(10) + '召回率'.padEnd(10) + '误杀盈利');
  console.log('-'.repeat(130));
  combinations.sort((a, b) => b.f1 - a.f1);
  combinations.slice(0, 15).forEach(c => {
    console.log(`${c.name.padEnd(80)}${(c.f1 * 100).toFixed(1).padEnd(10)}${(c.precision * 100).toFixed(1).padEnd(10)}${(c.recall * 100).toFixed(1).padEnd(10)}${c.rejectProfitable}`);
  });

  // ========================================
  // 第三部分：三因子组合搜索
  // ========================================
  console.log('\n=== 第三部分：三因子组合搜索 ===\n');

  const topCombinations = combinations.slice(0, 10);
  const tripleCombinations = [];
  const processedTriple = new Set();

  for (let i = 0; i < topCombinations.length; i++) {
    for (let j = 0; j < Math.min(30, highPrecisionTests.length); j++) {
      const comboRule = topCombinations[i];
      const addRule = highPrecisionTests[j];

      // 跳过与组合规则字段相同的规则
      const comboFields = comboRule.name.split(' AND ').map(n => n.split(' ')[0]);
      if (comboFields.includes(addRule.config.field)) continue;

      const key = [...comboFields, addRule.config.field].sort().join('|');
      if (processedTriple.has(key)) continue;
      processedTriple.add(key);

      const test = (f) => {
        const parts = comboRule.name.split(' AND ');
        const testA = allTests.find(t => t.name === parts[0]);
        const testB = allTests.find(t => t.name === parts[1]);
        if (!testA || !testB) return true;
        return testA.test(f) && testB.test(f) && addRule.test(f);
      };

      const wouldRejectLosing = losing.filter(t => !test(t.factors));
      const wouldRejectProfitable = profitable.filter(t => !test(t.factors));
      const recall = wouldRejectLosing.length / losing.length;
      const precision = (wouldRejectLosing.length + wouldRejectProfitable.length) > 0
        ? wouldRejectLosing.length / (wouldRejectLosing.length + wouldRejectProfitable.length)
        : 0;
      const f1 = precision > 0 ? (2 * precision * recall) / (precision + recall) : 0;

      if (wouldRejectLosing.length >= 10 && precision > 0.72 && wouldRejectProfitable < 6) {
        tripleCombinations.push({
          name: `${comboRule.name} AND ${addRule.name}`,
          precision,
          recall,
          f1,
          rejectLosing: wouldRejectLosing.length,
          rejectProfitable: wouldRejectProfitable.length
        });
      }
    }
  }

  console.log(`找到 ${tripleCombinations.length} 个有效三因子组合\n`);

  if (tripleCombinations.length > 0) {
    console.log('规则'.padEnd(100) + 'F1分数'.padEnd(10) + '精确率'.padEnd(10) + '召回率'.padEnd(10) + '误杀盈利');
    console.log('-'.repeat(150));
    tripleCombinations.sort((a, b) => b.f1 - a.f1);
    tripleCombinations.slice(0, 10).forEach(c => {
      console.log(`${c.name.padEnd(100)}${(c.f1 * 100).toFixed(1).padEnd(10)}${(c.precision * 100).toFixed(1).padEnd(10)}${(c.recall * 100).toFixed(1).padEnd(10)}${c.rejectProfitable}`);
    });
  }

  // ========================================
  // 第四部分：特殊发现总结
  // ========================================
  console.log('\n=== 特殊发现总结 ===\n');

  // countPerMin >= 150 是100%亏损
  const superHighActivity = dataset.filter(t => t.factors.countPerMin >= 150);
  console.log(`1. countPerMin >= 150：${superHighActivity.length} 个代币，${superHighActivity.filter(t => t.returnRate <= 0).length} 个亏损 (${superHighActivity.length > 0 ? (superHighActivity.filter(t => t.returnRate <= 0).length/superHighActivity.length*100).toFixed(0) : 0}%)`);

  // earlyReturn > 800
  const superHighReturn = dataset.filter(t => t.factors.earlyReturn > 800);
  console.log(`2. earlyReturn > 800：${superHighReturn.length} 个代币，${superHighReturn.filter(t => t.returnRate <= 0).length} 个亏损 (${superHighReturn.length > 0 ? (superHighReturn.filter(t => t.returnRate <= 0).length/superHighReturn.length*100).toFixed(0) : 0}%)`);

  // trendStrengthScore
  const lowStrength = dataset.filter(t => t.factors.trendStrengthScore < 25);
  const highStrength = dataset.filter(t => t.factors.trendStrengthScore >= 40);
  console.log(`3. trendStrengthScore < 25：${lowStrength.length} 个代币，平均收益 ${lowStrength.length > 0 ? (lowStrength.reduce((a, t) => a + t.returnRate, 0) / lowStrength.length).toFixed(1) : 0}%`);
  console.log(`   trendStrengthScore >= 40：${highStrength.length} 个代币，平均收益 ${highStrength.length > 0 ? (highStrength.reduce((a, t) => a + t.returnRate, 0) / highStrength.length).toFixed(1) : 0}%`);

  // ========================================
  // 第五部分：最终推荐
  // ========================================
  console.log('\n=== 🎯 最终推荐 ===\n');

  if (tripleCombinations.length > 0) {
    const best = tripleCombinations[0];
    console.log('【最佳三因子组合】');
    console.log(`  ${best.name}`);
    console.log(`  精确率：${(best.precision * 100).toFixed(1)}%`);
    console.log(`  召回率：${(best.recall * 100).toFixed(1)}%`);
    console.log(`  筛掉亏损：${best.rejectLosing}/${losing.length}`);
    console.log(`  误杀盈利：${best.rejectProfitable}/${profitable.length}\n`);

    console.log('配置语句（加入 preBuyCheckCondition）：');
    const parts = best.name.split(' AND ');
    parts.forEach(p => {
      const rule = p.trim();
      let config = rule;
      // 转换为配置语句
      config = config.replace(/countPerMin/, 'earlyTradesCountPerMin');
      config = config.replace(/volumePerMin/, 'earlyTradesVolumePerMin');
      config = config.replace(/uniqueWallets/, 'earlyTradesUniqueWallets');
      config = config.replace(/highValueCount/, 'earlyTradesHighValueCount');
      config = config.replace(/actualSpan/, 'earlyTradesActualSpan');
      config = config.replace(/earlyReturn/, 'trendFactors.earlyReturn');
      config = config.replace(/trendCV/, 'trendFactors.trendCV');
      config = config.replace(/trendStrengthScore/, 'trendFactors.trendStrengthScore');
      config = config.replace(/trendTotalReturn/, 'trendFactors.trendTotalReturn');
      config = config.replace(/trendRiseRatio/, 'trendFactors.trendRiseRatio');
      config = config.replace(/trendSlope/, 'trendFactors.trendSlope');
      config = config.replace(/trendRecentDownRatio/, 'trendFactors.trendRecentDownRatio');
      console.log(`  ${config}`);
    });
  }

  // 保存结果
  const result = {
    timestamp: new Date().toISOString(),
    dataset: { total: dataset.length, profitable: profitable.length, losing: losing.length },
    bestSingleRules: allTests.slice(0, 20),
    bestDoubleRules: combinations.slice(0, 20),
    bestTripleRules: tripleCombinations.slice(0, 10)
  };
  fs.writeFileSync('/Users/nobody1/Desktop/Codes/richer-js/scripts/comprehensive_analysis_result.json', JSON.stringify(result, null, 2));
  console.log('\n详细结果已保存到 comprehensive_analysis_result.json');
}

main().catch(console.error);
