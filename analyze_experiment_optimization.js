/**
 * 分析回测实验，寻找优化空间
 * 目标：提升胜率
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeForOptimization() {
  const experimentId = '5072373e-b79d-4d66-b471-03c7c72730ec';

  // 1. 获取所有信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  console.log('=== 实验总览 ===\n');
  console.log('总信号数:', signals.length);

  // 2. 获取交易结果
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  console.log('总交易数:', trades.length);

  // 3. 按代币分组统计
  const tokenResults = new Map();

  trades.forEach(trade => {
    if (!tokenResults.has(trade.token_address)) {
      tokenResults.set(trade.token_address, {
        tokenAddress: trade.token_address,
        symbol: trade.token_symbol || trade.token_address.substring(0, 8),
        buys: 0,
        sells: 0,
        buyAmount: 0,
        sellAmount: 0,
        profit: 0,
        profitPct: 0,
        status: 'unknown'
      });
    }
    const result = tokenResults.get(trade.token_address);
    if (trade.type === 'buy') {
      result.buys++;
      result.buyAmount += trade.amount || 0;
    } else if (trade.type === 'sell') {
      result.sells++;
      result.sellAmount += trade.amount || 0;
      result.profit += trade.profit || 0;
      result.profitPct += trade.profit_percentage || 0;
    }
  });

  // 计算最终结果
  const results = Array.from(tokenResults.values()).map(r => {
    // 判断盈亏
    const avgProfitPct = r.sells > 0 ? r.profitPct / r.sells : 0;
    return {
      ...r,
      avgProfitPct: avgProfitPct,
      isProfit: avgProfitPct > 0
    };
  });

  const profitCount = results.filter(r => r.isProfit).length;
  const lossCount = results.filter(r => !r.isProfit).length;
  const winRate = profitCount / results.length * 100;

  const totalProfit = results.filter(r => r.isProfit).reduce((sum, r) => sum + r.avgProfitPct, 0);
  const totalLoss = results.filter(r => !r.isProfit).reduce((sum, r) => sum + r.avgProfitPct, 0);
  const avgProfit = profitCount > 0 ? totalProfit / profitCount : 0;
  const avgLoss = lossCount > 0 ? totalLoss / lossCount : 0;

  console.log('\n=== 交易结果统计 ===');
  console.log('盈利代币:', profitCount);
  console.log('亏损代币:', lossCount);
  console.log('胜率:', winRate.toFixed(1) + '%');
  console.log('平均盈利:', avgProfit.toFixed(1) + '%');
  console.log('平均亏损:', avgLoss.toFixed(1) + '%');
  console.log('盈亏比:', avgLoss !== 0 ? (avgProfit / Math.abs(avgLoss)).toFixed(2) : 'N/A');
  console.log('总收益:', results.reduce((sum, r) => sum + r.avgProfitPct, 0).toFixed(1) + '%');
  console.log('');

  // 4. 分析成功和失败案例的因子差异
  console.log('=== 分析盈亏模式 ===\n');

  // 按代币获取对应的信号因子
  for (const result of results) {
    const signal = signals.find(s => s.token_address === result.token_address);
    if (signal) {
      result.trendFactors = signal.metadata?.trendFactors || {};
      result.preBuyFactors = signal.metadata?.preBuyCheckFactors || {};
      result.executionStatus = signal.metadata?.execution_status;
      result.executionReason = signal.metadata?.execution_reason;
    }
  }

  // 按盈亏分组
  const profitTokens = results.filter(r => r.isProfit);
  const lossTokens = results.filter(r => !r.isProfit);

  console.log('盈利案例:', profitTokens.length);
  console.log('亏损案例:', lossTokens.length);
  console.log('');

  // 5. 对比关键因子
  console.log('=== 关键因子对比 ===\n');

  const factorsToCompare = [
    // 趋势因子
    { name: 'earlyReturn', key: 'trendFactors', subkey: 'earlyReturn' },
    { name: 'trendCV', key: 'trendFactors', subkey: 'trendCV' },
    { name: 'trendSlope', key: 'trendFactors', subkey: 'trendSlope' },
    { name: 'trendStrengthScore', key: 'trendFactors', subkey: 'trendStrengthScore' },
    { name: 'trendTotalReturn', key: 'trendFactors', subkey: 'trendTotalReturn' },
    { name: 'trendRecentDownRatio', key: 'trendFactors', subkey: 'trendRecentDownRatio' },
    // 预检查因子
    { name: 'earlyWhaleCount', key: 'preBuyFactors', subkey: 'earlyWhaleCount' },
    { name: 'earlyWhaleSellRatio', key: 'preBuyFactors', subkey: 'earlyWhaleSellRatio' },
    { name: 'earlyWhaleHoldRatio', key: 'preBuyFactors', subkey: 'earlyWhaleHoldRatio' },
    { name: 'walletClusterSecondToFirstRatio', key: 'preBuyFactors', subkey: 'walletClusterSecondToFirstRatio' },
    { name: 'walletClusterMegaRatio', key: 'preBuyFactors', subkey: 'walletClusterMegaRatio' },
    { name: 'earlyTradesVolumePerMin', key: 'preBuyFactors', subkey: 'earlyTradesVolumePerMin' },
    { name: 'earlyTradesCountPerMin', key: 'preBuyFactors', subkey: 'earlyTradesCountPerMin' },
    { name: 'holderBlacklistCount', key: 'preBuyFactors', subkey: 'holderBlacklistCount' },
    { name: 'devHoldingRatio', key: 'preBuyFactors', subkey: 'devHoldingRatio' },
  ];

  factorsToCompare.forEach(factor => {
    const profitValues = profitTokens
      .map(t => t[factor.key]?.[factor.subkey])
      .filter(v => v !== undefined && v !== null);

    const lossValues = lossTokens
      .map(t => t[factor.key]?.[factor.subkey])
      .filter(v => v !== undefined && v !== null);

    if (profitValues.length > 0 && lossValues.length > 0) {
      const profitAvg = profitValues.reduce((a, b) => a + b, 0) / profitValues.length;
      const lossAvg = lossValues.reduce((a, b) => a + b, 0) / lossValues.length;

      const profitMin = Math.min(...profitValues);
      const profitMax = Math.max(...profitValues);
      const lossMin = Math.min(...lossValues);
      const lossMax = Math.max(...lossValues);

      const diff = profitAvg - lossAvg;
      const diffPct = lossAvg !== 0 ? (diff / Math.abs(lossAvg) * 100).toFixed(1) : 'N/A';

      console.log(`${factor.name}:`);
      console.log(`  盈利平均: ${formatNumber(profitAvg, 2)} (范围: ${formatNumber(profitMin, 2)} - ${formatNumber(profitMax, 2)})`);
      console.log(`  亏损平均: ${formatNumber(lossAvg, 2)} (范围: ${formatNumber(lossMin, 2)} - ${formatNumber(lossMax, 2)})`);
      console.log(`  差异: ${diff > 0 ? '+' : ''}${formatNumber(diff, 2)} (${diffPct}%)`);
      console.log('');
    }
  });

  // 6. 找出最亏损的案例
  console.log('=== 亏损案例详情（按亏损排序）===');
  const sortedLossTokens = [...lossTokens].sort((a, b) => a.avgProfitPct - b.avgProfitPct);

  console.log('\n代币          | 盈亏% | earlyReturn | earlyWhale | whaleSellRatio | cluster2nd/1st');
  console.log('-------------|-------|-------------|------------|----------------|----------------');

  sortedLossTokens.slice(0, 10).forEach(t => {
    console.log(`  ${t.symbol.padEnd(13)} | ${t.avgProfitPct.toFixed(1).padStart(5)}% | ${formatNumber(t.trendFactors?.earlyReturn, 1).padStart(10)}% | ${formatNumber(t.preBuyFactors?.earlyWhaleCount, 0).padStart(9)} | ${formatNumber(t.preBuyFactors?.earlyWhaleSellRatio, 2).padStart(13)} | ${formatNumber(t.preBuyFactors?.walletClusterSecondToFirstRatio, 2).padStart(13)}`);
  });

  // 7. 找出最盈利的案例
  console.log('\n=== 盈利案例详情（按盈利排序）===');
  const sortedProfitTokens = [...profitTokens].sort((a, b) => b.avgProfitPct - a.avgProfitPct);

  console.log('\n代币          | 盈亏% | earlyReturn | earlyWhale | whaleSellRatio | cluster2nd/1st');
  console.log('-------------|-------|-------------|------------|----------------|----------------');

  sortedProfitTokens.slice(0, 10).forEach(t => {
    console.log(`  ${t.symbol.padEnd(13)} | ${t.avgProfitPct.toFixed(1).padStart(5)}% | ${formatNumber(t.trendFactors?.earlyReturn, 1).padStart(10)}% | ${formatNumber(t.preBuyFactors?.earlyWhaleCount, 0).padStart(9)} | ${formatNumber(t.preBuyFactors?.earlyWhaleSellRatio, 2).padStart(13)} | ${formatNumber(t.preBuyFactors?.walletClusterSecondToFirstRatio, 2).padStart(13)}`);
  });

  // 8. 识别高风险模式
  console.log('\n=== 高风险模式识别 ===\n');

  // 检查 earlyWhaleCount = 0 的情况
  const zeroWhaleProfit = profitTokens.filter(t => t.preBuyFactors?.earlyWhaleCount === 0).length;
  const zeroWhaleLoss = lossTokens.filter(t => t.preBuyFactors?.earlyWhaleCount === 0).length;

  console.log('earlyWhaleCount = 0:');
  console.log(`  盈利: ${zeroWhaleProfit}/${profitTokens.length} (${(zeroWhaleProfit/profitTokens.length*100).toFixed(1)}%)`);
  console.log(`  亏损: ${zeroWhaleLoss}/${lossTokens.length} (${(zeroWhaleLoss/lossTokens.length*100).toFixed(1)}%)`);

  // 检查 cluster 模式
  const highClusterRatio = 0.3;
  const highClusterProfit = profitTokens.filter(t => (t.preBuyFactors?.walletClusterSecondToFirstRatio || 0) > highClusterRatio).length;
  const highClusterLoss = lossTokens.filter(t => (t.preBuyFactors?.walletClusterSecondToFirstRatio || 0) > highClusterRatio).length;

  console.log(`\nwalletClusterSecondToFirstRatio > ${highClusterRatio}:`);
  console.log(`  盈利: ${highClusterProfit}/${profitTokens.length} (${(highClusterProfit/profitTokens.length*100).toFixed(1)}%)`);
  console.log(`  亏损: ${highClusterLoss}/${lossTokens.length} (${(highClusterLoss/lossTokens.length*100).toFixed(1)}%)`);

  // 检查 earlyReturn 范围
  console.log('\nearlyReturn 范围分析:');
  const returnRanges = [
    { name: '低 (15-30%)', min: 15, max: 30 },
    { name: '中 (30-60%)', min: 30, max: 60 },
    { name: '高 (60-90%)', min: 60, max: 90 },
    { name: '极高 (90%+)', min: 90, max: Infinity }
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
    if (total > 0) {
      console.log(`  ${range.name}: 盈利 ${inRangeProfit}/${total} (${(inRangeProfit/total*100).toFixed(1)}%), 亏损 ${inRangeLoss}/${total}`);
    }
  });

  console.log('\n=== 优化建议 ===\n');
  generateOptimizationSuggestions(profitTokens, lossTokens);
}

function formatNumber(num, decimals = 2) {
  if (num === undefined || num === null) return 'N/A';
  return num.toFixed(decimals);
}

function generateOptimizationSuggestions(profitTokens, lossTokens) {
  const suggestions = [];

  // 分析1: earlyWhaleCount = 0 的情况
  const zeroWhaleInLoss = lossTokens.filter(t => t.preBuyFactors?.earlyWhaleCount === 0).length;
  const zeroWhaleInProfit = profitTokens.filter(t => t.preBuyFactors?.earlyWhaleCount === 0).length;
  const zeroWhaleTotal = zeroWhaleInLoss + zeroWhaleInProfit;

  if (zeroWhaleTotal > 0) {
    const lossRate = zeroWhaleInLoss / zeroWhaleTotal;
    if (lossRate > 0.5) {
      suggestions.push({
        priority: 'HIGH',
        issue: `earlyWhaleCount=0 的代币亏损率 ${ (lossRate*100).toFixed(1) }%`,
        suggestion: '考虑增加条件：要求 earlyWhaleCount >= 1',
        impact: `可能过滤掉 ${zeroWhaleInLoss} 个亏损案例，但也会过滤 ${zeroWhaleInProfit} 个盈利案例`
      });
    }
  }

  // 分析2: walletClusterSecondToFirstRatio
  const highClusterInLoss = lossTokens.filter(t => (t.preBuyFactors?.walletClusterSecondToFirstRatio || 0) > 0.2).length;
  const highClusterInProfit = profitTokens.filter(t => (t.preBuyFactors?.walletClusterSecondToFirstRatio || 0) > 0.2).length;
  const highClusterTotal = highClusterInLoss + highClusterInProfit;

  if (highClusterTotal > 0) {
    const lossRate = highClusterInLoss / highClusterTotal;
    if (lossRate > 0.5) {
      suggestions.push({
        priority: 'MEDIUM',
        issue: `walletClusterSecondToFirstRatio > 0.2 的代币亏损率 ${(lossRate*100).toFixed(1)}%`,
        suggestion: '考虑收紧条件：walletClusterSecondToFirstRatio <= 0.2',
        impact: `可能过滤掉 ${highClusterInLoss} 个亏损案例，但也会过滤 ${highClusterInProfit} 个盈利案例`
      });
    }
  }

  // 分析3: earlyReturn 过高
  const veryHighReturnInLoss = lossTokens.filter(t => (t.trendFactors?.earlyReturn || 0) > 80).length;
  const veryHighReturnInProfit = profitTokens.filter(t => (t.trendFactors?.earlyReturn || 0) > 80).length;
  const veryHighReturnTotal = veryHighReturnInLoss + veryHighReturnInProfit;

  if (veryHighReturnTotal > 0) {
    const lossRate = veryHighReturnInLoss / veryHighReturnTotal;
    suggestions.push({
      priority: 'LOW',
      issue: `earlyReturn > 80% 的代币亏损率 ${(lossRate*100).toFixed(1)}%`,
      suggestion: '考虑限制 earlyReturn 上限：earlyReturn < 80',
      impact: `可能过滤掉 ${veryHighReturnInLoss} 个亏损案例，但也会过滤 ${veryHighReturnInProfit} 个盈利案例`
    });
  }

  // 分析4: holderBlacklistCount
  const highBlacklistInLoss = lossTokens.filter(t => (t.preBuyFactors?.holderBlacklistCount || 0) > 0).length;
  const highBlacklistInProfit = profitTokens.filter(t => (t.preBuyFactors?.holderBlacklistCount || 0) > 0).length;
  const highBlacklistTotal = highBlacklistInLoss + highBlacklistInProfit;

  if (highBlacklistTotal > 0) {
    const lossRate = highBlacklistInLoss / highBlacklistTotal;
    suggestions.push({
      priority: 'HIGH',
      issue: `holderBlacklistCount > 0 的代币亏损率 ${(lossRate*100).toFixed(1)}%`,
      suggestion: '考虑收紧条件：holderBlacklistCount = 0',
      impact: `可能过滤掉 ${highBlacklistInLoss} 个亏损案例，但也会过滤 ${highBlacklistInProfit} 个盈利案例`
    });
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
      console.log(`${i + 1}. [${s.priority}] ${s.issue}`);
      console.log(`   建议: ${s.suggestion}`);
      console.log(`   影响: ${s.impact}`);
      console.log('');
    });
  }
}

analyzeForOptimization().catch(console.error);
