const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// 断头台代币
const guillotineTokens = [
  { address: '0x4b838ebd1f9efcdf1ea31d3cf858a98015584444', expId: '0c616581-aa7f-4fcf-beed-6c84488925fb', name: '迎财福袋' },
  { address: '0x60f49cc3e8343764c2954ee8be82c98cf586ffff', expId: '0cc6804d-834e-44f8-8287-c4b4a78abd30', name: '币安财神' }
];

// 正常代币（对比）
const normalTokens = [
  { address: '0x46745a3d173e8dc0903095add3e2d5224b3c4444', expId: '0c616581-aa7f-4fcf-beed-6c84488925fb', name: 'WIN' },
  { address: '0x8c7e30783a8ad31a7c604ad68b0d7271d4c54444', expId: '0c616581-aa7f-4fcf-beed-6c84488925fb', name: 'BLUEDOG' }
];

async function analyzeToken(token) {
  const { data } = await supabase
    .from('experiment_time_series_data')
    .select('loop_count, price_usd, factor_values, timestamp, token_symbol')
    .eq('experiment_id', token.expId)
    .eq('token_address', token.address)
    .order('timestamp', { ascending: true });

  if (!data || data.length === 0) return null;

  const prices = data.map(d => parseFloat(d.price_usd));

  // 找到峰值和谷值
  const maxPrice = Math.max(...prices);
  const maxIdx = prices.indexOf(maxPrice);
  const minPrice = Math.min(...prices);
  const minIdx = prices.indexOf(minPrice);

  // 分析整个生命周期
  const firstPrice = prices[0];
  const lastPrice = prices[prices.length - 1];
  const totalRange = ((maxPrice - firstPrice) / firstPrice * 100);
  const totalDrop = ((lastPrice - maxPrice) / maxPrice * 100);

  // 分析暴跌模式
  let crashFound = false;
  let crashDrop = 0;
  let crashRounds = 0;
  let crashStartIdx = -1;

  for (let i = maxIdx; i < data.length - 1; i++) {
    const afterPrices = prices.slice(i);
    const minAfter = Math.min(...afterPrices);
    const dropPct = ((minAfter - prices[i]) / prices[i] * 100);

    if (dropPct < -50) { // 暴跌超过 50%
      const minAfterIdx = prices.indexOf(minAfter, i);
      crashDrop = dropPct;
      crashRounds = minAfterIdx - i;
      crashStartIdx = i;
      crashFound = true;
      break;
    }
  }

  // 获取峰值时的因子
  const peakFactors = data[maxIdx].factor_values || {};

  // 计算价格波动性（标准差）
  const meanPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance = prices.reduce((a, p) => a + Math.pow(p - meanPrice, 2), 0) / prices.length;
  const stdDev = Math.sqrt(variance);
  const cv = stdDev / meanPrice;

  // 计算持有者集中度
  const marketCap = peakFactors.marketCap || 0;
  const holders = peakFactors.holders || 1;
  const avgHolding = marketCap / holders;

  // 分析价格变化的"跳跃性"
  let bigJumps = 0;
  let bigDrops = 0;
  for (let i = 1; i < prices.length; i++) {
    const change = ((prices[i] - prices[i - 1]) / prices[i - 1] * 100);
    if (change > 10) bigJumps++;
    if (change < -10) bigDrops++;
  }

  return {
    name: token.name,
    symbol: data[0].token_symbol,
    dataPoints: data.length,
    firstPrice,
    maxPrice,
    minPrice,
    lastPrice,
    maxIdx,
    minIdx,
    totalRange,
    totalDrop,
    crashFound,
    crashDrop,
    crashRounds,
    peakLoop: data[maxIdx].loop_count,
    factors: peakFactors,
    cv,
    avgHolding,
    bigJumps,
    bigDrops,
    // 新增：分析峰值前的上涨模式
    prePeakRounds: maxIdx,
    prePeakRise: ((maxPrice - firstPrice) / firstPrice * 100),
    risePerRound: maxIdx > 0 ? ((maxPrice - firstPrice) / firstPrice * 100) / maxIdx : 0
  };
}

