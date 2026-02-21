require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

// "断头台"代币
const guillotineTokens = [
  { expId: '0c616581-aa7f-4fcf-beed-6c84488925fb', address: '0x4b838ebd1f9efcdf1ea31d3cf858a98015584444', name: '迎财福袋' },
  { expId: '0cc6804d-834e-44f8-8287-c4b4a78abd30', address: '0x60f49cc3e8343764c2954ee8be82c98cf586ffff', name: '币安财神' },
  { expId: '0cc6804d-834e-44f8-8287-c4b4a78abd30', address: '0xe17df11817754c9c15ee912e459d812e4d0fffff', name: '财神' }
];

// 正常盈利代币作为对比
const normalTokens = [
  { expId: '0cc6804d-834e-44f8-8287-c4b4a78abd30', address: '0x3ef3a1e38861bd0ee9cb0aaa0e3734e86914fc61', name: 'Martian' }, // +147.55%
  { expId: '0cc6804d-834e-44f8-8287-c4b4a78abd30', address: '0x81f1de5eed7bf1bbccabedcd8447c0793b0e8de2', name: 'CATALIEN' }, // +53.54%
];

async function analyzeEarlySignals(expId, tokenAddress, tokenName) {
  const { data: timeSeries } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', expId)
    .eq('token_address', tokenAddress)
    .order('timestamp', { ascending: true });

  if (!timeSeries || timeSeries.length < 10) {
    return null;
  }

  const prices = timeSeries.map(ts => ({
    timestamp: new Date(ts.timestamp).getTime(),
    price: parseFloat(ts.price_usd) || 0,
    holders: ts.factor_values?.holders || 0,
    tvl: ts.factor_values?.tvl || 0,
    fdv: ts.factor_values?.fdv || 0,
    txVolumeU24h: ts.factor_values?.txVolumeU24h || 0
  })).filter(p => p.price > 0);

  // 分析前 10 个数据点（买入决策时刻）
  const earlyPrices = prices.slice(0, Math.min(15, prices.length));

  // 计算早期信号
  const firstPrice = earlyPrices[0].price;
  const lastEarlyPrice = earlyPrices[earlyPrices.length - 1].price;
  const earlyChange = ((lastEarlyPrice - firstPrice) / firstPrice * 100);

  // 价格波动性（前15个点）
  let maxSingleJump = 0;
  for (let i = 1; i < earlyPrices.length; i++) {
    const change = ((earlyPrices[i].price - earlyPrices[i-1].price) / earlyPrices[i-1].price) * 100;
    if (change > maxSingleJump) maxSingleJump = change;
  }

  // Holders 稳定性
  const holdersValues = earlyPrices.map(p => p.holders);
  const avgHolders = holdersValues.reduce((a, b) => a + b, 0) / holdersValues.length;
  const minHolders = Math.min(...holdersValues);
  const holdersStability = minHolders / avgHolders; // 越低越不稳定

  // TVL/FDV 比例（检测虚假流动性）
  const avgTvl = earlyPrices.reduce((sum, p) => sum + p.tvl, 0) / earlyPrices.length;
  const avgFd = earlyPrices.reduce((sum, p) => sum + p.fdv, 0) / earlyPrices.length;
  const tvlToFdvRatio = avgFd > 0 ? avgTvl / avgFd : 0;

  return {
    name: tokenName,
    address: tokenAddress,
    earlyChange,
    maxSingleJump,
    avgHolders,
    minHolders,
    holdersStability,
    tvlToFdvRatio,
    avgTxVolume: earlyPrices.reduce((sum, p) => sum + p.txVolumeU24h, 0) / earlyPrices.length,
    // 全周期数据（用于验证）
    fullCycleMaxRise: Math.max(...prices.map(p => p.price)) / firstPrice * 100 - 100,
    fullCycleMaxDrop: Math.min(...prices.map(p => p.price)) / Math.max(...prices.map(p => p.price)) * 100 - 100
  };
}

