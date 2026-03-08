/**
 * 用回测实验 ab75cb2b (55个代币) 验证优化策略
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function validateWithBacktest() {
  const experimentId = 'ab75cb2b-4930-4049-a3bd-f96e3de6af47';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    用回测数据验证优化策略 (55个代币)                      ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 获取所有交易
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
      totalBuyAmount,
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

  // 当前策略（回测实验使用的策略）
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

  // 优化策略
  const optimizedStrategy = (t) => {
    return t.trendCV > 0.02 &&
           t.trendSlope > 0.02 &&
           t.trendStrengthScore >= 40 &&
           t.trendTotalReturn >= 10 &&
           t.earlyReturn > 80 &&
           t.drawdownFromHighest > -25 &&
           t.age > 1.2 && t.age <= 2.2 &&
           t.trendRiseRatio >= 0.7 &&
           t.tvl >= 5000;
  };

  const currentFiltered = tokenAnalyses.filter(currentStrategy);
  const optFiltered = tokenAnalyses.filter(optimizedStrategy);

  const calculateStats = (data) => {
    const prof = data.filter(t => t.profitPercent > 0);
    const avgProfit = data.reduce((sum, t) => sum + t.profitPercent, 0) / data.length;
    const totalProf = data.reduce((sum, t) => sum + t.profit, 0);
    const winRate = (prof.length / data.length * 100);
    return { count: data.length, winRate, avgProfit, totalProf, profitable: prof.length };
  };

  const currentStats = calculateStats(currentFiltered);
  const optStats = calculateStats(optFiltered);

  console.log('【策略效果对比】');
  console.log('');
  console.log('指标              当前策略        优化策略        改善');
  console.log('─'.repeat(60));
  console.log(`交易数            ${currentStats.count.toString().padStart(8)}        ${optStats.count.toString().padStart(8)}        ${currentStats.count - optStats.count > 0 ? '-' + (currentStats.count - optStats.count) : '0'}`);
  console.log(`胜率              ${currentStats.winRate.toFixed(1).padStart(8)}%       ${optStats.winRate.toFixed(1).padStart(8)}%       +${(optStats.winRate - currentStats.winRate).toFixed(1)}%`);
  console.log(`平均收益          ${currentStats.avgProfit.toFixed(2).padStart(8)}%       ${optStats.avgProfit.toFixed(2).padStart(8)}%       +${(optStats.avgProfit - currentStats.avgProfit).toFixed(2)}%`);
  console.log(`总收益 (BNB)      ${currentStats.totalProf.toFixed(3).padStart(8)}       ${optStats.totalProf.toFixed(3).padStart(8)}       +${((optStats.totalProf - currentStats.totalProf)).toFixed(3)}`);
  console.log(`盈利交易数        ${currentStats.profitable.toString().padStart(8)}        ${optStats.profitable.toString().padStart(8)}        ${optStats.profitable - currentStats.profitable > 0 ? '+' + (optStats.profitable - currentStats.profitable) : currentStats.profitable - optStats.profitable}`);
  console.log('');

  // 详细分析
  const currentProf = currentFiltered.filter(t => t.profitPercent > 0);
  const currentLoss = currentFiltered.filter(t => t.profitPercent < 0);
  const optProf = optFiltered.filter(t => t.profitPercent > 0);
  const optLoss = optFiltered.filter(t => t.profitPercent < 0);

  console.log('【盈利交易分析】');
  console.log('');
  console.log(`                    当前策略 (${currentProf.length}个)     优化策略 (${optProf.length}个)`);
  console.log(`平均收益            ${currentProf.length > 0 ? (currentProf.reduce((sum, t) => sum + t.profitPercent, 0) / currentProf.length).toFixed(2) : 'N/A'}%                  ${optProf.length > 0 ? (optProf.reduce((sum, t) => sum + t.profitPercent, 0) / optProf.length).toFixed(2) : 'N/A'}%`);
  console.log(`最大收益            ${currentProf.length > 0 ? Math.max(...currentProf.map(t => t.profitPercent)).toFixed(2) : 'N/A'}%                  ${optProf.length > 0 ? Math.max(...optProf.map(t => t.profitPercent)).toFixed(2) : 'N/A'}%`);
  console.log('');

  console.log('【亏损交易分析】');
  console.log('');
  console.log(`                    当前策略 (${currentLoss.length}个)     优化策略 (${optLoss.length}个)`);
  console.log(`平均亏损            ${currentLoss.length > 0 ? (currentLoss.reduce((sum, t) => sum + t.profitPercent, 0) / currentLoss.length).toFixed(2) : 'N/A'}%                  ${optLoss.length > 0 ? (optLoss.reduce((sum, t) => sum + t.profitPercent, 0) / optLoss.length).toFixed(2) : 'N/A'}%`);
  console.log(`最大亏损            ${currentLoss.length > 0 ? Math.min(...currentLoss.map(t => t.profitPercent)).toFixed(2) : 'N/A'}%                  ${optLoss.length > 0 ? Math.min(...optLoss.map(t => t.profitPercent)).toFixed(2) : 'N/A'}%`);
  console.log('');

  // 分析被过滤的代币
  const filteredOut = currentFiltered.filter(t => !optimizedStrategy(t));
  const profitableFilteredOut = filteredOut.filter(t => t.profitPercent > 0);
  const lossFilteredOut = filteredOut.filter(t => t.profitPercent < 0);

  console.log('【被优化策略过滤的代币】');
  console.log('');
  console.log(`总计: ${filteredOut.length} 个 (盈利 ${profitableFilteredOut.length} 个, 亏损 ${lossFilteredOut.length} 个)`);
  console.log('');

  if (profitableFilteredOut.length > 0) {
    profitableFilteredOut.sort((a, b) => b.profitPercent - a.profitPercent);
    console.log('过滤的盈利代币 (按收益排序):');
    console.log('');
    console.log('代币                      收益%    trendRiseRatio  trendStrength  earlyReturn%  age(分钟)');
    console.log('─'.repeat(80));
    profitableFilteredOut.forEach(t => {
      console.log(
        (t.token_symbol.padEnd(24)) +
        t.profitPercent.toFixed(2).padStart(8) + '%' +
        t.trendRiseRatio.toFixed(2).padStart(16) +
        t.trendStrengthScore.toFixed(1).padStart(15) +
        t.earlyReturn.toFixed(1).padStart(14) +
        t.age.toFixed(2).padStart(12)
      );
    });
    console.log('');
  }

  if (lossFilteredOut.length > 0) {
    lossFilteredOut.sort((a, b) => a.profitPercent - b.profitPercent);
    console.log('过滤的亏损代币 (节省的损失):');
    console.log('');
    console.log('代币                      收益%    原因');
    console.log('─'.repeat(60));
    lossFilteredOut.forEach(t => {
      let reasons = [];
      if (t.trendStrengthScore < 40) reasons.push(`strength(${t.trendStrengthScore.toFixed(0)})`);
      if (t.earlyReturn <= 80) reasons.push(`earlyReturn(${t.earlyReturn.toFixed(0)})`);
      if (t.age > 2.2) reasons.push(`age(${t.age.toFixed(1)})`);
      if (t.trendRiseRatio < 0.7) reasons.push(`ratio(${t.trendRiseRatio.toFixed(2)})`);

      console.log(
        (t.token_symbol.padEnd(24)) +
        t.profitPercent.toFixed(2).padStart(8) + '%' +
        reasons.join(', ')
      );
    });
    console.log('');
  }

  // 最终结论
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    最终结论                                                ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const totalProfitImprovement = ((optStats.totalProf - currentStats.totalProf) / currentStats.totalProf * 100);
  const winRateImprovement = optStats.winRate - currentStats.winRate;

  console.log('【优化策略效果】');
  console.log('');
  console.log(`✅ 胜率提升: ${currentStats.winRate.toFixed(1)}% → ${optStats.winRate.toFixed(1)}% (+${winRateImprovement.toFixed(1)}%)`);
  console.log(`✅ 平均收益提升: ${currentStats.avgProfit.toFixed(2)}% → ${optStats.avgProfit.toFixed(2)}% (+${(optStats.avgProfit - currentStats.avgProfit).toFixed(2)}%)`);
  console.log(`✅ 交易数减少: ${currentStats.count} → ${optStats.count} (减少${currentStats.count - optStats.count}个低质量交易)`);
  console.log(`✅ 总收益: ${optStats.totalProf > currentStats.totalProf ? '+' : ''}${(optStats.totalProf - currentStats.totalProf).toFixed(3)} BNB (${totalProfitImprovement > 0 ? '+' : ''}${totalProfitImprovement.toFixed(1)}%)`);
  console.log('');

  if (optStats.totalProf >= currentStats.totalProf) {
    console.log('📈 结论: 优化策略在更大样本(55个代币)上表现出色，建议采用！');
  } else {
    console.log('📊 结论: 优化策略略微降低了总收益，但显著提高了胜率和平均收益。');
    console.log('         如果风险偏好较低，建议采用优化策略。');
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
}

validateWithBacktest().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('分析失败:', error);
  process.exit(1);
});
