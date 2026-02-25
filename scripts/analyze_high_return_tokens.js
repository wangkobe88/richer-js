/**
 * 分析高涨幅但未购买的代币
 */

const { dbManager } = require('../src/services/dbManager');

async function analyzeNoBuyTokens() {
  const supabase = dbManager.getClient();
  const experimentId = '6853949c-ad60-40ac-b4b3-cfd457de99e3';

  console.log('📊 开始分析...\n');

  // 1. 分批获取时序数据（避免超时）
  // 先获取所有代币地址
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol, status, platform')
    .eq('experiment_id', experimentId);

  const tokenAddresses = tokens.map(t => t.token_address);
  const batchSize = 100;
  const allTimeSeries = [];

  console.log(`📊 总代币数: ${tokenAddresses.length}`);

  // 分批查询时序数据
  for (let i = 0; i < tokenAddresses.length; i += batchSize) {
    const batch = tokenAddresses.slice(i, i + batchSize);
    const { data: batchData, error: batchError } = await supabase
      .from('experiment_time_series_data')
      .select('token_address, loop_count, factor_values')
      .eq('experiment_id', experimentId)
      .in('token_address', batch);

    if (batchError) {
      console.log(`⚠️ 批次 ${i}-${i + batchSize} 查询失败:`, batchError.message);
    } else if (batchData) {
      allTimeSeries.push(...batchData);
      console.log(`✅ 已处理 ${Math.min(i + batchSize, tokenAddresses.length)}/${tokenAddresses.length} 个代币`);
    }
  }

  if (tsError) {
    console.log('❌ 获取时序数据失败:', tsError.message);
    return;
  }

  console.log(`✅ 获取时序数据: ${allTimeSeries.length} 条`);

  // 2. 按代币分组，计算最高涨幅
  const tokenMaxReturns = new Map(); // token_address -> { maxReturn, maxLoop, dataPoints }

  for (const ts of allTimeSeries) {
    const factors = typeof ts.factor_values === 'string'
      ? JSON.parse(ts.factor_values)
      : ts.factor_values;

    if (!factors.earlyReturn) continue;

    if (!tokenMaxReturns.has(ts.token_address)) {
      tokenMaxReturns.set(ts.token_address, {
        maxReturn: factors.earlyReturn,
        maxLoop: ts.loop_count,
        dataPoints: 0
      });
    }

    const record = tokenMaxReturns.get(ts.token_address);
    record.dataPoints++;
    if (factors.earlyReturn > record.maxReturn) {
      record.maxReturn = factors.earlyReturn;
      record.maxLoop = ts.loop_count;
    }
  }

  // 3. 获取已购买代币
  const { data: trades } = await supabase
    .from('trades')
    .select('token_address')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy');

  const boughtAddresses = new Set(trades?.map(t => t.token_address) || []);

  // 4. 获取代币基本信息
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol, status, platform')
    .eq('experiment_id', experimentId);

  const tokenInfo = new Map();
  for (const t of tokens) {
    tokenInfo.set(t.token_address, t);
  }

  // 5. 筛选高涨幅但未购买的代币
  const noBuyHighReturnTokens = [];
  for (const [address, record] of tokenMaxReturns.entries()) {
    if (record.maxReturn >= 300 && !boughtAddresses.has(address)) {
      const info = tokenInfo.get(address);
      if (info && info.status !== 'bad_holder' && info.status !== 'negative_dev') {
        noBuyHighReturnTokens.push({
          address,
          symbol: info.token_symbol,
          status: info.status,
          platform: info.platform,
          maxReturn: record.maxReturn,
          maxLoop: record.maxLoop,
          dataPoints: record.dataPoints
        });
      }
    }
  }

  console.log(`\n🔍 最高涨幅 >= 300% 但未购买的代币: ${noBuyHighReturnTokens.length} 个\n`);

  // 6. 分析每个代币未购买的原因
  // 重新查询时序数据（只查这些代币的最高点数据）
  const addresses = noBuyHighReturnTokens.map(t => t.token_address = t.address);
  const { data: maxPointData } = await supabase
    .from('experiment_time_series_data')
    .select('token_address, loop_count, factor_values, signal_type')
    .eq('experiment_id', experimentId)
    .in('token_address', addresses);

  // 构建查找映射
  const maxPointsMap = new Map();
  for (const d of maxPointData) {
    maxPointsMap.set(`${d.token_address}_${d.loop_count}`, d);
  }

  console.log('═══════════════════════════════════════════════════════════════');
  for (const token of noBuyHighReturnTokens) {
    const key = `${token.address}_${token.maxLoop}`;
    const maxPoint = maxPointsMap.get(key);

    console.log(`🪙 ${token.symbol} (${token.address})`);
    console.log(`   平台: ${token.platform} | 状态: ${token.status} | 数据点: ${token.dataPoints}`);
    console.log(`   最高涨幅: ${token.maxReturn.toFixed(2)}% (Loop ${token.maxLoop})`);

    if (maxPoint) {
      const f = typeof maxPoint.factor_values === 'string'
        ? JSON.parse(maxPoint.factor_values)
        : maxPoint.factor_values;

      console.log(`\n   📊 最高点时的买入条件检查:`);

      const c1 = f.trendCV > 0.005;
      const c2 = f.trendDirectionCount >= 2;
      const c3 = f.trendStrengthScore >= 30;
      const c4 = f.trendTotalReturn >= 5;
      const c5 = f.tvl >= 3000;
      const c6 = f.txVolumeU24h >= 3500;
      const c7 = f.holders >= 25;
      const c8 = f.trendRecentDownRatio < 0.5;
      const c9 = f.trendConsecutiveDowns < 2;
      const c10 = f.earlyReturn < 160;
      const c11 = f.drawdownFromHighest > -25;

      console.log(`      c1(trendCV>0.005): ${c1 ? '✅' : '❌'} ${f.trendCV?.toFixed(4) ?? 'null'}`);
      console.log(`      c2(directionCount>=2): ${c2 ? '✅' : '❌'} ${f.trendDirectionCount ?? 'null'}`);
      console.log(`      c3(strengthScore>=30): ${c3 ? '✅' : '❌'} ${f.trendStrengthScore ?? 'null'}`);
      console.log(`      c4(totalReturn>=5): ${c4 ? '✅' : '❌'} ${f.trendTotalReturn?.toFixed(2) ?? 'null'}`);
      console.log(`      c5(tvl>=3000): ${c5 ? '✅' : '❌'} ${f.tvl?.toFixed(0) ?? 'null'}`);
      console.log(`      c6(txVolume>=3500): ${c6 ? '✅' : '❌'} ${f.txVolumeU24h?.toFixed(0) ?? 'null'}`);
      console.log(`      c7(holders>=25): ${c7 ? '✅' : '❌'} ${f.holders ?? 'null'}`);
      console.log(`      c8(recentDownRatio<0.5): ${c8 ? '✅' : '❌'} ${f.trendRecentDownRatio ?? 'null'}`);
      console.log(`      c9(consecutiveDowns<2): ${c9 ? '✅' : '❌'} ${f.trendConsecutiveDowns ?? 'null'}`);
      console.log(`      c10(earlyReturn<160): ${c10 ? '✅' : '❌'} ${f.earlyReturn?.toFixed(2) ?? 'null'}`);
      console.log(`      c11(drawdown>-25): ${c11 ? '✅' : '❌'} ${f.drawdownFromHighest?.toFixed(2) ?? 'null'}`);

      const failedConditions = [];
      if (!c1) failedConditions.push('trendCV');
      if (!c2) failedConditions.push('trendDirectionCount');
      if (!c3) failedConditions.push('trendStrengthScore');
      if (!c4) failedConditions.push('trendTotalReturn');
      if (!c5) failedConditions.push('tvl');
      if (!c6) failedConditions.push('txVolumeU24h');
      if (!c7) failedConditions.push('holders');
      if (!c8) failedConditions.push('trendRecentDownRatio');
      if (!c9) failedConditions.push('trendConsecutiveDowns');
      if (!c10) failedConditions.push('earlyReturn<160');
      if (!c11) failedConditions.push('drawdownFromHighest>-25');

      if (failedConditions.length > 0) {
        console.log(`\n   ❌ 未满足条件: ${failedConditions.join(', ')}`);
      }
    }
    console.log();
  }

  // 7. 统计失败原因
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📊 失败原因统计:\n');

  const failureReasons = {
    'earlyReturn>=160': 0,
    '趋势条件不满足': 0,
    'tvl<3000': 0,
    'txVolume<3500': 0,
    'holders<25': 0,
    'drawdown<=-25': 0
  };

  for (const token of noBuyHighReturnTokens) {
    const key = `${token.address}_${token.maxLoop}`;
    const maxPoint = maxPointsMap.get(key);
    if (maxPoint) {
      const f = typeof maxPoint.factor_values === 'string'
        ? JSON.parse(maxPoint.factor_values)
        : maxPoint.factor_values;

      if (f.earlyReturn >= 160) failureReasons['earlyReturn>=160']++;
      if (!(f.trendCV > 0.005 && f.trendDirectionCount >= 2 && f.trendStrengthScore >= 30)) {
        failureReasons['趋势条件不满足']++;
      }
      if (f.tvl < 3000) failureReasons['tvl<3000']++;
      if (f.txVolumeU24h < 3500) failureReasons['txVolume<3500']++;
      if (f.holders < 25) failureReasons['holders<25']++;
      if (f.drawdownFromHighest <= -25) failureReasons['drawdown<=-25']++;
    }
  }

  for (const [reason, count] of Object.entries(failureReasons)) {
    if (count > 0) {
      console.log(`  ${reason}: ${count} 个`);
    }
  }
}

analyzeNoBuyTokens()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
