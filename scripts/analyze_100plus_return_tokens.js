/**
 * 分析涨幅超过 100% 但未购买的代币
 */

const { dbManager } = require('../src/services/dbManager');

async function analyzeHighReturnNoBuy() {
  const supabase = dbManager.getClient();
  const experimentId = '6853949c-ad60-40ac-b4b3-cfd457de99e3';

  // 1. 获取所有代币及其分析结果
  const { data: tokens, error: tokensError } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol, status, platform, analysis_results')
    .eq('experiment_id', experimentId);

  if (tokensError) {
    console.log('❌ 获取代币失败:', tokensError.message);
    return;
  }

  console.log(`📊 总代币数: ${tokens.length}`);

  // 2. 获取已购买代币
  const { data: trades } = await supabase
    .from('trades')
    .select('token_address')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy');

  const boughtAddresses = new Set(trades?.map(t => t.token_address) || []);
  console.log(`📈 已购买代币数: ${boughtAddresses.size}`);

  // 3. 筛选最高涨幅 >= 100% 但未购买的代币
  const noBuyHighReturnTokens = [];
  for (const token of tokens) {
    // 跳过已购买的
    if (boughtAddresses.has(token.token_address)) continue;
    // 跳过黑名单状态
    if (token.status === 'bad_holder' || token.status === 'negative_dev') continue;

    // 解析分析结果
    const analysis = typeof token.analysis_results === 'string'
      ? JSON.parse(token.analysis_results)
      : token.analysis_results;

    if (analysis && analysis.max_change_percent >= 100) {
      noBuyHighReturnTokens.push({
        address: token.token_address,
        symbol: token.token_symbol,
        status: token.status,
        platform: token.platform,
        maxReturn: analysis.max_change_percent,
        finalReturn: analysis.final_change_percent,
        dataPoints: analysis.data_points
      });
    }
  }

  console.log(`\n🔍 最高涨幅 >= 100% 但未购买的代币: ${noBuyHighReturnTokens.length} 个\n`);

  if (noBuyHighReturnTokens.length === 0) {
    console.log('没有符合条件的代币');
    return;
  }

  // 4. 获取这些代币的时序数据
  const addresses = noBuyHighReturnTokens.map(t => t.address);

  // 分批查询时序数据
  const batchSize = 50;
  const failureStats = {
    'earlyReturn>=160': 0,
    '趋势条件不满足': 0,
    'tvl<3000': 0,
    'txVolume<3500': 0,
    'holders<25': 0,
    'drawdown<=-25': 0,
    '数据点不足': 0
  };

  for (let i = 0; i < noBuyHighReturnTokens.length; i += batchSize) {
    const batch = noBuyHighReturnTokens.slice(i, i + batchSize);
    const batchAddresses = batch.map(t => t.address);

    // 获取这些代币的时序数据
    const { data: timeSeriesData } = await supabase
      .from('experiment_time_series_data')
      .select('token_address, loop_count, factor_values')
      .eq('experiment_id', experimentId)
      .in('token_address', batchAddresses)
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

      // 找到最高涨幅时的数据点
      let maxPoint = null;
      let maxEarlyReturn = 0;

      for (const ts of tsList) {
        const f = typeof ts.factor_values === 'string'
          ? JSON.parse(ts.factor_values)
          : ts.factor_values;
        if (f.earlyReturn && f.earlyReturn > maxEarlyReturn) {
          maxEarlyReturn = f.earlyReturn;
          maxPoint = { ...ts, factors: f };
        }
      }

      if (!maxPoint) continue;

      const f = maxPoint.factors;

      // 统计失败原因
      if (f.earlyReturn >= 160) failureStats['earlyReturn>=160']++;
      if (!(f.trendCV > 0.005 && f.trendDirectionCount >= 2 && f.trendStrengthScore >= 30)) {
        failureStats['趋势条件不满足']++;
      }
      if (f.tvl < 3000) failureStats['tvl<3000']++;
      if (f.txVolumeU24h < 3500) failureStats['txVolume<3500']++;
      if (f.holders < 25) failureStats['holders<25']++;
      if (f.drawdownFromHighest <= -25) failureStats['drawdown<=-25']++;
      if (tsList.length < 6) failureStats['数据点不足']++;
    }
  }

  // 现在打印详细信息
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📊 失败原因统计:');
  for (const [reason, count] of Object.entries(failureStats)) {
    if (count > 0) {
      console.log(`  ${reason}: ${count} 个`);
    }
  }

  // 获取时序数据进行详细分析
  for (let i = 0; i < noBuyHighReturnTokens.length; i += batchSize) {
    const batch = noBuyHighReturnTokens.slice(i, i + batchSize);
    const batchAddresses = batch.map(t => t.address);

    const { data: timeSeriesData } = await supabase
      .from('experiment_time_series_data')
      .select('token_address, loop_count, factor_values')
      .eq('experiment_id', experimentId)
      .in('token_address', batchAddresses)
      .order('token_address')
      .order('loop_count', { ascending: true });

    if (!timeSeriesData) continue;

    const tokenTimeSeries = new Map();
    for (const ts of timeSeriesData) {
      if (!tokenTimeSeries.has(ts.token_address)) {
        tokenTimeSeries.set(ts.token_address, []);
      }
      tokenTimeSeries.get(ts.token_address).push(ts);
    }

    // 打印每个代币的详细分析
    for (const token of batch) {
      const tsList = tokenTimeSeries.get(token.address);
      if (!tsList || tsList.length === 0) continue;

      // 找到最高涨幅时的数据点
      let maxPoint = null;
      let maxEarlyReturn = 0;

      for (const ts of tsList) {
        const f = typeof ts.factor_values === 'string'
          ? JSON.parse(ts.factor_values)
          : ts.factor_values;
        if (f.earlyReturn && f.earlyReturn > maxEarlyReturn) {
          maxEarlyReturn = f.earlyReturn;
          maxPoint = { ...ts, factors: f };
        }
      }

      if (!maxPoint) continue;

      const f = maxPoint.factors;

      console.log('\n───────────────────────────────────────────────────────────────');
      console.log(`🪙 ${token.symbol} (${token.address})`);
      console.log(`   平台: ${token.platform} | 状态: ${token.status}`);
      console.log(`   最高涨幅: ${token.maxReturn.toFixed(2)}% | 最终: ${token.finalReturn?.toFixed(2) || 'N/A'}% | 数据点: ${tsList.length}`);
      console.log(`\n   📊 最高点时的买入条件检查:`);

      const check = (cond, val, label) => {
        const status = cond ? '✅' : '❌';
        const valStr = val !== null && val !== undefined ? val.toFixed ? val.toFixed(2) : val : 'null';
        return `      ${status} ${label}: ${valStr}`;
      };

      console.log(check(f.trendCV > 0.005, f.trendCV, 'trendCV>0.005'));
      console.log(check(f.trendDirectionCount >= 2, f.trendDirectionCount, 'directionCount>=2'));
      console.log(check(f.trendStrengthScore >= 30, f.trendStrengthScore, 'strengthScore>=30'));
      console.log(check(f.trendTotalReturn >= 5, f.trendTotalReturn, 'totalReturn>=5'));
      console.log(check(f.tvl >= 3000, f.tvl, 'tvl>=3000'));
      console.log(check(f.txVolumeU24h >= 3500, f.txVolumeU24h, 'txVolume>=3500'));
      console.log(check(f.holders >= 25, f.holders, 'holders>=25'));
      console.log(check(f.trendRecentDownRatio < 0.5, f.trendRecentDownRatio, 'recentDownRatio<0.5'));
      console.log(check(f.trendConsecutiveDowns < 2, f.trendConsecutiveDowns, 'consecutiveDowns<2'));
      console.log(check(f.earlyReturn < 160, f.earlyReturn, 'earlyReturn<160'));
      console.log(check(f.drawdownFromHighest > -25, f.drawdownFromHighest, 'drawdown>-25'));

      // 找出失败的原因
      const failed = [];
      if (!(f.trendCV > 0.005)) failed.push('trendCV');
      if (!(f.trendDirectionCount >= 2)) failed.push('directionCount');
      if (!(f.trendStrengthScore >= 30)) failed.push('strengthScore');
      if (!(f.trendTotalReturn >= 5)) failed.push('totalReturn');
      if (!(f.tvl >= 3000)) failed.push('tvl');
      if (!(f.txVolumeU24h >= 3500)) failed.push('txVolume');
      if (!(f.holders >= 25)) failed.push('holders');
      if (!(f.trendRecentDownRatio < 0.5)) failed.push('recentDownRatio');
      if (!(f.trendConsecutiveDowns < 2)) failed.push('consecutiveDowns');
      if (!(f.earlyReturn < 160)) failed.push('earlyReturn<160');
      if (!(f.drawdownFromHighest > -25)) failed.push('drawdown>-25');

      if (failed.length > 0) {
        console.log(`\n   ❌ 未满足条件: ${failed.join(', ')}`);
      }
    }
  }
}

analyzeHighReturnNoBuy()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
