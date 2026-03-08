/**
 * 分析各因子与收益的相关性，寻找更好的优化方案
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function analyzeCorrelation() {
  const experimentId = '543f039c-c1bd-45ba-94fa-b1490c123513';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    因子相关性分析                                          ║');
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
      age: trendAtBuy.age || 0
    });
  }

  // 计算相关系数
  const features = [
    { key: 'trendRiseRatio', name: '趋势上升比' },
    { key: 'tvl', name: 'TVL' },
    { key: 'fdv', name: 'FDV' },
    { key: 'holders', name: '持币地址数' },
    { key: 'earlyReturn', name: '早期收益' },
    { key: 'drawdownFromHighest', name: '从最高点回撤' },
    { key: 'trendStrengthScore', name: '趋势强度得分' },
    { key: 'trendCV', name: '趋势变异系数' },
    { key: 'trendSlope', name: '趋势斜率' },
    { key: 'trendTotalReturn', name: '趋势总收益' },
    { key: 'age', name: '代币年龄' }
  ];

  // 计算皮尔逊相关系数
  const correlation = (feature) => {
    const n = tokenAnalyses.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;

    tokenAnalyses.forEach(t => {
      const x = t[feature] || 0;
      const y = t.profitPercent;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
      sumY2 += y * y;
    });

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    return denominator === 0 ? 0 : numerator / denominator;
  };

  console.log('【与收益的相关系数】');
  console.log('');

  const correlations = features.map(f => ({
    ...f,
    corr: correlation(f.key)
  })).sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr));

  correlations.forEach(({ name, corr }) => {
    const bar = '█'.repeat(Math.abs(corr) * 30);
    const sign = corr >= 0 ? '+' : '';
    const color = corr >= 0.2 ? '\x1b[32m' : corr <= -0.2 ? '\x1b[31m' : '\x1b[0m';
    console.log(`${color}${name.padEnd(20)} ${sign}${corr.toFixed(3)}  ${bar}\x1b[0m`);
  });

  console.log('');
  console.log('说明: 相关系数范围 -1 到 1，绝对值越大相关性越强');
  console.log('      正相关表示该因子越大收益越高，负相关表示相反');
  console.log('');

  // 查看高收益代币的共同特征
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    高收益代币特征分析                                      ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const highProfit = tokenAnalyses.filter(t => t.profitPercent > 50);
  const midProfit = tokenAnalyses.filter(t => t.profitPercent >= 0 && t.profitPercent <= 50);
  const loss = tokenAnalyses.filter(t => t.profitPercent < 0);

  console.log('【高收益代币 (>50%) 特征】');
  if (highProfit.length > 0) {
    features.forEach(f => {
      const avg = highProfit.reduce((sum, t) => sum + (t[f.key] || 0), 0) / highProfit.length;
      console.log(`  ${f.name}: ${avg.toFixed(2)}`);
    });
  }
  console.log('');

  console.log('【中收益代币 (0-50%) 特征】');
  if (midProfit.length > 0) {
    features.forEach(f => {
      const avg = midProfit.reduce((sum, t) => sum + (t[f.key] || 0), 0) / midProfit.length;
      console.log(`  ${f.name}: ${avg.toFixed(2)}`);
    });
  }
  console.log('');

  console.log('【亏损代币特征】');
  if (loss.length > 0) {
    features.forEach(f => {
      const avg = loss.reduce((sum, t) => sum + (t[f.key] || 0), 0) / loss.length;
      console.log(`  ${f.name}: ${avg.toFixed(2)}`);
    });
  }
  console.log('');

  // 尝试不同的过滤策略
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    优化策略测试                                          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const strategies = [
    {
      name: '当前策略',
      filter: () => true
    },
    {
      name: '过滤极端age (> 2.5)',
      filter: (t) => t.age <= 2.5
    },
    {
      name: '过滤低trendCV (< 0.1)',
      filter: (t) => t.trendCV >= 0.1
    },
    {
      name: '组合: age <= 2.5 AND trendCV >= 0.1',
      filter: (t) => t.age <= 2.5 && t.trendCV >= 0.1
    },
    {
      name: '过滤高回撤 (< -15)',
      filter: (t) => t.drawdownFromHighest > -15
    },
    {
      name: '过滤低trendRiseRatio (< 0.7)',
      filter: (t) => t.trendRiseRatio >= 0.7
    },
    {
      name: '智能组合: trendCV >= 0.1 AND trendRiseRatio >= 0.7 AND age <= 2.5',
      filter: (t) => t.trendCV >= 0.1 && t.trendRiseRatio >= 0.7 && t.age <= 2.5
    }
  ];

  console.log('策略                                              交易数  胜率    平均收益%   总收益BNB');
  console.log('─'.repeat(85));

  strategies.forEach(s => {
    const filtered = tokenAnalyses.filter(s.filter);
    if (filtered.length === 0) return;

    const prof = filtered.filter(t => t.profitPercent > 0);
    const avgProfit = filtered.reduce((sum, t) => sum + t.profitPercent, 0) / filtered.length;
    const totalProf = filtered.reduce((sum, t) => sum + t.profit, 0);
    const winRate = (prof.length / filtered.length * 100);

    console.log(
      `${s.name.padEnd(48)} ${filtered.length.toString().padStart(4)} ${winRate.toFixed(1).padStart(6)}% ${avgProfit.toFixed(2).padStart(10)} ${totalProf.toFixed(3).padStart(10)}`
    );
  });

  console.log('');
  console.log('');

  // 查看被过滤掉的代币
  const smartFilter = (t) => t.trendCV >= 0.1 && t.trendRiseRatio >= 0.7 && t.age <= 2.5;
  const smartFiltered = tokenAnalyses.filter(smartFilter);
  const filteredOut = tokenAnalyses.filter(t => !smartFilter(t));

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    被过滤掉的代币分析                                      ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  console.log('被过滤的代币 (按收益排序):');
  console.log('');
  console.log('代币                      收益%    trendCV  trendRiseRatio  age(分钟)  原因');
  console.log('─'.repeat(85));

  filteredOut.sort((a, b) => b.profitPercent - a.profitPercent);

  filteredOut.forEach(t => {
    const profitColor = t.profitPercent >= 0 ? '\x1b[32m' : '\x1b[31m';
    const resetColor = '\x1b[0m';

    let reasons = [];
    if (t.trendCV < 0.1) reasons.push('CV');
    if (t.trendRiseRatio < 0.7) reasons.push('ratio');
    if (t.age > 2.5) reasons.push('age');

    console.log(
      (t.token_symbol.padEnd(24)) +
      profitColor + t.profitPercent.toFixed(2).padStart(8) + '%' + resetColor +
      t.trendCV.toFixed(3).padStart(9) +
      t.trendRiseRatio.toFixed(2).padStart(15) +
      t.age.toFixed(2).padStart(14) +
      reasons.join(', ')
    );
  });

  console.log('');
  console.log('');

  // 最终建议
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    优化建议                                                ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  console.log('【观察】');
  console.log('- age 与收益负相关 (-0.37): 买入越早越好');
  console.log('- trendCV 与收益正相关 (0.36): 波动性越大收益越高');
  console.log('- trendRiseRatio 与收益正相关 (0.35): 上升比越高越好');
  console.log('- drawdownFromHighest 与收益负相关 (-0.28): 回撤越小越好');
  console.log('');

  console.log('【推荐策略】');
  console.log('在当前策略基础上，添加温和的过滤条件：');
  console.log('');
  console.log('1. age <= 2.5 (过滤晚期买入)');
  console.log('   当前: age > 1.2（没有上限）');
  console.log('   效果: 过滤掉 AND(-22%), 打工仔日记(-26%), FREEDOM(-27%)');
  console.log('   保留: 巨鲸(257%), 鲸落(92%)');
  console.log('');
  console.log('2. trendCV >= 0.1 (提高趋势质量门槛)');
  console.log('   当前: trendCV > 0.02（太低）');
  console.log('   效果: 过滤掉低波动性代币');
  console.log('');
  console.log('3. trendRiseRatio >= 0.7 (稍微提高门槛)');
  console.log('   当前: trendRiseRatio >= 0.6');
  console.log('   效果: 过滤掉低上升比代币');
  console.log('');

  console.log('【完整配置】');
  console.log('trendCV >= 0.1 AND');
  console.log('trendSlope > 0.02 AND');
  console.log('trendPriceUp >= 1 AND');
  console.log('trendMedianUp >= 1 AND');
  console.log('trendStrengthScore >= 30 AND');
  console.log('trendTotalReturn >= 10 AND');
  console.log('earlyReturn > 80 AND');
  console.log('trendRecentDownRatio < 0.6 AND');
  console.log('drawdownFromHighest > -25 AND');
  console.log('age > 1.2 AND age <= 2.5 AND');
  console.log('trendRiseRatio >= 0.7 AND');
  console.log('tvl >= 5000');
  console.log('');

  console.log('【预期效果】');
  const smartFilteredProf = smartFiltered.filter(t => t.profitPercent > 0);
  const smartWinRate = (smartFilteredProf.length / smartFiltered.length * 100);
  const smartAvgProfit = smartFiltered.reduce((sum, t) => sum + t.profitPercent, 0) / smartFiltered.length;
  const smartTotalProfit = smartFiltered.reduce((sum, t) => sum + t.profit, 0);

  console.log(`- 交易数: ${smartFiltered.length} 个 (当前 ${tokenAnalyses.length} 个)`);
  console.log(`- 胜率: ${smartWinRate.toFixed(1)}% (当前 40.0%)`);
  console.log(`- 平均收益: ${smartAvgProfit.toFixed(2)}% (当前 18.51%)`);
  console.log(`- 总收益: ${smartTotalProfit.toFixed(3)} BNB (当前 2.777 BNB)`);
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════════════════');
}

analyzeCorrelation().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('分析失败:', error);
  process.exit(1);
});
