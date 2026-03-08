/**
 * 基于实验543f039c的15个代币验证优化策略
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function validateOptimization() {
  const experimentId = '543f039c-c1bd-45ba-94fa-b1490c123513';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    基于543f039c验证优化策略                                 ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 获取交易数据
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  // 按代币分组
  const tokenTradeGroups = new Map();
  trades.forEach(trade => {
    if (!tokenTradeGroups.has(trade.token_address)) {
      tokenTradeGroups.set(trade.token_address, []);
    }
    tokenTradeGroups.get(trade.token_address).push(trade);
  });

  const tokenAnalyses = [];

  for (const [tokenAddress, tokenTrades] of tokenTradeGroups) {
    tokenTrades.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const buyTrades = tokenTrades.filter(t => t.trade_direction === 'buy');
    const sellTrades = tokenTrades.filter(t => t.trade_direction === 'sell');

    if (buyTrades.length === 0 || sellTrades.length === 0) continue;

    const firstBuy = buyTrades[0];
    const tokenSymbol = firstBuy.token_symbol || tokenAddress.substring(0, 8);

    let totalBuyAmount = 0;
    let totalSellAmount = 0;

    buyTrades.forEach(t => totalBuyAmount += t.input_amount || 0);
    sellTrades.forEach(t => totalSellAmount += t.output_amount || 0);

    const profit = totalSellAmount - totalBuyAmount;
    const profitPercent = (profit / totalBuyAmount) * 100;

    const signalMetadata = firstBuy.metadata?.factors || {};
    const trendAtBuy = signalMetadata.trendFactors || {};

    tokenAnalyses.push({
      token_symbol: tokenSymbol,
      profitPercent,
      profit,
      trendRiseRatio: trendAtBuy.trendRiseRatio || 0,
      trendStrengthScore: trendAtBuy.trendStrengthScore || 0,
      tvl: trendAtBuy.tvl || 0,
      fdv: trendAtBuy.fdv || 0,
      holders: trendAtBuy.holders || 0,
      earlyReturn: trendAtBuy.earlyReturn || 0,
      drawdownFromHighest: trendAtBuy.drawdownFromHighest || 0,
      trendCV: trendAtBuy.trendCV || 0,
      trendSlope: trendAtBuy.trendSlope || 0,
      trendTotalReturn: trendAtBuy.trendTotalReturn || 0,
      age: trendAtBuy.age || 0
    });
  }

  // 当前策略（543f039c使用的策略）
  const currentStrategy = (t) => {
    return t.trendCV > 0.02 &&
           t.trendSlope > 0.02 &&
           t.trendTotalReturn >= 10 &&
           t.earlyReturn > 15 &&
           t.drawdownFromHighest > -25 &&
           t.age > 1.2 &&
           t.trendRiseRatio >= 0.6 &&
           t.tvl >= 5000;
  };

  // 测试不同的优化策略
  const testStrategies = [
    { name: '当前策略', filter: currentStrategy },
    { name: '提高earlyReturn>80', filter: (t) => currentStrategy(t) && t.earlyReturn > 80 },
    { name: '提高earlyReturn>100', filter: (t) => currentStrategy(t) && t.earlyReturn > 100 },
    { name: '提高ratio>=0.7', filter: (t) => currentStrategy(t) && t.trendRiseRatio >= 0.7 },
    { name: '提高ratio>=0.8', filter: (t) => currentStrategy(t) && t.trendRiseRatio >= 0.8 },
    { name: '添加age上限<=2.5', filter: (t) => currentStrategy(t) && t.age <= 2.5 },
    { name: '添加age上限<=2.0', filter: (t) => currentStrategy(t) && t.age <= 2.0 },
    { name: '组合: earlyReturn>80 + age<=2.5', filter: (t) => currentStrategy(t) && t.earlyReturn > 80 && t.age <= 2.5 },
    { name: '组合: earlyReturn>100 + age<=2.0', filter: (t) => currentStrategy(t) && t.earlyReturn > 100 && t.age <= 2.0 },
    { name: '组合: ratio>=0.7 + age<=2.5', filter: (t) => currentStrategy(t) && t.trendRiseRatio >= 0.7 && t.age <= 2.5 },
    { name: '组合: ratio>=0.8 + age<=2.0', filter: (t) => currentStrategy(t) && t.trendRiseRatio >= 0.8 && t.age <= 2.0 },
    { name: '激进: earlyReturn>200 + ratio>=0.8', filter: (t) => currentStrategy(t) && t.earlyReturn > 200 && t.trendRiseRatio >= 0.8 },
  ];

  console.log('策略效果对比:');
  console.log('');
  console.log('策略                                    交易数  胜率    平均收益%   总收益BNB');
  console.log('─'.repeat(85));

  testStrategies.forEach(s => {
    const filtered = tokenAnalyses.filter(s.filter);
    if (filtered.length === 0) return;

    const prof = filtered.filter(t => t.profitPercent > 0);
    const avgProfit = filtered.reduce((sum, t) => sum + t.profitPercent, 0) / filtered.length;
    const totalProf = filtered.reduce((sum, t) => sum + t.profit, 0);
    const winRate = (prof.length / filtered.length * 100);

    console.log(
      `${s.name.padEnd(40)} ${filtered.length.toString().padStart(4)} ${winRate.toFixed(1).padStart(6)}% ${avgProfit.toFixed(2).padStart(10)} ${totalProf.toFixed(3).padStart(10)}`
    );
  });

  console.log('');
  console.log('');

  // 找出最佳策略
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    最佳策略分析                                          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 找出收益最高的策略
  const bestStrategy = testStrategies
    .map(s => ({
      ...s,
      filtered: tokenAnalyses.filter(s.filter)
    }))
    .filter(s => s.filtered.length >= 3) // 至少3个交易
    .sort((a, b) => {
      const totalA = a.filtered.reduce((sum, t) => sum + t.profit, 0);
      const totalB = b.filtered.reduce((sum, t) => sum + t.profit, 0);
      return totalB - totalA;
    })[0];

  if (bestStrategy) {
    const bestFiltered = bestStrategy.filtered;
    const bestProf = bestFiltered.filter(t => t.profitPercent > 0);
    const bestAvg = bestFiltered.reduce((sum, t) => sum + t.profitPercent, 0) / bestFiltered.length;
    const bestTotal = bestFiltered.reduce((sum, t) => sum + t.profit, 0);
    const bestWinRate = (bestProf.length / bestFiltered.length * 100);

    console.log('【最佳策略】');
    console.log(`  策略: ${bestStrategy.name}`);
    console.log(`  交易数: ${bestFiltered.length}`);
    console.log(`  胜率: ${bestWinRate.toFixed(1)}%`);
    console.log(`  平均收益: ${bestAvg.toFixed(2)}%`);
    console.log(`  总收益: ${bestTotal.toFixed(3)} BNB`);
    console.log('');

    console.log('【保留的代币】');
    bestFiltered.forEach(t => {
      const profitColor = t.profitPercent >= 0 ? '\x1b[32m' : '\x1b[31m';
      const resetColor = '\x1b[0m';
      console.log(`  ${profitColor}${t.token_symbol}: ${t.profitPercent.toFixed(2)}%${resetColor}`);
    });
    console.log('');

    const currentTotal = tokenAnalyses.reduce((sum, t) => sum + t.profit, 0);
    const improvement = ((bestTotal - currentTotal) / currentTotal * 100);

    console.log('【与当前策略对比】');
    console.log(`  当前策略: 15个交易, 总收益 ${currentTotal.toFixed(3)} BNB`);
    console.log(`  最佳策略: ${bestFiltered.length}个交易, 总收益 ${bestTotal.toFixed(3)} BNB`);
    console.log(`  收益改善: ${improvement > 0 ? '+' : ''}${improvement.toFixed(1)}%`);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
}

validateOptimization().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('分析失败:', error);
  process.exit(1);
});
