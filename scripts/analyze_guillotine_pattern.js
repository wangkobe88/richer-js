require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

// 要分析的"断头台"代币
const guillotineTokens = [
  { expId: '0c616581-aa7f-4fcf-beed-6c84488925fb', address: '0x4b838ebd1f9efcdf1ea31d3cf858a98015584444' },
  { expId: '0cc6804d-834e-44f8-8287-c4b4a78abd30', address: '0x60f49cc3e8343764c2954ee8be82c98cf586ffff' },
  { expId: '0cc6804d-834e-44f8-8287-c4b4a78abd30', address: '0xe17df11817754c9c15ee912e459d812e4d0fffff' }
];

async function analyzeToken(expId, tokenAddress) {
  console.log(`\n========================================`);
  console.log(`分析代币: ${tokenAddress}`);
  console.log(`========================================`);

  // 获取时序数据
  const { data: timeSeries } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', expId)
    .eq('token_address', tokenAddress)
    .order('timestamp', { ascending: true });

  if (!timeSeries || timeSeries.length === 0) {
    console.log('❌ 没有时序数据');
    return null;
  }

  console.log(`数据点数: ${timeSeries.length}`);
  console.log(`代币符号: ${timeSeries[0].token_symbol}`);

  // 解析价格数据
  const prices = timeSeries.map(ts => ({
    timestamp: new Date(ts.timestamp).getTime(),
    price: parseFloat(ts.price_usd) || 0,
    loopCount: ts.loop_count,
    factorValues: ts.factor_values || {}
  })).filter(p => p.price > 0);

  if (prices.length === 0) {
    console.log('❌ 没有有效价格数据');
    return null;
  }

  // 分析价格模式
  const firstPrice = prices[0].price;
  const lastPrice = prices[prices.length - 1].price;
  const maxPrice = Math.max(...prices.map(p => p.price));
  const minPrice = Math.min(...prices.map(p => p.price));
  const maxIndex = prices.findIndex(p => p.price === maxPrice);
  const minIndex = prices.findIndex(p => p.price === minPrice);

  // 计算价格变化
  const maxRiseFromStart = ((maxPrice - firstPrice) / firstPrice * 100);
  const maxDropFromPeak = ((minPrice - maxPrice) / maxPrice * 100);
  const totalChange = ((lastPrice - firstPrice) / firstPrice * 100);

  console.log(`\n=== 价格分析 ===`);
  console.log(`起始价格: $${firstPrice.toFixed(8)}`);
  console.log(`最高价格: $${maxPrice.toFixed(8)} (${maxRiseFromStart.toFixed(2)}%)`);
  console.log(`最低价格: $${minPrice.toFixed(8)} (${maxDropFromPeak.toFixed(2)}%)`);
  console.log(`结束价格: $${lastPrice.toFixed(8)} (${totalChange.toFixed(2)}%)`);

  // 找到峰值时刻
  const peakTime = new Date(prices[maxIndex].timestamp);
  const crashTime = minIndex > maxIndex ? new Date(prices[minIndex].timestamp) : null;
  const timeToPeak = (peakTime.getTime() - prices[0].timestamp) / 1000 / 60; // 分钟

  console.log(`\n=== 时间分析 ===`);
  console.log(`到达峰值时间: ${timeToPeak.toFixed(2)} 分钟`);
  if (crashTime) {
    const timeToCrash = (crashTime.getTime() - peakTime.getTime()) / 1000 / 60;
    console.log(`峰值到崩盘: ${timeToCrash.toFixed(2)} 分钟`);
  }

  // 分析 holders 和持仓集中度
  const holdersData = prices.map(p => p.factorValues.holders || 0);
  const avgHolders = holdersData.reduce((a, b) => a + b, 0) / holdersData.length;
  const maxHolders = Math.max(...holdersData);
  const minHolders = Math.min(...holdersData);

  console.log(`\n=== Holders 分析 ===`);
  console.log(`平均 holders: ${avgHolders.toFixed(0)}`);
  console.log(`最高 holders: ${maxHolders}`);
  console.log(`最低 holders: ${minHolders}`);

  // 分析价格波动性
  const priceChanges = [];
  for (let i = 1; i < prices.length; i++) {
    const change = ((prices[i].price - prices[i-1].price) / prices[i-1].price) * 100;
    priceChanges.push(change);
  }

  const avgChange = priceChanges.reduce((a, b) => a + b, 0) / priceChanges.length;
  const maxPositiveChange = Math.max(...priceChanges);
  const maxNegativeChange = Math.min(...priceChanges);
  const volatility = Math.sqrt(priceChanges.reduce((sum, change) => sum + change * change, 0) / priceChanges.length);

  console.log(`\n=== 波动性分析 ===`);
  console.log(`平均变化: ${avgChange.toFixed(2)}%`);
  console.log(`最大单次上涨: ${maxPositiveChange.toFixed(2)}%`);
  console.log(`最大单次下跌: ${maxNegativeChange.toFixed(2)}%`);
  console.log(`波动率(std): ${volatility.toFixed(2)}%`);

  // 分析峰值前后的特征
  if (maxIndex > 0 && maxIndex < prices.length - 1) {
    console.log(`\n=== 峰值前后对比 ===`);

    // 峰值前 5 个数据点
    const beforePeak = prices.slice(Math.max(0, maxIndex - 5), maxIndex);
    const beforePeakAvgChange = beforePeak.length > 1
      ? ((beforePeak[beforePeak.length - 1].price - beforePeak[0].price) / beforePeak[0].price * 100)
      : 0;

    // 峰值后 5 个数据点
    const afterPeak = prices.slice(maxIndex + 1, Math.min(prices.length, maxIndex + 6));
    const afterPeakAvgChange = afterPeak.length > 1
      ? ((afterPeak[afterPeak.length - 1].price - afterPeak[0].price) / afterPeak[0].price * 100)
      : 0;

    console.log(`峰值前平均上涨: ${beforePeakAvgChange.toFixed(2)}%`);
    console.log(`峰值后平均变化: ${afterPeakAvgChange.toFixed(2)}%`);

    // 检查是否有突然的大幅下跌
    let suddenDropFound = false;
    for (let i = maxIndex; i < Math.min(prices.length, maxIndex + 10); i++) {
      if (i < prices.length - 1) {
        const drop = ((prices[i + 1].price - prices[i].price) / prices[i].price) * 100;
        if (drop < -20) { // 单次下跌超过 20%
          console.log(`⚠️ 发现突然下跌: ${drop.toFixed(2)}% 在峰值后 ${i - maxIndex} 个数据点`);
          suddenDropFound = true;
          break;
        }
      }
    }

    if (suddenDropFound) {
      console.log(`✅ 检测到"断头台"模式: 峰值后突然大幅下跌`);
    }
  }

  // 分析交易量（如果有的话）
  const txVolumeData = prices.map(p => p.factorValues.txVolumeU24h || 0);
  const avgTxVolume = txVolumeData.reduce((a, b) => a + b, 0) / txVolumeData.length;

  console.log(`\n=== 交易量分析 ===`);
  console.log(`平均24h交易量: $${avgTxVolume.toFixed(0)}`);

  return {
    symbol: timeSeries[0].token_symbol,
    prices,
    firstPrice,
    lastPrice,
    maxPrice,
    minPrice,
    maxIndex,
    minIndex,
    maxRiseFromStart,
    maxDropFromPeak,
    totalChange,
    avgHolders,
    maxHolders,
    minHolders,
    volatility,
    suddenDrop: maxDropFromPeak < -50 // 峰值后下跌超过 50%
  };
}

