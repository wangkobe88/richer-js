/**
 * 全面筛选规则分析
 * 使用所有购买前检查因子，测试各种阈值和组合
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
        // 钱包簇因子
        secondToFirstRatio: f.walletClusterSecondToFirstRatio,
        megaRatio: f.walletClusterMegaRatio,
        top2Ratio: f.walletClusterTop2Ratio,
        maxBlockBuyRatio: f.walletClusterMaxBlockBuyRatio,
        clusterCount: f.walletClusterCount,
        clusterMaxSize: f.walletClusterMaxSize,
        // 早期交易因子
        countPerMin: f.earlyTradesCountPerMin,
        volumePerMin: f.earlyTradesVolumePerMin,
        walletsPerMin: f.earlyTradesWalletsPerMin,
        highValuePerMin: f.earlyTradesHighValuePerMin,
        totalCount: f.earlyTradesTotalCount,
        totalVolume: f.earlyTradesVolume,
        uniqueWallets: f.earlyTradesUniqueWallets,
        highValueCount: f.earlyTradesHighValueCount,
        actualSpan: f.earlyTradesActualSpan,
        // 持有者因子
        blacklistCount: f.holderBlacklistCount,
        whitelistCount: f.holderWhitelistCount,
        holdersCount: f.holdersCount,
        devHoldingRatio: f.devHoldingRatio,
        maxHoldingRatio: f.maxHoldingRatio,
        // 其他
        creatorIsNotBadDevWallet: f.creatorIsNotBadDevWallet,
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
    // 钱包簇因子
    { name: 'secondToFirstRatio', field: 'secondToFirstRatio', thresholds: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5], compare: '>' },
    { name: 'megaRatio', field: 'megaRatio', thresholds: [0.3, 0.4, 0.5, 0.6, 0.7, 0.8], compare: '<' },
    { name: 'top2Ratio', field: 'top2Ratio', thresholds: [0.6, 0.7, 0.75, 0.8, 0.85, 0.9], compare: '<' },
    { name: 'maxBlockBuyRatio', field: 'maxBlockBuyRatio', thresholds: [0.1, 0.15, 0.2, 0.25, 0.3], compare: '<' },

    // 早期交易因子
    { name: 'countPerMin', field: 'countPerMin', thresholds: [20, 30, 40, 50, 60, 80, 100], compare: '>=' },
    { name: 'countPerMin_max', field: 'countPerMin', thresholds: [150, 200, 250, 300], compare: '<' },
    { name: 'volumePerMin', field: 'volumePerMin', thresholds: [2000, 3000, 4000, 5000, 6000, 8000], compare: '>=' },
    { name: 'uniqueWallets', field: 'uniqueWallets', thresholds: [5, 8, 10, 12, 15], compare: '>=' },
    { name: 'highValueCount', field: 'highValueCount', thresholds: [3, 5, 8, 10, 15], compare: '>=' },
    { name: 'actualSpan', field: 'actualSpan', thresholds: [40, 50, 60, 70, 80], compare: '>=' },

    // 持有者因子
    { name: 'blacklistCount', field: 'blacklistCount', thresholds: [0, 1, 2, 3], compare: '<=' },
    { name: 'devHoldingRatio', field: 'devHoldingRatio', thresholds: [5, 10, 15, 20], compare: '<' },
    { name: 'maxHoldingRatio', field: 'maxHoldingRatio', thresholds: [10, 15, 18, 20, 25], compare: '<' },

    // 趋势因子
    { name: 'earlyReturn', field: 'earlyReturn', thresholds: [50, 80, 100, 120, 150, 200], compare: '>' },
    { name: 'earlyReturn_max', field: 'earlyReturn', thresholds: [200, 300, 400, 500], compare: '<' },
  ];

  // 生成所有单规则
  console.log('=== 第一步：单规则测试 ===\n');
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
        precision,
        f1: precision > 0 ? (2 * precision * recall) / (precision + recall) : 0
      });
    });
  });

  // 找出最佳的单规则
  console.log('最佳单规则（按精确率排序）：\n');
  singleRules.sort((a, b) => b.precision - a.precision);

  console.log('规则'.padEnd(40) + '精确率'.padEnd(10) + '召回率'.padEnd(10) + 'F1分数'.padEnd(10) + '筛掉/误杀');
  console.log('-'.repeat(90));
  singleRules.slice(0, 20).forEach(r => {
    if (r.rejectLosing > 3) {
      console.log(`${r.name.padEnd(40)}${(r.precision * 100).toFixed(1).padEnd(10)}${(r.recall * 100).toFixed(1).padEnd(10)}${(r.f1 * 100).toFixed(1).padEnd(10)}${r.rejectLosing}/${r.rejectProfitable}`);
    }
  });

  // 第二步：测试双规则组合（只测试精确率>70%的规则组合）
  console.log('\n=== 第二步：双规则组合测试 ===\n');

  const highPrecisionRules = singleRules.filter(r => r.precision > 0.7 && r.rejectLosing >= 5);
  console.log(`从 ${singleRules.length} 个单规则中筛选出 ${highPrecisionRules.length} 个高精确率规则进行组合测试...\n`);

  const combinations = [];
  for (let i = 0; i < highPrecisionRules.length && i < 30; i++) {
    for (let j = i + 1; j < highPrecisionRules.length && j < 30; j++) {
      const rule1 = highPrecisionRules[i];
      const rule2 = highPrecisionRules[j];

      // 跳过相同字段的规则
      if (rule1.config.field === rule2.config.field) continue;

      const test = (f) => rule1.test(f) && rule2.test(f);
      const wouldRejectLosing = losing.filter(t => !test(t.factors));
      const wouldRejectProfitable = profitable.filter(t => !test(t.factors));
      const recall = wouldRejectLosing.length / losing.length;
      const precision = (wouldRejectLosing.length + wouldRejectProfitable.length) > 0
        ? wouldRejectLosing.length / (wouldRejectLosing.length + wouldRejectProfitable.length)
        : 0;
      const f1 = precision > 0 ? (2 * precision * recall) / (precision + recall) : 0;

      combinations.push({
        name: `${rule1.name} AND ${rule2.name}`,
        rejectLosing: wouldRejectLosing.length,
        rejectProfitable: wouldRejectProfitable.length,
        recall,
        precision,
        f1
      });
    }
  }

  // 找出最佳的双规则组合
  console.log('最佳双规则组合（按F1分数排序）：\n');
  combinations.sort((a, b) => b.f1 - a.f1);

  console.log('规则'.padEnd(70) + '精确率'.padEnd(10) + '召回率'.padEnd(10) + 'F1分数'.padEnd(10) + '筛掉/误杀');
  console.log('-'.repeat(120));
  combinations.slice(0, 20).forEach(c => {
    if (c.rejectLosing >= 10) {
      console.log(`${c.name.padEnd(70)}${(c.precision * 100).toFixed(1).padEnd(10)}${(c.recall * 100).toFixed(1).padEnd(10)}${(c.f1 * 100).toFixed(1).padEnd(10)}${c.rejectLosing}/${c.rejectProfitable}`);
    }
  });

  // 第三步：测试三规则组合（基于最佳双规则）
  console.log('\n=== 第三步：三规则组合测试 ===\n');

  const topCombinations = combinations.slice(0, 10);
  console.log(`基于前10个双规则组合，添加第三个规则...\n`);

  const tripleCombinations = [];
  for (let i = 0; i < topCombinations.length; i++) {
    for (let j = 0; j < highPrecisionRules.length && j < 20; j++) {
      const comboRule = topCombinations[i];
      const addRule = highPrecisionRules[j];

      const test = (f) => {
        const baseTest = (fr) => {
          // 重新计算双规则的测试
          const parts = comboRule.name.split(' AND ');
          const test1 = singleRules.find(r => r.name === parts[0]);
          const test2 = singleRules.find(r => r.name === parts[1]);
          if (!test1 || !test2) return true;
          return test1.test(fr) && test2.test(fr);
        };
        return baseTest(f) && addRule.test(f);
      };

      const wouldRejectLosing = losing.filter(t => !test(t.factors));
      const wouldRejectProfitable = profitable.filter(t => !test(t.factors));
      const recall = wouldRejectLosing.length / losing.length;
      const precision = (wouldRejectLosing.length + wouldRejectProfitable.length) > 0
        ? wouldRejectLosing.length / (wouldRejectLosing.length + wouldRejectProfitable.length)
        : 0;
      const f1 = precision > 0 ? (2 * precision * recall) / (precision + recall) : 0;

      tripleCombinations.push({
        name: `${comboRule.name} AND ${addRule.name}`,
        rejectLosing: wouldRejectLosing.length,
        rejectProfitable: wouldRejectProfitable.length,
        recall,
        precision,
        f1
      });
    }
  }

  console.log('最佳三规则组合（按F1分数排序）：\n');
  tripleCombinations.sort((a, b) => b.f1 - a.f1);

  console.log('规则'.padEnd(90) + '精确率'.padEnd(10) + '召回率'.padEnd(10) + 'F1分数'.padEnd(10) + '筛掉/误杀');
  console.log('-'.repeat(140));
  tripleCombinations.slice(0, 15).forEach(c => {
    if (c.rejectLosing >= 12 && c.precision > 0.75) {
      console.log(`${c.name.padEnd(90)}${(c.precision * 100).toFixed(1).padEnd(10)}${(c.recall * 100).toFixed(1).padEnd(10)}${(c.f1 * 100).toFixed(1).padEnd(10)}${c.rejectLosing}/${c.rejectProfitable}`);
    }
  });

  // 输出推荐规则
  console.log('\n=== 推荐规则 ===\n');

  const bestCombo = combinations[0];
  const bestTriple = tripleCombinations[0];

  console.log('🥇 最佳双规则：');
  console.log(`   ${bestCombo.name}`);
  console.log(`   精确率: ${(bestCombo.precision * 100).toFixed(1)}%, 召回率: ${(bestCombo.recall * 100).toFixed(1)}%`);
  console.log(`   筛掉亏损: ${bestCombo.rejectLosing}/${losing.length}, 误杀盈利: ${bestCombo.rejectProfitable}/${profitable.length}\n`);

  if (bestTriple.rejectLosing >= 12) {
    console.log('🥇 最佳三规则：');
    console.log(`   ${bestTriple.name}`);
    console.log(`   精确率: ${(bestTriple.precision * 100).toFixed(1)}%, 召回率: ${(bestTriple.recall * 100).toFixed(1)}%`);
    console.log(`   筛掉亏损: ${bestTriple.rejectLosing}/${losing.length}, 误杀盈利: ${bestTriple.rejectProfitable}/${profitable.length}\n`);
  }

  // 保存结果到文件
  const result = {
    timestamp: new Date().toISOString(),
    dataset: {
      total: dataset.length,
      profitable: profitable.length,
      losing: losing.length
    },
    bestSingleRule: singleRules[0],
    bestDoubleRule: bestCombo,
    bestTripleRule: bestTriple,
    topCombinations: combinations.slice(0, 20),
    topTripleCombinations: tripleCombinations.slice(0, 20)
  };

  fs.writeFileSync('/Users/nobody1/Desktop/Codes/richer-js/scripts/filter_analysis_result.json', JSON.stringify(result, null, 2));
  console.log('分析结果已保存到 filter_analysis_result.json');
}

main().catch(console.error);
