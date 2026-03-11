/**
 * 全因子扫描 - 寻找隐藏的宝藏因子
 * 测试所有因子在不同阈值下的表现
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
        // Early participant factors
        countPerMin: f.earlyTradesCountPerMin,
        volumePerMin: f.earlyTradesVolumePerMin,
        walletsPerMin: f.earlyTradesWalletsPerMin,
        uniqueWallets: f.earlyTradesUniqueWallets,
        highValueCount: f.earlyTradesHighValueCount,
        actualSpan: f.earlyTradesActualSpan,

        // Wallet cluster factors
        clusterCount: f.walletClusterCount,
        top2Ratio: f.walletClusterTop2Ratio,
        secondToFirstRatio: f.walletClusterSecondToFirstRatio,
        megaRatio: f.walletClusterMegaRatio,
        maxBlockBuyRatio: f.walletClusterMaxBlockBuyRatio,

        // Holder factors
        blacklistCount: f.holderBlacklistCount,
        whitelistCount: f.holderWhitelistCount,
        devHoldingRatio: f.devHoldingRatio,
        maxHoldingRatio: f.maxHoldingRatio,

        // Trend factors (first-stage)
        earlyReturn: tf.earlyReturn,
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

  return tokens.map(t => ({
    ...t,
    factors: tokenFactors[t.address] || {}
  })).filter(t => Object.keys(t.factors).length > 0);
}

async function main() {
  console.log('=== 全因子扫描 - 寻找隐藏的宝藏因子 ===\n');
  console.log('正在加载数据...\n');

  const [exp1, exp2] = await Promise.all([
    analyzeExperiment('25493408-98b3-4342-a1ac-036ba49f97ee'),
    analyzeExperiment('1dde2be5-2f4e-49fb-9520-cb032e9ef759')
  ]);

  console.log(`市场差：${exp1.length} 个代币`);
  console.log(`市场好：${exp2.length} 个代币\n`);

  // ========================================
  // 定义所有要测试的因子和阈值范围
  // ========================================
  const factorConfigs = [
    {
      name: 'countPerMin',
      thresholds: [20, 30, 40, 50, 60, 80, 100, 120, 150, 180],
      direction: '<'  // 测试小于阈值的效果
    },
    {
      name: 'volumePerMin',
      thresholds: [2000, 3000, 4000, 5000, 6000, 8000, 10000, 15000, 20000],
      direction: '>'
    },
    {
      name: 'walletsPerMin',
      thresholds: [5, 10, 15, 20, 25, 30, 40, 50],
      direction: '>'
    },
    {
      name: 'uniqueWallets',
      thresholds: [5, 10, 15, 20, 30, 40, 50, 80, 100, 120, 150],
      direction: '>'
    },
    {
      name: 'highValueCount',
      thresholds: [5, 8, 10, 15, 20, 30],
      direction: '>'
    },
    {
      name: 'actualSpan',
      thresholds: [30, 40, 50, 60, 70, 80],
      direction: '>'
    },
    {
      name: 'top2Ratio',
      thresholds: [0.5, 0.6, 0.7, 0.8, 0.85, 0.9],
      direction: '<'
    },
    {
      name: 'secondToFirstRatio',
      thresholds: [0.1, 0.2, 0.3, 0.4, 0.5],
      direction: '<'
    },
    {
      name: 'megaRatio',
      thresholds: [0.3, 0.4, 0.5, 0.6],
      direction: '<'
    },
    {
      name: 'earlyReturn',
      thresholds: [100, 150, 200, 250, 300, 400, 500],
      direction: '<'
    },
    {
      name: 'trendCV',
      thresholds: [0.01, 0.015, 0.02, 0.025, 0.03, 0.04],
      direction: '>'
    },
    {
      name: 'trendStrengthScore',
      thresholds: [15, 20, 25, 30, 35, 40, 45],
      direction: '>'
    },
    {
      name: 'trendTotalReturn',
      thresholds: [5, 8, 10, 12, 15, 20, 30],
      direction: '>'
    },
    {
      name: 'trendRiseRatio',
      thresholds: [0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
      direction: '>'
    },
    {
      name: 'trendRecentDownRatio',
      thresholds: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
      direction: '<'
    },
    {
      name: 'trendConsecutiveDowns',
      thresholds: [1, 2, 3, 4, 5],
      direction: '<'
    },
  ];

  // ========================================
  // 测试每个因子的每个阈值
  // ========================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔍 因子扫描结果');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const results = [];

  factorConfigs.forEach(config => {
    config.thresholds.forEach(threshold => {
      // 构建测试函数
      const test = (f) => {
        const val = f[config.name];
        if (val === undefined || val === null) return true; // 如果没有数据，默认通过
        if (config.direction === '<') return val < threshold;
        return val >= threshold;
      };

      // 测试市场差
      const exp1Matched = exp1.filter(t => test(t.factors));
      const exp1Losing = exp1Matched.filter(t => t.returnRate <= 0);
      const exp1Avg = exp1Matched.length > 0 ? exp1Matched.reduce((a, t) => a + t.returnRate, 0) / exp1Matched.length : 0;

      // 测试市场好
      const exp2Matched = exp2.filter(t => test(t.factors));
      const exp2Losing = exp2Matched.filter(t => t.returnRate <= 0);
      const exp2Avg = exp2Matched.length > 0 ? exp2Matched.reduce((a, t) => a + t.returnRate, 0) / exp2Matched.length : 0;

      // 计算综合改善分数
      const exp1Baseline = exp1.reduce((a, t) => a + t.returnRate, 0) / exp1.length;
      const exp2Baseline = exp2.reduce((a, t) => a + t.returnRate, 0) / exp2.length;

      const exp1Improvement = exp1Avg - exp1Baseline;
      const exp2Improvement = exp2Avg - exp2Baseline;
      const totalImprovement = exp1Improvement + exp2Improvement;

      if (exp1Matched.length >= 5 && exp2Matched.length >= 3) {
        results.push({
          factor: config.name,
          condition: `${config.direction} ${threshold}`,
          exp1Count: exp1Matched.length,
          exp1Avg: exp1Avg,
          exp1Improvement: exp1Improvement,
          exp2Count: exp2Matched.length,
          exp2Avg: exp2Avg,
          exp2Improvement: exp2Improvement,
          totalImprovement: totalImprovement,
          exp1LosingRate: exp1Losing.length / exp1Matched.length,
          exp2LosingRate: exp2Losing.length / exp2Matched.length,
        });
      }
    });
  });

  // 按综合改善分数排序
  results.sort((a, b) => b.totalImprovement - a.totalImprovement);

  // ========================================
  // 输出 Top 20 宝藏因子
  // ========================================
  console.log('【Top 20 宝藏因子】（按综合改善分数排序）\n');
  console.log('排名'.padEnd(5) + '因子'.padEnd(25) + '条件'.padEnd(12) + '市场差改善'.padEnd(12) + '市场好改善'.padEnd(12) + '综合改善');
  console.log('-'.repeat(95));

  results.slice(0, 20).forEach((r, i) => {
    const rank = (i + 1).toString().padEnd(5);
    const factor = r.factor.padEnd(25);
    const condition = r.condition.padEnd(12);
    const exp1Imp = (r.exp1Improvement >= 0 ? '+' : '') + r.exp1Improvement.toFixed(1) + '%';
    const exp2Imp = (r.exp2Improvement >= 0 ? '+' : '') + r.exp2Improvement.toFixed(1) + '%';
    const totalImp = (r.totalImprovement >= 0 ? '+' : '') + r.totalImprovement.toFixed(1) + '%';

    console.log(`${rank}${factor}${condition}${exp1Imp.padEnd(12)}${exp2Imp.padEnd(12)}${totalImp}`);
  });

  // ========================================
  // 分析在两个市场都有效的因子
  // ========================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【双边市场有效因子】（两个市场都改善 >= 5%）');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const dualEffective = results.filter(r => r.exp1Improvement >= 5 && r.exp2Improvement >= 5);

  console.log('因子'.padEnd(25) + '条件'.padEnd(12) + '市场差'.padEnd(15) + '市场好'.padEnd(15) + '代币数(差/好)');
  console.log('-'.repeat(90));

  dualEffective.forEach(r => {
    const factor = r.factor.padEnd(25);
    const condition = r.condition.padEnd(12);
    const exp1Result = `+${r.exp1Improvement.toFixed(1)}% (${r.exp1Avg.toFixed(1)}%)`.padEnd(15);
    const exp2Result = `+${r.exp2Improvement.toFixed(1)}% (${r.exp2Avg.toFixed(1)}%)`.padEnd(15);
    const count = `${r.exp1Count}/${r.exp2Count}`;

    console.log(`${factor}${condition}${exp1Result}${exp2Result}${count}`);
  });

  // ========================================
  // 寻找"完美过滤器"（高改善 + 低误杀）
  // ========================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【完美过滤器】（改善 >= 10% 且保留 >= 80% 代币）');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const perfectFilters = results.filter(r => {
    const exp1KeepRate = r.exp1Count / exp1.length;
    const exp2KeepRate = r.exp2Count / exp2.length;
    return r.totalImprovement >= 10 && exp1KeepRate >= 0.8 && exp2KeepRate >= 0.8;
  });

  if (perfectFilters.length > 0) {
    console.log('因子'.padEnd(25) + '条件'.padEnd(12) + '综合改善'.padEnd(12) + '保留率(差/好)');
    console.log('-'.repeat(80));

    perfectFilters.forEach(r => {
      const factor = r.factor.padEnd(25);
      const condition = r.condition.padEnd(12);
      const improvement = `+${r.totalImprovement.toFixed(1)}%`.padEnd(12);
      const exp1KeepRate = (r.exp1Count / exp1.length * 100).toFixed(0) + '%';
      const exp2KeepRate = (r.exp2Count / exp2.length * 100).toFixed(0) + '%';
      const keepRate = `${exp1KeepRate}/${exp2KeepRate}`;

      console.log(`${factor}${condition}${improvement}${keepRate}`);
    });
  } else {
    console.log('没有找到完美的过滤器（改善 >= 10% 且保留 >= 80% 代币）');
  }

  // ========================================
  // 发现"超级因子"（单一因子效果就很好）
  // ========================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【超级因子】（单一因子综合改善 >= 15%）');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const superFactors = results.filter(r => r.totalImprovement >= 15);

  if (superFactors.length > 0) {
    console.log('🏆 超级因子排名：\n');

    superFactors.forEach((r, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
      console.log(`${medal} ${r.factor} ${r.condition}`);
      console.log(`   市场差: ${r.exp1Count} 个代币, 平均收益 ${(r.exp1Avg).toFixed(1)}% (改善 ${r.exp1Improvement >= 0 ? '+' : ''}${r.exp1Improvement.toFixed(1)}%)`);
      console.log(`   市场好: ${r.exp2Count} 个代币, 平均收益 ${(r.exp2Avg).toFixed(1)}% (改善 ${r.exp2Improvement >= 0 ? '+' : ''}${r.exp2Improvement.toFixed(1)}%)`);
      console.log('');
    });
  } else {
    console.log('没有找到超级因子（单一因子综合改善 >= 15%）');
  }

  // ========================================
  // 最终推荐
  // ========================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎯 最终推荐配置');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (results.length > 0) {
    const topFactor = results[0];
    console.log('【最佳单一因子】');
    console.log(`  ${topFactor.factor} ${topFactor.condition}`);
    console.log(`  综合改善: +${topFactor.totalImprovement.toFixed(1)}%`);
    console.log(`  配置: earlyTrades${topFactor.factor.charAt(0).toUpperCase() + topFactor.factor.slice(1)} ${topFactor.direction} ${topFactor.condition.split(' ')[1]}`);
    console.log('');

    // 推荐组合
    if (dualEffective.length >= 2) {
      console.log('【推荐组合】（取前两个双边有效因子）');
      const f1 = dualEffective[0];
      const f2 = dualEffective[1];

      console.log(`  1. ${f1.factor} ${f1.condition}`);
      console.log(`  2. ${f2.factor} ${f2.condition}`);
      console.log('');
      console.log('  配置示例：');
      console.log(`  {`);
      console.log(`    "preBuyCheckCondition": "walletClusterCount < 4 OR walletClusterTop2Ratio <= 0.85" +`);
      console.log(`                             " AND earlyTrades${f1.factor.charAt(0).toUpperCase() + f1.factor.slice(1)} ${f1.direction} ${f1.condition.split(' ')[1]}" +`);
      console.log(`                             " AND earlyTrades${f2.factor.charAt(0).toUpperCase() + f2.factor.slice(1)} ${f2.direction} ${f2.condition.split(' ')[1]}"`);
      console.log(`  }`);
    }
  }
}

main().catch(console.error);
