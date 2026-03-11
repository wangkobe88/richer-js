/**
 * 分析已通过现有规则的代币
 * 找出可以进一步筛选的因子
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
  console.log('正在加载数据...\n');

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
        // 钱包簇
        clusterCount: f.walletClusterCount,
        secondToFirstRatio: f.walletClusterSecondToFirstRatio,
        megaRatio: f.walletClusterMegaRatio,
        top2Ratio: f.walletClusterTop2Ratio,
        maxBlockBuyRatio: f.walletClusterMaxBlockBuyRatio,
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

  console.log(`数据集：${dataset.length} 个代币 (已通过现有规则)`);
  console.log(`盈利：${profitable.length} 个`);
  console.log(`亏损：${losing.length} 个\n`);

  console.log('=== 在已通过现有规则的代币中，进一步筛选 ===\n');

  // 测试各种额外规则
  const additionalRules = [
    // 钱包簇额外条件
    { name: 'secondToFirstRatio > 0.3', test: (f) => f.secondToFirstRatio > 0.3 },
    { name: 'secondToFirstRatio > 0.35', test: (f) => f.secondToFirstRatio > 0.35 },
    { name: 'megaRatio < 0.5', test: (f) => f.megaRatio < 0.5 },
    { name: 'megaRatio < 0.6', test: (f) => f.megaRatio < 0.6 },
    { name: 'megaRatio < 0.7', test: (f) => f.megaRatio < 0.7 },
    { name: 'maxBlockBuyRatio < 0.1', test: (f) => f.maxBlockBuyRatio < 0.1 },

    // 早期交易额外条件
    { name: 'countPerMin >= 30', test: (f) => f.countPerMin >= 30 },
    { name: 'countPerMin >= 50', test: (f) => f.countPerMin >= 50 },
    { name: 'countPerMin < 150', test: (f) => f.countPerMin < 150 },
    { name: 'countPerMin < 120', test: (f) => f.countPerMin < 120 },
    { name: 'volumePerMin >= 3000', test: (f) => f.volumePerMin >= 3000 },
    { name: 'volumePerMin >= 5000', test: (f) => f.volumePerMin >= 5000 },
    { name: 'uniqueWallets >= 10', test: (f) => f.uniqueWallets >= 10 },
    { name: 'uniqueWallets >= 15', test: (f) => f.uniqueWallets >= 15 },
    { name: 'highValueCount >= 8', test: (f) => f.highValueCount >= 8 },
    { name: 'highValueCount >= 10', test: (f) => f.highValueCount >= 10 },
    { name: 'actualSpan >= 60', test: (f) => f.actualSpan >= 60 },

    // 趋势条件
    { name: 'earlyReturn > 80', test: (f) => f.earlyReturn > 80 },
    { name: 'earlyReturn > 100', test: (f) => f.earlyReturn > 100 },
    { name: 'earlyReturn > 150', test: (f) => f.earlyReturn > 150 },
    { name: 'earlyReturn < 400', test: (f) => f.earlyReturn < 400 },
    { name: 'earlyReturn < 500', test: (f) => f.earlyReturn < 500 },
  ];

  console.log('额外规则'.padEnd(30) + '精确率'.padEnd(10) + '召回率'.padEnd(10) + '筛掉亏损'.padEnd(12) + '误杀盈利');
  console.log('-'.repeat(90));

  const results = additionalRules.map(rule => {
    const wouldRejectLosing = losing.filter(t => !rule.test(t.factors));
    const wouldRejectProfitable = profitable.filter(t => !rule.test(t.factors));
    const recall = wouldRejectLosing.length / losing.length;
    const precision = (wouldRejectLosing.length + wouldRejectProfitable.length) > 0
      ? wouldRejectLosing.length / (wouldRejectLosing.length + wouldRejectProfitable.length)
      : 0;

    return {
      name: rule.name,
      test: rule.test,
      precision,
      recall,
      rejectLosing: wouldRejectLosing.length,
      rejectProfitable: wouldRejectProfitable.length
    };
  });

  // 按精确率排序，只显示有意义的规则
  results.sort((a, b) => b.precision - a.precision);

  results.forEach(r => {
    if (r.rejectLosing >= 3 && r.precision > 0.6) {
      console.log(`${r.name.padEnd(30)}${(r.precision * 100).toFixed(1).padEnd(10)}${(r.recall * 100).toFixed(1).padEnd(10)}${r.rejectLosing}/${losing.length} (${(r.rejectLosing/losing.length*100).toFixed(0)}%)${r.rejectProfitable}/${profitable.length}`);
    }
  });

  // 找出最佳组合
  console.log('\n=== 测试额外规则的组合 ===\n');

  // 选择精确率 > 65% 的规则
  const highPrecisionRules = results.filter(r => r.precision > 0.65 && r.rejectLosing >= 5);
  console.log(`从 ${results.length} 个额外规则中筛选出 ${highPrecisionRules.length} 个高精确率规则...\n`);

  if (highPrecisionRules.length > 0) {
    console.log('规则'.padEnd(70) + '精确率'.padEnd(10) + '召回率'.padEnd(10) + '误杀盈利'.padEnd(10) + '筛掉亏损');
    console.log('-'.repeat(110));

    const combinations = [];
    for (let i = 0; i < Math.min(10, highPrecisionRules.length); i++) {
      for (let j = i + 1; j < Math.min(15, highPrecisionRules.length); j++) {
        const rule1 = highPrecisionRules[i];
        const rule2 = highPrecisionRules[j];

        // 跳过功能重复的规则（如 countPerMin >= 30 和 countPerMin >= 50）
        const name1Parts = rule1.name.split(' ');
        const name2Parts = rule2.name.split(' ');
        if (name1Parts[0] === name2Parts[0]) continue;

        const test = (f) => rule1.test(f) && rule2.test(f);
        const wouldRejectLosing = losing.filter(t => !test(t.factors));
        const wouldRejectProfitable = profitable.filter(t => !test(t.factors));
        const recall = wouldRejectLosing.length / losing.length;
        const precision = (wouldRejectLosing.length + wouldRejectProfitable.length) > 0
          ? wouldRejectLosing.length / (wouldRejectLosing.length + wouldRejectProfitable.length)
          : 0;

        // 只保留精确率 > 70% 且误杀盈利 < 6 的组合
        if (precision > 0.70 && wouldRejectProfitable < 6 && wouldRejectLosing.length >= 8) {
          combinations.push({
            name: `${rule1.name} AND ${rule2.name}`,
            precision,
            recall,
            rejectLosing: wouldRejectLosing.length,
            rejectProfitable: wouldRejectProfitable.length
          });
        }
      }
    }

    combinations.sort((a, b) => b.rejectLosing - a.rejectLosing);
    combinations.slice(0, 10).forEach(c => {
      console.log(`${c.name.padEnd(70)}${(c.precision * 100).toFixed(1).padEnd(10)}${(c.recall * 100).toFixed(1).padEnd(10)}${c.rejectProfitable}/${profitable.length}${c.rejectLosing}/${losing.length}`);
    });

    // 推荐配置
    if (combinations.length > 0) {
      console.log('\n=== 🎯 推荐额外加入的规则 ===\n');
      const best = combinations[0];
      console.log(`最佳组合：`);
      console.log(`  ${best.name}`);
      console.log(`  在现有规则基础上，可以进一步：`);
      console.log(`    精确率：${(best.precision * 100).toFixed(1)}%`);
      console.log(`    召回率：${(best.recall * 100).toFixed(1)}%`);
      console.log(`    筛掉亏损：${best.rejectLosing}/${losing.length}`);
      console.log(`    误杀盈利：${best.rejectProfitable}/${profitable.length}\n`);

      console.log('配置语句（加入现有的 preBuyCheckCondition）：');
      console.log(`  // 现有规则：`);
      console.log(`  (walletClusterCount < 4 OR walletClusterTop2Ratio <= 0.85)`);
      console.log(`  AND`);
      console.log(`  // 新增规则：`);
      const parts = best.name.split(' AND ');
      parts.forEach(p => {
        console.log(`  ${p.replace(/countPerMin/, 'earlyTradesCountPerMin').replace(/volumePerMin/, 'earlyTradesVolumePerMin').replace(/uniqueWallets/, 'earlyTradesUniqueWallets').replace(/highValueCount/, 'earlyTradesHighValueCount').replace(/actualSpan/, 'earlyTradesActualSpan').replace(/earlyReturn/, 'trendFactors.earlyReturn')}`);
      });
    }
  } else {
    console.log('没有找到合适的高精确率额外规则。');
  }
}

main().catch(console.error);
