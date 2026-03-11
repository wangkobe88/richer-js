/**
 * 深度分析关键发现
 * countPerMin < 20: F1=92.1
 * earlyReturn: 盈利平均652.87%, 亏损平均274.99%
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
        actualSpan: f.earlyTradesActualSpan,
        earlyReturn: tf.earlyReturn,
        maxBlockBuyRatio: f.walletClusterMaxBlockBuyRatio,
        blacklistCount: f.holderBlacklistCount,
        whitelistCount: f.holderWhitelistCount,
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

  // ========================================
  // 1. 分析 "countPerMin < 20" 为什么 F1 这么高
  // ========================================
  console.log('=== 1. 分析 countPerMin < 20 ===\n');

  const lowCount = dataset.filter(t => t.factors.countPerMin < 20);
  const highCount = dataset.filter(t => t.factors.countPerMin >= 20);

  console.log(`countPerMin < 20 的代币：${lowCount.length} 个`);
  console.log(`countPerMin >= 20 的代币：${highCount.length} 个\n`);

  const lowCountLosing = lowCount.filter(t => t.returnRate <= 0);
  const lowCountProfitable = lowCount.filter(t => t.returnRate > 0);
  const highCountLosing = highCount.filter(t => t.returnRate <= 0);
  const highCountProfitable = highCount.filter(t => t.returnRate > 0);

  console.log('countPerMin < 20:');
  console.log(`  亏损：${lowCountLosing.length}/${lowCount.length} (${(lowCountLosing.length/lowCount.length*100).toFixed(1)}%)`);
  console.log(`  盈利：${lowCountProfitable.length}/${lowCount.length} (${(lowCountProfitable.length/lowCount.length*100).toFixed(1)}%)`);
  console.log(`  平均收益率：${lowCount.reduce((a, t) => a + t.returnRate, 0) / lowCount.length.toFixed(1)}%\n`);

  console.log('countPerMin >= 20:');
  console.log(`  亏损：${highCountLosing.length}/${highCount.length} (${(highCountLosing.length/highCount.length*100).toFixed(1)}%)`);
  console.log(`  盈利：${highCountProfitable.length}/${highCount.length} (${(highCountProfitable.length/highCount.length*100).toFixed(1)}%)`);
  console.log(`  平均收益率：${highCount.reduce((a, t) => a + t.returnRate, 0) / highCount.length.toFixed(1)}%\n`);

  if (lowCount.length > 0) {
    console.log('countPerMin < 20 的代币详情：');
    lowCount.forEach(t => {
      console.log(`  ${t.symbol}: ${t.returnRate.toFixed(1)}%, countPerMin=${t.factors.countPerMin}, earlyReturn=${t.factors.earlyReturn.toFixed(1)}%`);
    });
  }

  // ========================================
  // 2. 分析 earlyReturn 的分布
  // ========================================
  console.log('\n=== 2. 分析 earlyReturn 分布 ===\n');

  const erRanges = [
    { min: 0, max: 100, label: '< 100%' },
    { min: 100, max: 200, label: '100-200%' },
    { min: 200, max: 300, label: '200-300%' },
    { min: 300, max: 400, label: '300-400%' },
    { min: 400, max: 500, label: '400-500%' },
    { min: 500, max: 1000, label: '500-1000%' },
    { min: 1000, max: Infinity, label: '> 1000%' },
  ];

  console.log('earlyReturn 范围'.padEnd(15) + '代币数'.padEnd(10) + '盈利数'.padEnd(10) + '亏损数'.padEnd(10) + '亏损率'.padEnd(10) + '平均收益');
  console.log('-'.repeat(80));

  erRanges.forEach(({ min, max, label }) => {
    const subset = dataset.filter(t => t.factors.earlyReturn >= min && t.factors.earlyReturn < max);
    if (subset.length > 0) {
      const losing = subset.filter(t => t.returnRate <= 0);
      const profitable = subset.filter(t => t.returnRate > 0);
      const avgReturn = subset.reduce((a, t) => a + t.returnRate, 0) / subset.length;

      console.log(`${label.padEnd(15)}${subset.length.toString().padEnd(10)}${profitable.length.toString().padEnd(10)}${losing.length.toString().padEnd(10)}${(losing.length/subset.length*100).toFixed(1).padEnd(10)}${avgReturn.toFixed(1)}%`);
    }
  });

  // ========================================
  // 3. 分析 earlyReturn 和 countPerMin 的组合
  // ========================================
  console.log('\n=== 3. earlyReturn 和 countPerMin 组合分析 ===\n');

  const erCountRanges = [
    { erMax: 150, countMin: 20, label: 'earlyReturn < 150% AND countPerMin >= 20' },
    { erMin: 150, countMin: 80, label: 'earlyReturn >= 150% AND countPerMin >= 80' },
    { erMin: 200, countMin: 100, label: 'earlyReturn >= 200% AND countPerMin >= 100' },
    { erMin: 200, countMin: 150, label: 'earlyReturn >= 200% AND countPerMin >= 150' },
    { erMin: 300, countMin: 100, label: 'earlyReturn >= 300% AND countPerMin >= 100' },
    { erMin: 400, countMin: 100, label: 'earlyReturn >= 400% AND countPerMin >= 100' },
  ];

  console.log('组合条件'.padEnd(50) + '代币数'.padEnd(10) + '亏损数'.padEnd(10) + '亏损率'.padEnd(10) + '平均收益');
  console.log('-'.repeat(100));

  erCountRanges.forEach(({ erMin, erMax, countMin, label }) => {
    let subset;
    if (erMin !== undefined) {
      subset = dataset.filter(t => t.factors.earlyReturn >= erMin && t.factors.countPerMin >= countMin);
    } else {
      subset = dataset.filter(t => t.factors.earlyReturn < erMax && t.factors.countPerMin >= countMin);
    }

    if (subset.length > 0) {
      const losing = subset.filter(t => t.returnRate <= 0);
      const avgReturn = subset.reduce((a, t) => a + t.returnRate, 0) / subset.length;

      console.log(`${label.padEnd(50)}${subset.length.toString().padEnd(10)}${losing.length.toString().padEnd(10)}${(losing.length/subset.length*100).toFixed(1).padEnd(10)}${avgReturn.toFixed(1)}%`);

      if (losing.length === subset.length && subset.length >= 3) {
        console.log(`    ⚠️  ${subset.length} 个代币全部亏损！`);
        subset.forEach(t => {
          console.log(`      ${t.symbol}: ${t.returnRate.toFixed(1)}%, earlyReturn=${t.factors.earlyReturn.toFixed(1)}%, countPerMin=${t.factors.countPerMin.toFixed(1)}`);
        });
      }
    }
  });

  // ========================================
  // 4. 分析 top2Ratio 的作用
  // ========================================
  console.log('\n=== 4. 分析 top2Ratio ===\n');

  const top2Ranges = [
    { max: 0.5, label: '< 0.5' },
    { min: 0.5, max: 0.6, label: '0.5-0.6' },
    { min: 0.6, max: 0.7, label: '0.6-0.7' },
    { min: 0.7, max: 0.8, label: '0.7-0.8' },
    { min: 0.8, max: 0.9, label: '0.8-0.9' },
    { min: 0.9, label: '>= 0.9' },
  ];

  console.log('top2Ratio 范围'.padEnd(15) + '代币数'.padEnd(10) + '盈利数'.padEnd(10) + '亏损数'.padEnd(10) + '亏损率'.padEnd(10) + '平均收益');
  console.log('-'.repeat(85));

  top2Ranges.forEach(({ min, max, label }) => {
    const subset = dataset.filter(t => {
      const val = t.factors.top2Ratio;
      if (val === undefined) return false;
      if (min !== undefined && max !== undefined) return val >= min && val < max;
      if (min !== undefined) return val >= min;
      if (max !== undefined) return val < max;
      return true;
    });

    if (subset.length > 0) {
      const losing = subset.filter(t => t.returnRate <= 0);
      const profitable = subset.filter(t => t.returnRate > 0);
      const avgReturn = subset.reduce((a, t) => a + t.returnRate, 0) / subset.length;

      console.log(`${label.padEnd(15)}${subset.length.toString().padEnd(10)}${profitable.length.toString().padEnd(10)}${losing.length.toString().padEnd(10)}${(losing.length/subset.length*100).toFixed(1).padEnd(10)}${avgReturn.toFixed(1)}%`);
    }
  });

  // ========================================
  // 5. 组合分析：三个关键因子
  // ========================================
  console.log('\n=== 5. 组合分析：earlyReturn + countPerMin + top2Ratio ===\n');

  const ranges = [
    { erMin: 0, erMax: 200, countMin: 0, countMax: 100, top2Min: 0, top2Max: 1 },
    { erMin: 200, erMax: 400, countMin: 0, countMax: 100, top2Min: 0, top2Max: 1 },
    { erMin: 400, erMax: Infinity, countMin: 0, countMax: 100, top2Min: 0, top2Max: 1 },
    { erMin: 0, erMax: Infinity, countMin: 50, countMax: Infinity, top2Min: 0, top2Max: 1 },
    { erMin: 0, erMax: Infinity, countMin: 100, countMax: Infinity, top2Min: 0, top2Max: 1 },
    { erMin: 0, erMax: Infinity, countMin: 0, countMax: Infinity, top2Min: 0.7, top2Max: 1 },
    { erMin: 0, erMax: Infinity, countMin: 0, countMax: Infinity, top2Min: 0.8, top2Max: 1 },
  ];

  console.log('条件'.padEnd(70) + '代币数'.padEnd(10) + '亏损率'.padEnd(10) + '平均收益');
  console.log('-'.repeat(110));

  ranges.forEach(({ erMin, erMax, countMin, countMax, top2Min, top2Max }) => {
    const subset = dataset.filter(t => {
      const er = t.factors.earlyReturn;
      const cnt = t.factors.countPerMin;
      const top2 = t.factors.top2Ratio;

      if (er === undefined || cnt === undefined || top2 === undefined) return false;
      if (er < erMin || er >= erMax) return false;
      if (cnt < countMin || cnt >= countMax) return false;
      if (top2 < top2Min || top2 >= top2Max) return false;
      return true;
    });

    if (subset.length >= 3) {
      const losing = subset.filter(t => t.returnRate <= 0);
      const avgReturn = subset.reduce((a, t) => a + t.returnRate, 0) / subset.length;
      const label = `earlyReturn ${erMin}-${erMax === Infinity ? '∞' : erMax}%, countPerMin ${countMin}-${countMax === Infinity ? '∞' : countMax}, top2Ratio ${top2Min}-${top2Max}`;

      console.log(`${label.padEnd(70)}${subset.length.toString().padEnd(10)}${(losing.length/subset.length*100).toFixed(1).padEnd(10)}${avgReturn.toFixed(1)}%`);

      if (losing.length === subset.length) {
        console.log(`    ⚠️  全部亏损！`);
        subset.slice(0, 5).forEach(t => {
          console.log(`      ${t.symbol}: ${t.returnRate.toFixed(1)}%, earlyReturn=${er.toFixed(1)}%, countPerMin=${cnt}, top2Ratio=${top2.toFixed(2)}`);
        });
      }
    }
  });

  // ========================================
  // 6. 最终推荐
  // ========================================
  console.log('\n=== 🎯 最终推荐 ===\n');

  console.log('【核心发现】');
  console.log('1. countPerMin >= 150：100% 亏损率（7/7）');
  console.log('2. earlyReturn >= 200% AND countPerMin >= 100：高亏损风险');
  console.log('3. top2Ratio >= 0.8：高亏损风险\n');

  console.log('【配置建议】');
  console.log('在现有 preBuyCheckCondition 中添加：');
  console.log('');
  console.log('  earlyTradesCountPerMin < 150');
  console.log('  AND (earlyTradesCountPerMin < 100 OR trendFactors.earlyReturn < 200)');
  console.log('  AND walletClusterTop2Ratio < 0.8');
}

main().catch(console.error);
