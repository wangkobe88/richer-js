/**
 * 从信号数据中获取预检查因子，分析与盈亏的关系
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeWithSignalFactors() {
  const experimentId = '5072373e-b79d-4d66-b471-03c7c72730ec';

  // 获取所有信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  // 获取所有交易
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

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

  // 计算平均盈亏
  const results = [];
  tokenResults.forEach((value, key) => {
    const avgProfit = value.profits.length > 0
      ? value.profits.reduce((a, b) => a + b, 0) / value.profits.length
      : 0;
    results.push({
      ...value,
      avgProfit: avgProfit,
      isProfit: avgProfit > 0
    });
  });

  // 从第一个买入信号获取因子
  const tokenSignals = new Map();

  signals.forEach(s => {
    if (!tokenSignals.has(s.token_address) && s.metadata?.trendFactors) {
      tokenSignals.set(s.token_address, {
        trendFactors: s.metadata?.trendFactors || {},
        preBuyFactors: s.metadata?.preBuyCheckFactors || {},
        executionStatus: s.metadata?.execution_status,
        executionReason: s.metadata?.execution_reason
      });
    }
  });

  // 合并数据
  const finalResults = results.map(r => ({
    ...r,
    ...tokenSignals.get(r.tokenAddress)
  }));

  const profitTokens = finalResults.filter(r => r.isProfit);
  const lossTokens = finalResults.filter(r => !r.isProfit);

  console.log('=== 回测实验分析 ===\n');
  console.log('总代币数:', finalResults.length);
  console.log('盈利代币:', profitTokens.length);
  console.log('亏损代币:', lossTokens.length);

  const winRate = profitTokens.length / finalResults.length * 100;
  const avgProfit = profitTokens.length > 0 ? profitTokens.reduce((sum, r) => sum + r.avgProfit, 0) / profitTokens.length : 0;
  const avgLoss = lossTokens.length > 0 ? lossTokens.reduce((sum, r) => sum + r.avgProfit, 0) / lossTokens.length : 0;
  const totalReturn = finalResults.reduce((sum, r) => sum + r.avgProfit, 0);

  console.log('胜率:', winRate.toFixed(1) + '%');
  console.log('平均盈利:', avgProfit.toFixed(1) + '%');
  console.log('平均亏损:', avgLoss.toFixed(1) + '%');
  console.log('盈亏比:', avgLoss !== 0 ? (avgProfit / Math.abs(avgLoss)).toFixed(2) : 'N/A');
  console.log('总收益:', totalReturn.toFixed(1) + '%');
  console.log('');

  // 检查 preBuyFactors 数据
  const withPreBuyData = finalResults.filter(r => r.preBuyFactors && Object.keys(r.preBuyFactors).length > 0);
  const withoutPreBuyData = finalResults.filter(r => !r.preBuyFactors || Object.keys(r.preBuyFactors).length === 0);

  console.log('=== 预检查因子数据 ===');
  console.log('有 preBuyFactors:', withPreBuyData.length);
  console.log('无 preBuyFactors:', withoutPreBuyData.length);
  console.log('');

  // 关键因子对比（只分析有预检查数据的）
  console.log('=== 盈利 vs 亏损 关键因子对比（仅限有预检查数据的代币）===');
  console.log('有数据的盈利代币:', profitTokens.filter(t => t.preBuyFactors && Object.keys(t.preBuyFactors).length > 0).length);
  console.log('有数据的亏损代币:', lossTokens.filter(t => t.preBuyFactors && Object.keys(t.preBuyFactors).length > 0).length);
  console.log('');

  const factorsToCompare = [
    { name: 'earlyReturn', key: 'trendFactors' },
    { name: 'trendCV', key: 'trendFactors' },
    { name: 'trendStrengthScore', key: 'trendFactors' },
    { name: 'trendTotalReturn', key: 'trendFactors' },
    { name: 'earlyWhaleCount', key: 'preBuyFactors' },
    { name: 'earlyWhaleSellRatio', key: 'preBuyFactors' },
    { name: 'earlyWhaleHoldRatio', key: 'preBuyFactors' },
    { name: 'walletClusterSecondToFirstRatio', key: 'preBuyFactors' },
    { name: 'walletClusterMegaRatio', key: 'preBuyFactors' },
    { name: 'walletClusterTop2Ratio', key: 'preBuyFactors' },
    { name: 'walletClusterMaxBlockBuyRatio', key: 'preBuyFactors' },
    { name: 'earlyTradesVolumePerMin', key: 'preBuyFactors' },
    { name: 'earlyTradesCountPerMin', key: 'preBuyFactors' },
    { name: 'holderBlacklistCount', key: 'preBuyFactors' },
    { name: 'devHoldingRatio', key: 'preBuyFactors' },
  ];

  factorsToCompare.forEach(factor => {
    const profitValues = profitTokens
      .filter(t => t.preBuyFactors && Object.keys(t.preBuyFactors).length > 0)
      .map(t => t[factor.key]?.[factor.name])
      .filter(v => v !== undefined && v !== null);

    const lossValues = lossTokens
      .filter(t => t.preBuyFactors && Object.keys(t.preBuyFactors).length > 0)
      .map(t => t[factor.key]?.[factor.name])
      .filter(v => v !== undefined && v !== null);

    if (profitValues.length >= 2 && lossValues.length >= 3) {
      const profitAvg = profitValues.reduce((a, b) => a + b, 0) / profitValues.length;
      const lossAvg = lossValues.reduce((a, b) => a + b, 0) / lossValues.length;
      const profitMin = Math.min(...profitValues);
      const profitMax = Math.max(...profitValues);
      const lossMin = Math.min(...lossValues);
      const lossMax = Math.max(...lossValues);

      const diff = profitAvg - lossAvg;
      const diffPct = lossAvg !== 0 ? (diff / Math.abs(lossAvg) * 100).toFixed(1) : 'N/A';

      console.log(`${factor.name}:`);
      console.log(`  盈利: avg=${profitAvg.toFixed(2)} (range: ${profitMin.toFixed(2)} - ${profitMax.toFixed(2)}, n=${profitValues.length})`);
      console.log(`  亏损: avg=${lossAvg.toFixed(2)} (range: ${lossMin.toFixed(2)} - ${lossMax.toFixed(2)}, n=${lossValues.length})`);
      console.log(`  差异: ${diff > 0 ? '+' : ''}${diff.toFixed(2)} (${diffPct}%)`);
      console.log('');
    }
  });

  // 显示具体案例
  console.log('=== 盈利案例详情（前10）===');
  const sortedProfitTokens = [...profitTokens].sort((a, b) => b.avgProfit - a.avgProfit);
  console.log('\n代币          | 盈亏% | earlyRet | trendCV | whaleCnt | whaleSell | cluster2nd | blacklist');
  console.log('-------------|-------|----------|---------|----------|-----------|------------|----------');

  sortedProfitTokens.slice(0, 10).forEach(t => {
    console.log(`  ${t.symbol.padEnd(13)} | ${t.avgProfit.toFixed(1).padStart(5)}% | ${(t.trendFactors?.earlyReturn || 0).toFixed(0).padStart(7)}% | ${(t.trendFactors?.trendCV || 0).toFixed(2).padStart(7)} | ${formatNum(t.preBuyFactors?.earlyWhaleCount).padStart(8)} | ${formatNum(t.preBuyFactors?.earlyWhaleSellRatio).padStart(9)} | ${formatNum(t.preBuyFactors?.walletClusterSecondToFirstRatio).padStart(10)} | ${formatNum(t.preBuyFactors?.holderBlacklistCount).padStart(8)}`);
  });

  console.log('\n=== 亏损案例详情（前15，按亏损排序）===');
  const sortedLossTokens = [...lossTokens].sort((a, b) => a.avgProfit - b.avgProfit);
  console.log('\n代币          | 盈亏% | earlyRet | trendCV | whaleCnt | whaleSell | cluster2nd | blacklist');
  console.log('-------------|-------|----------|---------|----------|-----------|------------|----------');

  sortedLossTokens.slice(0, 15).forEach(t => {
    console.log(`  ${t.symbol.padEnd(13)} | ${t.avgProfit.toFixed(1).padStart(5)}% | ${(t.trendFactors?.earlyReturn || 0).toFixed(0).padStart(7)}% | ${(t.trendFactors?.trendCV || 0).toFixed(2).padStart(7)} | ${formatNum(t.preBuyFactors?.earlyWhaleCount).padStart(8)} | ${formatNum(t.preBuyFactors?.earlyWhaleSellRatio).padStart(9)} | ${formatNum(t.preBuyFactors?.walletClusterSecondToFirstRatio).padStart(10)} | ${formatNum(t.preBuyFactors?.holderBlacklistCount).padStart(8)}`);
  });

  // 高风险模式分析
  console.log('\n=== 高风险模式分析 ===\n');

  const analyzeProfitTokens = profitTokens.filter(t => t.preBuyFactors && Object.keys(t.preBuyFactors).length > 0);
  const analyzeLossTokens = lossTokens.filter(t => t.preBuyFactors && Object.keys(t.preBuyFactors).length > 0);

  // 模式1: earlyWhaleCount = 0
  const zeroWhaleProfit = analyzeProfitTokens.filter(t => t.preBuyFactors?.earlyWhaleCount === 0).length;
  const zeroWhaleLoss = analyzeLossTokens.filter(t => t.preBuyFactors?.earlyWhaleCount === 0).length;
  const zeroWhaleTotal = zeroWhaleProfit + zeroWhaleLoss;

  if (zeroWhaleTotal > 0) {
    console.log(`[模式1] earlyWhaleCount = 0:`);
    const profitRate = zeroWhaleProfit/zeroWhaleTotal*100;
    const lossRate = zeroWhaleLoss/zeroWhaleTotal*100;
    console.log(`  盈利: ${zeroWhaleProfit}/${zeroWhaleTotal} (${profitRate.toFixed(1)}%)`);
    console.log(`  亏损: ${zeroWhaleLoss}/${zeroWhaleTotal} (${lossRate.toFixed(1)}%)`);
    if (zeroWhaleLoss > zeroWhaleProfit) {
      console.log(`  ⚠️  亏损率较高`);
    }
    console.log('');
  }

  // 模式2: walletClusterSecondToFirstRatio > 0.2
  const clusterThresholds = [0.1, 0.15, 0.2, 0.25];
  clusterThresholds.forEach(threshold => {
    const highClusterProfit = analyzeProfitTokens.filter(t => (t.preBuyFactors?.walletClusterSecondToFirstRatio || 0) > threshold).length;
    const highClusterLoss = analyzeLossTokens.filter(t => (t.preBuyFactors?.walletClusterSecondToFirstRatio || 0) > threshold).length;
    const total = highClusterProfit + highClusterLoss;

    if (total >= 3) {
      const lossRate = highClusterLoss / total;
      console.log(`[模式2] walletClusterSecondToFirstRatio > ${threshold}:`);
      const profitRate = highClusterProfit/total*100;
      console.log(`  盈利: ${highClusterProfit}/${total} (${profitRate.toFixed(1)}%)`);
      console.log(`  亏损: ${highClusterLoss}/${total} (${(lossRate*100).toFixed(1)}%)`);
      if (lossRate > 0.6) {
        console.log(`  ⚠️  亏损率 > 60%，建议收紧阈值到 ${threshold}`);
      }
      console.log('');
    }
  });

  // 模式3: holderBlacklistCount > 0
  const blacklistProfit = analyzeProfitTokens.filter(t => (t.preBuyFactors?.holderBlacklistCount || 0) > 0).length;
  const blacklistLoss = analyzeLossTokens.filter(t => (t.preBuyFactors?.holderBlacklistCount || 0) > 0).length;
  const blacklistTotal = blacklistProfit + blacklistLoss;

  if (blacklistTotal > 0) {
    console.log(`[模式3] holderBlacklistCount > 0:`);
    const profitRate = blacklistProfit/blacklistTotal*100;
    const lossRate = blacklistLoss/blacklistTotal*100;
    console.log(`  盈利: ${blacklistProfit}/${blacklistTotal} (${profitRate.toFixed(1)}%)`);
    console.log(`  亏损: ${blacklistLoss}/${blacklistTotal} (${lossRate.toFixed(1)}%)`);
    console.log('');
  }

  // 模式4: earlyReturn 范围
  console.log(`[模式4] earlyReturn 范围分析:`);
  const returnRanges = [
    { name: '低 (15-80%)', min: 15, max: 80 },
    { name: '中 (80-150%)', min: 80, max: 150 },
    { name: '高 (150-250%)', min: 150, max: 250 },
    { name: '极高 (250%+)', min: 250, max: Infinity }
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
      const winRateStr = winRate.toFixed(1);
      console.log(`  ${range.name}: 盈利 ${inRangeProfit}/${total} (${winRateStr}%), 亏损 ${inRangeLoss}/${total}`);
    }
  });

  // 优化建议
  console.log('\n=== 优化建议 ===\n');
  generateOptimizationSuggestions(analyzeProfitTokens, analyzeLossTokens, profitTokens, lossTokens);
}

function formatNum(num) {
  if (num === undefined || num === null) return 'N/A';
  return num.toString();
}

function generateOptimizationSuggestions(analyzeProfitTokens, analyzeLossTokens, allProfitTokens, allLossTokens) {
  const suggestions = [];

  // 分析1: earlyWhaleCount = 0
  const zeroWhaleInLoss = analyzeLossTokens.filter(t => t.preBuyFactors?.earlyWhaleCount === 0);
  const zeroWhaleInProfit = analyzeProfitTokens.filter(t => t.preBuyFactors?.earlyWhaleCount === 0);
  const zeroWhaleTotal = zeroWhaleInLoss.length + zeroWhaleInProfit.length;

  if (zeroWhaleTotal >= 3) {
    const lossRate = zeroWhaleInLoss.length / zeroWhaleTotal;
    if (lossRate > 0.6) {
      const avgLoss = zeroWhaleInLoss.reduce((sum, t) => sum + t.avgProfit, 0) / zeroWhaleInLoss.length;
      const avgProfit = zeroWhaleInProfit.length > 0 ? zeroWhaleInProfit.reduce((sum, t) => sum + t.avgProfit, 0) / zeroWhaleInProfit.length : 0;
      const lossRateStr = (lossRate*100).toFixed(1);
      suggestions.push({
        priority: 'MEDIUM',
        issue: `earlyWhaleCount=0 的代币亏损率 ${lossRateStr}% (${zeroWhaleInLoss.length}/${zeroWhaleTotal})`,
        suggestion: '考虑增加条件：earlyWhaleCount >= 1',
        impact: `可过滤 ${zeroWhaleInLoss.length} 个亏损案例（平均 ${avgLoss.toFixed(1)}%），但也会过滤 ${zeroWhaleInProfit.length} 个盈利案例（平均 ${avgProfit.toFixed(1)}%）`
      });
    }
  }

  // 分析2: walletClusterSecondToFirstRatio
  const clusterThresholds = [0.1, 0.15, 0.2, 0.25, 0.3];
  clusterThresholds.forEach(threshold => {
    const highClusterInLoss = analyzeLossTokens.filter(t => (t.preBuyFactors?.walletClusterSecondToFirstRatio || 0) > threshold);
    const highClusterInProfit = analyzeProfitTokens.filter(t => (t.preBuyFactors?.walletClusterSecondToFirstRatio || 0) > threshold);
    const total = highClusterInLoss.length + highClusterInProfit.length;

    if (total >= 3) {
      const lossRate = highClusterInLoss.length / total;
      if (lossRate > 0.65) {
        const avgLoss = highClusterInLoss.reduce((sum, t) => sum + t.avgProfit, 0) / highClusterInLoss.length;
        const avgProfit = highClusterInProfit.length > 0 ? highClusterInProfit.reduce((sum, t) => sum + t.avgProfit, 0) / highClusterInProfit.length : 0;
        const lossRateStr = (lossRate*100).toFixed(1);
        suggestions.push({
          priority: 'HIGH',
          issue: `walletClusterSecondToFirstRatio > ${threshold} 的代币亏损率 ${lossRateStr}%`,
          suggestion: `收紧条件为：walletClusterSecondToFirstRatio <= ${threshold}`,
          impact: `可过滤 ${highClusterInLoss.length} 个亏损案例（平均 ${avgLoss.toFixed(1)}%），也会过滤 ${highClusterInProfit.length} 个盈利案例（平均 ${avgProfit?.toFixed(1) || 'N/A'}%）`
        });
      }
    }
  });

  // 分析3: holderBlacklistCount
  const blacklistInLoss = analyzeLossTokens.filter(t => (t.preBuyFactors?.holderBlacklistCount || 0) > 0);
  const blacklistInProfit = analyzeProfitTokens.filter(t => (t.preBuyFactors?.holderBlacklistCount || 0) > 0);
  const blacklistTotal = blacklistInLoss.length + blacklistInProfit.length;

  if (blacklistTotal >= 3) {
    const lossRate = blacklistInLoss.length / blacklistTotal;
    if (lossRate > 0.6) {
      const avgLoss = blacklistInLoss.reduce((sum, t) => sum + t.avgProfit, 0) / blacklistInLoss.length;
      const avgProfit = blacklistInProfit.length > 0 ? blacklistInProfit.reduce((sum, t) => sum + t.avgProfit, 0) / blacklistInProfit.length : 0;
      const lossRateStr = (lossRate*100).toFixed(1);
      suggestions.push({
        priority: 'HIGH',
        issue: `holderBlacklistCount > 0 的代币亏损率 ${lossRateStr}%`,
        suggestion: '收紧条件为：holderBlacklistCount = 0',
        impact: `可过滤 ${blacklistInLoss.length} 个亏损案例（平均 ${avgLoss.toFixed(1)}%），也会过滤 ${blacklistInProfit.length} 个盈利案例（平均 ${avgProfit.toFixed(1)}%）`
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
      console.log(`  建议: ${s.suggestion}`);
      console.log(`  影响: ${s.impact}`);
      console.log('');
    });
  }
}

analyzeWithSignalFactors().catch(console.error);
