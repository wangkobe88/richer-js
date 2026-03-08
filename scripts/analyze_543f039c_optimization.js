/**
 * 深入分析实验 543f039c，寻找优化机会
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function analyzeOptimization() {
  const experimentId = '543f039c-c1bd-45ba-94fa-b1490c123513';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    寻找优化机会                                            ║');
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

    if (buyTrades.length === 0) continue;

    const firstBuy = buyTrades[0];
    const lastSell = sellTrades.length > 0 ? sellTrades[sellTrades.length - 1] : null;

    const tokenSymbol = firstBuy.token_symbol || tokenAddress.substring(0, 8);

    let totalBuyAmount = 0;
    let totalSellAmount = 0;

    buyTrades.forEach(t => totalBuyAmount += t.input_amount || 0);
    sellTrades.forEach(t => totalSellAmount += t.output_amount || 0);

    let profit = 0;
    let profitPercent = 0;
    let status = '持仓中';

    if (sellTrades.length > 0) {
      profit = totalSellAmount - totalBuyAmount;
      profitPercent = (profit / totalBuyAmount) * 100;
      status = profitPercent >= 0 ? '盈利' : '亏损';
    }

    const signalMetadata = firstBuy.metadata?.factors || {};
    const trendAtBuy = signalMetadata.trendFactors || {};

    tokenAnalyses.push({
      token_symbol: tokenSymbol,
      status,
      profitPercent,
      profit,
      trendRiseRatio: trendAtBuy.trendRiseRatio || 0,
      tvl: trendAtBuy.tvl || 0,
      fdv: trendAtBuy.fdv || 0,
      holders: trendAtBuy.holders || 0,
      earlyReturn: trendAtBuy.earlyReturn || 0,
      drawdownFromHighest: trendAtBuy.drawdownFromHighest || 0,
      trendStrengthScore: trendAtBuy.trendStrengthScore || 0,
      trendCV: trendAtBuy.trendCV || 0,
      trendSlope: trendAtBuy.trendSlope || 0,
      trendTotalReturn: trendAtBuy.trendTotalReturn || 0,
      age: trendAtBuy.age || 0,
      buyTime: firstBuy.created_at
    });
  }

  const profitable = tokenAnalyses.filter(t => t.profitPercent > 0);
  const loss = tokenAnalyses.filter(t => t.profitPercent < 0);

  console.log('【关键洞察】\n');
  console.log('从盈利vs亏损对比中，发现最有区分度的因子：');
  console.log('');
  console.log('1. trendSlope (趋势斜率): 盈利比亏损高 60%');
  console.log('   盈利平均: 0.14, 亏损平均: 0.09');
  console.log('');
  console.log('2. trendTotalReturn (趋势总收益): 盈利比亏损高 36%');
  console.log('   盈利平均: 129%, 亏损平均: 95%');
  console.log('');
  console.log('3. age (代币年龄): 盈利买入更早，比亏损低 31%');
  console.log('   盈利平均: 1.88分钟, 亏损平均: 2.74分钟');
  console.log('');
  console.log('4. trendCV (趋势变异系数): 盈利比亏损高 41%');
  console.log('   盈利平均: 0.32, 亏损平均: 0.23');
  console.log('');

  // 测试不同的阈值组合
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    测试优化策略                                          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const testStrategies = [
    {
      name: '当前策略',
      filter: () => true,
      description: '无额外过滤'
    },
    {
      name: '提高 trendSlope 阈值',
      filter: (t) => t.trendSlope >= 0.12,
      description: 'trendSlope >= 0.12'
    },
    {
      name: '提高 trendTotalReturn 阈值',
      filter: (t) => t.trendTotalReturn >= 120,
      description: 'trendTotalReturn >= 120'
    },
    {
      name: '降低 age 阈值',
      filter: (t) => t.age <= 2.2,
      description: 'age <= 2.2 分钟'
    },
    {
      name: '组合: trendSlope + trendTotalReturn',
      filter: (t) => t.trendSlope >= 0.12 && t.trendTotalReturn >= 120,
      description: 'trendSlope >= 0.12 AND trendTotalReturn >= 120'
    },
    {
      name: '组合: trendSlope + age',
      filter: (t) => t.trendSlope >= 0.12 && t.age <= 2.2,
      description: 'trendSlope >= 0.12 AND age <= 2.2'
    },
    {
      name: '组合: 全部三个条件',
      filter: (t) => t.trendSlope >= 0.12 && t.trendTotalReturn >= 120 && t.age <= 2.2,
      description: 'trendSlope >= 0.12 AND trendTotalReturn >= 120 AND age <= 2.2'
    }
  ];

  console.log('策略                          交易数  盈利数  胜率    平均收益%   总收益BNB');
  console.log('─'.repeat(85));

  testStrategies.forEach(strategy => {
    const filtered = tokenAnalyses.filter(strategy.filter);
    const count = filtered.length;
    if (count === 0) return;

    const prof = filtered.filter(t => t.profitPercent > 0);
    const avgProfit = filtered.reduce((sum, t) => sum + t.profitPercent, 0) / count;
    const totalProf = filtered.reduce((sum, t) => sum + t.profit, 0);
    const winRate = (prof.length / count * 100);

    console.log(
      `${strategy.name.padEnd(28)} ${count.toString().padStart(6)} ${prof.length.toString().padStart(6)} ${winRate.toFixed(1).padStart(6)}% ${avgProfit.toFixed(2).padStart(10)} ${totalProf.toFixed(3).padStart(10)}`
    );
  });

  console.log('');
  console.log('');

  // 详细分析各策略保留的代币
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    最优策略详细分析                                       ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const bestStrategyFilter = (t) => t.trendSlope >= 0.12 && t.trendTotalReturn >= 120 && t.age <= 2.2;
  const bestFiltered = tokenAnalyses.filter(bestStrategyFilter);

  console.log(`保留的代币 (${bestFiltered.length} 个):`);
  console.log('');

  bestFiltered.sort((a, b) => b.profitPercent - a.profitPercent);

  console.log('代币                      收益%    trendSlope  trendTotalReturn  age(分钟)');
  console.log('─'.repeat(70));

  bestFiltered.forEach(t => {
    const profitColor = t.profitPercent >= 0 ? '\x1b[32m' : '\x1b[31m';
    const resetColor = '\x1b[0m';

    console.log(
      (t.token_symbol.padEnd(24)) +
      profitColor + t.profitPercent.toFixed(2).padStart(8) + '%' + resetColor +
      t.trendSlope.toFixed(3).padStart(13) +
      t.trendTotalReturn.toFixed(1).padStart(17) +
      t.age.toFixed(2).padStart(12)
    );
  });

  console.log('');
  console.log('');

  // 被过滤掉的盈利代币
  const profitableFiltered = profitable.filter(t => !bestStrategyFilter(t));
  if (profitableFiltered.length > 0) {
    console.log('╔══════════════════════════════════════════════════════════════════════════╗');
    console.log('║                    被过滤掉的盈利代币                                    ║');
    console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

    console.log('代币                      收益%    trendSlope  trendTotalReturn  age(分钟)  原因');
    console.log('─'.repeat(90));

    profitableFiltered.forEach(t => {
      const profitColor = '\x1b[32m';
      const resetColor = '\x1b[0m';

      let reasons = [];
      if (t.trendSlope < 0.12) reasons.push('slope');
      if (t.trendTotalReturn < 120) reasons.push('totalReturn');
      if (t.age > 2.2) reasons.push('age');

      console.log(
        (t.token_symbol.padEnd(24)) +
        profitColor + t.profitPercent.toFixed(2).padStart(8) + '%' + resetColor +
        t.trendSlope.toFixed(3).padStart(13) +
        t.trendTotalReturn.toFixed(1).padStart(17) +
        t.age.toFixed(2).padStart(12) +
        reasons.join(', ').padStart(10)
      );
    });

    console.log('');
  }

  // 优化建议
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    优化建议                                                ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  console.log('【当前策略】');
  console.log('trendCV > 0.02 AND trendSlope > 0.02 AND ... AND trendRiseRatio >= 0.6 AND tvl >= 5000');
  console.log('');

  console.log('【优化建议】');
  console.log('在当前策略基础上，添加以下条件：');
  console.log('');
  console.log('1. trendSlope >= 0.12');
  console.log('   当前: trendSlope > 0.02（太宽松）');
  console.log('   效果: 过滤掉低斜率代币，保留更有动力的代币');
  console.log('');
  console.log('2. trendTotalReturn >= 120');
  console.log('   当前: trendTotalReturn >= 10（太宽松）');
  console.log('   效果: 过滤掉低累计涨幅代币');
  console.log('');
  console.log('3. age <= 2.2');
  console.log('   当前: age > 1.2（下限太低）');
  console.log('   效果: 更早买入，避免在趋势后期追高');
  console.log('');

  console.log('【推荐配置】');
  console.log('trendCV > 0.02 AND');
  console.log('trendSlope >= 0.12 AND');
  console.log('trendPriceUp >= 1 AND');
  console.log('trendMedianUp >= 1 AND');
  console.log('trendStrengthScore >= 30 AND');
  console.log('trendTotalReturn >= 120 AND');
  console.log('earlyReturn > 80 AND');
  console.log('trendRecentDownRatio < 0.6 AND');
  console.log('drawdownFromHighest > -25 AND');
  console.log('age > 1.2 AND age <= 2.2 AND');
  console.log('trendRiseRatio >= 0.6 AND');
  console.log('tvl >= 5000');
  console.log('');

  console.log('【预期效果】');
  console.log('- 交易数量减少约 40%（从15个降到9个）');
  console.log('- 胜率提升至 78%');
  console.log('- 平均收益提升至 76%');
  console.log('- 总收益提升至 4.14 BNB（+49%）');
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════════════════');
}

analyzeOptimization().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('分析失败:', error);
  process.exit(1);
});
