/**
 * 检查高涨幅代币数据
 */

const { dbManager } = require('../src/services/dbManager');

async function checkHighReturnTokens() {
  const supabase = dbManager.getClient();
  const experimentId = '6853949c-ad60-40ac-b4b3-cfd457de99e3';

  // 1. 检查 analysis_results 的数据范围
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol, analysis_results')
    .eq('experiment_id', experimentId);

  let hasMax50 = 0;
  let hasMax100 = 0;
  let hasMax300 = 0;
  const maxReturnTokens = [];

  for (const token of tokens) {
    const analysis = typeof token.analysis_results === 'string'
      ? JSON.parse(token.analysis_results)
      : token.analysis_results;

    if (analysis && analysis.max_change_percent !== undefined) {
      if (analysis.max_change_percent >= 50) {
        hasMax50++;
        maxReturnTokens.push({
          address: token.token_address,
          symbol: token.token_symbol,
          maxReturn: analysis.max_change_percent
        });
      }
      if (analysis.max_change_percent >= 100) hasMax100++;
      if (analysis.max_change_percent >= 300) hasMax300++;
    }
  }

  console.log('📊 analysis_results 中的涨幅统计:');
  console.log(`  >= 50%: ${hasMax50} 个`);
  console.log(`  >= 100%: ${hasMax100} 个`);
  console.log(`  >= 300%: ${hasMax300} 个`);

  // 如果数据不对，可能需要触发页面分析
  if (hasMax50 < 100) {
    console.log('\n⚠️ analysis_results 数据可能不完整，建议在页面上点击"开始分析"按钮');
    console.log('    或者使用 TokenAnalysisService 重新分析');
  }

  // 2. 获取已购买代币
  const { data: trades } = await supabase
    .from('trades')
    .select('token_address')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy');

  const boughtAddresses = new Set(trades?.map(t => t.token_address) || []);
  console.log(`\n📈 已购买代币数: ${boughtAddresses.size}`);

  // 3. 找出高涨幅但未购买的代币（从已有的 analysis_results）
  const highReturnNoBuy = maxReturnTokens.filter(t => !boughtAddresses.has(t.address));

  console.log(`\n🔍 最高涨幅 >= 50% 但未购买的代币: ${highReturnNoBuy.length} 个`);

  // 4. 分析这些代币在生命周期中是否满足过买入条件
  // 分批查询时序数据
  const batchSize = 50;
  const neverMetCondition = [];
  const metConditionButNotBought = [];

  for (let i = 0; i < Math.min(highReturnNoBuy.length, 200); i += batchSize) {
    const batch = highReturnNoBuy.slice(i, i + batchSize);
    const addresses = batch.map(t => t.address);

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

    // 检查每个代币是否满足过买入条件
    for (const token of batch) {
      const tsList = tokenTimeSeries.get(token.address);
      if (!tsList || tsList.length === 0) {
        neverMetCondition.push({ ...token, reason: '无时序数据' });
        continue;
      }

      let everMetConditions = false;
      let metLoop = null;
      let metEarlyReturn = null;

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
          metEarlyReturn = f.earlyReturn;
          break;
        }
      }

      if (everMetConditions) {
        metConditionButNotBought.push({
          ...token,
          metLoop,
          metEarlyReturn
        });
      } else {
        // 分析为什么没满足
        const tsList = tokenTimeSeries.get(token.address);
        if (tsList && tsList.length > 0) {
          // 找出主要原因
          let neverHadTrend = 0;
          let neverHadTvl = 0;
          let neverHadTxVolume = 0;
          let neverHadHolders = 0;
          let alwaysOver160 = 0;

          for (const ts of tsList) {
            const f = typeof ts.factor_values === 'string'
              ? JSON.parse(ts.factor_values)
              : ts.factor_values;

            if (!(f.trendCV > 0.005 && f.trendDirectionCount >= 2 && f.trendStrengthScore >= 30)) neverHadTrend++;
            if (f.tvl < 3000) neverHadTvl++;
            if (f.txVolumeU24h < 3500) neverHadTxVolume++;
            if (f.holders < 25) neverHadHolders++;
            if (f.earlyReturn >= 160) alwaysOver160++;
          }

          const totalPoints = tsList.length;
          const reasons = [];
          if (neverHadTrend === totalPoints) reasons.push('始终未满足趋势条件');
          if (neverHadTvl === totalPoints) reasons.push('TVL始终不足');
          if (neverHadTxVolume === totalPoints) reasons.push('交易量始终不足');
          if (neverHadHolders === totalPoints) reasons.push('持有者数始终不足');
          if (alwaysOver160 === totalPoints) reasons.push('earlyReturn始终>=160');

          neverMetCondition.push({
            ...token,
            reason: reasons.join(', ') || '未知原因',
            dataPoints: totalPoints
          });
        }
      }
    }

    console.log(`已处理 ${Math.min(i + batchSize, highReturnNoBuy.length)}/${Math.min(highReturnNoBuy.length, 200)} 个代币`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('📊 分析结果:');
  console.log(`  从未满足买入条件: ${neverMetCondition.length} 个`);
  console.log(`  满足过条件但未买入: ${metConditionButNotBought.length} 个`);

  // 打印前20个从未满足条件的代币
  console.log('\n🔍 从未满足买入条件的前20个代币:');
  for (let i = 0; i < Math.min(20, neverMetCondition.length); i++) {
    const t = neverMetCondition[i];
    console.log(`  ${i + 1}. ${t.symbol} (${t.address}) - 最高${t.maxReturn.toFixed(2)}% - ${t.reason}`);
  }

  // 打印满足过条件但未买入的代币
  if (metConditionButNotBought.length > 0) {
    console.log('\n⚠️ 满足过买入条件但未买入的代币:');
    for (const t of metConditionButNotBought) {
      console.log(`  ${t.symbol} (${t.address}) - 最高${t.maxReturn.toFixed(2)}% - Loop ${t.metLoop} (earlyReturn=${t.metEarlyReturn.toFixed(2)}%)`);
    }
  }

  // 统计失败原因
  const reasonStats = {};
  for (const t of neverMetCondition) {
    const key = t.reason || '未知';
    reasonStats[key] = (reasonStats[key] || 0) + 1;
  }

  console.log('\n📊 失败原因统计:');
  for (const [reason, count] of Object.entries(reasonStats)) {
    console.log(`  ${reason}: ${count} 个`);
  }
}

checkHighReturnTokens()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
