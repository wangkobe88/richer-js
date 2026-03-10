/**
 * 深度分析交易盈亏与因子关系
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeTradeFactors() {
  const experimentId = '5072373e-b79d-4d66-b471-03c7c72730ec';

  // 获取所有交易
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  // 按代币分组，获取买入时的因子
  const tokenBuyTrades = new Map();

  trades.forEach(trade => {
    if (trade.trade_direction === 'buy' && !tokenBuyTrades.has(trade.token_address)) {
      const factors = trade.metadata?.factors || {};
      tokenBuyTrades.set(trade.token_address, {
        tokenAddress: trade.token_address,
        symbol: trade.token_symbol || trade.token_address.substring(0, 8),
        buyPrice: trade.unit_price,
        trendFactors: factors.trendFactors || {},
        preBuyFactors: factors.preBuyCheckFactors || {},
        buyTime: trade.executed_at || trade.created_at
      });
    }
  });

  // 计算每个代币的盈亏
  const tokenResults = new Map();

  trades.forEach(trade => {
    if (!tokenResults.has(trade.token_address)) {
      tokenResults.set(trade.token_address, {
        tokenAddress: trade.token_address,
        symbol: trade.token_symbol || trade.token_address.substring(0, 8),
        profits: [],
        buyCount: 0,
        sellCount: 0
      });
    }
    const result = tokenResults.get(trade.token_address);
    if (trade.trade_direction === 'buy') {
      result.buyCount++;
    } else if (trade.trade_direction === 'sell') {
      result.sellCount++;
      const profit = trade.metadata?.profitPercent || 0;
      result.profits.push(profit);
    }
  });

  // 合并数据和计算结果
  const results = [];
  tokenResults.forEach((value, key) => {
    const buyTrade = tokenBuyTrades.get(key);
    const avgProfit = value.profits.length > 0
      ? value.profits.reduce((a, b) => a + b, 0) / value.profits.length
      : 0;

    results.push({
      ...value,
      ...buyTrade,
      avgProfit: avgProfit,
      isProfit: avgProfit > 0,
      totalProfit: value.profits.reduce((a, b) => a + b, 0)
    });
  });

  // 统计
  const profitTokens = results.filter(r => r.isProfit);
  const lossTokens = results.filter(r => !r.isProfit);

  const winRate = profitTokens.length / results.length * 100;
  const avgProfit = profitTokens.length > 0 ? profitTokens.reduce((sum, r) => sum + r.avgProfit, 0) / profitTokens.length : 0;
  const avgLoss = lossTokens.length > 0 ? lossTokens.reduce((sum, r) => sum + r.avgProfit, 0) / lossTokens.length : 0;
  const totalReturn = results.reduce((sum, r) => sum + r.avgProfit, 0);

  console.log('=== 回测实验总览 ===\n');
  console.log('总代币数:', results.length);
  console.log('盈利代币:', profitTokens.length);
  console.log('亏损代币:', lossTokens.length);
  console.log('胜率:', winRate.toFixed(1) + '%');
  console.log('平均盈利:', avgProfit.toFixed(1) + '%');
  console.log('平均亏损:', avgLoss.toFixed(1) + '%');
  console.log('盈亏比:', avgLoss !== 0 ? (avgProfit / Math.abs(avgLoss)).toFixed(2) : 'N/A');
  console.log('总收益:', totalReturn.toFixed(1) + '%');
  console.log('');

  // 关键因子对比
  console.log('=== 盈利 vs 亏损 关键因子对比 ===\n');

  const factorsToCompare = [
    { name: 'earlyReturn', key: 'trendFactors', format: '%.1f' },
    { name: 'trendCV', key: 'trendFactors', format: '%.3f' },
    { name: 'trendSlope', key: 'trendFactors', format: '%.3f' },
    { name: 'trendStrengthScore', key: 'trendFactors', format: '%.1f' },
    { name: 'trendTotalReturn', key: 'trendFactors', format: '%.1f' },
    { name: 'trendRecentDownRatio', key: 'trendFactors', format: '%.2f' },
    { name: 'drawdownFromHighest', key: 'trendFactors', format: '%.1f' },
    { name: 'earlyWhaleCount', key: 'preBuyFactors', format: '%.0f' },
    { name: 'earlyWhaleSellRatio', key: 'preBuyFactors', format: '%.2f' },
    { name: 'earlyWhaleHoldRatio', key: 'preBuyFactors', format: '%.2f' },
    { name: 'walletClusterSecondToFirstRatio', key: 'preBuyFactors', format: '%.2f' },
    { name: 'walletClusterMegaRatio', key: 'preBuyFactors', format: '%.2f' },
    { name: 'walletClusterTop2Ratio', key: 'preBuyFactors', format: '%.2f' },
    { name: 'walletClusterMaxBlockBuyRatio', key: 'preBuyFactors', format: '%.2f' },
    { name: 'earlyTradesVolumePerMin', key: 'preBuyFactors', format: '%.0f' },
    { name: 'earlyTradesCountPerMin', key: 'preBuyFactors', format: '%.0f' },
    { name: 'earlyTradesActualSpan', key: 'preBuyFactors', format: '%.0f' },
    { name: 'holderBlacklistCount', key: 'preBuyFactors', format: '%.0f' },
    { name: 'devHoldingRatio', key: 'preBuyFactors', format: '%.1f' },
  ];

  factorsToCompare.forEach(factor => {
    const profitValues = profitTokens
      .map(t => t[factor.key]?.[factor.name])
      .filter(v => v !== undefined && v !== null);

    const lossValues = lossTokens
      .map(t => t[factor.key]?.[factor.name])
      .filter(v => v !== undefined && v !== null);

    if (profitValues.length >= 3 && lossValues.length >= 5) {
      const profitAvg = profitValues.reduce((a, b) => a + b, 0) / profitValues.length;
      const lossAvg = lossValues.reduce((a, b) => a + b, 0) / lossValues.length;

      const profitMin = Math.min(...profitValues);
      const profitMax = Math.max(...profitValues);
      const lossMin = Math.min(...lossValues);
      const lossMax = Math.max(...lossValues);

      const diff = profitAvg - lossAvg;
      const diffPct = lossAvg !== 0 ? (diff / Math.abs(lossAvg) * 100).toFixed(1) : 'N/A';

      console.log(`${factor.name}:`);
      console.log(`  盈利: avg=${formatNum(profitAvg, factor.format)} (range: ${formatNum(profitMin, factor.format)} - ${formatNum(profitMax, factor.format)}, n=${profitValues.length})`);
      console.log(`  亏损: avg=${formatNum(lossAvg, factor.format)} (range: ${formatNum(lossMin, factor.format)} - ${formatNum(lossMax, factor.format)}, n=${lossValues.length})`);
      console.log(`  差异: ${diff > 0 ? '+' : ''}${formatNum(diff, factor.format)} (${diffPct}%)`);
      console.log('');
    }
  });

  // 详细案例
  console.log('=== 盈利案例详情（按盈利排序）===');
  const sortedProfitTokens = [...profitTokens].sort((a, b) => b.avgProfit - a.avgProfit);
  console.log('\n代币          | 盈亏% | earlyReturn | trendCV | strength | whaleCnt | whaleSell | cluster2nd/1st | blacklist');
  console.log('-------------|-------|-------------|---------|----------|----------|-----------|----------------|----------');

  sortedProfitTokens.slice(0, 10).forEach(t => {
    console.log(`  ${t.symbol.padEnd(13)} | ${t.avgProfit.toFixed(1).padStart(5)}% | ${formatNum(t.trendFactors?.earlyReturn, '%.1f').padStart(10)}% | ${formatNum(t.trendFactors?.trendCV, '%.3f').padStart(7)} | ${formatNum(t.trendFactors?.trendStrengthScore, '%.1f').padStart(8)} | ${formatNum(t.preBuyFactors?.earlyWhaleCount, '%.0f').padStart(8)} | ${formatNum(t.preBuyFactors?.earlyWhaleSellRatio, '%.2f').padStart(9)} | ${formatNum(t.preBuyFactors?.walletClusterSecondToFirstRatio, '%.2f').padStart(13)} | ${formatNum(t.preBuyFactors?.holderBlacklistCount, '%.0f').padStart(8)}`);
  });

  console.log('\n=== 亏损案例详情（按亏损排序）===');
  const sortedLossTokens = [...lossTokens].sort((a, b) => a.avgProfit - b.avgProfit);
  console.log('\n代币          | 盈亏% | earlyReturn | trendCV | strength | whaleCnt | whaleSell | cluster2nd/1st | blacklist');
  console.log('-------------|-------|-------------|---------|----------|----------|-----------|----------------|----------');

  sortedLossTokens.slice(0, 15).forEach(t => {
    console.log(`  ${t.symbol.padEnd(13)} | ${t.avgProfit.toFixed(1).padStart(5)}% | ${formatNum(t.trendFactors?.earlyReturn, '%.1f').padStart(10)}% | ${formatNum(t.trendFactors?.trendCV, '%.3f').padStart(7)} | ${formatNum(t.trendFactors?.trendStrengthScore, '%.1f').padStart(8)} | ${formatNum(t.preBuyFactors?.earlyWhaleCount, '%.0f').padStart(8)} | ${formatNum(t.preBuyFactors?.earlyWhaleSellRatio, '%.2f').padStart(9)} | ${formatNum(t.preBuyFactors?.walletClusterSecondToFirstRatio, '%.2f').padStart(13)} | ${formatNum(t.preBuyFactors?.holderBlacklistCount, '%.0f').padStart(8)}`);
  });

  // 高风险模式分析
  console.log('\n=== 高风险模式分析 ===\n');

  // 模式1: earlyWhaleCount = 0
  const zeroWhaleProfit = profitTokens.filter(t => t.preBuyFactors?.earlyWhaleCount === 0).length;
  const zeroWhaleLoss = lossTokens.filter(t => t.preBuyFactors?.earlyWhaleCount === 0).length;
  const zeroWhaleTotal = zeroWhaleProfit + zeroWhaleLoss;

  if (zeroWhaleTotal > 0) {
    console.log(`[模式1] earlyWhaleCount = 0:`);
    console.log(`  盈利: ${zeroWhaleProfit}/${zeroWhaleTotal} (${(zeroWhaleProfit/zeroWhaleTotal*100).toFixed(1)}%)`);
    console.log(`  亏损: ${zeroWhaleLoss}/${zeroWhaleTotal} (${(zeroWhaleLoss/zeroWhaleTotal*100).toFixed(1)}%)`);
    if (zeroWhaleLoss > zeroWhaleProfit) {
      console.log(`  ⚠️  亏损率较高，建议过滤`);
    }
    console.log('');
  }

  // 模式2: walletClusterSecondToFirstRatio > 0.2
  const highClusterProfit = profitTokens.filter(t => (t.preBuyFactors?.walletClusterSecondToFirstRatio || 0) > 0.2).length;
  const highClusterLoss = lossTokens.filter(t => (t.preBuyFactors?.walletClusterSecondToFirstRatio || 0) > 0.2).length;
  const highClusterTotal = highClusterProfit + highClusterLoss;

  if (highClusterTotal > 0) {
    console.log(`[模式2] walletClusterSecondToFirstRatio > 0.2:`);
    console.log(`  盈利: ${highClusterProfit}/${highClusterTotal} (${(highClusterProfit/highClusterTotal*100).toFixed(1)}%)`);
    console.log(`  亏损: ${highClusterLoss}/${highClusterTotal} (${(highClusterLoss/highClusterTotal*100).toFixed(1)}%)`);
    if (highClusterLoss > highClusterProfit) {
      console.log(`  ⚠️  亏损率较高，建议过滤`);
    }
    console.log('');
  }

  // 模式3: holderBlacklistCount > 0
  const blacklistProfit = profitTokens.filter(t => (t.preBuyFactors?.holderBlacklistCount || 0) > 0).length;
  const blacklistLoss = lossTokens.filter(t => (t.preBuyFactors?.holderBlacklistCount || 0) > 0).length;
  const blacklistTotal = blacklistProfit + blacklistLoss;

  if (blacklistTotal > 0) {
    console.log(`[模式3] holderBlacklistCount > 0:`);
    console.log(`  盈利: ${blacklistProfit}/${blacklistTotal} (${(blacklistProfit/blacklistTotal*100).toFixed(1)}%)`);
    console.log(`  亏损: ${blacklistLoss}/${blacklistTotal} (${(blacklistLoss/blacklistTotal*100).toFixed(1)}%)`);
    if (blacklistLoss > blacklistProfit) {
      console.log(`  ⚠️  亏损率较高，建议过滤`);
    }
    console.log('');
  }

  // 模式4: earlyReturn 范围
  console.log(`[模式4] earlyReturn 范围分析:`);
  const returnRanges = [
    { name: '低 (15-40%)', min: 15, max: 40 },
    { name: '中低 (40-60%)', min: 40, max: 60 },
    { name: '中高 (60-80%)', min: 60, max: 80 },
    { name: '高 (80-120%)', min: 80, max: 120 },
    { name: '极高 (120%+)', min: 120, max: Infinity }
  ];

  returnRanges.forEach(range => {
    const inRangeProfit = profitTokens.filter(t => {
      const r = t.trendFactors?.earlyReturn || 0;
      return r >= range.min && r < range.max;
    }).length;
    const inRangeLoss = lossTokens.filter(t => {
      const r = t.trendFactors?.earlyReturn || 0;
      return r >= range.min && r < range.max;
    }).length;
    const total = inRangeProfit + inRangeLoss;
    if (total >= 3) {
      const winRate = inRangeProfit / total * 100;
      console.log(`  ${range.name}: 盈利 ${inRangeProfit}/${total} (${winRate.toFixed(1)}%), 亏损 ${inRangeLoss}/${total}`);
    }
  });

  // 优化建议
  console.log('\n=== 优化建议 ===\n');
  generateOptimizationSuggestions(profitTokens, lossTokens);
}

function formatNum(num, format) {
  if (num === undefined || num === null) return 'N/A';
  const decimals = format.match(/\.(\d+)/)?.[1]?.length || 2;
  return num.toFixed(decimals);
}

function generateOptimizationSuggestions(profitTokens, lossTokens) {
  const suggestions = [];

  // 分析1: earlyWhaleCount = 0
  const zeroWhaleInLoss = lossTokens.filter(t => t.preBuyFactors?.earlyWhaleCount === 0);
  const zeroWhaleInProfit = profitTokens.filter(t => t.preBuyFactors?.earlyWhaleCount === 0);
  const zeroWhaleTotal = zeroWhaleInLoss.length + zeroWhaleInProfit.length;

  if (zeroWhaleTotal >= 3) {
    const lossRate = zeroWhaleInLoss.length / zeroWhaleTotal;
    if (lossRate > 0.6) {
      const avgLoss = zeroWhaleInLoss.reduce((sum, t) => sum + t.avgProfit, 0) / zeroWhaleInLoss.length;
      const avgProfit = zeroWhaleInProfit.length > 0 ? zeroWhaleInProfit.reduce((sum, t) => sum + t.avgProfit, 0) / zeroWhaleInProfit.length : 0;
      suggestions.push({
        priority: 'MEDIUM',
        issue: `earlyWhaleCount=0 的代币亏损率 ${(lossRate*100).toFixed(1)}% (${zeroWhaleInLoss.length}/${zeroWhaleTotal})`,
        current: `当前: 亏损平均 ${avgLoss.toFixed(1)}%, 盈利平均 ${avgProfit.toFixed(1)}%`,
        suggestion: '考虑增加条件：earlyWhaleCount >= 1',
        impact: `可过滤 ${zeroWhaleInLoss.length} 个亏损案例，但也会过滤 ${zeroWhaleInProfit.length} 个盈利案例`
      });
    }
  }

  // 分析2: walletClusterSecondToFirstRatio
  const clusterThresholds = [0.15, 0.2, 0.25, 0.3];
  clusterThresholds.forEach(threshold => {
    const highClusterInLoss = lossTokens.filter(t => (t.preBuyFactors?.walletClusterSecondToFirstRatio || 0) > threshold);
    const highClusterInProfit = profitTokens.filter(t => (t.preBuyFactors?.walletClusterSecondToFirstRatio || 0) > threshold);
    const total = highClusterInLoss.length + highClusterInProfit.length;

    if (total >= 3) {
      const lossRate = highClusterInLoss.length / total;
      if (lossRate > 0.65) {
        const avgLoss = highClusterInLoss.reduce((sum, t) => sum + t.avgProfit, 0) / highClusterInLoss.length;
        suggestions.push({
          priority: 'HIGH',
          issue: `walletClusterSecondToFirstRatio > ${threshold} 的代币亏损率 ${(lossRate*100).toFixed(1)}%`,
          suggestion: `收紧条件为：walletClusterSecondToFirstRatio <= ${threshold}`,
          impact: `可过滤 ${highClusterInLoss.length} 个亏损案例，平均亏损 ${avgLoss.toFixed(1)}%，也会过滤 ${highClusterInProfit.length} 个盈利案例`
        });
      }
    }
  });

  // 分析3: holderBlacklistCount
  const blacklistInLoss = lossTokens.filter(t => (t.preBuyFactors?.holderBlacklistCount || 0) > 0);
  const blacklistInProfit = profitTokens.filter(t => (t.preBuyFactors?.holderBlacklistCount || 0) > 0);
  const blacklistTotal = blacklistInLoss.length + blacklistInProfit.length;

  if (blacklistTotal >= 3) {
    const lossRate = blacklistInLoss.length / blacklistTotal;
    if (lossRate > 0.6) {
      const avgLoss = blacklistInLoss.reduce((sum, t) => sum + t.avgProfit, 0) / blacklistInLoss.length;
      suggestions.push({
        priority: 'HIGH',
        issue: `holderBlacklistCount > 0 的代币亏损率 ${(lossRate*100).toFixed(1)}% (${blacklistInLoss.length}/${blacklistTotal})`,
        suggestion: '收紧条件为：holderBlacklistCount = 0',
        impact: `可过滤 ${blacklistInLoss.length} 个亏损案例，也会过滤 ${blacklistInProfit.length} 个盈利案例`
      });
    }
  }

  // 分析4: earlyReturn 过高
  const highReturnInLoss = lossTokens.filter(t => (t.trendFactors?.earlyReturn || 0) > 100);
  const highReturnInProfit = profitTokens.filter(t => (t.trendFactors?.earlyReturn || 0) > 100);
  const highReturnTotal = highReturnInLoss.length + highReturnInProfit.length;

  if (highReturnTotal >= 3) {
    const lossRate = highReturnInLoss.length / highReturnTotal;
    if (lossRate > 0.6) {
      suggestions.push({
        priority: 'MEDIUM',
        issue: `earlyReturn > 100% 的代币亏损率 ${(lossRate*100).toFixed(1)}%`,
        suggestion: '限制 earlyReturn 上限：earlyReturn < 100',
        impact: `可过滤 ${highReturnInLoss.length} 个亏损案例，也会过滤 ${highReturnInProfit.length} 个盈利案例`
      });
    }
  }

  // 显示建议
  if (suggestions.length === 0) {
    console.log('✓ 当前条件已经比较优化，暂无明显改进建议');
  } else {
    suggestions.sort((a, b) => {
      const order = { 'HIGH': 0, 'MEDIUM': 1, 'LOW': 2 };
      return order[a.priority] - order[b.priority];
    });

    suggestions.forEach((s, i) => {
      console.log(`[${s.priority}] ${s.issue}`);
      if (s.current) console.log(`  ${s.current}`);
      console.log(`  建议: ${s.suggestion}`);
      console.log(`  影响: ${s.impact}`);
      console.log('');
    });
  }
}

analyzeTradeFactors().catch(console.error);
