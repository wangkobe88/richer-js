/**
 * 验证推荐规则的实际效果
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
      tokenFactors[s.token_address] = {
        top2Ratio: f.walletClusterTop2Ratio,
        countPerMin: f.earlyTradesCountPerMin,
        megaRatio: f.walletClusterMegaRatio,
        secondToFirstRatio: f.walletClusterSecondToFirstRatio
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

  // 定义测试规则
  const rules = [
    {
      name: '推荐规则 A (平衡)',
      condition: 'walletClusterTop2Ratio < 0.75 AND earlyTradesCountPerMin < 150',
      test: (f) => f.top2Ratio < 0.75 && f.countPerMin < 150
    },
    {
      name: '推荐规则 B (保守)',
      condition: 'walletClusterTop2Ratio < 0.85 AND earlyTradesCountPerMin < 150',
      test: (f) => f.top2Ratio < 0.85 && f.countPerMin < 150
    },
    {
      name: '严格规则 C',
      condition: 'walletClusterTop2Ratio < 0.75 AND walletClusterMegaRatio < 0.6 AND earlyTradesCountPerMin < 150',
      test: (f) => f.top2Ratio < 0.75 && f.megaRatio < 0.6 && f.countPerMin < 150
    },
    {
      name: '三规则组合 D',
      condition: 'walletClusterTop2Ratio < 0.8 AND walletClusterMegaRatio < 0.6 AND earlyTradesCountPerMin < 150',
      test: (f) => f.top2Ratio < 0.8 && f.megaRatio < 0.6 && f.countPerMin < 150
    },
    {
      name: '当前系统规则',
      condition: '(walletClusterCount < 4 OR walletClusterTop2Ratio <= 0.85) AND walletClusterMaxBlockBuyRatio < 0.15 ...',
      test: (f) => (f.top2Ratio <= 0.85 || f.top2Ratio === undefined) && true
    },
  ];

  console.log('=== 规则效果对比 ===\n');
  console.log('规则'.padEnd(40) + '精确率'.padEnd(10) + '召回率'.padEnd(10) + '误杀盈利'.padEnd(10) + '筛掉亏损');
  console.log('-'.repeat(90));

  rules.forEach(rule => {
    const wouldRejectLosing = losing.filter(t => !rule.test(t.factors));
    const wouldRejectProfitable = profitable.filter(t => !rule.test(t.factors));
    const recall = wouldRejectLosing.length / losing.length;
    const precision = (wouldRejectLosing.length + wouldRejectProfitable.length) > 0
      ? wouldRejectLosing.length / (wouldRejectLosing.length + wouldRejectProfitable.length)
      : 0;

    console.log(`${rule.name.padEnd(40)}${(precision * 100).toFixed(1).padEnd(10)}${(recall * 100).toFixed(1).padEnd(10)}${wouldRejectProfitable.toString().padEnd(10)}${wouldRejectLosing.length}/${losing.length}`);
  });

  // 详细分析推荐规则A
  console.log('\n=== 推荐规则 A 详细分析 ===\n');

  const ruleA = rules[0];
  const rejectedLosing = losing.filter(t => !ruleA.test(t.factors));
  const rejectedProfitable = profitable.filter(t => !ruleA.test(t.factors));
  const acceptedLosing = losing.filter(t => ruleA.test(t.factors));
  const acceptedProfitable = profitable.filter(t => ruleA.test(t.factors));

  console.log(`会被拒绝的亏损代币 (${rejectedLosing.length}个)：`);
  rejectedLosing.forEach(t => {
    const reason = [];
    if (t.factors.top2Ratio >= 0.75) reason.push(`top2Ratio=${t.factors.top2Ratio.toFixed(2)}`);
    if (t.factors.countPerMin >= 150) reason.push(`countPerMin=${t.factors.countPerMin.toFixed(1)}`);
    console.log(`  ${t.symbol}: ${t.returnRate.toFixed(1)}% (${reason.join(', ')})`);
  });

  console.log(`\n会被误杀的盈利代币 (${rejectedProfitable.length}个)：`);
  rejectedProfitable.forEach(t => {
    const reason = [];
    if (t.factors.top2Ratio >= 0.75) reason.push(`top2Ratio=${t.factors.top2Ratio.toFixed(2)}`);
    if (t.factors.countPerMin >= 150) reason.push(`countPerMin=${t.factors.countPerMin.toFixed(1)}`);
    console.log(`  ${t.symbol}: ${t.returnRate.toFixed(1)}% (${reason.join(', ')})`);
  });

  console.log(`\n会通过的亏损代币 (漏网之鱼, ${acceptedLosing.length}个)：`);
  acceptedLosing.forEach(t => {
    console.log(`  ${t.symbol}: ${t.returnRate.toFixed(1)}%, top2Ratio=${t.factors.top2Ratio}, countPerMin=${t.factors.countPerMin}`);
  });
}

main().catch(console.error);
