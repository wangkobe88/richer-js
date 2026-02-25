/**
 * 分析所有未购买代币在生命周期中是否曾经满足过买入条件
 */

const { dbManager } = require('../src/services/dbManager');

async function analyzeAllNoBuyTokens() {
  const supabase = dbManager.getClient();
  const experimentId = '6853949c-ad60-40ac-b4b3-cfd457de99e3';

  // 获取所有代币
  const { data: allTokens } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol, status')
    .eq('experiment_id', experimentId);

  // 获取已购买代币
  const { data: boughtTokens } = await supabase
    .from('trades')
    .select('token_address')
    .eq('experiment_id', experimentId)
    .eq('trade_direction', 'buy');

  const boughtAddresses = new Set(boughtTokens?.map(t => t.token_address) || []);

  // 筛选未购买代币（排除掉一些明显不应该购买的）
  const noBuyTokens = allTokens?.filter(t =>
    !boughtAddresses.has(t.token_address) &&
    t.status !== 'bad_holder' &&
    t.status !== 'negative_dev' &&
    t.status !== 'exited'
  ) || [];

  console.log(`📊 总代币数: ${allTokens?.length || 0}`);
  console.log(`📈 已购买: ${boughtAddresses.size}`);
  console.log(`🔍 未购买且需分析: ${noBuyTokens.length}\n`);

  // 分析每个未购买代币
  const batchSize = 50;
  const neverMetCondition = [];
  const metCondition = [];

  for (let i = 0; i < noBuyTokens.length; i += batchSize) {
    const batch = noBuyTokens.slice(i, i + batchSize);
    const addresses = batch.map(t => t.token_address);

    // 获取时序数据
    const { data: timeSeriesData } = await supabase
      .from('experiment_time_series_data')
      .select('token_address, loop_count, factor_values')
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
      const tsList = tokenTimeSeries.get(token.token_address);
      if (!tsList || tsList.length === 0) {
        neverMetCondition.push({
          ...token,
          reason: '无时序数据',
          dataPoints: 0
        });
        continue;
      }

      let everMetConditions = false;
      let metLoop = null;
      let metFactorValues = null;

      // 检查每个时间点
      for (const ts of tsList) {
        const f = typeof ts.factor_values === 'string'
          ? JSON.parse(ts.factor_values)
          : ts.factor_values;

        // 检查所有买入条件
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
          everMetConditions = true;
          metLoop = ts.loop_count;
          metFactorValues = f;
          break;
        }
      }

      if (everMetConditions) {
        metCondition.push({
          ...token,
          metLoop,
          factorValues: metFactorValues
        });
      } else {
        // 分析主要失败原因
        const reasons = analyzeFailureReasons(tsList);
        neverMetCondition.push({
          ...token,
          reason: reasons.join(', ') || '未知',
          dataPoints: tsList.length,
          details: reasons
        });
      }
    }

    console.log(`已处理 ${Math.min(i + batchSize, noBuyTokens.length)}/${noBuyTokens.length} 个代币`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('📊 分析结果:');
  console.log(`  从未满足买入条件: ${neverMetCondition.length} 个`);
  console.log(`  曾经满足过买入条件: ${metCondition.length} 个`);

  // 统计失败原因
  const reasonStats = {};
  for (const t of neverMetCondition) {
    const mainReason = t.details ? t.details[0] : t.reason || '未知';
    reasonStats[mainReason] = (reasonStats[mainReason] || 0) + 1;
  }

  console.log('\n📊 主要失败原因统计:');
  const sortedReasons = Object.entries(reasonStats).sort((a, b) => b[1] - a[1]);
  for (const [reason, count] of sortedReasons) {
    console.log(`  ${reason}: ${count} 个`);
  }

  // 详细分析曾经满足过条件的代币
  if (metCondition.length > 0) {
    console.log('\n⚠️ 曾经满足过所有买入条件但未购买的代币:');
    for (const t of metCondition) {
      const f = t.factorValues;
      console.log(`\n  代币: ${t.token_symbol} (${t.token_address})`);
      console.log(`  满足条件的 Loop: ${t.metLoop}`);
      console.log(`  关键指标:`);
      console.log(`    trendCV: ${f.trendCV?.toFixed(4)} (需要 > 0.005)`);
      console.log(`    trendDirectionCount: ${f.trendDirectionCount} (需要 >= 2)`);
      console.log(`    trendStrengthScore: ${f.trendStrengthScore} (需要 >= 30)`);
      console.log(`    earlyReturn: ${f.earlyReturn?.toFixed(2)}% (需要 < 160)`);
      console.log(`    tvl: ${f.tvl} (需要 >= 3000)`);
      console.log(`    holders: ${f.holders} (需要 >= 25)`);
      console.log(`    drawdownFromHighest: ${f.drawdownFromHighest?.toFixed(2)} (需要 > -25)`);
    }
  }
}

// 分析主要失败原因
function analyzeFailureReasons(tsList) {
  const reasons = [];

  // 统计每个条件在整个生命周期中是否曾经满足过
  let everHadTrend = false;
  let everHadTvl = false;
  let everHadTxVolume = false;
  let everHadHolders = false;
  let everUnder160 = false;
  let everHadGoodDrawdown = false;

  for (const ts of tsList) {
    const f = typeof ts.factor_values === 'string'
      ? JSON.parse(ts.factor_values)
      : ts.factor_values;

    if (f.trendCV > 0.005 && f.trendDirectionCount >= 2 && f.trendStrengthScore >= 30) everHadTrend = true;
    if (f.tvl >= 3000) everHadTvl = true;
    if (f.txVolumeU24h >= 3500) everHadTxVolume = true;
    if (f.holders >= 25) everHadHolders = true;
    if (f.earlyReturn < 160) everUnder160 = true;
    if (f.drawdownFromHighest > -25) everHadGoodDrawdown = true;
  }

  if (!everHadTrend) reasons.push('趋势条件不满足');
  if (!everHadTvl) reasons.push('TVL不足');
  if (!everHadTxVolume) reasons.push('交易量不足');
  if (!everHadHolders) reasons.push('持有者数不足');
  if (!everUnder160) reasons.push('earlyReturn过高');
  if (!everHadGoodDrawdown) reasons.push('回撤过大');

  return reasons.length > 0 ? reasons : ['未知原因'];
}

analyzeAllNoBuyTokens()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
