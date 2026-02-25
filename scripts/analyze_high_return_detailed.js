/**
 * 分析高收益但未购买代币的完整时序数据
 * 找出具体是哪个条件导致无法购买
 */

const { dbManager } = require('../src/services/dbManager');

async function analyzeHighReturnNoBuyTokens() {
  const supabase = dbManager.getClient();
  const experimentId = '6853949c-ad60-40ac-b4b3-cfd457de99e3';

  // 1. 获取已购买代币
  const { data: boughtTokens } = await supabase
    .from('trades')
    .select('token_address')
    .eq('experiment_id', experimentId)
    .eq('trade_direction', 'buy');

  const boughtAddresses = new Set(boughtTokens?.map(t => t.token_address) || []);

  // 2. 获取所有代币的分析结果
  const { data: allTokens } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol, analysis_results, status')
    .eq('experiment_id', experimentId);

  // 3. 筛选高收益但未购买的代币
  const highReturnNoBuy = [];
  for (const token of allTokens || []) {
    // 跳过已购买的
    if (boughtAddresses.has(token.token_address)) continue;
    // 跳过明显不应该购买的
    if (token.status === 'bad_holder' || token.status === 'negative_dev') continue;

    // 解析分析结果
    const analysis = typeof token.analysis_results === 'string'
      ? JSON.parse(token.analysis_results)
      : token.analysis_results;

    if (analysis && analysis.max_change_percent >= 50) {
      highReturnNoBuy.push({
        address: token.token_address,
        symbol: token.token_symbol,
        maxReturn: analysis.max_change_percent,
        finalReturn: analysis.final_change_percent,
        dataPoints: analysis.data_points
      });
    }
  }

  console.log(`📊 高收益但未购买的代币 (>=50%): ${highReturnNoBuy.length} 个\n`);

  // 按收益率排序
  highReturnNoBuy.sort((a, b) => b.maxReturn - a.maxReturn);

  // 4. 分析每个代币的时序数据
  const batchSize = 50;

  for (let i = 0; i < highReturnNoBuy.length; i += batchSize) {
    const batch = highReturnNoBuy.slice(i, i + batchSize);
    const addresses = batch.map(t => t.address);

    // 获取时序数据
    const { data: timeSeriesData } = await supabase
      .from('experiment_time_series_data')
      .select('token_address, loop_count, timestamp, factor_values')
      .eq('experiment_id', experimentId)
      .in('token_address', addresses)
      .order('token_address')
      .order('loop_count', { ascending: true });

    if (!timeSeriesData) continue;

    // 按代币分组
    const tokenTimeSeries = new Map();
    for (const ts of timeSeriesData) {
      if (!tokenTimeSeries.has(ts.token_address)) {
        tokenTimeSeries.set(ts.token_address, []);
      }
      tokenTimeSeries.get(ts.token_address).push(ts);
    }

    // 分析每个代币
    for (const token of batch) {
      const tsList = tokenTimeSeries.get(token.address);
      if (!tsList || tsList.length === 0) continue;

      // 详细分析每个条件在整个生命周期中的表现
      const analysis = analyzeTokenLifecycle(tsList);

      console.log('\n───────────────────────────────────────────────────────────────');
      console.log(`🪙 ${token.symbol} (${token.address})`);
      console.log(`   最高涨幅: ${token.maxReturn.toFixed(2)}% | 最终: ${token.finalReturn?.toFixed(2) || 'N/A'}% | 数据点: ${token.dataPoints || tsList.length}`);

      // 显示每个条件的最佳值
      console.log(`\n   📊 各条件最佳值:`);
      console.log(`     trendCV: 最佳 ${analysis.bestTrendCV.toFixed(4)} (需要 > 0.005) ${analysis.bestTrendCV > 0.005 ? '✅' : '❌'}`);
      console.log(`     trendDirectionCount: 最佳 ${analysis.bestDirectionCount} (需要 >= 2) ${analysis.bestDirectionCount >= 2 ? '✅' : '❌'}`);
      console.log(`     trendStrengthScore: 最佳 ${analysis.bestStrengthScore.toFixed(0)} (需要 >= 30) ${analysis.bestStrengthScore >= 30 ? '✅' : '❌'}`);
      console.log(`     trendTotalReturn: 最佳 ${analysis.bestTotalReturn?.toFixed(2)}% (需要 >= 5%) ${analysis.bestTotalReturn >= 5 ? '✅' : '❌'}`);
      console.log(`     tvl: 最佳 ${analysis.bestTvl?.toFixed(0)} (需要 >= 3000) ${analysis.bestTvl >= 3000 ? '✅' : '❌'}`);
      console.log(`     txVolumeU24h: 最佳 ${analysis.bestTxVolume?.toFixed(0)} (需要 >= 3500) ${analysis.bestTxVolume >= 3500 ? '✅' : '❌'}`);
      console.log(`     holders: 最佳 ${analysis.bestHolders} (需要 >= 25) ${analysis.bestHolders >= 25 ? '✅' : '❌'}`);
      console.log(`     trendRecentDownRatio: 最佳 ${analysis.bestRecentDownRatio?.toFixed(2)} (需要 < 0.5) ${analysis.bestRecentDownRatio < 0.5 ? '✅' : '❌'}`);
      console.log(`     trendConsecutiveDowns: 最佳 ${analysis.bestConsecutiveDowns} (需要 < 2) ${analysis.bestConsecutiveDowns < 2 ? '✅' : '❌'}`);
      console.log(`     earlyReturn: 最低 ${analysis.minEarlyReturn?.toFixed(2)}% (需要 < 160) ${analysis.minEarlyReturn < 160 ? '✅' : '❌'}`);
      console.log(`     drawdownFromHighest: 最佳 ${analysis.bestDrawdown?.toFixed(2)} (需要 > -25) ${analysis.bestDrawdown > -25 ? '✅' : '❌'}`);

      // 显示所有条件同时满足的时间点（如果有的话）
      if (analysis.allMetAt) {
        console.log(`\n   ⚠️ Loop ${analysis.allMetAt.loop_count} 所有条件都满足!`);
        console.log(`      但信号记录: ${analysis.allMetAt.signal_type || 'null'}`);
        console.log(`      执行状态: ${analysis.allMetAt.signal_executed || 'null'}`);
      } else {
        // 找出主要失败原因
        console.log(`\n   ❌ 主要失败原因: ${analysis.failedReasons.join(', ')}`);
      }
    }

    console.log(`\n已处理 ${Math.min(i + batchSize, highReturnNoBuy.length)}/${highReturnNoBuy.length} 个代币`);
  }
}