async function main() {
  console.log('=== "断头台"代币早期信号分析 ===\n');

  console.log('【断头台代币】');
  const guillotineResults = [];
  for (const token of guillotineTokens) {
    const result = await analyzeEarlySignals(token.expId, token.address, token.name);
    if (result) {
      guillotineResults.push(result);
      console.log(`\n${result.name}:`);
      console.log(`  前15点涨幅: ${result.earlyChange.toFixed(2)}%`);
      console.log(`  最大单次跳跃: ${result.maxSingleJump.toFixed(2)}%`);
      console.log(`  平均 holders: ${result.avgHolders.toFixed(0)} (最低: ${result.minHolders})`);
      console.log(`  Holder 稳定性: ${(result.holdersStability * 100).toFixed(0)}%`);
      console.log(`  TVL/FDV 比例: ${result.tvlToFdvRatio.toFixed(3)}`);
      console.log(`  全周期: 涨 ${result.fullCycleMaxRise.toFixed(0)}% / 跌 ${result.fullCycleMaxDrop.toFixed(0)}%`);
    }
  }

  console.log('\n\n【正常盈利代币（对比）】');
  const normalResults = [];
  for (const token of normalTokens) {
    const result = await analyzeEarlySignals(token.expId, token.address, token.name);
    if (result) {
      normalResults.push(result);
      console.log(`\n${result.name}:`);
      console.log(`  前15点涨幅: ${result.earlyChange.toFixed(2)}%`);
      console.log(`  最大单次跳跃: ${result.maxSingleJump.toFixed(2)}%`);
      console.log(`  平均 holders: ${result.avgHolders.toFixed(0)} (最低: ${result.minHolders})`);
      console.log(`  Holder 稳定性: ${(result.holdersStability * 100).toFixed(0)}%`);
      console.log(`  TVL/FDV 比例: ${result.tvlToFdvRatio.toFixed(3)}`);
      console.log(`  全周期: 涨 ${result.fullCycleMaxRise.toFixed(0)}% / 跌 ${result.fullCycleMaxDrop.toFixed(0)}%`);
    }
  }

  // 找出区分特征
  console.log('\n\n=== 区分特征分析 ===');

  const avgGuillotineHolders = guillotineResults.reduce((sum, r) => sum + r.avgHolders, 0) / guillotineResults.length;
  const avgNormalHolders = normalResults.reduce((sum, r) => sum + r.avgHolders, 0) / normalResults.length;

  const avgGuillotineJump = guillotineResults.reduce((sum, r) => sum + r.maxSingleJump, 0) / guillotineResults.length;
  const avgNormalJump = normalResults.reduce((sum, r) => sum + r.maxSingleJump, 0) / normalResults.length;

  const avgGuillotineTvlRatio = guillotineResults.reduce((sum, r) => sum + r.tvlToFdvRatio, 0) / guillotineResults.length;
  const avgNormalTvlRatio = normalResults.reduce((sum, r) => sum + r.tvlToFdvRatio, 0) / normalResults.length;

  console.log(`\nHolders 数量:`);
  console.log(`  断头台平均: ${avgGuillotineHolders.toFixed(0)}`);
  console.log(`  正常代币平均: ${avgNormalHolders.toFixed(0)}`);
  console.log(`  → 建议阈值: holders < ${Math.floor((avgGuillotineHolders + avgNormalHolders) / 2)}`);

  console.log(`\n最大单次跳跃:`);
  console.log(`  断头台平均: ${avgGuillotineJump.toFixed(2)}%`);
  console.log(`  正常代币平均: ${avgNormalJump.toFixed(2)}%`);
  console.log(`  → 建议阈值: 单次跳跃 > ${((avgGuillotineJump + avgNormalJump) / 2).toFixed(2)}%`);

  console.log(`\nTVL/FDV 比例 (流动性真实性):`);
  console.log(`  断头台平均: ${avgGuillotineTvlRatio.toFixed(3)}`);
  console.log(`  正常代币平均: ${avgNormalTvlRatio.toFixed(3)}`);
  console.log(`  → TVL/FDV 越低，流动性越虚假`);

  console.log('\n\n=== 建议的过滤条件 ===');
  console.log('1. **Holder 过少检测**:');
  console.log(`   holders < ${Math.floor((avgGuillotineHolders + avgNormalHolders) / 2)}`);
  console.log('   → 原因：庄家控盘，散户少');

  console.log('\n2. **异常价格跳跃检测**:');
  console.log(`   单次价格变化 > ${((avgGuillotineJump + avgNormalJump) / 2).toFixed(2)}%`);
  console.log('   → 原因：庄家拉盘，价格异常波动');

  console.log('\n3. **虚假流动性检测**:');
  console.log(`   tvl / fdv < ${((avgGuillotineTvlRatio + avgNormalTvlRatio) / 2).toFixed(2)}`);
  console.log('   → 原因：FDV 很高但 TVL 很低，说明流动性集中');

  console.log('\n4. **Holder 稳定性检测**:');
  console.log(`   最低 holders / 平均 holders < 0.3`);
  console.log('   → 原因：Holder 数量波动大，不自然');
}

main().catch(console.error);