async function main() {
  console.log('开始分析"断头台"代币模式...\n');

  const results = [];

  for (const token of guillotineTokens) {
    const result = await analyzeToken(token.expId, token.address);
    if (result) {
      results.push(result);
    }
  }

  // 总结共同特征
  console.log(`\n\n========================================`);
  console.log(`=== "断头台"模式共同特征 ===`);
  console.log(`========================================`);

  if (results.length > 0) {
    const avgMaxRise = results.reduce((sum, r) => sum + r.maxRiseFromStart, 0) / results.length;
    const avgMaxDrop = results.reduce((sum, r) => sum + r.maxDropFromPeak, 0) / results.length;
    const avgHolders = results.reduce((sum, r) => sum + r.avgHolders, 0) / results.length;
    const avgVolatility = results.reduce((sum, r) => sum + r.volatility, 0) / results.length;

    console.log(`\n价格模式:`);
    console.log(`  - 平均最高涨幅: +${avgMaxRise.toFixed(2)}%`);
    console.log(`  - 平均最大跌幅: ${avgMaxDrop.toFixed(2)}%`);
    console.log(`  - 涨跌比: ${Math.abs(avgMaxDrop / avgMaxRise).toFixed(2)}x`);

    console.log(`\nHolder 特征:`);
    console.log(`  - 平均 holders 数量: ${avgHolders.toFixed(0)}`);

    console.log(`\n波动性特征:`);
    console.log(`  - 平均波动率: ${avgVolatility.toFixed(2)}%`);

    // 识别规则建议
    console.log(`\n=== 建议的识别规则 ===`);
    console.log(`1. Holders 过少 (< ${Math.ceil(avgHolders)})`);
    console.log(`2. 高波动率 (> ${(avgVolatility * 0.8).toFixed(2)}%)`);
    console.log(`3. 价格暴涨后快速回落特征`);
    console.log(`4. 24h 交易量异常 (可能需要分析)`);
  }
}

main().catch(console.error);
