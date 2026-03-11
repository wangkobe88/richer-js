/**
 * 寻找最优筛选规则
 * 目标：筛掉亏损代币，不影响盈利代币
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
        highValueCount: f.earlyTradesHighValueCount,
        highValuePerMin: f.earlyTradesHighValuePerMin,
        uniqueWallets: f.earlyTradesUniqueWallets,
        blacklistCount: f.holderBlacklistCount,
        whitelistCount: f.holderWhitelistCount,
        devHoldingRatio: f.devHoldingRatio,
        earlyReturn: tf.earlyReturn
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

  // 定义测试规则
  const rules = [
    // 钱包簇规则
    { name: 'secondToFirst > 0.3', test: f => f.secondToFirstRatio > 0.3 },
    { name: 'secondToFirst > 0.2', test: f => f.secondToFirstRatio > 0.2 },
    { name: 'secondToFirst > 0.15', test: f => f.secondToFirstRatio > 0.15 },
    { name: 'megaRatio < 0.5', test: f => f.megaRatio < 0.5 },
    { name: 'megaRatio < 0.6', test: f => f.megaRatio < 0.6 },
    { name: 'megaRatio < 0.7', test: f => f.megaRatio < 0.7 },
    { name: 'top2Ratio < 0.8', test: f => f.top2Ratio < 0.8 },
    { name: 'top2Ratio < 0.85', test: f => f.top2Ratio < 0.85 },
    { name: 'maxBlockBuyRatio < 0.15', test: f => f.maxBlockBuyRatio < 0.15 },
    { name: 'maxBlockBuyRatio < 0.2', test: f => f.maxBlockBuyRatio < 0.2 },

    // 早期交易规则
    { name: 'countPerMin >= 30', test: f => f.countPerMin >= 30 },
    { name: 'countPerMin >= 50', test: f => f.countPerMin >= 50 },
    { name: 'countPerMin >= 80', test: f => f.countPerMin >= 80 },
    { name: 'countPerMin < 200', test: f => f.countPerMin < 200 },
    { name: 'volumePerMin >= 3000', test: f => f.volumePerMin >= 3000 },
    { name: 'volumePerMin >= 5000', test: f => f.volumePerMin >= 5000 },
    { name: 'highValueCount >= 8', test: f => f.highValueCount >= 8 },
    { name: 'uniqueWallets >= 10', test: f => f.uniqueWallets >= 10 },

    // 持有者规则
    { name: 'blacklistCount = 0', test: f => f.blacklistCount === 0 },
    { name: 'blacklistCount <= 2', test: f => f.blacklistCount <= 2 },
    { name: 'whitelistCount >= blacklistCount * 2', test: f => f.whitelistCount >= f.blacklistCount * 2 },
    { name: 'devHoldingRatio < 10', test: f => f.devHoldingRatio < 10 },
    { name: 'devHoldingRatio < 15', test: f => f.devHoldingRatio < 15 },

    // earlyReturn 规则
    { name: 'earlyReturn > 50', test: f => f.earlyReturn > 50 },
    { name: 'earlyReturn > 80', test: f => f.earlyReturn > 80 },
    { name: 'earlyReturn < 500', test: f => f.earlyReturn < 500 },
    { name: 'earlyReturn < 300', test: f => f.earlyReturn < 300 },
  ];

  // 测试单个规则的效果
  console.log('=== 单规则测试 ===\n');
  const results = rules.map(rule => {
    const wouldRejectLosing = losing.filter(t => !rule.test(t.factors));
    const wouldRejectProfitable = profitable.filter(t => !rule.test(t.factors));

    const recall = wouldRejectLosing.length / losing.length; // 召回率：筛掉的亏损代币比例
    const precision = wouldRejectLosing.length / (wouldRejectLosing.length + wouldRejectProfitable.length); // 精确率

    return {
      rule: rule.name,
      rejectLosing: wouldRejectLosing.length,
      rejectProfitable: wouldRejectProfitable.length,
      recall: (recall * 100).toFixed(1) + '%',
      precision: isFinite(precision) ? (precision * 100).toFixed(1) + '%' : 'N/A'
    };
  });

  // 按召回率排序
  results.sort((a, b) => parseFloat(b.recall) - parseFloat(a.recall));

  console.log('规则'.padEnd(40) + '筛掉亏损'.padEnd(10) + '误杀盈利'.padEnd(10) + '召回率'.padEnd(10) + '精确率');
  console.log('-'.repeat(80));
  results.forEach(r => {
    console.log(`${r.rule.padEnd(40)}${r.rejectLosing.toString().padEnd(10)}${r.rejectProfitable.toString().padEnd(10)}${r.recall.padEnd(10)}${r.precision}`);
  });

  // 测试组合规则
  console.log('\n=== 组合规则测试（精确率优先）===\n');

  // 选择精确率 > 70% 的规则
  const highPrecisionRules = results.filter(r => {
    const p = parseFloat(r.precision);
    return isFinite(p) && p > 70 && r.rejectLosing > 5;
  });

  console.log('测试 2 规则组合：\n');
  for (let i = 0; i < highPrecisionRules.length; i++) {
    for (let j = i + 1; j < highPrecisionRules.length; j++) {
      const rule1 = rules.find(r => r.name === highPrecisionRules[i].rule);
      const rule2 = rules.find(r => r.name === highPrecisionRules[j].rule);

      const test = (f) => rule1.test(f) && rule2.test(f);

      const wouldRejectLosing = losing.filter(t => !test(t.factors));
      const wouldRejectProfitable = profitable.filter(t => !test(t.factors));

      const recall = wouldRejectLosing.length / losing.length;
      const precision = wouldRejectLosing.length / (wouldRejectLosing.length + wouldRejectProfitable.length);

      console.log(`${rule1.name} AND ${rule2.name}`);
      console.log(`  筛掉亏损: ${wouldRejectLosing.length}/${losing.length} (${(recall * 100).toFixed(1)}%)`);
      console.log(`  误杀盈利: ${wouldRejectProfitable.length}/${profitable.length}`);
      console.log(`  召回率: ${(recall * 100).toFixed(1)}%, 精确率: ${(precision * 100).toFixed(1)}%\n`);
    }
  }
}

main().catch(console.error);
