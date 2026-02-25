/**
 * 使用 TokenAnalysisService 分析高涨幅但未买入的代币
 */

const { TokenAnalysisService } = require('../src/web/services/TokenAnalysisService');
const { dbManager } = require('../src/services/dbManager');

async function analyzeNoBuyTokens() {
  const supabase = dbManager.getClient();
  const experimentId = '6853949c-ad60-40ac-b4b3-cfd457de99e3';

  console.log('📊 开始分析实验代币涨幅...\n');

  // 1. 运行涨幅分析
  const analysisService = new TokenAnalysisService();

  const result = await analysisService.analyzeExperimentTokens(experimentId, (current, total) => {
    const percent = ((current / total) * 100).toFixed(1);
    console.log(`  进度: ${current}/${total} (${percent}%)`);
  });

  console.log(`\n✅ 分析完成: ${result.analyzed} 成功, ${result.failed} 失败\n`);

  // 2. 获取分析后的代币数据
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol, status, platform, analysis_results')
    .eq('experiment_id', experimentId);

  // 统计涨幅分布
  const ranges = {
    '0-20%': 0,
    '20-50%': 0,
    '50-100%': 0,
    '100-200%': 0,
    '200-300%': 0,
    '300%+': 0
  };

  const highReturnTokens = []; // >= 50%

  for (const token of tokens) {
    const analysis = typeof token.analysis_results === 'string'
      ? JSON.parse(token.analysis_results)
      : token.analysis_results;

    if (analysis && analysis.max_change_percent !== undefined) {
      const maxReturn = analysis.max_change_percent;
      if (maxReturn < 20) ranges['0-20%']++;
      else if (maxReturn < 50) ranges['20-50%']++;
      else if (maxReturn < 100) {
        ranges['50-100%']++;
        highReturnTokens.push({ ...token, maxReturn });
      }
      else if (maxReturn < 200) {
        ranges['100-200%']++;
        highReturnTokens.push({ ...token, maxReturn });
      }
      else if (maxReturn < 300) {
        ranges['200-300%']++;
        highReturnTokens.push({ ...token, maxReturn });
      }
      else {
        ranges['300%+']++;
        highReturnTokens.push({ ...token, maxReturn });
      }
    }
  }

  console.log('📈 涨幅分布:');
  for (const [range, count] of Object.entries(ranges)) {
    console.log(`  ${range}: ${count} 个`);
  }

  // 3. 获取已购买代币
  const { data: trades } = await supabase
    .from('trades')
    .select('token_address')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy');

  const boughtAddresses = new Set(trades?.map(t => t.token_address) || []);
  console.log(`\n📈 已购买代币数: ${boughtAddresses.size}`);

  // 4. 筛选高涨幅但未购买的代币
  const noBuyHighReturn = highReturnTokens.filter(t => !boughtAddresses.has(t.token_address));
  console.log(`\n🔍 涨幅 >= 50% 但未购买的代币: ${noBuyHighReturn.length} 个\n`);

  // 5. 分析这些代币为什么没有买入
  const batchSize = 50;
  const neverMetCondition = [];
  const metConditionButNotBought = [];

  for (let i = 0; i < noBuyHighReturn.length; i += batchSize) {
    const batch = noBuyHighReturn.slice(i, i + batchSize);
    const addresses = batch.map(t => t.token_address);

    const { data: timeSeriesData } = await supabase
      .from('experiment_time_series_data')
      .select('token_address, loop_count, factor_values')
      .eq('experiment_id', experimentId)
      .in('token_address', addresses)
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

    for (const token of batch) {
      const tsList = tokenTimeSeries.get(token.token_address);
      if (!tsList || tsList.length === 0) continue;

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
        // 分析主要原因
        const reasons = [];
        const totalPoints = tsList.length;

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

        if (!everHadTrend) reasons.push('从未满足趋势条件');
        if (!everHadTvl) reasons.push('TVL从未>=3000');
        if (!everHadTxVolume) reasons.push('交易量从未>=3500');
        if (!everHadHolders) reasons.push('持有者数从未>=25');
        if (!everUnder160) reasons.push('earlyReturn始终>=160');
        if (!everHadGoodDrawdown) reasons.push('回撤始终<=-25');

        neverMetCondition.push({
          ...token,
          reason: reasons.join(', ') || '未知原因',
          dataPoints: totalPoints
        });
      }
    }

    console.log(`已处理 ${Math.min(i + batchSize, noBuyHighReturn.length)}/${noBuyHighReturn.length} 个代币`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('📊 分析结果:');
  console.log(`  从未满足买入条件: ${neverMetCondition.length} 个`);
  console.log(`  满足过条件但未买入: ${metConditionButNotBought.length} 个`);

  // 统计失败原因
  const reasonStats = {};
  for (const t of neverMetCondition) {
    const key = t.reason || '未知';
    reasonStats[key] = (reasonStats[key] || 0) + 1;
  }

  console.log('\n📊 失败原因统计:');
  const sortedReasons = Object.entries(reasonStats).sort((a, b) => b[1] - a[1]);
  for (const [reason, count] of sortedReasons) {
    console.log(`  ${reason}: ${count} 个`);
  }

  // 打印满足过条件但未买入的代币（这些需要调查）
  if (metConditionButNotBought.length > 0) {
    console.log('\n⚠️ 满足过买入条件但未买入的代币:');
    for (const t of metConditionButNotBought) {
      console.log(`  ${t.token_symbol} (${t.token_address}) - 最高${t.maxReturn.toFixed(2)}% - Loop ${t.metLoop} (earlyReturn=${t.metEarlyReturn.toFixed(2)}%)`);
    }
  }
}

analyzeNoBuyTokens()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
