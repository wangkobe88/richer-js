/**
 * 深度分析 trendCV 因子
 * 1. trendCV 偏低的原因
 * 2. 加入 trendCV 过滤条件对好票的影响
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function analyzeTrendCV() {
  const experimentId = '543f039c-c1bd-45ba-94fa-b1490c123513';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    trendCV 因子深度分析                                       ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 获取交易数据
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  // 获取代币数据
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId);

  // 计算每个代币的收益
  const tokenTradeGroups = new Map();
  trades.forEach(trade => {
    if (!tokenTradeGroups.has(trade.token_address)) {
      tokenTradeGroups.set(trade.token_address, []);
    }
    tokenTradeGroups.get(trade.token_address).push(trade);
  });

  const tokenData = [];
  for (const [addr, tokenTrades] of tokenTradeGroups) {
    tokenTrades.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const buyTrades = tokenTrades.filter(t => t.trade_direction === 'buy');
    const sellTrades = tokenTrades.filter(t => t.trade_direction === 'sell');

    if (buyTrades.length === 0) continue;

    const firstBuy = buyTrades[0];
    const symbol = firstBuy.token_symbol;

    let totalBuy = 0, totalSell = 0;
    buyTrades.forEach(t => totalBuy += t.input_amount || 0);
    sellTrades.forEach(t => totalSell += t.output_amount || 0);

    const profit = totalSell - totalBuy;
    const profitPercent = (profit / totalBuy) * 100;

    const trendFactors = firstBuy.metadata?.factors?.trendFactors || {};

    // 获取人工标注
    const tokenInfo = tokens?.find(t => t.token_address === addr);
    const humanJudges = tokenInfo?.human_judges || {};
    const qualityLabel = humanJudges.category
      ? { fake_pump: '🎭流水盘', no_user: '👻无人玩', low_quality: '📉低质量', mid_quality: '📊中质量', high_quality: '🚀高质量' }[humanJudges.category] || '❓未标注'
      : '❓未标注';

    tokenData.push({
      symbol,
      addr,
      profitPercent,
      profit,
      hasSell: sellTrades.length > 0,
      qualityLabel,
      qualityCategory: humanJudges.category,
      trendCV: trendFactors.trendCV || 0,
      trendSlope: trendFactors.trendSlope || 0,
      trendRiseRatio: trendFactors.trendRiseRatio || 0,
      age: trendFactors.age || 0,
      earlyReturn: trendFactors.earlyReturn || 0,
      highestPrice: trendFactors.highestPrice || 0,
      buyPrice: firstBuy.unit_price || 0
    });
  }

  // 按收益分组
  const profitable = tokenData.filter(t => t.profitPercent > 0);
  const loss = tokenData.filter(t => t.profitPercent <= 0);

  console.log('【trendCV 分布分析】\n');
  console.log('trendCV区间        盈利代币数  亏损代币数  盈利平均收益%  亏损平均收益%  分析');
  console.log('─'.repeat(90));

  const cvBuckets = [
    { min: 0, max: 0.1, label: '0.00-0.10' },
    { min: 0.1, max: 0.15, label: '0.10-0.15' },
    { min: 0.15, max: 0.2, label: '0.15-0.20' },
    { min: 0.2, max: 0.25, label: '0.20-0.25' },
    { min: 0.25, max: 0.3, label: '0.25-0.30' },
    { min: 0.3, max: 0.4, label: '0.30-0.40' },
    { min: 0.4, max: Infinity, label: '≥0.40' }
  ];

  cvBuckets.forEach(bucket => {
    const profitInBucket = profitable.filter(t => t.trendCV >= bucket.min && t.trendCV < bucket.max);
    const lossInBucket = loss.filter(t => t.trendCV >= bucket.min && t.trendCV < bucket.max);

    if (profitInBucket.length === 0 && lossInBucket.length === 0) return;

    const profitAvg = profitInBucket.length > 0
      ? profitInBucket.reduce((sum, t) => sum + t.profitPercent, 0) / profitInBucket.length
      : 0;
    const lossAvg = lossInBucket.length > 0
      ? lossInBucket.reduce((sum, t) => sum + t.profitPercent, 0) / lossInBucket.length
      : 0;

    const profitCount = profitInBucket.length;
    const lossCount = lossInBucket.length;
    const profitWinRate = profitCount > 0 ? (profitInBucket.filter(t => t.profitPercent > 50).length / profitCount * 100) : 0;

    console.log(`${bucket.label.padEnd(14)} ${profitCount.toString().padStart(10)} ${lossCount.toString().padStart(10)} ${profitAvg.toFixed(2).padStart(12)} ${lossAvg.toFixed(2).padStart(12)}  盈利大收益>${profitWinRate.toFixed(1)}%`);
  });

  console.log('');
  console.log('');

  // 详细列出盈利代币的trendCV
  console.log('【所有代币的trendCV详情】\n');
  console.log('代币              收益%      trendCV   trendSlope  age    earlyReturn  质量        标注');
  console.log('─'.repeat(100));

  tokenData.sort((a, b) => b.trendCV - a.trendCV).forEach(t => {
    const profitStr = t.profitPercent.toFixed(2).padStart(8);
    const cvStr = t.trendCV.toFixed(3).padStart(8);
    const slopeStr = t.trendSlope.toFixed(3).padStart(10);
    const ageStr = t.age.toFixed(2).padStart(6);
    const erStr = t.earlyReturn.toFixed(1).padStart(10);
    const qualityStr = `${t.qualityLabel} (${t.qualityCategory || '未标注'})`;

    // 标记低trendCV
    const cvMark = t.trendCV < 0.2 ? ' ⚠️低CV' : '';

    console.log(`${t.symbol.padEnd(16)} ${profitStr}%  ${cvStr}  ${slopeStr}  ${ageStr}  ${erStr}  ${qualityStr.padEnd(20)}${cvMark}`);
  });

  console.log('');
  console.log('');

  // 测试不同trendCV阈值的影响
  console.log('【测试不同trendCV阈值的影响】\n');

  const thresholds = [0.1, 0.15, 0.18, 0.2, 0.22, 0.25];

  console.log('trendCV阈值    过滤后总数  过滤掉盈利  过滤掉亏损  盈利代币平均收益%  亏损代币平均收益%');
  console.log('─'.repeat(95));

  thresholds.forEach(threshold => {
    const filtered = tokenData.filter(t => t.trendCV >= threshold);
    const filteredProfit = filtered.filter(t => t.profitPercent > 0);
    const filteredLoss = filtered.filter(t => t.profitPercent <= 0);

    const originalProfit = profitable.filter(t => t.trendCV >= threshold);
    const originalLoss = loss.filter(t => t.trendCV >= threshold);

    if (filtered.length === 0) return;

    const profitAvg = filteredProfit.length > 0
      ? filteredProfit.reduce((sum, t) => sum + t.profitPercent, 0) / filteredProfit.length
      : 0;
    const lossAvg = filteredLoss.length > 0
      ? filteredLoss.reduce((sum, t) => sum + t.profitPercent, 0) / filteredLoss.length
      : 0;

    // 计算过滤掉的盈利代币
    const lostProfit = profitable.filter(t => t.trendCV < threshold);
    // 计算过滤掉的亏损代币
    const removedLoss = loss.filter(t => t.trendCV < threshold);

    console.log(`>= ${(threshold * 100).toFixed(0)}%        ${filtered.length.toString().padStart(8)}  ${lostProfit.length.toString().padStart(8)}  ${removedLoss.length.toString().padStart(9)}  ${profitAvg.toFixed(2).padStart(14)}  ${lossAvg.toFixed(2).padStart(14)}`);
  });

  console.log('');
  console.log('');

  // 深入分析：trendCV < 0.2 的盈利代币
  console.log('【trendCV < 0.2 的盈利代币分析】\n');

  const lowCVProfit = profitable.filter(t => t.trendCV < 0.2);
  if (lowCVProfit.length > 0) {
    console.log(`发现 ${lowCVProfit.length} 个盈利但trendCV < 0.2的代币:\n`);
    lowCVProfit.forEach(t => {
      console.log(`  ${t.symbol}:`);
      console.log(`    收益: ${t.profitPercent.toFixed(2)}%`);
      console.log(`    trendCV: ${t.trendCV.toFixed(3)} (${t.trendSlope.toFixed(3)})`);
      console.log(`    age: ${t.age.toFixed(2)}分钟, earlyReturn: ${t.earlyReturn.toFixed(1)}%`);
      console.log(`    质量: ${t.qualityLabel}`);
      console.log('');
    });
  } else {
    console.log('✅ 没有盈利代币的trendCV < 0.2');
    console.log('');
  }

  // 分析trendCV与价格走势的关系
  console.log('【trendCV 的含义分析】\n');
  console.log('trendCV (趋势变异系数) = 标准差 / 均值');
  console.log('');
  console.log('含义:');
  console.log('  - trendCV高: 价格波动大，不稳定');
  console.log('  - trendCV低: 价格波动小，相对稳定');
  console.log('');
  console.log('亏损代币trendCV偏低的原因:');
  console.log('  1. 价格走势单调下跌 → 标准差小 → CV低');
  console.log('  2. 买入后立即开始阴跌，没有反弹');
  console.log('  3. 缺乏波动，说明是"单边下跌"而非"震荡下跌"');
  console.log('');
  console.log('盈利代币trendCV较高的原因:');
  console.log('  1. 价格有波动，有上涨也有回调');
  console.log('  2. 反映了真实的市场博弈和供需变化');
  console.log('');

  // 结合trendSlope分析
  console.log('【trendCV + trendSlope 组合分析】\n');

  const profitLowCV = profitable.filter(t => t.trendCV < 0.2);
  const profitHighCV = profitable.filter(t => t.trendCV >= 0.2);
  const lossLowCV = loss.filter(t => t.trendCV < 0.2);
  const lossHighCV = loss.filter(t => t.trendCV >= 0.2);

  const categories = [
    { name: '盈利+trendCV高', data: profitHighCV },
    { name: '盈利+trendCV低', data: profitLowCV },
    { name: '亏损+trendCV高', data: lossHighCV },
    { name: '亏损+trendCV低', data: lossLowCV }
  ];

  console.log('分类                    数量  平均收益%  平均trendCV  平均Slope  分析');
  console.log('─'.repeat(85));

  categories.forEach(cat => {
    if (cat.data.length === 0) return;
    const avgProfit = cat.data.reduce((sum, t) => sum + t.profitPercent, 0) / cat.data.length;
    const avgCV = cat.data.reduce((sum, t) => sum + t.trendCV, 0) / cat.data.length;
    const avgSlope = cat.data.reduce((sum, t) => sum + t.trendSlope, 0) / cat.data.length;

    let analysis = '';
    if (cat.name.includes('高')) {
      analysis = '波动大，';
      if (avgSlope > 0) analysis += '上涨趋势';
      else if (avgSlope < 0) analysis += '下跌趋势';
      else analysis += '震荡';
    } else {
      analysis = '波动小，';
      if (avgSlope > 0) analysis += '稳定上涨';
      else if (avgSlope < 0) analysis += '稳定下跌';
      else analysis += '横盘';
    }

    console.log(`${cat.name.padEnd(22)} ${cat.data.length.toString().padStart(4)}  ${avgProfit.toFixed(2).padStart(10)}  ${avgCV.toFixed(3).padStart(9)}  ${avgSlope.toFixed(3).padStart(8)}  ${analysis}`);
  });

  console.log('');
  console.log('');

  // 最终建议
  console.log('【建议：如何使用trendCV过滤条件】\n');

  const profitLowCVCount = lowCVProfit.length;
  const totalProfit = profitable.length;

  console.log(`当前盈利代币: ${totalProfit}个`);
  console.log(`其中trendCV < 0.2: ${profitLowCVCount}个 (${profitLowCVCount > 0 ? (profitLowCVCount / totalProfit * 100).toFixed(1) : 0}%)`);
  console.log('');

  if (profitLowCVCount > 0) {
    console.log('⚠️  如果使用 trendCV >= 0.2 过滤条件:');
    console.log(`   会过滤掉 ${profitLowCVCount} 个盈利代币:`);
    profitLowCV.forEach(t => {
      console.log(`     - ${t.symbol} (${t.profitPercent.toFixed(2)}%, trendCV=${t.trendCV.toFixed(3)})`);
    });
    console.log('');
  }

  console.log('💡 推荐策略:');
  console.log('   方案1: 保守 - trendCV >= 0.15');
  console.log('     - 可以保留大部分好票');
  console.log('     - 过滤掉部分低CV的亏损代币');
  console.log('');
  console.log('   方案2: 激进 - trendCV >= 0.2');
  console.log('     - 会过滤掉部分好票（需权衡）');
  console.log('     - 更强的风险控制');
  console.log('');
  console.log('   方案3: 结合趋势斜率 - trendCV >= 0.15 AND trendSlope > 0');
  console.log('     - 要求波动大且上涨趋势');
  console.log('     - 过滤掉稳定下跌的代币');

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
}

analyzeTrendCV().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
