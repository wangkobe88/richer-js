const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function analyzeMissedOpportunities() {
  // 1. 获取所有买入信号的代币地址
  const { data: signals, error: signalsError } = await supabase
    .from('strategy_signals')
    .select('token_address')
    .eq('experiment_id', '303b22cb-d17a-488f-b187-cfd650d0ce7c')
    .eq('action', 'buy');

  if (signalsError) {
    console.error('Error fetching signals:', signalsError);
    return;
  }

  const signalTokens = new Set(signals.map(s => s.token_address));
  console.log('有买入信号的代币数:', signalTokens.size);

  // 2. 获取所有代币（从 experiment_tokens）
  const { data: allTokens, error: tokensError } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol')
    .eq('experiment_id', '303b22cb-d17a-488f-b187-cfd650d0ce7c');

  if (tokensError) {
    console.error('Error fetching tokens:', tokensError);
    return;
  }

  console.log('总代币数:', allTokens?.length || 0);

  // 3. 找出没有买入信号的代币
  const noSignalTokens = (allTokens || []).filter(t => !signalTokens.has(t.token_address));
  console.log('没有买入信号的代币数:', noSignalTokens.length);

  // 4. 逐个分析没有信号的代币
  const results = [];
  let processedCount = 0;

  for (const { token_address, token_symbol } of noSignalTokens) {
    // 只获取该代币的第一个和最后一个时序数据点
    const { data: firstLast, error: tsError } = await supabase
      .from('experiment_time_series_data')
      .select('token_address, token_symbol, timestamp, price_usd, factor_values')
      .eq('experiment_id', '303b22cb-d17a-488f-b187-cfd650d0ce7c')
      .eq('token_address', token_address)
      .order('timestamp', { ascending: true })
      .limit(1000);  // 限制数量

    if (tsError || !firstLast || firstLast.length < 2) {
      continue;
    }

    processedCount++;

    const firstPoint = firstLast[0];
    const lastPoint = firstLast[firstLast.length - 1];

    const firstPrice = firstPoint.price_usd || firstPoint.factor_values?.currentPrice;
    const lastPrice = lastPoint.price_usd || lastPoint.factor_values?.currentPrice;

    if (!firstPrice || !lastPrice || firstPrice === 0) continue;

    const returnPercent = ((lastPrice - firstPrice) / firstPrice) * 100;

    // 计算最高收益
    let maxPrice = firstPrice;
    for (const pt of firstLast) {
      const price = pt.price_usd || pt.factor_values?.currentPrice;
      if (price && price > maxPrice) maxPrice = price;
    }
    const maxReturn = ((maxPrice - firstPrice) / firstPrice) * 100;

    const firstFactors = firstPoint.factor_values || {};

    results.push({
      tokenAddress: token_address,
      symbol: token_symbol || 'Unknown',
      returnPercent: returnPercent,
      maxReturn: maxReturn,
      dataPoints: firstLast.length,
      factors: {
        age: firstFactors.age,
        fdv: firstFactors.fdv,
        tvl: firstFactors.tvl,
        holders: firstFactors.holders,
        earlyReturn: firstFactors.earlyReturn,
        txVolumeU24h: firstFactors.txVolumeU24h,
        currentPrice: firstFactors.currentPrice
      }
    });

    // 每处理50个代币输出一次进度
    if (processedCount % 50 === 0) {
      console.log(`已处理 ${processedCount} 个代币...`);
    }
  }

  console.log(`\n总共处理了 ${processedCount} 个代币`);

  // 5. 排序并分析
  results.sort((a, b) => b.returnPercent - a.returnPercent);

  console.log('\n========== 没有信号的代币 - 按最终收益率排序 (前30个) ==========');
  console.log('序号 | 代币 | 最终收益率 | 最高收益率 | 数据点 | fdv | tvl | holders | earlyReturn%');
  console.log('---');

  results.slice(0, 30).forEach((r, i) => {
    console.log(`${i + 1}. ${r.symbol} | ${r.returnPercent.toFixed(2)}% | ${r.maxReturn.toFixed(2)}% | ${r.dataPoints} | ${r.factors.fdv?.toFixed(0) || 'N/A'} | ${r.factors.tvl?.toFixed(0) || 'N/A'} | ${r.factors.holders || 'N/A'} | ${r.factors.earlyReturn?.toFixed(2) || 'N/A'}%`);
  });

  // 6. 统计分析
  const highReturnTokens = results.filter(r => r.returnPercent >= 50);
  const moderateReturnTokens = results.filter(r => r.returnPercent >= 20 && r.returnPercent < 50);
  const negativeReturnTokens = results.filter(r => r.returnPercent < 0);

  console.log('\n========== 收益率分布 ==========');
  console.log('高收益(>=50%):', highReturnTokens.length, '个');
  console.log('中等收益(20-50%):', moderateReturnTokens.length, '个');
  console.log('亏损(<0%):', negativeReturnTokens.length, '个');

  if (highReturnTokens.length > 0) {
    const avgHighReturn = highReturnTokens.reduce((sum, r) => sum + r.returnPercent, 0) / highReturnTokens.length;
    console.log('高收益平均收益率:', avgHighReturn.toFixed(2) + '%');
  }

  // 7. 分析高收益代币的特征
  console.log('\n========== 高收益代币(>=50%)因子分析 ==========');
  if (highReturnTokens.length > 0) {
    const factors = ['age', 'fdv', 'tvl', 'holders', 'earlyReturn', 'txVolumeU24h'];
    console.log('因子 | 平均值');
    console.log('---');

    for (const factor of factors) {
      const values = highReturnTokens.map(r => r.factors[factor]).filter(v => v !== undefined && v !== null);
      if (values.length === 0) continue;
      const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
      console.log(`${factor} | ${avg.toFixed(2)}`);
    }
  }

  // 8. 分析为什么这些代币没有触发买入信号
  console.log('\n========== 为什么没有触发买入信号？ ==========');
  console.log('当前买入策略条件: age < 5 AND earlyReturn >= 50 AND earlyReturn < 150');

  if (highReturnTokens.length > 0) {
    console.log('\n高收益代币的策略条件满足情况 (前15个):');
    highReturnTokens.slice(0, 15).forEach((r, i) => {
      const ageOk = r.factors.age !== undefined && r.factors.age < 5;
      const earlyReturnMinOk = r.factors.earlyReturn !== undefined && r.factors.earlyReturn >= 50;
      const earlyReturnMaxOk = r.factors.earlyReturn !== undefined && r.factors.earlyReturn < 150;
      const earlyReturnOk = earlyReturnMinOk && earlyReturnMaxOk;
      const priceOk = r.factors.currentPrice > 0;

      const reasons = [];
      if (!ageOk) reasons.push('age>=5');
      if (!earlyReturnMinOk) reasons.push('earlyReturn<50');
      if (!earlyReturnMaxOk) reasons.push('earlyReturn>=150');
      if (!priceOk) reasons.push('price<=0');

      console.log(`${i + 1}. ${r.symbol}: 收益${r.returnPercent.toFixed(2)}% | 未满足: ${reasons.join(', ') || '无(全部满足)'}`);
    });
  }

  // 9. 测试不同的 earlyReturn 阈值
  console.log('\n========== 如果改变 earlyReturn 阈值 ==========');
  const earlyReturnTests = [30, 40, 50, 60, 70, 80, 100];

  console.log('阈值 | 满足条件的代币数 | 这些代币的平均收益 | 这些代币中高收益(>=50%)占比');
  console.log('---');

  for (const threshold of earlyReturnTests) {
    const matched = results.filter(r => r.factors.earlyReturn >= threshold);
    if (matched.length === 0) continue;

    const avgReturn = matched.reduce((sum, r) => sum + r.returnPercent, 0) / matched.length;
    const highReturnCount = matched.filter(r => r.returnPercent >= 50).length;
    const highReturnRatio = matched.length > 0 ? (highReturnCount / matched.length) * 100 : 0;

    console.log(`earlyReturn >= ${threshold} | ${matched.length} | ${avgReturn.toFixed(2)}% | ${highReturnRatio.toFixed(2)}%`);
  }

  // 10. 分析 earlyReturn >= 150 的代币
  console.log('\n========== earlyReturn >= 150 的代币分析 ==========');
  const veryHighEarlyReturn = results.filter(r => r.factors.earlyReturn >= 150);

  if (veryHighEarlyReturn.length > 0) {
    console.log(`代币数量: ${veryHighEarlyReturn.length}`);
    const avgReturn = veryHighEarlyReturn.reduce((sum, r) => sum + r.returnPercent, 0) / veryHighEarlyReturn.length;
    const highReturnCount = veryHighEarlyReturn.filter(r => r.returnPercent >= 50).length;
    const positiveCount = veryHighEarlyReturn.filter(r => r.returnPercent > 0).length;

    console.log(`平均最终收益率: ${avgReturn.toFixed(2)}%`);
    console.log(`其中盈利的: ${positiveCount}个 (${(positiveCount / veryHighEarlyReturn.length * 100).toFixed(2)}%)`);
    console.log(`其中高收益(>=50%)的: ${highReturnCount}个`);

    console.log('\n这些代币的详细情况 (前10个):');
    veryHighEarlyReturn.slice(0, 10).forEach((r, i) => {
      console.log(`${i + 1}. ${r.symbol}: earlyReturn=${r.factors.earlyReturn?.toFixed(2)}%, 最终收益=${r.returnPercent.toFixed(2)}%, 最高收益=${r.maxReturn.toFixed(2)}%`);
    });
  } else {
    console.log('没有 earlyReturn >= 150 的代币');
  }
}

analyzeMissedOpportunities();
