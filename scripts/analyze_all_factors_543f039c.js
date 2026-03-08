/**
 * 全面分析所有因子的优化效果
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function analyzeAllFactors() {
  const experimentId = '543f039c-c1bd-45ba-94fa-b1490c123513';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    全面分析所有因子的优化效果                              ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 获取交易数据
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  // 按代币分组并计算收益
  const tokenTradeGroups = new Map();
  trades.forEach(trade => {
    if (!tokenTradeGroups.has(trade.token_address)) {
      tokenTradeGroups.set(trade.token_address, []);
    }
    tokenTradeGroups.get(trade.token_address).push(trade);
  });

  const tokens = [];
  for (const [addr, tokenTrades] of tokenTradeGroups) {
    tokenTrades.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const buyTrades = tokenTrades.filter(t => t.trade_direction === 'buy');
    const sellTrades = tokenTrades.filter(t => t.trade_direction === 'sell');

    if (buyTrades.length === 0 || sellTrades.length === 0) continue;

    const firstBuy = buyTrades[0];
    const symbol = firstBuy.token_symbol;

    let totalBuy = 0, totalSell = 0;
    buyTrades.forEach(t => totalBuy += t.input_amount || 0);
    sellTrades.forEach(t => totalSell += t.output_amount || 0);

    const profit = totalSell - totalBuy;
    const profitPercent = (profit / totalBuy) * 100;

    const trend = firstBuy.metadata?.factors?.trendFactors || {};

    tokens.push({
      symbol,
      profitPercent,
      profit,
      ratio: trend.trendRiseRatio || 0,
      earlyReturn: trend.earlyReturn || 0,
      age: trend.age || 0,
      tvl: trend.tvl || 0,
      fdv: trend.fdv || 0,
      holders: trend.holders || 0,
      trendStrength: trend.trendStrengthScore || 0,
      trendCV: trend.trendCV || 0,
      trendSlope: trend.trendSlope || 0,
      trendTotalReturn: trend.trendTotalReturn || 0,
      drawdown: trend.drawdownFromHighest || 0
    });
  }

  const currentTotal = tokens.reduce((sum, t) => sum + t.profit, 0);
  console.log(`当前策略总收益: ${currentTotal.toFixed(4)} BNB (${tokens.length}个代币)\n`);

  // 定义要测试的阈值策略
  const strategies = [
    // trendRiseRatio
    { name: 'ratio >= 0.65', filter: t => t.ratio >= 0.65 },
    { name: 'ratio >= 0.70', filter: t => t.ratio >= 0.70 },
    { name: 'ratio >= 0.75', filter: t => t.ratio >= 0.75 },
    { name: 'ratio >= 0.80', filter: t => t.ratio >= 0.80 },
    { name: 'ratio >= 0.85', filter: t => t.ratio >= 0.85 },

    // earlyReturn
    { name: 'earlyReturn > 100', filter: t => t.earlyReturn > 100 },
    { name: 'earlyReturn > 150', filter: t => t.earlyReturn > 150 },
    { name: 'earlyReturn > 200', filter: t => t.earlyReturn > 200 },
    { name: 'earlyReturn > 250', filter: t => t.earlyReturn > 250 },
    { name: 'earlyReturn > 300', filter: t => t.earlyReturn > 300 },

    // age (上限)
    { name: 'age <= 1.5', filter: t => t.age <= 1.5 },
    { name: 'age <= 2.0', filter: t => t.age <= 2.0 },
    { name: 'age <= 2.5', filter: t => t.age <= 2.5 },
    { name: 'age <= 3.0', filter: t => t.age <= 3.0 },
    { name: 'age <= 4.0', filter: t => t.age <= 4.0 },

    // tvl
    { name: 'tvl >= 6000', filter: t => t.tvl >= 6000 },
    { name: 'tvl >= 7000', filter: t => t.tvl >= 7000 },
    { name: 'tvl >= 8000', filter: t => t.tvl >= 8000 },
    { name: 'tvl >= 9000', filter: t => t.tvl >= 9000 },

    // fdv
    { name: 'fdv >= 10000', filter: t => t.fdv >= 10000 },
    { name: 'fdv >= 12000', filter: t => t.fdv >= 12000 },
    { name: 'fdv >= 14000', filter: t => t.fdv >= 14000 },

    // holders
    { name: 'holders >= 35', filter: t => t.holders >= 35 },
    { name: 'holders >= 40', filter: t => t.holders >= 40 },
    { name: 'holders >= 45', filter: t => t.holders >= 45 },
    { name: 'holders >= 50', filter: t => t.holders >= 50 },

    // trendStrengthScore
    { name: 'strength >= 70', filter: t => t.trendStrength >= 70 },
    { name: 'strength >= 75', filter: t => t.trendStrength >= 75 },
    { name: 'strength >= 80', filter: t => t.trendStrength >= 80 },

    // trendCV
    { name: 'trendCV >= 0.20', filter: t => t.trendCV >= 0.20 },
    { name: 'trendCV >= 0.25', filter: t => t.trendCV >= 0.25 },
    { name: 'trendCV >= 0.30', filter: t => t.trendCV >= 0.30 },

    // trendSlope
    { name: 'slope >= 0.10', filter: t => t.trendSlope >= 0.10 },
    { name: 'slope >= 0.12', filter: t => t.trendSlope >= 0.12 },
    { name: 'slope >= 0.14', filter: t => t.trendSlope >= 0.14 },

    // trendTotalReturn
    { name: 'totalReturn >= 100', filter: t => t.trendTotalReturn >= 100 },
    { name: 'totalReturn >= 150', filter: t => t.trendTotalReturn >= 150 },
    { name: 'totalReturn >= 200', filter: t => t.trendTotalReturn >= 200 },

    // drawdownFromHighest
    { name: 'drawdown > -20', filter: t => t.drawdown > -20 },
    { name: 'drawdown > -15', filter: t => t.drawdown > -15 },
    { name: 'drawdown > -10', filter: t => t.drawdown > -10 },

    // 组合策略
    { name: '组合: ratio>=0.7 + age<=2.5', filter: t => t.ratio >= 0.7 && t.age <= 2.5 },
    { name: '组合: ratio>=0.7 + earlyReturn>200', filter: t => t.ratio >= 0.7 && t.earlyReturn > 200 },
    { name: '组合: ratio>=0.8 + age<=2.0', filter: t => t.ratio >= 0.8 && t.age <= 2.0 },
    { name: '组合: earlyReturn>200 + age<=2.0', filter: t => t.earlyReturn > 200 && t.age <= 2.0 },
    { name: '组合: ratio>=0.7 + tvl>=7000', filter: t => t.ratio >= 0.7 && t.tvl >= 7000 },
    { name: '组合: earlyReturn>150 + age<=2.5', filter: t => t.earlyReturn > 150 && t.age <= 2.5 },
    { name: '组合: earlyReturn>200 + ratio>=0.8', filter: t => t.earlyReturn > 200 && t.ratio >= 0.8 },
  ];

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    单因子优化效果                                          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 按因子分类显示
  const categories = {
    'trendRiseRatio': strategies.filter(s => s.name.startsWith('ratio')),
    'earlyReturn': strategies.filter(s => s.name.startsWith('earlyReturn')),
    'age': strategies.filter(s => s.name.startsWith('age')),
    'tvl': strategies.filter(s => s.name.startsWith('tvl')),
    'fdv': strategies.filter(s => s.name.startsWith('fdv')),
    'holders': strategies.filter(s => s.name.startsWith('holders')),
    'strength': strategies.filter(s => s.name.startsWith('strength')),
    'trendCV': strategies.filter(s => s.name.startsWith('trendCV')),
    'slope': strategies.filter(s => s.name.startsWith('slope')),
    'totalReturn': strategies.filter(s => s.name.startsWith('totalReturn')),
    'drawdown': strategies.filter(s => s.name.startsWith('drawdown')),
  };

  for (const [category, cats] of Object.entries(categories)) {
    console.log(`【${category}】`);
    console.log('');

    const results = cats.map(s => {
      const filtered = tokens.filter(s.filter);
      if (filtered.length === 0) return null;

      const total = filtered.reduce((sum, t) => sum + t.profit, 0);
      const avg = filtered.reduce((sum, t) => sum + t.profitPercent, 0) / filtered.length;
      const winCount = filtered.filter(t => t.profitPercent > 0).length;
      const winRate = (winCount / filtered.length * 100);
      const improvement = ((total - currentTotal) / currentTotal * 100);

      return { name: s.name, count: filtered.length, total, avg, winRate, improvement };
    }).filter(r => r !== null && r.count >= 3); // 至少3个交易

    if (results.length === 0) {
      console.log('  (无符合条件的策略)\n');
      continue;
    }

    // 按收益改善排序
    results.sort((a, b) => b.total - a.total);

    console.log('  策略                        交易数  总收益BNB  改善%   胜率');
    console.log('  ' + '─'.repeat(65));

    results.forEach(r => {
      const color = r.total >= currentTotal ? '\x1b[32m' : '\x1b[31m';
      const reset = '\x1b[0m';
      console.log(`  ${r.name.padEnd(27)} ${r.count.toString().padStart(4)} ${color}${r.total.toFixed(4)}${reset} ${r.improvement >= 0 ? '+' : ''}${r.improvement.toFixed(1).padStart(5)}% ${r.winRate.toFixed(1)}%`);
    });

    console.log('');
  }

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    组合策略效果                                            ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const comboStrategies = strategies.filter(s => s.name.startsWith('组合'));

  const comboResults = comboStrategies.map(s => {
    const filtered = tokens.filter(s.filter);
    if (filtered.length === 0 || filtered.length < 3) return null;

    const total = filtered.reduce((sum, t) => sum + t.profit, 0);
    const avg = filtered.reduce((sum, t) => sum + t.profitPercent, 0) / filtered.length;
    const winCount = filtered.filter(t => t.profitPercent > 0).length;
    const winRate = (winCount / filtered.length * 100);
    const improvement = ((total - currentTotal) / currentTotal * 100);

    return { name: s.name, count: filtered.length, total, avg, winRate, improvement };
  }).filter(r => r !== null);

  comboResults.sort((a, b) => b.total - a.total);

  console.log('  策略                                    交易数  总收益BNB  改善%   胜率');
  console.log('  ' + '─'.repeat(75));

  comboResults.forEach(r => {
    const color = r.total >= currentTotal ? '\x1b[32m' : '\x1b[31m';
    const reset = '\x1b[0m';
    console.log(`  ${r.name.padEnd(40)} ${r.count.toString().padStart(4)} ${color}${r.total.toFixed(4)}${reset} ${r.improvement >= 0 ? '+' : ''}${r.improvement.toFixed(1).padStart(5)}% ${r.winRate.toFixed(1)}%`);
  });

  console.log('');
  console.log('');

  // 找出最佳策略
  const allResults = [
    ...categories['trendRiseRatio'].map(s => {
      const filtered = tokens.filter(s.filter);
      if (filtered.length < 3) return null;
      const total = filtered.reduce((sum, t) => sum + t.profit, 0);
      return { name: s.name, total, count: filtered.length };
    }).filter(r => r !== null),
    ...categories['earlyReturn'].map(s => {
      const filtered = tokens.filter(s.filter);
      if (filtered.length < 3) return null;
      const total = filtered.reduce((sum, t) => sum + t.profit, 0);
      return { name: s.name, total, count: filtered.length };
    }).filter(r => r !== null),
    ...categories['age'].map(s => {
      const filtered = tokens.filter(s.filter);
      if (filtered.length < 3) return null;
      const total = filtered.reduce((sum, t) => sum + t.profit, 0);
      return { name: s.name, total, count: filtered.length };
    }).filter(r => r !== null),
  ].sort((a, b) => b.total - a.total);

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    TOP5 单因子策略                                          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  allResults.slice(0, 5).forEach((r, i) => {
    const improvement = ((r.total - currentTotal) / currentTotal * 100);
    console.log(`${i+1}. ${r.name} - ${r.count}个交易, 总收益 ${r.total.toFixed(4)} BNB (${improvement >= 0 ? '+' : ''}${improvement.toFixed(1)}%)`);
  });

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
}

analyzeAllFactors().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('分析失败:', error);
  process.exit(1);
});
