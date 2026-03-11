/**
 * 对比源实验和回测实验的差异
 * 分析添加 age > 3 条件后的效果
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

const sourceExperimentId = '543f039c-c1bd-45ba-94fa-b1490c123513';
const backtestExperimentId = '2ff48af1-9ce0-4134-ae60-7a98efdadb11';

async function compareExperiments() {
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    实验对比分析                                          ║');
  console.log('║         源实验 vs 回测实验 (添加 age > 3 条件)                         ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 获取两个实验的交易数据
  const [sourceTradesRes, backtestTradesRes] = await Promise.all([
    supabase.from('trades').select('*').eq('experiment_id', sourceExperimentId),
    supabase.from('trades').select('*').eq('experiment_id', backtestExperimentId)
  ]);

  const sourceTrades = sourceTradesRes.data || [];
  const backtestTrades = backtestTradesRes.data || [];

  // 计算每个实验的代币收益
  const calcTokenPnL = (trades) => {
    const groups = new Map();
    trades.forEach(t => {
      if (!groups.has(t.token_address)) groups.set(t.token_address, []);
      groups.get(t.token_address).push(t);
    });

    const results = [];
    for (const [addr, tokenTrades] of groups) {
      tokenTrades.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const buys = tokenTrades.filter(t => t.trade_direction === 'buy');
      const sells = tokenTrades.filter(t => t.trade_direction === 'sell');

      if (buys.length === 0) continue;

      const firstBuy = buys[0];
      const totalBuy = buys.reduce((sum, t) => sum + (t.input_amount || 0), 0);
      const totalSell = sells.reduce((sum, t) => sum + (t.output_amount || 0), 0);
      const profit = totalSell - totalBuy;
      const profitPercent = (profit / totalBuy) * 100;

      results.push({
        symbol: firstBuy.token_symbol,
        addr,
        profitPercent,
        profit,
        buyAge: firstBuy.metadata?.factors?.trendFactors?.age || 0
      });
    }
    return results;
  };

  const sourceTokens = calcTokenPnL(sourceTrades);
  const backtestTokens = calcTokenPnL(backtestTrades);

  // 找出被过滤掉的代币
  const backtestAddresses = new Set(backtestTokens.map(t => t.addr));
  const filteredTokens = sourceTokens.filter(t => !backtestAddresses.has(t.addr));

  console.log('【实验对比总览】\n');
  console.log('指标                源实验      回测实验    变化');
  console.log('─'.repeat(55));
  console.log(`交易数              ${sourceTokens.length.toString().padStart(8)}  ${backtestTokens.length.toString().padStart(8)}  ${(backtestTokens.length - sourceTokens.length) > 0 ? '+' : ''}${backtestTokens.length - sourceTokens.length}`);
  console.log(`胜率                ${(sourceTokens.filter(t => t.profitPercent > 0).length / sourceTokens.length * 100).toFixed(1).padStart(8)}%  ${(backtestTokens.filter(t => t.profitPercent > 0).length / backtestTokens.length * 100).toFixed(1).padStart(8)}%  ${((backtestTokens.filter(t => t.profitPercent > 0).length / backtestTokens.length * 100) - (sourceTokens.filter(t => t.profitPercent > 0).length / sourceTokens.length * 100)).toFixed(1)}%`);

  const sourceTotalProfit = sourceTokens.reduce((sum, t) => sum + t.profit, 0);
  const backtestTotalProfit = backtestTokens.reduce((sum, t) => sum + t.profit, 0);
  console.log(`总盈亏 (BNB)        ${sourceTotalProfit.toFixed(4).padStart(8)}  ${backtestTotalProfit.toFixed(4).padStart(8)}  ${(backtestTotalProfit - sourceTotalProfit) > 0 ? '+' : ''}${(backtestTotalProfit - sourceTotalProfit).toFixed(4)}`);
  console.log(`总收益率            ${(sourceTokens.reduce((sum, t) => sum + t.profitPercent, 0) / sourceTokens.length).toFixed(2).padStart(8)}%  ${(backtestTokens.reduce((sum, t) => sum + t.profitPercent, 0) / backtestTokens.length).toFixed(2).padStart(8)}%  ${((backtestTokens.reduce((sum, t) => sum + t.profitPercent, 0) / backtestTokens.length) - (sourceTokens.reduce((sum, t) => sum + t.profitPercent, 0) / sourceTokens.length)).toFixed(2)}%`);
  console.log('');

  console.log('【被过滤掉的代币】\n');
  console.log(`共过滤掉 ${filteredTokens.length} 个代币\n`);
  console.log('代币              收益率      盈亏BNB    Age');
  console.log('─'.repeat(50));

  filteredTokens.forEach(t => {
    const profitColor = t.profitPercent >= 0 ? '\x1b[32m' : '\x1b[31m';
    const reset = '\x1b[0m';
    console.log(`${t.symbol.padEnd(16)} ${profitColor}${t.profitPercent.toFixed(2).padStart(8)}%${reset} ${(t.profit > 0 ? '+' : '')}${t.profit.toFixed(4).padStart(8)}  ${t.buyAge.toFixed(2)}分钟`);
  });

  console.log('');
  console.log('');

  // 获取代币的人工标注
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', sourceExperimentId);

  const tokenMap = new Map((tokens || []).map(t => [t.token_address, t]));

  console.log('【被过滤代币的详细分析】\n');

  for (const token of filteredTokens) {
    const tokenInfo = tokenMap.get(token.addr);
    const humanJudges = tokenInfo?.human_judges || {};
    const qualityLabel = humanJudges.category
      ? {
          fake_pump: '🎭 流水盘',
          no_user: '👻 无人玩',
          low_quality: '📉 低质量',
          mid_quality: '📊 中质量',
          high_quality: '🚀 高质量'
        }[humanJudges.category] || '❓ 未标注'
      : '❓ 未标注';

    console.log(`【${token.symbol}】`);
    console.log(`  收益: ${token.profitPercent.toFixed(2)}% (${token.profit > 0 ? '+' : ''}${token.profit.toFixed(4)} BNB)`);
    console.log(`  Age: ${token.buyAge.toFixed(2)} 分钟`);
    console.log(`  质量标签: ${qualityLabel}`);
    if (humanJudges.note) {
      console.log(`  标注备注: ${humanJudges.note}`);
    }
    console.log('');
  }

  // 获取源实验的所有代币，看看age分布
  console.log('【源实验代币的Age分布】\n');

  const ageGroups = [
    { name: '0-2分钟', filter: age => age < 2 },
    { name: '2-3分钟', filter: age => age >= 2 && age < 3 },
    { name: '3-5分钟', filter: age => age >= 3 && age < 5 },
    { name: '≥5分钟', filter: age => age >= 5 }
  ];

  ageGroups.forEach(group => {
    const tokensInGroup = sourceTokens.filter(t => group.filter(t.buyAge));
    if (tokensInGroup.length === 0) return;

    const profitable = tokensInGroup.filter(t => t.profitPercent > 0);
    const avgProfit = tokensInGroup.reduce((sum, t) => sum + t.profitPercent, 0) / tokensInGroup.length;

    console.log(`${group.name}: ${tokensInGroup.length}个代币, 胜率${(profitable.length / tokensInGroup.length * 100).toFixed(1)}%, 平均收益${avgProfit.toFixed(2)}%`);
  });

  console.log('');
  console.log('');

  // 结论
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    结论                                                  ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  console.log('【效果对比】');
  console.log(`  ✅ 过滤掉了 ${filteredTokens.length} 个代币`);
  console.log(`  ✅ 胜率提升: +${((backtestTokens.filter(t => t.profitPercent > 0).length / backtestTokens.length * 100) - (sourceTokens.filter(t => t.profitPercent > 0).length / sourceTokens.length * 100)).toFixed(1)}%`);
  console.log(`  ✅ 总收益提升: +${(backtestTotalProfit - sourceTotalProfit).toFixed(4)} BNB (+${((backtestTotalProfit - sourceTotalProfit) / sourceTotalProfit * 100).toFixed(1)}%)`);
  console.log('');

  // 分析被过滤代币是否都是低质量
  const lowQualityCount = filteredTokens.filter(t => {
    const tokenInfo = tokenMap.get(t.addr);
    return tokenInfo?.human_judges?.category === 'low_quality';
  }).length;

  console.log('【被过滤代币的质量分析】');
  console.log(`  低质量代币: ${lowQualityCount} / ${filteredTokens.length} (${(lowQualityCount / filteredTokens.length * 100).toFixed(1)}%)`);

  if (lowQualityCount === filteredTokens.length) {
    console.log('  ✅ 被过滤的代币全部都是低质量代币！');
  } else {
    console.log(`  ⚠️  有 ${filteredTokens.length - lowQualityCount} 个代币不是低质量，但也被过滤了`);
  }
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════════════════');
}

compareExperiments().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
