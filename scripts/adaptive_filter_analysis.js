/**
 * 自适应过滤规则分析
 * 寻找在两种市场环境下都有效的规则
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
        top2Ratio: f.walletClusterTop2Ratio,
        secondToFirstRatio: f.walletClusterSecondToFirstRatio,
        megaRatio: f.walletClusterMegaRatio,
        uniqueWallets: f.earlyTradesUniqueWallets,
        highValueCount: f.earlyTradesHighValueCount,
        volumePerMin: f.earlyTradesVolumePerMin,
        earlyReturn: tf.earlyReturn,
        trendCV: tf.trendCV,
        trendStrengthScore: tf.trendStrengthScore,
        trendTotalReturn: tf.trendTotalReturn,
        trendRiseRatio: tf.trendRiseRatio,
      };
    }
  });

  return tokens.map(t => ({
    ...t,
    factors: tokenFactors[t.address] || {}
  })).filter(t => Object.keys(t.factors).length > 0);
}

async function main() {
  console.log('正在加载数据...\n');

  const [exp1Data, exp2Data] = await Promise.all([
    analyzeExperiment('25493408-98b3-4342-a1ac-036ba49f97ee'), // 原实验（市场差）
    analyzeExperiment('1dde2be5-2f4e-49fb-9520-cb032e9ef759')  // 市场好实验
  ]);

  console.log('市场差实验：', exp1Data.length, '个代币');
  console.log('市场好实验：', exp2Data.length, '个代币\n');

  // ========================================
  // 1. 寻找"安全区"（两个市场都盈利）
  // ========================================
  console.log('=== 1. 寻找两个市场都安全的区域 ===\n');

  const safeZones = [
    { name: 'countPerMin < 50', test: f => f.countPerMin < 50 },
    { name: 'countPerMin < 80', test: f => f.countPerMin < 80 },
    { name: 'countPerMin < 100', test: f => f.countPerMin < 100 },
    { name: 'countPerMin < 150', test: f => f.countPerMin < 150 },
    { name: 'top2Ratio < 0.8', test: f => f.top2Ratio < 0.8 },
    { name: 'top2Ratio < 0.85', test: f => f.top2Ratio < 0.85 },
    { name: 'uniqueWallets >= 10', test: f => f.uniqueWallets >= 10 },
    { name: 'uniqueWallets >= 15', test: f => f.uniqueWallets >= 15 },
    { name: 'earlyReturn < 150', test: f => f.earlyReturn < 150 },
    { name: 'earlyReturn < 200', test: f => f.earlyReturn < 200 },
    { name: 'earlyReturn < 300', test: f => f.earlyReturn < 300 },
  ];

  console.log('规则'.padEnd(30) + '市场差胜率'.padEnd(15) + '市场好胜率'.padEnd(15) + '综合胜率');
  console.log('-'.repeat(80));

  safeZones.forEach(zone => {
    const exp1Match = exp1Data.filter(t => zone.test(t.factors));
    const exp1Profit = exp1Match.filter(t => t.returnRate > 0);
    const exp1WinRate = exp1Match.length > 0 ? (exp1Profit.length / exp1Match.length * 100).toFixed(1) : 'N/A';

    const exp2Match = exp2Data.filter(t => zone.test(t.factors));
    const exp2Profit = exp2Match.filter(t => t.returnRate > 0);
    const exp2WinRate = exp2Match.length > 0 ? (exp2Profit.length / exp2Match.length * 100).toFixed(1) : 'N/A';

    const totalMatch = exp1Match.length + exp2Match.length;
    const totalProfit = exp1Profit.length + exp2Profit.length;
    const overallWinRate = totalMatch > 0 ? (totalProfit / totalMatch * 100).toFixed(1) : 'N/A';

    if (exp1Match.length >= 3 && exp2Match.length >= 3) {
      console.log(`${zone.name.padEnd(30)}${exp1WinRate.padEnd(15)}${exp2WinRate.padEnd(15)}${overallWinRate}`);
    }
  });

  // ========================================
  // 2. 寻找"危险区"（两个市场都亏损）
  // ========================================
  console.log('\n=== 2. 寻找两个市场都危险的区域 ===\n');

  const dangerZones = [
    { name: 'countPerMin >= 150', test: f => f.countPerMin >= 150 },
    { name: 'countPerMin >= 200', test: f => f.countPerMin >= 200 },
    { name: 'earlyReturn >= 200 AND countPerMin >= 150', test: f => f.earlyReturn >= 200 && f.countPerMin >= 150 },
    { name: 'earlyReturn >= 300 AND countPerMin >= 100', test: f => f.earlyReturn >= 300 && f.countPerMin >= 100 },
    { name: 'earlyReturn >= 400', test: f => f.earlyReturn >= 400 },
    { name: 'top2Ratio >= 0.9 AND countPerMin >= 100', test: f => f.top2Ratio >= 0.9 && f.countPerMin >= 100 },
    { name: 'top2Ratio >= 0.95', test: f => f.top2Ratio >= 0.95 },
  ];

  console.log('规则'.padEnd(45) + '市场差'.padEnd(20) + '市场好');
  console.log('-'.repeat(80));

  dangerZones.forEach(zone => {
    const exp1Match = exp1Data.filter(t => zone.test(t.factors));
    const exp1Losing = exp1Match.filter(t => t.returnRate <= 0);
    const exp1LossRate = exp1Match.length > 0 ? (exp1Losing.length / exp1Match.length * 100).toFixed(0) + '%' : 'N/A';
    const exp1AvgReturn = exp1Match.length > 0 ? (exp1Match.reduce((a, t) => a + t.returnRate, 0) / exp1Match.length).toFixed(1) + '%' : 'N/A';

    const exp2Match = exp2Data.filter(t => zone.test(t.factors));
    const exp2Losing = exp2Match.filter(t => t.returnRate <= 0);
    const exp2LossRate = exp2Match.length > 0 ? (exp2Losing.length / exp2Match.length * 100).toFixed(0) + '%' : 'N/A';
    const exp2AvgReturn = exp2Match.length > 0 ? (exp2Match.reduce((a, t) => a + t.returnRate, 0) / exp2Match.length).toFixed(1) + '%' : 'N/A';

    if (exp1Match.length >= 2 || exp2Match.length >= 2) {
      console.log(`${zone.name.padEnd(45)}${exp1LossRate} (${exp1AvgReturn})`.padEnd(20) + `${exp2LossRate} (${exp2AvgReturn})`);
    }
  });

  // ========================================
  // 3. 自适应规则：根据 earlyReturn 动态调整 countPerMin 阈值
  // ========================================
  console.log('\n=== 3. 自适应规则：根据 earlyReturn 动态调整 ===\n');

  const adaptiveRules = [
    {
      name: 'earlyReturn < 150: countPerMin 无限制',
      test: f => f.earlyReturn < 150
    },
    {
      name: 'earlyReturn >= 150 AND earlyReturn < 250: countPerMin < 150',
      test: f => f.earlyReturn >= 150 && f.earlyReturn < 250 && f.countPerMin < 150
    },
    {
      name: 'earlyReturn >= 250 AND earlyReturn < 400: countPerMin < 100',
      test: f => f.earlyReturn >= 250 && f.earlyReturn < 400 && f.countPerMin < 100
    },
    {
      name: 'earlyReturn >= 400: countPerMin < 50',
      test: f => f.earlyReturn >= 400 && f.countPerMin < 50
    },
  ];

  console.log('规则'.padEnd(60) + '市场差'.padEnd(20) + '市场好');
  console.log('-'.repeat(90));

  adaptiveRules.forEach(rule => {
    const exp1Match = exp1Data.filter(t => rule.test(t.factors));
    const exp1Losing = exp1Match.filter(t => t.returnRate <= 0);
    const exp1WinRate = exp1Match.length > 0 ? ((exp1Match.length - exp1Losing.length) / exp1Match.length * 100).toFixed(0) + '%' : 'N/A';
    const exp1Avg = exp1Match.length > 0 ? (exp1Match.reduce((a, t) => a + t.returnRate, 0) / exp1Match.length).toFixed(1) + '%' : 'N/A';

    const exp2Match = exp2Data.filter(t => rule.test(t.factors));
    const exp2Losing = exp2Match.filter(t => t.returnRate <= 0);
    const exp2WinRate = exp2Match.length > 0 ? ((exp2Match.length - exp2Losing.length) / exp2Match.length * 100).toFixed(0) + '%' : 'N/A';
    const exp2Avg = exp2Match.length > 0 ? (exp2Match.reduce((a, t) => a + t.returnRate, 0) / exp2Match.length).toFixed(1) + '%' : 'N/A';

    console.log(`${rule.name.padEnd(60)}${exp1WinRate} (${exp1Avg})`.padEnd(20) + `${exp2WinRate} (${exp2Avg})`);
  });

  // ========================================
  // 4. 分析 CM0 和 Dude 为什么能盈利
  // ========================================
  console.log('\n=== 4. 分析市场好时的高活跃盈利代币 ===\n');

  const highActivityProfitableInGoodMarket = exp2Data.filter(t =>
    t.factors.countPerMin >= 150 && t.returnRate > 0
  );

  console.log('市场好实验中 countPerMin >= 150 且盈利的代币：');
  highActivityProfitableInGoodMarket.forEach(t => {
    console.log(`\n  ${t.symbol}: +${t.returnRate.toFixed(1)}%`);
    console.log(`    countPerMin: ${t.factors.countPerMin.toFixed(1)}, earlyReturn: ${t.factors.earlyReturn.toFixed(1)}%`);
    console.log(`    top2Ratio: ${t.factors.top2Ratio?.toFixed(2) || 'N/A'}, uniqueWallets: ${t.factors.uniqueWallets}, volumePerMin: ${t.factors.volumePerMin?.toFixed(0) || 'N/A'}`);
  });

  // 对比亏损的高活跃代币
  const highActivityLosingInGoodMarket = exp2Data.filter(t =>
    t.factors.countPerMin >= 150 && t.returnRate <= 0
  );

  console.log('\n市场好实验中 countPerMin >= 150 且亏损的代币：');
  highActivityLosingInGoodMarket.forEach(t => {
    console.log(`\n  ${t.symbol}: ${t.returnRate.toFixed(1)}%`);
    console.log(`    countPerMin: ${t.factors.countPerMin.toFixed(1)}, earlyReturn: ${t.factors.earlyReturn.toFixed(1)}%`);
    console.log(`    top2Ratio: ${t.factors.top2Ratio?.toFixed(2) || 'N/A'}, uniqueWallets: ${t.factors.uniqueWallets}, volumePerMin: ${t.factors.volumePerMin?.toFixed(0) || 'N/A'}`);
  });

  // ========================================
  // 5. 最终推荐
  // ========================================
  console.log('\n=== 🎯 最终推荐 ===\n');

  console.log('【保守策略】适用于市场不确定时：');
  console.log('  countPerMin < 100');
  console.log('  OR (countPerMin >= 100 AND earlyReturn < 150)');
  console.log('');

  console.log('【自适应策略】根据 earlyReturn 动态调整：');
  console.log('  IF earlyReturn < 150: countPerMin 无限制');
  console.log('  ELSE IF earlyReturn < 250: countPerMin < 150');
  console.log('  ELSE IF earlyReturn < 400: countPerMin < 100');
  console.log('  ELSE: countPerMin < 50');
  console.log('');

  console.log('【绝对避免】（两个市场都高风险）：');
  console.log('  earlyReturn >= 400 AND countPerMin >= 100');
}

main().catch(console.error);
