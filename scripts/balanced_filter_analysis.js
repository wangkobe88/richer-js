/**
 * 平衡筛选规则分析
 * 目标：高精确率 + 低误杀盈利
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

  // 计算每个代币的收益率
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

  // 计算收益率并分类
  const tokens = Object.values(tokenPnL).map(t => ({
    ...t,
    returnRate: t.totalSpent > 0 ? ((t.totalReceived - t.totalSpent) / t.totalSpent * 100) : 0
  }));

  // 获取每个代币的买入信号因子
  const tokenFactors = {};
  signalsData.signals.filter(s => s.action === 'buy' && s.executed === true).forEach(s => {
    if (!tokenFactors[s.token_address]) {
      const f = s.metadata?.preBuyCheckFactors || {};
      const tf = s.metadata?.trendFactors || {};
      tokenFactors[s.token_address] = {
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
        devHoldingRatio: f.devHoldingRatio,
        maxHoldingRatio: f.maxHoldingRatio,
        earlyReturn: tf.earlyReturn,
        drawdownFromHighest: tf.drawdownFromHighest
      };
    }
  });

  // 合并数据
  const dataset = tokens.map(t => ({
    ...t,
    factors: tokenFactors[t.address] || {}
  })).filter(t => Object.keys(t.factors).length > 0);

  // 分类：盈利 vs 亏损
  const profitable = dataset.filter(t => t.returnRate > 0);
  const losing = dataset.filter(t => t.returnRate <= 0);

  console.log(`\n数据集：${dataset.length} 个代币`);
  console.log(`盈利：${profitable.length} 个`);
  console.log(`亏损：${losing.length} 个\n`);

  // 定义所有要测试的因子和阈值范围
  const factorConfigs = [
    { name: 'secondToFirstRatio', field: 'secondToFirstRatio', thresholds: [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4], compare: '>' },
    { name: 'megaRatio', field: 'megaRatio', thresholds: [0.4, 0.5, 0.6, 0.7], compare: '<' },
    { name: 'top2Ratio', field: 'top2Ratio', thresholds: [0.6, 0.7, 0.75, 0.8, 0.85], compare: '<' },
    { name: 'maxBlockBuyRatio', field: 'maxBlockBuyRatio', thresholds: [0.1, 0.15, 0.2, 0.25], compare: '<' },
    { name: 'countPerMin', field: 'countPerMin', thresholds: [20, 30, 40, 50, 60, 80], compare: '>=' },
    { name: 'countPerMin_max', field: 'countPerMin', thresholds: [150, 200, 250], compare: '<' },
    { name: 'volumePerMin', field: 'volumePerMin', thresholds: [2000, 3000, 5000], compare: '>=' },
    { name: 'uniqueWallets', field: 'uniqueWallets', thresholds: [5, 8, 10, 15], compare: '>=' },
    { name: 'highValueCount', field: 'highValueCount', thresholds: [5, 8, 10], compare: '>=' },
    { name: 'actualSpan', field: 'actualSpan', thresholds: [50, 60, 70], compare: '>=' },
    { name: 'blacklistCount', field: 'blacklistCount', thresholds: [0, 1, 2], compare: '<=' },
    { name: 'devHoldingRatio', field: 'devHoldingRatio', thresholds: [10, 15], compare: '<' },
    { name: 'maxHoldingRatio', field: 'maxHoldingRatio', thresholds: [15, 18, 20], compare: '<' },
    { name: 'earlyReturn', field: 'earlyReturn', thresholds: [80, 100, 150, 200], compare: '>' },
    { name: 'earlyReturn_max', field: 'earlyReturn', thresholds: [300, 400, 500], compare: '<' },
  ];

  // 生成所有单规则
  const singleRules = [];
  factorConfigs.forEach(config => {
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

      singleRules.push({
        name: testName,
        config,
        threshold,
        test,
        rejectLosing: wouldRejectLosing.length,
        rejectProfitable: wouldRejectProfitable.length,
        recall,
        precision
      });
    });
  });

  // 筛选条件：精确率 > 70% 且误杀盈利 < 6
  console.log('=== 精确率 > 70% 且误杀盈利 < 6 的单规则 ===\n');
  const balancedRules = singleRules.filter(r =>
    r.precision > 0.7 && r.rejectProfitable < 6 && r.rejectLosing >= 5
  );

  console.log('规则'.padEnd(35) + '精确率'.padEnd(10) + '召回率'.padEnd(10) + '误杀盈利'.padEnd(10) + '筛掉亏损');
  console.log('-'.repeat(80));
  balancedRules.forEach(r => {
    console.log(`${r.name.padEnd(35)}${(r.precision * 100).toFixed(1).padEnd(10)}${(r.recall * 100).toFixed(1).padEnd(10)}${r.rejectProfitable.toString().padEnd(10)}${r.rejectLosing}/${losing.length}`);
  });

  // 测试双规则组合
  console.log('\n=== 双规则组合（精确率 > 75% 且误杀盈利 < 6）===\n');

  const combinations = [];
  for (let i = 0; i < balancedRules.length; i++) {
    for (let j = i + 1; j < balancedRules.length; j++) {
      const rule1 = balancedRules[i];
      const rule2 = balancedRules[j];

      // 跳过相同字段的规则
      if (rule1.config.field === rule2.config.field) continue;

      const test = (f) => rule1.test(f) && rule2.test(f);
      const wouldRejectLosing = losing.filter(t => !test(t.factors));
      const wouldRejectProfitable = profitable.filter(t => !test(t.factors));
      const recall = wouldRejectLosing.length / losing.length;
      const precision = (wouldRejectLosing.length + wouldRejectProfitable.length) > 0
        ? wouldRejectLosing.length / (wouldRejectLosing.length + wouldRejectProfitable.length)
        : 0;

      // 筛选条件
      if (precision > 0.75 && wouldRejectProfitable < 6 && wouldRejectLosing >= 8) {
        combinations.push({
          name: `${rule1.name} AND ${rule2.name}`,
          rejectLosing: wouldRejectLosing.length,
          rejectProfitable: wouldRejectProfitable.length,
          recall,
          precision
        });
      }
    }
  }

  console.log('规则'.padEnd(65) + '精确率'.padEnd(10) + '召回率'.padEnd(10) + '误杀盈利'.padEnd(10) + '筛掉亏损');
  console.log('-'.repeat(110));
  combinations.sort((a, b) => b.rejectLosing - a.rejectLosing);
  combinations.slice(0, 20).forEach(c => {
    console.log(`${c.name.padEnd(65)}${(c.precision * 100).toFixed(1).padEnd(10)}${(c.recall * 100).toFixed(1).padEnd(10)}${c.rejectProfitable.toString().padEnd(10)}${c.rejectLosing}/${losing.length}`);
  });

  // 输出推荐
  console.log('\n=== 🎯 推荐规则（平衡精确率和召回率）===\n');

  if (combinations.length > 0) {
    const best = combinations[0];
    console.log(`最佳组合：`);
    console.log(`  ${best.name}`);
    console.log(`  精确率: ${(best.precision * 100).toFixed(1)}%`);
    console.log(`  召回率: ${(best.recall * 100).toFixed(1)}%`);
    console.log(`  筛掉亏损: ${best.rejectLosing}/${losing.length} (${(best.rejectLosing/losing.length*100).toFixed(1)}%)`);
    console.log(`  误杀盈利: ${best.rejectProfitable}/${profitable.length} (${(best.rejectProfitable/profitable.length*100).toFixed(1)}%)`);
  } else {
    console.log('没有找到满足条件的双规则组合，使用最佳单规则：');
    const best = balancedRules.sort((a, b) => b.rejectLosing - a.rejectLosing)[0];
    console.log(`  ${best.name}`);
    console.log(`  精确率: ${(best.precision * 100).toFixed(1)}%`);
    console.log(`  召回率: ${(best.recall * 100).toFixed(1)}%`);
    console.log(`  筛掉亏损: ${best.rejectLosing}/${losing.length}`);
    console.log(`  误杀盈利: ${best.rejectProfitable}/${profitable.length}`);
  }

  // 特别分析：countPerMin 的作用
  console.log('\n=== 特别分析：countPerMin 作用 ===\n');

  const highActivityTokens = dataset.filter(t => t.factors.countPerMin >= 150);
  const highActivityLosing = highActivityTokens.filter(t => t.returnRate <= 0);
  const highActivityProfitable = highActivityTokens.filter(t => t.returnRate > 0);

  console.log(`countPerMin >= 150 的代币（超活跃）：${highActivityTokens.length} 个`);
  console.log(`  其中亏损：${highActivityLosing.length} 个 (${(highActivityLosing.length/highActivityTokens.length*100).toFixed(1)}%)`);
  console.log(`  其中盈利：${highActivityProfitable.length} 个\n`);

  highActivityTokens.forEach(t => {
    console.log(`  ${t.symbol}: ${t.returnRate.toFixed(1)}%, countPerMin=${t.factors.countPerMin}`);
  });
}

main().catch(console.error);