// 分析代币生命周期中各条件的表现
function analyzeTokenLifecycle(tsList) {
  let bestTrendCV = 0;
  let bestDirectionCount = 0;
  let bestStrengthScore = 0;
  let bestTotalReturn = 0;
  let bestTvl = 0;
  let bestTxVolume = 0;
  let bestHolders = 0;
  let bestRecentDownRatio = 1;
  let bestConsecutiveDowns = 0;
  let minEarlyReturn = Infinity;
  let bestDrawdown = -Infinity;

  let allMetAt = null;

  for (const ts of tsList) {
    const f = typeof ts.factor_values === 'string'
      ? JSON.parse(ts.factor_values)
      : ts.factor_values;

    if (f.trendCV > bestTrendCV) bestTrendCV = f.trendCV;
    if (f.trendDirectionCount > bestDirectionCount) bestDirectionCount = f.trendDirectionCount;
    if (f.trendStrengthScore > bestStrengthScore) bestStrengthScore = f.trendStrengthScore;
    if (f.trendTotalReturn > bestTotalReturn) bestTotalReturn = f.trendTotalReturn;
    if (f.tvl > bestTvl) bestTvl = f.tvl;
    if (f.txVolumeU24h > bestTxVolume) bestTxVolume = f.txVolumeU24h;
    if (f.holders > bestHolders) bestHolders = f.holders;
    if (f.trendRecentDownRatio < bestRecentDownRatio) bestRecentDownRatio = f.trendRecentDownRatio;
    if (f.trendConsecutiveDowns < bestConsecutiveDowns) bestConsecutiveDowns = f.trendConsecutiveDowns;
    if (f.earlyReturn < minEarlyReturn) minEarlyReturn = f.earlyReturn;
    if (f.drawdownFromHighest > bestDrawdown) bestDrawdown = f.drawdownFromHighest;

    // 检查是否所有条件同时满足
    if (
      f.trendCV > 0.005 &&
      f.trendDirectionCount >= 2 &&
      f.trendStrengthScore >= 30 &&
      f.trendTotalReturn >= 5 &&
      f.tvl >= 3000 &&
      f.txVolumeU24h >= 3500 &&
      f.holders >= 25 &&
      f.trendRecentDownRatio < 0.5 &&
      f.trendConsecutiveDowns < 2 &&
      f.earlyReturn < 160 &&
      f.drawdownFromHighest > -25
    ) {
      allMetAt = ts;
    }
  }

  // 分析主要失败原因
  const failedReasons = [];
  if (bestTrendCV <= 0.005) failedReasons.push('趋势CV');
  if (bestDirectionCount < 2) failedReasons.push('方向计数');
  if (bestStrengthScore < 30) failedReasons.push('趋势强度');
  if (bestTotalReturn < 5) failedReasons.push('趋势总收益');
  if (bestTvl < 3000) failedReasons.push('TVL');
  if (bestTxVolume < 3500) failedReasons.push('交易量');
  if (bestHolders < 25) failedReasons.push('持有者数');
  if (minEarlyReturn >= 160) failedReasons.push('earlyReturn过高');
  if (bestDrawdown <= -25) failedReasons.push('回撤过大');

  return {
    bestTrendCV,
    bestDirectionCount,
    bestStrengthScore,
    bestTotalReturn,
    bestTvl,
    bestTxVolume,
    bestHolders,
    bestRecentDownRatio,
    bestConsecutiveDowns,
    minEarlyReturn: minEarlyReturn === Infinity ? null : minEarlyReturn,
    bestDrawdown,
    allMetAt,
    failedReasons
  };
}

analyzeHighReturnNoBuyTokens()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
