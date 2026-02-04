const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function analyzeFilterFactors() {
  // 1. 获取所有买入信号
  const { data: signals, error: signalsError } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', '303b22cb-d17a-488f-b187-cfd650d0ce7c')
    .eq('action', 'buy')
    .order('created_at', { ascending: true });

  if (signalsError) {
    console.error('Error fetching signals:', signalsError);
    return;
  }

  // 2. 按代币分组，获取第一个信号
  const tokenFirstSignals = new Map();
  for (const signal of signals) {
    const key = signal.token_address;
    if (!tokenFirstSignals.has(key)) {
      tokenFirstSignals.set(key, {
        tokenAddress: signal.token_address,
        symbol: signal.token_symbol || 'Unknown',
        firstSignal: {
          id: signal.id,
          created_at: signal.created_at
        }
      });
    }
  }

  // 3. 获取每个代币的时序数据和分析
  const results = [];

  for (const [tokenAddress, signalData] of tokenFirstSignals) {
    const { data: timeSeries, error: tsError } = await supabase
      .from('experiment_time_series_data')
      .select('*')
      .eq('experiment_id', '303b22cb-d17a-488f-b187-cfd650d0ce7c')
      .eq('token_address', tokenAddress)
      .order('timestamp', { ascending: true });

    if (tsError || !timeSeries || timeSeries.length === 0) {
      continue;
    }

    // 找到第一个信号之后的第一个时序数据点
    const signalTime = new Date(signalData.firstSignal.created_at).getTime();
    const firstAfterSignal = timeSeries.find(ts => new Date(ts.timestamp).getTime() >= signalTime);

    // 最后一个时序数据点
    const lastTimePoint = timeSeries[timeSeries.length - 1];

    if (firstAfterSignal && lastTimePoint) {
      const buyPrice = firstAfterSignal.price_usd || firstAfterSignal.factor_values?.currentPrice;
      const sellPrice = lastTimePoint.price_usd || lastTimePoint.factor_values?.currentPrice;

      if (!buyPrice || !sellPrice) continue;

      const returnPercent = ((sellPrice - buyPrice) / buyPrice) * 100;

      // 获取买入时的因子数据
      const factors = firstAfterSignal.factor_values || {};

      results.push({
        tokenAddress: tokenAddress,
        symbol: signalData.symbol,
        returnPercent: returnPercent,
        isProfit: returnPercent > 0,
        factors: {
          age: factors.age,
          fdv: factors.fdv,
          tvl: factors.tvl,
          holders: factors.holders,
          marketCap: factors.marketCap,
          earlyReturn: factors.earlyReturn,
          txVolumeU24h: factors.txVolumeU24h,
          drawdownFromHighest: factors.drawdownFromHighest,
          currentPrice: factors.currentPrice,
          collectionPrice: factors.collectionPrice
        }
      });
    }
  }

  // 4. 分析盈利和亏损交易的因子差异
  const profitTrades = results.filter(r => r.isProfit);
  const lossTrades = results.filter(r => !r.isProfit);

  console.log('\n========== 盈利 vs 亏损交易因子分析 ==========');
  console.log(`盈利交易: ${profitTrades.length}个`);
  console.log(`亏损交易: ${lossTrades.length}个`);

  // 计算各因子的平均值
  const factorKeys = ['age', 'fdv', 'tvl', 'holders', 'marketCap', 'earlyReturn', 'txVolumeU24h', 'drawdownFromHighest'];

  console.log('\n因子对比 (平均值):');
  console.log('因子 | 盈利交易 | 亏损交易 | 差异');
  console.log('---');

  for (const key of factorKeys) {
    const profitAvg = profitTrades.length > 0
      ? profitTrades.reduce((sum, r) => sum + (r.factors[key] || 0), 0) / profitTrades.length
      : 0;
    const lossAvg = lossTrades.length > 0
      ? lossTrades.reduce((sum, r) => sum + (r.factors[key] || 0), 0) / lossTrades.length
      : 0;
    const diff = profitAvg - lossAvg;

    console.log(`${key} | ${profitAvg.toFixed(2)} | ${lossAvg.toFixed(2)} | ${diff.toFixed(2)}`);
  }

  // 5. 详细数据输出
  console.log('\n========== 详细交易数据 ==========');
  console.log('按收益率排序:');
  results.sort((a, b) => b.returnPercent - a.returnPercent);

  console.log('\n序号 | 代币 | 收益率 | age | fdv | tvl | holders | txVolumeU24h | earlyReturn');
  console.log('---');

  results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.symbol} | ${r.returnPercent.toFixed(2)}% | ${r.factors.age?.toFixed(2)} | ${r.factors.fdv?.toFixed(0)} | ${r.factors.tvl?.toFixed(0)} | ${r.factors.holders} | ${r.factors.txVolumeU24h?.toFixed(0)} | ${r.factors.earlyReturn?.toFixed(2)}%`);
  });

  // 6. 分析可能的过滤条件
  console.log('\n========== 可能的过滤条件分析 ==========');

  // 按不同因子阈值过滤，看效果
  const filters = [
    { name: 'fdv >= 10000', filter: r => r.factors.fdv >= 10000 },
    { name: 'fdv >= 5000', filter: r => r.factors.fdv >= 5000 },
    { name: 'tvl >= 50', filter: r => r.factors.tvl >= 50 },
    { name: 'tvl >= 100', filter: r => r.factors.tvl >= 100 },
    { name: 'holders >= 3', filter: r => r.factors.holders >= 3 },
    { name: 'txVolumeU24h >= 500', filter: r => r.factors.txVolumeU24h >= 500 },
    { name: 'txVolumeU24h >= 1000', filter: r => r.factors.txVolumeU24h >= 1000 },
    { name: 'earlyReturn >= 100', filter: r => r.factors.earlyReturn >= 100 },
    { name: 'earlyReturn >= 150', filter: r => r.factors.earlyReturn >= 150 },
  ];

  console.log('\n过滤条件 | 通过数 | 平均收益率 | 胜率');
  console.log('---');

  for (const { name, filter } of filters) {
    const filtered = results.filter(filter);
    if (filtered.length === 0) continue;

    const avgReturn = filtered.reduce((sum, r) => sum + r.returnPercent, 0) / filtered.length;
    const winRate = (filtered.filter(r => r.returnPercent > 0).length / filtered.length) * 100;

    console.log(`${name} | ${filtered.length} | ${avgReturn.toFixed(2)}% | ${winRate.toFixed(2)}%`);
  }

  // 7. 组合过滤条件
  console.log('\n========== 组合过滤条件 ==========');

  const combinedFilters = [
    { name: 'fdv >= 5000 AND tvl >= 50', filter: r => r.factors.fdv >= 5000 && r.factors.tvl >= 50 },
    { name: 'fdv >= 5000 AND holders >= 3', filter: r => r.factors.fdv >= 5000 && r.factors.holders >= 3 },
    { name: 'tvl >= 50 AND holders >= 3', filter: r => r.factors.tvl >= 50 && r.factors.holders >= 3 },
    { name: 'fdv >= 5000 AND tvl >= 50 AND holders >= 3', filter: r => r.factors.fdv >= 5000 && r.factors.tvl >= 50 && r.factors.holders >= 3 },
    { name: 'fdv >= 5000 AND tvl >= 50 AND holders >= 3 AND txVolumeU24h >= 500', filter: r => r.factors.fdv >= 5000 && r.factors.tvl >= 50 && r.factors.holders >= 3 && r.factors.txVolumeU24h >= 500 },
  ];

  console.log('\n过滤条件 | 通过数 | 平均收益率 | 胜率 | 总收益');
  console.log('---');

  for (const { name, filter } of combinedFilters) {
    const filtered = results.filter(filter);
    if (filtered.length === 0) continue;

    const avgReturn = filtered.reduce((sum, r) => sum + r.returnPercent, 0) / filtered.length;
    const winRate = (filtered.filter(r => r.returnPercent > 0).length / filtered.length) * 100;
    const totalReturn = filtered.reduce((sum, r) => sum + r.returnPercent, 0);

    console.log(`${name} | ${filtered.length} | ${avgReturn.toFixed(2)}% | ${winRate.toFixed(2)}% | ${totalReturn.toFixed(2)}%`);
  }
}

analyzeFilterFactors();
