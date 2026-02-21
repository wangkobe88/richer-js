require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

async function main() {
  // 获取源实验 0cc6804d 的所有代币数据
  const { data: timeSeries } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', '0cc6804d-834e-44f8-8287-c4b4a78abd30')
    .order('timestamp', { ascending: true });

  if (!timeSeries) {
    console.log('没有数据');
    return;
  }

  // 按代币分组
  const byToken = new Map();
  for (const ts of timeSeries) {
    const addr = ts.token_address;
    if (!byToken.has(addr)) {
      byToken.set(addr, {
        symbol: ts.token_symbol,
        address: addr,
        prices: []
      });
    }
    byToken.get(addr).prices.push({
      timestamp: new Date(ts.timestamp).getTime(),
      price: parseFloat(ts.price_usd) || 0,
      holders: ts.factor_values?.holders || 0,
      tvl: ts.factor_values?.tvl || 0,
      fdv: ts.factor_values?.fdv || 0
    });
  }

  // "断头台"代币地址
  const guillotineAddresses = new Set([
    '0x60f49cc3e8343764c2954ee8be82c98cf586ffff',
    '0xe17df11817754c9c15ee912e459d812e4d0fffff'
  ]);

  // 分析每个代币的早期特征
  const results = [];
  for (const [addr, data] of byToken) {
    const prices = data.prices.filter(p => p.price > 0);
    if (prices.length < 10) continue;

    // 前 10 个数据点（买入决策期）
    const earlyPrices = prices.slice(0, 10);

    // 计算指标
    const firstPrice = earlyPrices[0].price;
    const lastEarlyPrice = earlyPrices[earlyPrices.length - 1].price;
    const earlyChange = ((lastEarlyPrice - firstPrice) / firstPrice * 100);

    // 最大单次跳跃
    let maxSingleJump = 0;
    for (let i = 1; i < earlyPrices.length; i++) {
      const change = ((earlyPrices[i].price - earlyPrices[i-1].price) / earlyPrices[i-1].price) * 100;
      if (change > maxSingleJump) maxSingleJump = change;
    }

    // Holders
    const holdersValues = earlyPrices.map(p => p.holders);
    const avgHolders = holdersValues.reduce((a, b) => a + b, 0) / holdersValues.length;
    const minHolders = Math.min(...holdersValues);

    // TVL/FDV
    const avgTvl = earlyPrices.reduce((sum, p) => sum + p.tvl, 0) / earlyPrices.length;
    const avgFd = earlyPrices.reduce((sum, p) => sum + p.fdv, 0) / earlyPrices.length;
    const tvlToFdvRatio = avgFd > 0 ? avgTvl / avgFd : 0;

    // 全周期数据
    const maxPrice = Math.max(...prices.map(p => p.price));
    const minPrice = Math.min(...prices.map(p => p.price));
    const fullCycleRise = ((maxPrice - firstPrice) / firstPrice * 100);
    const fullCycleDrop = ((minPrice - maxPrice) / maxPrice * 100);

    results.push({
      symbol: data.symbol,
      address: addr,
      isGuillotine: guillotineAddresses.has(addr),
      earlyChange,
      maxSingleJump,
      avgHolders,
      minHolders,
      tvlToFdvRatio,
      fullCycleRise,
      fullCycleDrop
    });
  }

  // 按类型分组
  const guillotine = results.filter(r => r.isGuillotine);
  const normal = results.filter(r => !r.isGuillotine);

  console.log('=== "断头台"代币 ===');
  for (const r of guillotine) {
    console.log(`\n${r.symbol}:`);
    console.log(`  早期涨幅: ${r.earlyChange.toFixed(2)}%`);
    console.log(`  最大单次跳跃: ${r.maxSingleJump.toFixed(2)}%`);
    console.log(`  平均 holders: ${r.avgHolders.toFixed(0)} (最低: ${r.minHolders})`);
    console.log(`  TVL/FDV: ${r.tvlToFdvRatio.toFixed(3)}`);
    console.log(`  全周期: +${r.fullCycleRise.toFixed(0)}% / ${r.fullCycleDrop.toFixed(0)}%`);
  }

  console.log('\n=== 正常代币（随机抽样10个）===');
  const sampledNormal = normal.sort(() => Math.random() - 0.5).slice(0, 10);
  for (const r of sampledNormal) {
    console.log(`\n${r.symbol}:`);
    console.log(`  早期涨幅: ${r.earlyChange.toFixed(2)}%`);
    console.log(`  最大单次跳跃: ${r.maxSingleJump.toFixed(2)}%`);
    console.log(`  平均 holders: ${r.avgHolders.toFixed(0)} (最低: ${r.minHolders})`);
    console.log(`  TVL/FDV: ${r.tvlToFdvRatio.toFixed(3)}`);
    console.log(`  全周期: +${r.fullCycleRise.toFixed(0)}% / ${r.fullCycleDrop.toFixed(0)}%`);
  }

  // 统计对比
  console.log('\n\n=== 统计对比 ===');

  const gAvgHolders = guillotine.reduce((sum, r) => sum + r.avgHolders, 0) / guillotine.length;
  const nAvgHolders = normal.reduce((sum, r) => sum + r.avgHolders, 0) / normal.length;

  const gMaxJump = guillotine.reduce((sum, r) => sum + r.maxSingleJump, 0) / guillotine.length;
  const nMaxJump = normal.reduce((sum, r) => sum + r.maxSingleJump, 0) / normal.length;

  const gTvlRatio = guillotine.reduce((sum, r) => sum + r.tvlToFdvRatio, 0) / guillotine.length;
  const nTvlRatio = normal.reduce((sum, r) => sum + r.tvlToFdvRatio, 0) / normal.length;

  const gDrop = guillotine.reduce((sum, r) => sum + Math.abs(r.fullCycleDrop), 0) / guillotine.length;
  const nDrop = normal.reduce((sum, r) => sum + Math.abs(r.fullCycleDrop), 0) / normal.length;

  console.log(`\n平均 Holders:`);
  console.log(`  断头台: ${gAvgHolders.toFixed(0)}`);
  console.log(`  正常代币: ${nAvgHolders.toFixed(0)}`);

  console.log(`\n平均最大单次跳跃:`);
  console.log(`  断头台: ${gMaxJump.toFixed(2)}%`);
  console.log(`  正常代币: ${nMaxJump.toFixed(2)}%`);

  console.log(`\n平均 TVL/FDV:`);
  console.log(`  断头台: ${gTvlRatio.toFixed(3)}`);
  console.log(`  正常代币: ${nTvlRatio.toFixed(3)}`);

  console.log(`\n平均最大跌幅:`);
  console.log(`  断头台: ${gDrop.toFixed(2)}%`);
  console.log(`  正常代币: ${nDrop.toFixed(2)}%`);

  // 建议过滤条件
  console.log('\n\n=== 建议的过滤条件 ===');

  // 找最佳阈值
  const sortedByHolders = [...normal].sort((a, b) => a.avgHolders - b.avgHolders);
  const holdersPercentile10 = sortedByHolders[Math.floor(normal.length * 0.1)]?.avgHolders || 30;
  const holdersPercentile25 = sortedByHolders[Math.floor(normal.length * 0.25)]?.avgHolders || 50;

  const sortedByJump = [...normal].sort((a, b) => a.maxSingleJump - b.maxSingleJump);
  const jumpPercentile90 = sortedByJump[Math.floor(normal.length * 0.9)]?.maxSingleJump || 50;

  console.log(`\n1. Holder 过少检测:`);
  console.log(`   holders < ${holdersPercentile25}`);
  console.log(`   → 断头台平均 ${gAvgHolders.toFixed(0)}, 正常代币 25% 分位 ${holdersPercentile25.toFixed(0)}`);

  console.log(`\n2. 异常价格跳跃检测:`);
  console.log(`   连续2次单次涨幅 > 50%`);
  console.log(`   → 断头台平均 ${gMaxJump.toFixed(2)}%, 正常代币 90% 分位 ${jumpPercentile90.toFixed(2)}%`);

  console.log(`\n3. TVL/FDV 比例:`);
  console.log(`   tvl / fdv < 0.6`);
  console.log(`   → 断头台平均 ${gTvlRatio.toFixed(3)}, 正常代币平均 ${nTvlRatio.toFixed(3)}`);

  // 综合过滤规则
  console.log(`\n\n=== 综合过滤规则 ===`);
  console.log(`建议在买入条件中添加以下过滤:`);
  console.log(``);
  console.log(`// 过滤"断头台"代币`);
  console.log(`AND (`);
  console.log(`  // 1. Holder 不能太少`);
  console.log(`  holders >= ${Math.max(30, holdersPercentile25)}`);
  console.log(`  OR`);
  console.log(`  // 2. TVL/FDV 比例正常（流动性真实）`);
  console.log(`  (tvl / fdv) >= 0.6`);
  console.log(`)`);
}

main().catch(console.error);
