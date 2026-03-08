/**
 * 重新分析，找出更合理的优化方案
 * 核心问题：如何过滤亏损交易，同时保留高收益交易
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function reasonableOptimization() {
  const experimentId = 'ab75cb2b-4930-4049-a3bd-f96e3de6af47';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    重新分析：保留高收益，过滤低收益                          ║');
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

  // 分析高收益代币 vs 亏损代币的特征
  const superHigh = tokenAnalyses.filter(t => t.profitPercent >= 100);  // 超高收益
  const highProfit = tokenAnalyses.filter(t => t.profitPercent >= 30 && t.profitPercent < 100);  // 高收益
  const lowProfit = tokenAnalyses.filter(t => t.profitPercent >= 0 && t.profitPercent < 30);  // 低收益
  const loss = tokenAnalyses.filter(t => t.profitPercent < 0);  // 亏损

  console.log('【收益分类统计】');
  console.log('');
  console.log('类别              数量    平均收益%  趋势比   strength  age(分钟)');
  console.log('─'.repeat(70));

  const stats = (data, label) => {
    if (data.length === 0) return;
    const avgProfit = data.reduce((sum, t) => sum + t.profitPercent, 0) / data.length;
    const avgRatio = data.reduce((sum, t) => sum + t.trendRiseRatio, 0) / data.length;
    const avgStrength = data.reduce((sum, t) => sum + t.trendStrengthScore, 0) / data.length;
    const avgAge = data.reduce((sum, t) => sum + t.age, 0) / data.length;
    console.log(`${label.padEnd(18)} ${data.length.toString().padStart(4)}  ${avgProfit.toFixed(2).padStart(8)}  ${avgRatio.toFixed(2).padStart(7)}  ${avgStrength.toFixed(1).padStart(8)}  ${avgAge.toFixed(2).padStart(8)}`);
  };

  stats(superHigh, '超高收益 (>100%)');
  stats(highProfit, '高收益 (30-100%)');
  stats(lowProfit, '低收益 (0-30%)');
  stats(loss, '亏损 (<0%)');

  console.log('');
  console.log('');

  // 关键发现：亏损代币的主要特征
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    亏损代币特征分析                                        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  loss.sort((a, b) => a.profitPercent - b.profitPercent);

  console.log('【最亏损的代币】');
  console.log('');
  console.log('代币                      收益%    age    ratio  strength  earlyReturn%');
  console.log('─'.repeat(70));

  loss.slice(0, 10).forEach(t => {
    console.log(
      (t.token_symbol.padEnd(24)) +
      t.profitPercent.toFixed(2).padStart(8) + '%' +
      t.age.toFixed(2).padStart(7) +
      t.trendRiseRatio.toFixed(2).padStart(7) +
      t.trendStrengthScore.toFixed(1).padStart(9) +
      t.earlyReturn.toFixed(1).padStart(12)
    );
  });

  console.log('');
  console.log('');

  // 观察亏损代币的age分布
  console.log('【亏损代币的 age 分布】');
  const ageRanges = [
    { max: 2, label: '< 2分钟' },
    { min: 2, max: 5, label: '2-5分钟' },
    { min: 5, label: '> 5分钟' }
  ];

  ageRanges.forEach(range => {
    const inRange = loss.filter(t => {
      if (range.max === undefined) return t.age >= range.min;
      if (range.min === undefined) return t.age < range.max;
      return t.age >= range.min && t.age < range.max;
    });

    if (inRange.length > 0) {
      const avgLoss = inRange.reduce((sum, t) => sum + t.profitPercent, 0) / inRange.length;
      console.log(`  ${range.label}: ${inRange.length} 个, 平均亏损 ${avgLoss.toFixed(2)}%`);
    }
  });

  console.log('');
  console.log('');

  // 观察亏损代币的earlyReturn分布
  console.log('【亏损代币的 earlyReturn 分布】');
  const returnRanges = [
    { max: 100, label: '< 100%' },
    { min: 100, max: 200, label: '100-200%' },
    { min: 200, label: '> 200%' }
  ];

  returnRanges.forEach(range => {
    const inRange = loss.filter(t => {
      if (range.max === undefined) return t.earlyReturn >= range.min;
      if (range.min === undefined) return t.earlyReturn < range.max;
      return t.earlyReturn >= range.min && t.earlyReturn < range.max;
    });

    if (inRange.length > 0) {
      const avgLoss = inRange.reduce((sum, t) => sum + t.profitPercent, 0) / inRange.length;
      console.log(`  ${range.label}: ${inRange.length} 个, 平均亏损 ${avgLoss.toFixed(2)}%`);
    }
  });

  console.log('');
  console.log('');

  // 测试不同的策略
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    策略测试                                                ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 当前策略
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

  // 只过滤晚期买入
  const strategy1 = (t) => currentStrategy(t) && t.age <= 5;

  // 过滤晚期买入 + 极端高earlyReturn
  const strategy2 = (t) => currentStrategy(t) && t.age <= 5 && t.earlyReturn < 300;

  // 过滤晚期买入 + 低trendRiseRatio
  const strategy3 = (t) => currentStrategy(t) && t.age <= 5 && t.trendRiseRatio >= 0.67;

  // 只过滤极端晚期 (>10分钟)
  const strategy4 = (t) => currentStrategy(t) && t.age <= 10;

  const strategies = [
    { name: '当前策略', filter: currentStrategy },
    { name: '只过滤 age > 5', filter: strategy1 },
    { name: '过滤 age > 5 且 earlyReturn < 300', filter: strategy2 },
    { name: '过滤 age > 5 且 ratio >= 0.67', filter: strategy3 },
    { name: '只过滤 age > 10', filter: strategy4 }
  ];

  console.log('策略                              交易数  胜率    平均收益%   总收益BNB');
  console.log('─'.repeat(75));

  strategies.forEach(s => {
    const filtered = tokenAnalyses.filter(s.filter);
    if (filtered.length === 0) return;

    const prof = filtered.filter(t => t.profitPercent > 0);
    const avgProfit = filtered.reduce((sum, t) => sum + t.profitPercent, 0) / filtered.length;
    const totalProf = filtered.reduce((sum, t) => sum + t.profit, 0);
    const winRate = (prof.length / filtered.length * 100);

    console.log(
      `${s.name.padEnd(33)} ${filtered.length.toString().padStart(4)} ${winRate.toFixed(1).padStart(6)}% ${avgProfit.toFixed(2).padStart(10)} ${totalProf.toFixed(3).padStart(10)}`
    );
  });

  console.log('');
  console.log('');

  // 最终建议
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    最终建议                                                ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const strategy4Filtered = tokenAnalyses.filter(strategy4);
  const strategy4Prof = strategy4Filtered.filter(t => t.profitPercent > 0);
  const strategy4Avg = strategy4Filtered.reduce((sum, t) => sum + t.profitPercent, 0) / strategy4Filtered.length;
  const strategy4Total = strategy4Filtered.reduce((sum, t) => sum + t.profit, 0);
  const strategy4WinRate = (strategy4Prof.length / strategy4Filtered.length * 100);

  console.log('【推荐策略: 只过滤 age > 10 分钟】');
  console.log('');
  console.log(`  交易数: ${strategy4Filtered.length} (当前 31)`);
  console.log(`  胜率: ${strategy4WinRate.toFixed(1)}% (当前 51.6%)`);
  console.log(`  平均收益: ${strategy4Avg.toFixed(2)}% (当前 34.03%)`);
  console.log(`  总收益: ${strategy4Total.toFixed(3)} BNB (当前 10.550)`);
  console.log('');

  console.log('【推荐配置】');
  console.log('trendCV > 0.02 AND');
  console.log('trendSlope > 0.02 AND');
  console.log('trendTotalReturn >= 10 AND');
  console.log('earlyReturn > 80 AND');
  console.log('trendRecentDownRatio < 0.6 AND');
  console.log('drawdownFromHighest > -25 AND');
  console.log('age > 1.2 AND age <= 10 AND');
  console.log('trendRiseRatio >= 0.6 AND');
  console.log('tvl >= 5000');
  console.log('');

  console.log('【核心优化点】');
  console.log('1. earlyReturn: 15 → 80 (提高早期收益门槛)');
  console.log('2. age 上限: 添加 age <= 10 (避免晚期追高，但不过于严格)');
  console.log('3. 保持 trendRiseRatio >= 0.6 (不过高，保留 CLAWSTER 这类机会)');

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
}

reasonableOptimization().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('分析失败:', error);
  process.exit(1);
});
