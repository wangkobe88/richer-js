/**
 * 深度因子分析
 * 1. 因子与收益率的相关性
 * 2. 因子分布统计（找最佳分割点）
 * 3. 多因子组合搜索
 * 4. 寻找被忽略的强信号
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
  console.log('正在加载数据...');

  const [tradesData, signalsData] = await Promise.all([
    get('http://localhost:3010/api/experiment/25493408-98b3-4342-a1ac-036ba49f97ee/trades?limit=10000'),
    get('http://localhost:3010/api/experiment/25493408-98b3-4342-a1ac-036ba49f97ee/signals?limit=10000')
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

  // 获取因子
  const tokenFactors = {};
  signalsData.signals.filter(s => s.action === 'buy' && s.executed === true).forEach(s => {
    if (!tokenFactors[s.token_address]) {
      const f = s.metadata?.preBuyCheckFactors || {};
      const tf = s.metadata?.trendFactors || {};
      tokenFactors[s.token_address] = {
        // 钱包簇
        clusterCount: f.walletClusterCount,
        clusterMaxSize: f.walletClusterMaxSize,
        secondToFirstRatio: f.walletClusterSecondToFirstRatio,
        megaRatio: f.walletClusterMegaRatio,
        top2Ratio: f.walletClusterTop2Ratio,
        maxBlockBuyRatio: f.walletClusterMaxBlockBuyRatio,
        maxBlockBuyAmount: f.walletClusterMaxBlockBuyAmount,
        // 早期交易
        countPerMin: f.earlyTradesCountPerMin,
        volumePerMin: f.earlyTradesVolumePerMin,
        walletsPerMin: f.earlyTradesWalletsPerMin,
        highValuePerMin: f.earlyTradesHighValuePerMin,
        totalCount: f.earlyTradesTotalCount,
        totalVolume: f.earlyTradesVolume,
        uniqueWallets: f.earlyTradesUniqueWallets,
        highValueCount: f.earlyTradesHighValueCount,
        actualSpan: f.earlyTradesActualSpan,
        // 持有者
        blacklistCount: f.holderBlacklistCount,
        whitelistCount: f.holderWhitelistCount,
        holdersCount: f.holdersCount,
        devHoldingRatio: f.devHoldingRatio,
        maxHoldingRatio: f.maxHoldingRatio,
        // 趋势
        earlyReturn: tf.earlyReturn,
        drawdownFromHighest: tf.drawdownFromHighest,
      };
    }
  });

  const dataset = tokens.map(t => ({
    ...t,
    factors: tokenFactors[t.address] || {}
  })).filter(t => Object.keys(t.factors).length > 0);

  const profitable = dataset.filter(t => t.returnRate > 0);
  const losing = dataset.filter(t => t.returnRate <= 0);

  console.log(`\n数据集：${dataset.length} 个代币 (盈利: ${profitable.length}, 亏损: ${losing.length})\n`);

  // ========================================
  // 1. 因子与收益率的相关性分析
  // ========================================
  console.log('=== 1. 因子与收益率相关性分析 ===\n');

  const factorNames = [
    'clusterCount', 'clusterMaxSize', 'secondToFirstRatio', 'megaRatio', 'top2Ratio',
    'maxBlockBuyRatio', 'countPerMin', 'volumePerMin', 'walletsPerMin', 'highValuePerMin',
    'totalCount', 'totalVolume', 'uniqueWallets', 'highValueCount', 'actualSpan',
    'blacklistCount', 'whitelistCount', 'holdersCount', 'devHoldingRatio', 'maxHoldingRatio',
    'earlyReturn', 'drawdownFromHighest'
  ];

  const correlations = [];
  factorNames.forEach(factorName => {
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0, n = 0;

    dataset.forEach(t => {
      const x = t.factors[factorName];
      const y = t.returnRate;
      if (x !== undefined && x !== null && !isNaN(x)) {
        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumX2 += x * x;
        sumY2 += y * y;
        n++;
      }
    });

    if (n > 2) {
      const correlation = (n * sumXY - sumX * sumY) / Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
      correlations.push({
        factor: factorName,
        correlation: isNaN(correlation) ? 0 : correlation,
        n: n
      });
    }
  });

  console.log('因子'.padEnd(25) + '相关系数'.padEnd(12) + '解释');
  console.log('-'.repeat(70));
  correlations.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
  correlations.slice(0, 15).forEach(c => {
    const strength = Math.abs(c.correlation);
    const label = strength > 0.5 ? '强相关' : strength > 0.3 ? '中等相关' : '弱相关';
    const direction = c.correlation > 0 ? '(+)' : '(-)';
    console.log(`${c.factor.padEnd(25)}${c.correlation.toFixed(3).padEnd(12)}${direction} ${label}`);
  });

  // ========================================
  // 2. 因子分布统计（找最佳分割点）
  // ========================================
  console.log('\n=== 2. 关键因子分布分析 ===\n');

  const keyFactors = [
    'secondToFirstRatio', 'megaRatio', 'top2Ratio', 'countPerMin',
    'volumePerMin', 'uniqueWallets', 'highValueCount', 'actualSpan',
    'devHoldingRatio', 'maxHoldingRatio', 'earlyReturn'
  ];

  keyFactors.forEach(factorName => {
    const values = dataset.map(t => t.factors[factorName]).filter(v => v !== undefined && v !== null);
    if (values.length < 10) return;

    values.sort((a, b) => a - b);
    const min = values[0];
    const max = values[values.length - 1];
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const median = values[Math.floor(values.length / 2)];

    // 计算盈利和亏损代币的平均值
    const profitableValues = profitable.map(t => t.factors[factorName]).filter(v => v !== undefined && v !== null);
    const losingValues = losing.map(t => t.factors[factorName]).filter(v => v !== undefined && v !== null);
    const avgProfitable = profitableValues.length > 0 ? profitableValues.reduce((a, b) => a + b, 0) / profitableValues.length : 0;
    const avgLosing = losingValues.length > 0 ? losingValues.reduce((a, b) => a + b, 0) / losingValues.length : 0;

    console.log(`${factorName}:`);
    console.log(`  范围: [${min.toFixed(2)}, ${max.toFixed(2)}], 平均: ${avg.toFixed(2)}, 中位数: ${median.toFixed(2)}`);
    console.log(`  盈利代币平均: ${avgProfitable.toFixed(2)}, 亏损代币平均: ${avgLosing.toFixed(2)}`);
    console.log(`  差异: ${(avgProfitable - avgLosing).toFixed(2)}\n`);
  });

  // ========================================
  // 3. 寻找最佳阈值
  // ========================================
  console.log('=== 3. 最佳阈值搜索 ===\n');

  const thresholdTests = [
    { factor: 'secondToFirstRatio', compare: '>', range: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5] },
    { factor: 'megaRatio', compare: '<', range: [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8] },
    { factor: 'top2Ratio', compare: '<', range: [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95] },
    { factor: 'countPerMin', compare: '>=', range: [10, 20, 30, 40, 50, 60, 80, 100, 120, 150, 180, 200] },
    { factor: 'countPerMin', compare: '<', range: [100, 120, 140, 150, 160, 180, 200, 250] },
    { factor: 'volumePerMin', compare: '>=', range: [1000, 2000, 3000, 4000, 5000, 6000, 8000, 10000] },
    { factor: 'uniqueWallets', compare: '>=', range: [3, 5, 8, 10, 12, 15, 20] },
    { factor: 'highValueCount', compare: '>=', range: [2, 3, 5, 8, 10, 15, 20] },
    { factor: 'actualSpan', compare: '>=', range: [30, 40, 50, 60, 70, 80, 90] },
    { factor: 'devHoldingRatio', compare: '<', range: [3, 5, 8, 10, 12, 15, 18, 20] },
    { factor: 'maxHoldingRatio', compare: '<', range: [8, 10, 12, 15, 18, 20, 25, 30] },
    { factor: 'earlyReturn', compare: '>', range: [30, 50, 80, 100, 120, 150, 200, 250] },
    { factor: 'earlyReturn', compare: '<', range: [200, 300, 400, 500] },
  ];

  console.log('因子'.padEnd(20) + '阈值'.padEnd(10) + '方向'.padEnd(8) + '精确率'.padEnd(10) + '召回率'.padEnd(10) + 'F1分数');
  console.log('-'.repeat(80));

  const bestThresholds = [];
  thresholdTests.forEach(({ factor, compare, range }) => {
    range.forEach(threshold => {
      const test = (f) => {
        const val = f[factor];
        if (val === undefined || val === null) return false;
        if (compare === '>=') return val >= threshold;
        if (compare === '<=') return val <= threshold;
        if (compare === '>') return val > threshold;
        if (compare === '<') return val < threshold;
        return false;
      };

      const wouldRejectLosing = losing.filter(t => !test(t.factors));
      const wouldRejectProfitable = profitable.filter(t => !test(t.factors));
      const recall = wouldRejectLosing.length / losing.length;
      const precision = (wouldRejectLosing.length + wouldRejectProfitable.length) > 0
        ? wouldRejectLosing.length / (wouldRejectLosing.length + wouldRejectProfitable.length)
        : 0;
      const f1 = precision > 0 ? (2 * precision * recall) / (precision + recall) : 0;

      // 只保留有意义的阈值
      if (wouldRejectLosing.length >= 3 && precision > 0.5) {
        bestThresholds.push({
          factor,
          threshold,
          compare,
          precision,
          recall,
          f1,
          rejectLosing: wouldRejectLosing.length,
          rejectProfitable: wouldRejectProfitable.length
        });
      }
    });
  });

  bestThresholds.sort((a, b) => b.f1 - a.f1);
  bestThresholds.slice(0, 30).forEach(t => {
    console.log(`${t.factor.padEnd(20)}${t.threshold.toString().padEnd(10)}${t.compare.padEnd(8)}${(t.precision * 100).toFixed(1).padEnd(10)}${(t.recall * 100).toFixed(1).padEnd(10)}${(t.f1 * 100).toFixed(1)}`);
  });

  // ========================================
  // 4. 3因子组合搜索
  // ========================================
  console.log('\n=== 4. 三因子组合搜索 ===\n');

  // 选择F1分数最高的前15个单因子规则
  const topThresholds = bestThresholds.slice(0, 15);
  console.log(`从 ${bestThresholds.length} 个候选阈值中选择前15个进行组合...\n`);

  const tripleCombinations = [];
  for (let i = 0; i < Math.min(10, topThresholds.length); i++) {
    for (let j = i + 1; j < Math.min(12, topThresholds.length); j++) {
      for (let k = j + 1; k < Math.min(15, topThresholds.length); k++) {
        const t1 = topThresholds[i];
        const t2 = topThresholds[j];
        const t3 = topThresholds[k];

        // 跳过相同因子的组合
        if (t1.factor === t2.factor || t1.factor === t3.factor || t2.factor === t3.factor) continue;

        const test = (f) => {
          const v1 = f[t1.factor];
          const v2 = f[t2.factor];
          const v3 = f[t3.factor];
          if (v1 === undefined || v2 === undefined || v3 === undefined) return false;

          const pass1 = t1.compare === '>=' ? v1 >= t1.threshold : t1.compare === '<' ? v1 < t1.threshold : t1.compare === '>' ? v1 > t1.threshold : v1 <= t1.threshold;
          const pass2 = t2.compare === '>=' ? v2 >= t2.threshold : t2.compare === '<' ? v2 < t2.threshold : t2.compare === '>' ? v2 > t2.threshold : v2 <= t2.threshold;
          const pass3 = t3.compare === '>=' ? v3 >= t3.threshold : t3.compare === '<' ? v3 < t3.threshold : t3.compare === '>' ? v3 > t3.threshold : v3 <= t3.threshold;

          return pass1 && pass2 && pass3;
        };

        const wouldRejectLosing = losing.filter(t => !test(t.factors));
        const wouldRejectProfitable = profitable.filter(t => !test(t.factors));
        const recall = wouldRejectLosing.length / losing.length;
        const precision = (wouldRejectLosing.length + wouldRejectProfitable.length) > 0
          ? wouldRejectLosing.length / (wouldRejectLosing.length + wouldRejectProfitable.length)
          : 0;
        const f1 = precision > 0 ? (2 * precision * recall) / (precision + recall) : 0;

        // 只保留精确率 > 70% 且误杀盈利 < 6 的组合
        if (precision > 0.7 && wouldRejectProfitable < 6 && wouldRejectLosing.length >= 10) {
          tripleCombinations.push({
            name: `${t1.factor} ${t1.compare} ${t1.threshold} AND ${t2.factor} ${t2.compare} ${t2.threshold} AND ${t3.factor} ${t3.compare} ${t3.threshold}`,
            precision,
            recall,
            f1,
            rejectLosing: wouldRejectLosing.length,
            rejectProfitable: wouldRejectProfitable.length
          });
        }
      }
    }
  }

  console.log('规则'.padEnd(90) + '精确率'.padEnd(10) + '召回率'.padEnd(10) + 'F1分数'.padEnd(10) + '误杀盈利');
  console.log('-'.repeat(140));

  tripleCombinations.sort((a, b) => b.rejectLosing - a.rejectLosing);
  tripleCombinations.slice(0, 10).forEach(c => {
    console.log(`${c.name.padEnd(90)}${(c.precision * 100).toFixed(1).padEnd(10)}${(c.recall * 100).toFixed(1).padEnd(10)}${(c.f1 * 100).toFixed(1).padEnd(10)}${c.rejectProfitable}`);
  });

  // ========================================
  // 5. 被忽略的强信号因子
  // ========================================
  console.log('\n=== 5. 被忽略的强信号因子分析 ===\n');

  // 分析 earlyReturn > 300 的代币
  const superHighReturn = dataset.filter(t => t.factors.earlyReturn > 300);
  const superHighReturnLosing = superHighReturn.filter(t => t.returnRate <= 0);

  console.log(`earlyReturn > 300% 的代币：${superHighReturn.length} 个`);
  if (superHighReturn.length > 0) {
    console.log(`  亏损：${superHighReturnLosing.length} 个 (${(superHighReturnLosing.length / superHighReturn.length * 100).toFixed(1)}%)`);
    console.log(`  盈利：${superHighReturn.length - superHighReturnLosing.length} 个\n`);

    if (superHighReturnLosing.length > 0) {
      console.log('  亏损代币详情：');
      superHighReturnLosing.forEach(t => {
        console.log(`    ${t.symbol}: ${t.returnRate.toFixed(1)}%, earlyReturn=${t.factors.earlyReturn.toFixed(1)}%, countPerMin=${t.factors.countPerMin}`);
      });
    }
  }

  // 分析 uniqueWallets 极低的代币
  const lowWallets = dataset.filter(t => t.factors.uniqueWallets < 5);
  const lowWalletsLosing = lowWallets.filter(t => t.returnRate <= 0);

  console.log(`\nuniqueWallets < 5 的代币：${lowWallets.length} 个`);
  if (lowWallets.length > 0) {
    console.log(`  亏损：${lowWalletsLosing.length} 个 (${(lowWalletsLosing.length / lowWallets.length * 100).toFixed(1)}%)`);
    console.log(`  盈利：${lowWallets.length - lowWalletsLosing.length} 个\n`);

    if (lowWalletsLosing.length > 0) {
      console.log('  亏损代币详情：');
      lowWalletsLosing.forEach(t => {
        console.log(`    ${t.symbol}: ${t.returnRate.toFixed(1)}%, uniqueWallets=${t.factors.uniqueWallets}, countPerMin=${t.factors.countPerMin}`);
      });
    }
  }

  // 分析 actualSpan 极短的代币
  const shortSpan = dataset.filter(t => t.factors.actualSpan < 45);
  const shortSpanLosing = shortSpan.filter(t => t.returnRate <= 0);

  console.log(`\nactualSpan < 45秒 的代币：${shortSpan.length} 个`);
  if (shortSpan.length > 0) {
    console.log(`  亏损：${shortSpanLosing.length} 个 (${(shortSpanLosing.length / shortSpan.length * 100).toFixed(1)}%)`);
    console.log(`  盈利：${shortSpan.length - shortSpanLosing.length} 个\n`);

    if (shortSpanLosing.length > 0) {
      console.log('  亏损代币详情：');
      shortSpanLosing.forEach(t => {
        console.log(`    ${t.symbol}: ${t.returnRate.toFixed(1)}%, actualSpan=${t.factors.actualSpan}, countPerMin=${t.factors.countPerMin}`);
      });
    }
  }

  // ========================================
  // 6. 最终推荐
  // ========================================
  console.log('\n=== 🎯 最终推荐规则 ===\n');

  if (tripleCombinations.length > 0) {
    const best = tripleCombinations[0];
    console.log('【最佳三因子组合】');
    console.log(`  ${best.name}`);
    console.log(`  精确率: ${(best.precision * 100).toFixed(1)}%`);
    console.log(`  召回率: ${(best.recall * 100).toFixed(1)}%`);
    console.log(`  筛掉亏损: ${best.rejectLosing}/${losing.length}`);
    console.log(`  误杀盈利: ${best.rejectProfitable}/${profitable.length}\n`);
  }

  // 保存结果
  const result = {
    correlations: correlations,
    bestThresholds: bestThresholds.slice(0, 30),
    tripleCombinations: tripleCombinations.slice(0, 20)
  };
  fs.writeFileSync('/Users/nobody1/Desktop/Codes/richer-js/scripts/deep_analysis_result.json', JSON.stringify(result, null, 2));
  console.log('详细结果已保存到 deep_analysis_result.json');
}

main().catch(console.error);
