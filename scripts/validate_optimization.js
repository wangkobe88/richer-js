/**
 * 验证优化策略的实际效果
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function validateOptimization() {
  const experimentId = '543f039c-c1bd-45ba-94fa-b1490c123513';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    优化策略效果验证                                        ║');
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

  // 当前策略条件（基于已有数据）
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

  // 优化策略1: 温和优化
  const optimizedStrategy1 = (t) => {
    return t.trendCV > 0.02 &&
           t.trendSlope > 0.02 &&
           t.trendTotalReturn >= 10 &&
           t.earlyReturn > 50 &&        // 提高: 15 -> 50
           t.drawdownFromHighest > -25 &&
           t.age > 1.2 && t.age <= 2.5 && // 添加上限
           t.trendRiseRatio >= 0.7 &&    // 提高: 0.6 -> 0.7
           t.tvl >= 5000;
  };

  // 优化策略2: 激进优化（使用trendStrengthScore）
  const optimizedStrategy2 = (t) => {
    return t.trendCV > 0.02 &&
           t.trendSlope > 0.02 &&
           t.trendStrengthScore >= 50 && // 提高: 30 -> 50
           t.trendTotalReturn >= 10 &&
           t.earlyReturn > 50 &&
           t.drawdownFromHighest > -25 &&
           t.age > 1.2 && t.age <= 2.5 &&
           t.trendRiseRatio >= 0.7 &&
           t.tvl >= 5000;
  };

  // 优化策略3: 平衡策略
  const optimizedStrategy3 = (t) => {
    return t.trendCV > 0.02 &&
           t.trendSlope > 0.02 &&
           t.trendStrengthScore >= 40 && // 适中: 30 -> 40
           t.trendTotalReturn >= 10 &&
           t.earlyReturn > 80 &&          // 适中: 80
           t.drawdownFromHighest > -25 &&
           t.age > 1.2 && t.age <= 2.2 &&  // 更严格: 2.2
           t.trendRiseRatio >= 0.7 &&
           t.tvl >= 5000;
  };

  const strategies = [
    { name: '当前策略', filter: currentStrategy },
    { name: '优化1: 温和 (earlyReturn>50, age<=2.5, ratio>=0.7)', filter: optimizedStrategy1 },
    { name: '优化2: 激进 (strength>=50, age<=2.5, ratio>=0.7)', filter: optimizedStrategy2 },
    { name: '优化3: 平衡 (strength>=40, earlyReturn>80, age<=2.2)', filter: optimizedStrategy3 }
  ];

  console.log('策略效果对比:');
  console.log('');
  console.log('策略                                                      交易数  胜率    平均收益%   总收益BNB   改善%');
  console.log('─'.repeat(105));

  const currentResults = { count: 0, profit: 0, avg: 0, winRate: 0 };

  strategies.forEach((s, index) => {
    const filtered = tokenAnalyses.filter(s.filter);
    if (filtered.length === 0) return;

    const prof = filtered.filter(t => t.profitPercent > 0);
    const avgProfit = filtered.reduce((sum, t) => sum + t.profitPercent, 0) / filtered.length;
    const totalProf = filtered.reduce((sum, t) => sum + t.profit, 0);
    const winRate = (prof.length / filtered.length * 100);

    if (index === 0) {
      currentResults.count = filtered.length;
      currentResults.profit = totalProf;
      currentResults.avg = avgProfit;
      currentResults.winRate = winRate;
    }

    const improvement = ((totalProf - currentResults.profit) / currentResults.profit * 100);

    console.log(
      `${s.name.padEnd(58)} ${filtered.length.toString().padStart(4)} ${winRate.toFixed(1).padStart(6)}% ${avgProfit.toFixed(2).padStart(10)} ${totalProf.toFixed(3).padStart(10)}  ${improvement > 0 ? '+' : ''}${improvement.toFixed(1)}%`
    );
  });

  console.log('');
  console.log('');

  // 详细分析各策略保留/过滤的代币
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    各策略详细对比                                          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 对每个代币，显示它在各策略中是否被保留
  console.log('代币                      收益%    当前    优化1   优化2   优化3');
  console.log('─'.repeat(70));

  tokenAnalyses.sort((a, b) => b.profitPercent - a.profitPercent);

  tokenAnalyses.forEach(t => {
    const profitColor = t.profitPercent >= 0 ? '\x1b[32m' : '\x1b[31m';
    const resetColor = '\x1b[0m';

    const current = currentStrategy(t) ? '✓' : '✗';
    const opt1 = optimizedStrategy1(t) ? '✓' : '✗';
    const opt2 = optimizedStrategy2(t) ? '✓' : '✗';
    const opt3 = optimizedStrategy3(t) ? '✓' : '✗';

    const currentColor = current === '✓' ? '\x1b[32m' : '\x1b[90m';
    const opt1Color = opt1 === '✓' ? '\x1b[32m' : '\x1b[90m';
    const opt2Color = opt2 === '✓' ? '\x1b[32m' : '\x1b[90m';
    const opt3Color = opt3 === '✓' ? '\x1b[32m' : '\x1b[90m';

    console.log(
      (t.token_symbol.padEnd(24)) +
      profitColor + t.profitPercent.toFixed(2).padStart(8) + '%' + resetColor +
      currentColor + current.padStart(7) + resetColor +
      opt1Color + opt1.padStart(7) + resetColor +
      opt2Color + opt2.padStart(7) + resetColor +
      opt3Color + opt3.padStart(7) + resetColor
    );
  });

  console.log('');
  console.log('图例: ✓ = 保留该交易, ✗ = 过滤该交易');
  console.log('');

  // 分析各策略过滤掉的代币
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    各策略过滤分析                                          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const analyzeFiltered = (strategy, strategyName) => {
    const filtered = tokenAnalyses.filter(strategy);
    const filteredOut = tokenAnalyses.filter(t => !strategy(t));

    const profitableFilteredOut = filteredOut.filter(t => t.profitPercent > 0);
    const lossFilteredOut = filteredOut.filter(t => t.profitPercent < 0);

    console.log(`【${strategyName}】`);
    console.log(`  保留: ${filtered.length} 个, 过滤: ${filteredOut.length} 个`);
    if (profitableFilteredOut.length > 0) {
      const avgProfit = profitableFilteredOut.reduce((sum, t) => sum + t.profitPercent, 0) / profitableFilteredOut.length;
      const totalLost = profitableFilteredOut.reduce((sum, t) => sum + t.profit, 0);
      console.log(`  过滤的盈利代币: ${profitableFilteredOut.length} 个, 平均收益 ${avgProfit.toFixed(2)}%, 损失收益 ${totalLost.toFixed(3)} BNB`);
      profitableFilteredOut.forEach(t => {
        console.log(`    - ${t.token_symbol}: ${t.profitPercent.toFixed(2)}%`);
      });
    }
    if (lossFilteredOut.length > 0) {
      const avgLoss = lossFilteredOut.reduce((sum, t) => sum + t.profitPercent, 0) / lossFilteredOut.length;
      const totalSaved = Math.abs(lossFilteredOut.reduce((sum, t) => sum + t.profit, 0));
      console.log(`  过滤的亏损代币: ${lossFilteredOut.length} 个, 平均亏损 ${avgLoss.toFixed(2)}%, 节省损失 ${totalSaved.toFixed(3)} BNB`);
    }
    console.log('');
  };

  analyzeFiltered(currentStrategy, '当前策略');
  analyzeFiltered(optimizedStrategy1, '优化1: 温和优化');
  analyzeFiltered(optimizedStrategy3, '优化3: 平衡优化 (推荐)');

  // 最终建议
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    最终建议                                                ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const opt1Filtered = tokenAnalyses.filter(optimizedStrategy1);
  const opt1Prof = opt1Filtered.filter(t => t.profitPercent > 0);
  const opt1Avg = opt1Filtered.reduce((sum, t) => sum + t.profitPercent, 0) / opt1Filtered.length;
  const opt1Total = opt1Filtered.reduce((sum, t) => sum + t.profit, 0);
  const opt1WinRate = (opt1Prof.length / opt1Filtered.length * 100);

  const opt3Filtered = tokenAnalyses.filter(optimizedStrategy3);
  const opt3Prof = opt3Filtered.filter(t => t.profitPercent > 0);
  const opt3Avg = opt3Filtered.reduce((sum, t) => sum + t.profitPercent, 0) / opt3Filtered.length;
  const opt3Total = opt3Filtered.reduce((sum, t) => sum + t.profit, 0);
  const opt3WinRate = (opt3Prof.length / opt3Filtered.length * 100);

  console.log('【优化1: 温和优化】');
  console.log(`  交易数: ${opt1Filtered.length} (减少 ${tokenAnalyses.length - opt1Filtered.length} 个)`);
  console.log(`  胜率: ${opt1WinRate.toFixed(1)}% (当前 40.0%)`);
  console.log(`  平均收益: ${opt1Avg.toFixed(2)}% (当前 18.51%)`);
  console.log(`  总收益: ${opt1Total.toFixed(3)} BNB (当前 2.777 BNB)`);
  console.log(`  收益提升: ${((opt1Total - 2.777) / 2.777 * 100).toFixed(1)}%`);
  console.log('');

  console.log('【优化3: 平衡优化 (推荐)】');
  console.log(`  交易数: ${opt3Filtered.length} (减少 ${tokenAnalyses.length - opt3Filtered.length} 个)`);
  console.log(`  胜率: ${opt3WinRate.toFixed(1)}% (当前 40.0%)`);
  console.log(`  平均收益: ${opt3Avg.toFixed(2)}% (当前 18.51%)`);
  console.log(`  总收益: ${opt3Total.toFixed(3)} BNB (当前 2.777 BNB)`);
  console.log(`  收益提升: ${((opt3Total - 2.777) / 2.777 * 100).toFixed(1)}%`);
  console.log('');

  console.log('【推荐配置】');
  console.log('trendCV > 0.02 AND');
  console.log('trendSlope > 0.02 AND');
  console.log('trendStrengthScore >= 40 AND');
  console.log('trendTotalReturn >= 10 AND');
  console.log('earlyReturn > 80 AND');
  console.log('trendRecentDownRatio < 0.6 AND');
  console.log('drawdownFromHighest > -25 AND');
  console.log('age > 1.2 AND age <= 2.2 AND');
  console.log('trendRiseRatio >= 0.7 AND');
  console.log('tvl >= 5000');

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
}

validateOptimization().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('分析失败:', error);
  process.exit(1);
});