(async () => {
  console.log('========================================');
  console.log('断头台模式识别分析');
  console.log('========================================\\n');

  const guillotineResults = [];
  const normalResults = [];

  for (const token of guillotineTokens) {
    const result = await analyzeToken(token);
    if (result) guillotineResults.push(result);
  }

  for (const token of normalTokens) {
    const result = await analyzeToken(token);
    if (result) normalResults.push(result);
  }

  console.log('【断头台代币特征】\\n');
  for (const r of guillotineResults) {
    console.log('--- ' + r.name + ' (' + r.symbol + ') ---');
    console.log('数据点数: ' + r.dataPoints);
    console.log('峰值: 轮次' + r.peakLoop + ', 价格 ' + r.maxPrice.toExponential(2));
    console.log('峰前涨幅: ' + r.prePeakRise.toFixed(2) + '% (' + r.prePeakRounds + ' 轮)');
    console.log('平均每轮涨幅: ' + r.risePerRound.toFixed(2) + '%');
    console.log('暴跌: ' + r.crashDrop.toFixed(2) + '% (' + r.crashRounds + ' 轮内)');
    console.log('价格波动系数(CV): ' + r.cv.toFixed(4));
    console.log('持有者: ' + r.factors.holders + ', 平均持仓: ' + r.avgHolding.toExponential(2));
    console.log('TVL: ' + (r.factors.tvl || 0).toFixed(0));
    console.log('大涨幅次数(>10%): ' + r.bigJumps + ', 大跌幅次数(<-10%): ' + r.bigDrops);
    console.log('');
  }

  console.log('【正常代币特征（对比）】\\n');
  for (const r of normalResults) {
    console.log('--- ' + r.name + ' (' + r.symbol + ') ---');
    console.log('数据点数: ' + r.dataPoints);
    console.log('峰值: 轮次' + r.peakLoop + ', 价格 ' + r.maxPrice.toExponential(2));
    console.log('峰前涨幅: ' + r.prePeakRise.toFixed(2) + '% (' + r.prePeakRounds + ' 轮)');
    console.log('平均每轮涨幅: ' + r.risePerRound.toFixed(2) + '%');
    if (r.crashFound) {
      console.log('暴跌: ' + r.crashDrop.toFixed(2) + '% (' + r.crashRounds + ' 轮内)');
    } else {
      console.log('暴跌: 未发现暴跌(>50%)');
    }
    console.log('价格波动系数(CV): ' + r.cv.toFixed(4));
    console.log('持有者: ' + r.factors.holders + ', 平均持仓: ' + r.avgHolding.toExponential(2));
    console.log('TVL: ' + (r.factors.tvl || 0).toFixed(0));
    console.log('大涨幅次数(>10%): ' + r.bigJumps + ', 大跌幅次数(<-10%): ' + r.bigDrops);
    console.log('');
  }

  console.log('【潜在识别规则】\\n');

  // 计算平均值
  const gAvgCV = guillotineResults.reduce((a, b) => a + b.cv, 0) / guillotineResults.length;
  const gAvgHolders = guillotineResults.reduce((a, b) => a + (b.factors.holders || 0), 0) / guillotineResults.length;
  const gAvgTVL = guillotineResults.reduce((a, b) => a + (b.factors.tvl || 0), 0) / guillotineResults.length;
  const gAvgRisePerRound = guillotineResults.reduce((a, b) => a + b.risePerRound, 0) / guillotineResults.length;

  const nAvgCV = normalResults.reduce((a, b) => a + b.cv, 0) / normalResults.length;
  const nAvgHolders = normalResults.reduce((a, b) => a + (b.factors.holders || 0), 0) / normalResults.length;
  const nAvgTVL = normalResults.reduce((a, b) => a + (b.factors.tvl || 0), 0) / normalResults.length;
  const nAvgRisePerRound = normalResults.reduce((a, b) => a + b.risePerRound, 0) / normalResults.length;

  console.log('断头台代币平均值:');
  console.log('  CV: ' + gAvgCV.toFixed(4) + ', 持有者: ' + gAvgHolders.toFixed(0) + ', TVL: ' + gAvgTVL.toFixed(0));
  console.log('  平均每轮涨幅: ' + gAvgRisePerRound.toFixed(2) + '%');
  console.log('');
  console.log('正常代币平均值:');
  console.log('  CV: ' + nAvgCV.toFixed(4) + ', 持有者: ' + nAvgHolders.toFixed(0) + ', TVL: ' + nAvgTVL.toFixed(0));
  console.log('  平均每轮涨幅: ' + nAvgRisePerRound.toFixed(2) + '%');
})();
