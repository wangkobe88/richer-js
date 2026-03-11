/**
 * 降低标准，寻找更多组合规律
 * 分析盈利代币和亏损代币的因子分布差异
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
  const [tradesData, signalsData, timeSeriesData] = await Promise.all([
    get('http://localhost:3010/api/experiment/25493408-98b3-4342-a1ac-036ba49f97ee/trades?limit=10000'),
    get('http://localhost:3010/api/experiment/25493408-98b3-4342-a1ac-036ba49f97ee/signals?limit=10000'),
    get('http://localhost:3010/api/experiment/6b17ff18-002d-4ce0-a745-b8e02676abd4/time-series?limit=10000')
  ]);

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

  const signalFactors = {};
  signalsData.signals.filter(s => s.action === 'buy' && s.executed === true).forEach(s => {
    if (!signalFactors[s.token_address]) {
      const f = s.metadata?.preBuyCheckFactors || {};
      const tf = s.metadata?.trendFactors || {};
      signalFactors[s.token_address] = {
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
        whitelistCount: f.holderWhitelistCount,
        earlyReturn_signal: tf.earlyReturn,
        trendCV: tf.trendCV,
        trendPriceUp: tf.trendPriceUp,
        trendMedianUp: tf.trendMedianUp,
        trendStrengthScore: tf.trendStrengthScore,
        trendTotalReturn: tf.trendTotalReturn,
        trendRiseRatio: tf.trendRiseRatio,
        trendRecentDownRatio: tf.trendRecentDownRatio,
        trendConsecutiveDowns: tf.trendConsecutiveDowns,
      };
    }
  });

  const seriesFactors = {};
  if (timeSeriesData.success && timeSeriesData.timeSeriesList) {
    timeSeriesData.timeSeriesList.forEach(ts => {
      if (!seriesFactors[ts.token_address]) {
        const fv = ts.factor_values || {};
        seriesFactors[ts.token_address] = {
          age: fv.age,
          earlyReturn_ts: fv.earlyReturn,
          tvl: fv.tvl,
          fdv: fv.fdv,
          marketCap: fv.marketCap,
        };
      }
    });
  }

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
  // 1. 对比分析：盈利代币 vs 亏损代币
  // ========================================
  console.log('=== 1. 盈利代币 vs 亏损代币的因子平均值对比 ===\n');

  const factorsToCompare = [
    'secondToFirstRatio', 'megaRatio', 'top2Ratio', 'countPerMin',
    'volumePerMin', 'uniqueWallets', 'highValueCount', 'actualSpan',
    'whitelistCount', 'earlyReturn_signal', 'trendCV', 'trendStrengthScore',
    'trendTotalReturn', 'trendRiseRatio', 'trendRecentDownRatio'
  ];

  console.log('因子'.padEnd(25) + '盈利平均'.padEnd(12) + '亏损平均'.padEnd(12) + '差异'.padEnd(12) + '结论');
  console.log('-'.repeat(80));

  factorsToCompare.forEach(factorName => {
    const profitValues = profitable.map(t => t.factors[factorName]).filter(v => v !== undefined && v !== null);
    const losingValues = losing.map(t => t.factors[factorName]).filter(v => v !== undefined && v !== null);

    if (profitValues.length === 0 || losingValues.length === 0) return;

    const avgProfit = profitValues.reduce((a, b) => a + b, 0) / profitValues.length;
    const avgLosing = losingValues.reduce((a, b) => a + b, 0) / losingValues.length;
    const diff = avgProfit - avgLosing;

    let conclusion = '';
    if (diff > 10) conclusion = '盈利 >> 亏损';
    else if (diff < -10) conclusion = '盈利 << 亏损';
    else if (Math.abs(diff) < 5) conclusion = '差异小';
    else conclusion = '盈利 > 亏损';

    console.log(`${factorName.padEnd(25)}${avgProfit.toFixed(2).padEnd(12)}${avgLosing.toFixed(2).padEnd(12)}${diff.toFixed(2).padEnd(12)}${conclusion}`);
  });

  // ========================================
  // 2. 寻找"黄金分割点"（每个因子的最佳阈值）
  // ========================================
  console.log('\n=== 2. 每个因子的黄金分割点 ===\n');

  const goldenThresholds = [
    { name: 'top2Ratio', thresholds: [0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9] },
    { name: 'countPerMin', thresholds: [20, 30, 40, 50, 60, 80, 100, 120, 150, 180, 200] },
    { name: 'volumePerMin', thresholds: [1000, 2000, 3000, 4000, 5000, 6000, 8000, 10000] },
    { name: 'uniqueWallets', thresholds: [5, 8, 10, 15, 20, 30, 50] },
    { name: 'highValueCount', thresholds: [3, 5, 8, 10, 15, 20, 30] },
    { name: 'actualSpan', thresholds: [30, 40, 50, 60, 70, 80] },
    { name: 'trendCV', thresholds: [0.01, 0.015, 0.02, 0.025, 0.03, 0.04] },
    { name: 'trendStrengthScore', thresholds: [20, 25, 30, 35, 40, 45, 50] },
    { name: 'trendTotalReturn', thresholds: [5, 8, 10, 12, 15, 20, 30, 40] },
    { name: 'trendRiseRatio', thresholds: [0.4, 0.5, 0.6, 0.7, 0.8, 0.9] },
  ];

  goldenThresholds.forEach(({ name, thresholds }) => {
    console.log(`${name}:`);
    let bestThreshold = null;
    let bestPrecision = 0;
    let bestRecall = 0;
    let bestF1 = 0;

    thresholds.forEach(threshold => {
      // 测试 "<" 条件
      const subsetLow = dataset.filter(t => {
        const val = t.factors[name];
        return val !== undefined && val !== null && val < threshold;
      });

      if (subsetLow.length >= 5) {
        const losingLow = subsetLow.filter(t => t.returnRate <= 0);
        const precision = (subsetLow.length - losingLow.length) / subsetLow.length;
        const recall = losing.length > 0 ? (losing.length - losingLow.length) / losing.length : 0;
        const f1 = (precision + recall > 0) ? (2 * precision * recall) / (precision + recall) : 0;

        if (f1 > bestF1) {
          bestF1 = f1;
          bestThreshold = threshold;
          bestPrecision = precision;
          bestRecall = recall;
        }
      }
    });

    if (bestThreshold !== null) {
      console.log(`  最佳阈值: < ${bestThreshold}`);
      console.log(`  精确率: ${(bestPrecision * 100).toFixed(1)}%, 召回率: ${(bestRecall * 100).toFixed(1)}%, F1: ${(bestF1 * 100).toFixed(1)}\n`);
    }
  });

  // ========================================
  // 3. 双因子组合（降低标准）
  // ========================================
  console.log('=== 3. 双因子组合（降低标准：精确率>65%，误杀<8）===\n');

  // 定义简化规则集合
  const simpleRules = [
    { name: 'top2Ratio < 0.6', test: (f) => f.top2Ratio < 0.6 },
    { name: 'top2Ratio < 0.65', test: (f) => f.top2Ratio < 0.65 },
    { name: 'top2Ratio < 0.7', test: (f) => f.top2Ratio < 0.7 },
    { name: 'top2Ratio < 0.75', test: (f) => f.top2Ratio < 0.75 },
    { name: 'countPerMin < 150', test: (f) => f.countPerMin < 150 },
    { name: 'countPerMin < 120', test: (f) => f.countPerMin < 120 },
    { name: 'countPerMin >= 30', test: (f) => f.countPerMin >= 30 },
    { name: 'countPerMin >= 40', test: (f) => f.countPerMin >= 40 },
    { name: 'volumePerMin >= 3000', test: (f) => f.volumePerMin >= 3000 },
    { name: 'volumePerMin >= 5000', test: (f) => f.volumePerMin >= 5000 },
    { name: 'uniqueWallets >= 10', test: (f) => f.uniqueWallets >= 10 },
    { name: 'uniqueWallets >= 15', test: (f) => f.uniqueWallets >= 15 },
    { name: 'actualSpan >= 50', test: (f) => f.actualSpan >= 50 },
    { name: 'actualSpan >= 60', test: (f) => f.actualSpan >= 60 },
    { name: 'trendCV >= 0.02', test: (f) => f.trendCV >= 0.02 },
    { name: 'trendStrengthScore >= 35', test: (f) => f.trendStrengthScore >= 35 },
    { name: 'trendStrengthScore >= 40', test: (f) => f.trendStrengthScore >= 40 },
    { name: 'trendTotalReturn >= 10', test: (f) => f.trendTotalReturn >= 10 },
    { name: 'trendRiseRatio >= 0.6', test: (f) => f.trendRiseRatio >= 0.6 },
    { name: 'earlyReturn_signal > 80', test: (f) => f.earlyReturn_signal > 80 },
    { name: 'earlyReturn_signal > 100', test: (f) => f.earlyReturn_signal > 100 },
    { name: 'earlyReturn_signal > 150', test: (f) => f.earlyReturn_signal > 150 },
  ];

  console.log('规则'.padEnd(70) + '精确率'.padEnd(10) + '召回率'.padEnd(10) + 'F1分数'.padEnd(10) + '误杀盈利');
  console.log('-'.repeat(120));

  const validCombinations = [];
  for (let i = 0; i < simpleRules.length; i++) {
    for (let j = i + 1; j < simpleRules.length; j++) {
      const rule1 = simpleRules[i];
      const rule2 = simpleRules[j];

      // 跳过相同字段的规则
      const field1 = rule1.name.split(' ')[0];
      const field2 = rule2.name.split(' ')[0];
      if (field1 === field2) continue;

      const test = (f) => rule1.test(f) && rule2.test(f);
      const wouldRejectLosing = losing.filter(t => !test(t.factors));
      const wouldRejectProfitable = profitable.filter(t => !test(t.factors));
      const recall = wouldRejectLosing.length / losing.length;
      const precision = (wouldRejectLosing.length + wouldRejectProfitable.length) > 0
        ? wouldRejectLosing.length / (wouldRejectLosing.length + wouldRejectProfitable.length)
        : 0;
      const f1 = precision > 0 ? (2 * precision * recall) / (precision + recall) : 0;

      // 降低标准
      if (precision > 0.65 && wouldRejectProfitable < 8 && wouldRejectLosing.length >= 8) {
        validCombinations.push({
          name: `${rule1.name} AND ${rule2.name}`,
          precision,
          recall,
          f1,
          rejectLosing: wouldRejectLosing.length,
          rejectProfitable: wouldRejectProfitable.length
        });
      }
    }
  }

  validCombinations.sort((a, b) => b.f1 - a.f1);
  validCombinations.slice(0, 15).forEach(c => {
    console.log(`${c.name.padEnd(70)}${(c.precision * 100).toFixed(1).padEnd(10)}${(c.recall * 100).toFixed(1).padEnd(10)}${(c.f1 * 100).toFixed(1).padEnd(10)}${c.rejectProfitable}`);
  });

  // ========================================
  // 4. 三因子组合
  // ========================================
  console.log('\n=== 4. 三因子组合（基于最佳双因子）===\n');

  if (validCombinations.length > 0) {
    const topDouble = validCombinations.slice(0, 5);

    console.log('基于前5个双因子组合，添加第三个因子...\n');

    const tripleCombinations = [];

    for (let i = 0; i < topDouble.length; i++) {
      for (let j = 0; j < simpleRules.length; j++) {
        const comboRule = topDouble[i];
        const addRule = simpleRules[j];

        // 跳过已使用的字段
        const usedFields = comboRule.name.split(' AND ').map(r => r.split(' ')[0]);
        if (usedFields.includes(addRule.name.split(' ')[0])) continue;

        const test = (f) => {
          const parts = comboRule.name.split(' AND ');
          const tests = parts.map(p => simpleRules.find(r => r.name === p));
          if (tests.some(t => !t)) return true;
          return tests.every(t => t.test(f)) && addRule.test(f);
        };

        const wouldRejectLosing = losing.filter(t => !test(t.factors));
        const wouldRejectProfitable = profitable.filter(t => !test(t.factors));
        const recall = wouldRejectLosing.length / losing.length;
        const precision = (wouldRejectLosing.length + wouldRejectProfitable.length) > 0
          ? wouldRejectLosing.length / (wouldRejectLosing.length + wouldRejectProfitable.length)
          : 0;
        const f1 = precision > 0 ? (2 * precision * recall) / (precision + recall) : 0;

        if (precision > 0.65 && wouldRejectProfitable < 7 && wouldRejectLosing.length >= 10) {
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

    if (tripleCombinations.length > 0) {
      console.log('规则'.padEnd(95) + '精确率'.padEnd(10) + '召回率'.padEnd(10) + 'F1分数'.padEnd(10) + '误杀盈利');
      console.log('-'.repeat(150));

      tripleCombinations.sort((a, b) => b.f1 - a.f1);
      tripleCombinations.slice(0, 10).forEach(c => {
        console.log(`${c.name.padEnd(95)}${(c.precision * 100).toFixed(1).padEnd(10)}${(c.recall * 100).toFixed(1).padEnd(10)}${(c.f1 * 100).toFixed(1).padEnd(10)}${c.rejectProfitable}`);
      });
    } else {
      console.log('没有找到符合条件的三因子组合');
    }
  }

  // ========================================
  // 5. 最终推荐
  // ========================================
  console.log('\n=== 🎯 最终推荐 ===\n');

  if (validCombinations.length > 0) {
    const bestDouble = validCombinations[0];
    console.log('【最佳双因子组合】');
    console.log(`  ${bestDouble.name}`);
    console.log(`  精确率：${(bestDouble.precision * 100).toFixed(1)}%`);
    console.log(`  召回率：${(bestDouble.recall * 100).toFixed(1)}%`);
    console.log(`  F1分数：${(bestDouble.f1 * 100).toFixed(1)}%`);
    console.log(`  筛掉亏损：${bestDouble.rejectLosing}/${losing.length}`);
    console.log(`  误杀盈利：${bestDouble.rejectProfitable}/${profitable.length}\n`);
  }

  if (validCombinations.length > 0 && tripleCombinations && tripleCombinations.length > 0) {
    const bestTriple = tripleCombinations[0];
    console.log('【最佳三因子组合】');
    console.log(`  ${bestTriple.name}`);
    console.log(`  精确率：${(bestTriple.precision * 100).toFixed(1)}%`);
    console.log(`  召回率：${(bestTriple.recall * 100).toFixed(1)}%`);
    console.log(`  F1分数：${(bestTriple.f1 * 100).toFixed(1)}%`);
    console.log(`  筛掉亏损：${bestTriple.rejectLosing}/${losing.length}`);
    console.log(`  误杀盈利：${bestTriple.rejectProfitable}/${profitable.length}\n`);
  }

  // 输出配置语句
  console.log('【配置语句】');
  console.log('在现有 preBuyCheckCondition 基础上，可以额外添加：\n');

  if (validCombinations.length > 0) {
    console.log('// 推荐双因子：');
    const parts = validCombinations[0].name.split(' AND ');
    parts.forEach(p => {
      let config = p.trim();
      config = config.replace(/countPerMin/, 'earlyTradesCountPerMin');
      config = config.replace(/volumePerMin/, 'earlyTradesVolumePerMin');
      config = config.replace(/uniqueWallets/, 'earlyTradesUniqueWallets');
      config = config.replace(/highValueCount/, 'earlyTradesHighValueCount');
      config = config.replace(/actualSpan/, 'earlyTradesActualSpan');
      config = config.replace(/earlyReturn_signal/, 'trendFactors.earlyReturn');
      config = config.replace(/trendCV/, 'trendFactors.trendCV');
      config = config.replace(/trendStrengthScore/, 'trendFactors.trendStrengthScore');
      config = config.replace(/trendTotalReturn/, 'trendFactors.trendTotalReturn');
      config = config.replace(/trendRiseRatio/, 'trendFactors.trendRiseRatio');
      console.log(`  ${config}`);
    });
  }
}

main().catch(console.error);
