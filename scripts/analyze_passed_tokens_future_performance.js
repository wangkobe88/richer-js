require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

// 趋势确认函数（复用之前的逻辑）
function calculateCV(prices) {
  const n = prices.length;
  if (n < 2) return 0;
  const mean = prices.reduce((a, b) => a + b, 0) / n;
  if (mean === 0) return 0;
  const variance = prices.reduce((a, p) => a + Math.pow(p - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);
  return stdDev / mean;
}

function calculateLinearRegressionSlope(prices) {
  const n = prices.length;
  if (n < 2) return 0;
  const sumX = (n - 1) * n / 2;
  const sumY = prices.reduce((a, b) => a + b, 0);
  const sumXY = prices.reduce((a, p, i) => a + i * p, 0);
  const sumX2 = (n - 1) * n * (2 * n - 1) / 6;
  return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function confirmDirection(prices) {
  const n = prices.length;
  if (n < 4) return { passed: 0, total: 3 };
  let passed = 0;
  const slope = calculateLinearRegressionSlope(prices);
  if (slope > 0) passed++;
  if (prices[n-1] > prices[0]) passed++;
  const mid = Math.floor(n / 2);
  if (median(prices.slice(mid)) > median(prices.slice(0, mid))) passed++;
  return { passed, total: 3 };
}

function calculateTrendStrengthScore(prices) {
  const n = prices.length;
  if (n < 4) return { score: 0, details: {} };
  const avgPrice = prices.reduce((a, b) => a + b, 0) / n;
  const slope = calculateLinearRegressionSlope(prices);
  const normalizedSlope = (slope / avgPrice) * 100;
  const totalReturn = ((prices[n-1] - prices[0]) / prices[0]) * 100;
  let riseCount = 0;
  for (let i = 1; i < n; i++) {
    if (prices[i] > prices[i-1]) riseCount++;
  }
  const cv = calculateCV(prices);

  const slopeScore = Math.min(Math.abs(normalizedSlope) * 1000, 100);
  const returnScore = Math.min(Math.abs(totalReturn) * 10, 100);
  const consistencyScore = (riseCount / (n - 1)) * 100;
  const stabilityScore = Math.max((1 - cv * 10) * 100, 0);

  let directionMultiplier = 1;
  if (totalReturn < 0) directionMultiplier = 0.3;
  else if (totalReturn === 0) directionMultiplier = 0.1;

  const finalScore = (
    slopeScore * 0.3 +
    returnScore * 0.3 +
    consistencyScore * 0.2 +
    stabilityScore * 0.2
  ) * directionMultiplier;

  return {
    score: finalScore,
    details: { normalizedSlope, totalReturn, riseRatio: riseCount / (n - 1), cv }
  };
}

async function analyzePassedTokensFuturePerformance() {
  const experimentId = '21b23e96-e25d-4ea2-bcf8-1762ffffc702';

  console.log('========================================');
  console.log('   检测通过后的最大涨幅分析');
  console.log('========================================\n');

  // 获取总数
  const { count } = await supabase
    .from('experiment_time_series_data')
    .select('*', { count: 'exact', head: true })
    .eq('experiment_id', experimentId);

  // 分页获取所有数据
  const allRecords = [];
  const pageSize = 1000;
  let page = 0;

  console.log('正在获取所有时序数据...\n');

  while (page * pageSize < count) {
    const { data } = await supabase
      .from('experiment_time_series_data')
      .select('*')
      .eq('experiment_id', experimentId)
      .range(page * pageSize, (page + 1) * pageSize - 1)
      .order('timestamp', { ascending: true });

    allRecords.push(...data);
    process.stdout.write('\r已获取: ' + allRecords.length + ' / ' + count);
    page++;

    if (data.length < pageSize) break;
  }

  console.log('\n\n获取完成! 共 ' + allRecords.length + ' 条记录');

  // 按代币分组
  const byToken = new Map();
  allRecords.forEach(ts => {
    const addr = ts.token_address;
    if (!byToken.has(addr)) {
      byToken.set(addr, []);
    }
    byToken.get(addr).push(ts);
  });

  console.log('共有 ' + byToken.size + ' 个代币有时序数据\n');

  // 分析每个代币
  const allResults = [];

  byToken.forEach((records, addr) => {
    records.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // 取前10次数据用于检测
    const dataPoints = Math.min(10, records.length);
    if (dataPoints < 4) return;

    const prices = records.slice(0, dataPoints).map(r => {
      const f = r.factor_values || {};
      return f.currentPrice;
    });

    if (prices.some(p => !p || p <= 0)) return;

    const symbol = records[0]?.token_symbol || 'Unknown';

    // 检测是否通过
    const cv = calculateCV(prices);
    const direction = confirmDirection(prices);
    const strength = calculateTrendStrengthScore(prices);

    const passed = cv > 0.005 && direction.passed >= 2 && strength.score >= 30;

    allResults.push({
      address: addr,
      symbol: symbol,
      allRecords: records,
      dataPoints: dataPoints,
      totalRecords: records.length,
      detectPrices: prices,
      detectPrice: prices[prices.length - 1], // 检测通过时的价格（第10次数据采集或最后可用数据）
      passed: passed,
      cv: cv,
      directionPassed: direction.passed,
      strengthScore: strength.score
    });
  });

  const passedTokens = allResults.filter(r => r.passed);

  console.log('========================================');
  console.log('   检测通过的代币');
  console.log('========================================\n');

  console.log('通过数: ' + passedTokens.length);
  console.log('检测点: 前10次数据采集（或实际可用数据点）\n');

  // 计算每个代币检测通过后的最大涨幅
  const performanceData = [];

  passedTokens.forEach(token => {
    const detectPrice = token.detectPrice;
    const detectIndex = token.dataPoints - 1; // 检测点的索引

    // 获取检测点之后的所有价格
    const futurePrices = [];
    for (let i = detectIndex + 1; i < token.totalRecords; i++) {
      const f = token.allRecords[i].factor_values || {};
      const price = f.currentPrice;
      if (price && price > 0) {
        futurePrices.push({
          index: i,
          price: price,
          timestamp: token.allRecords[i].timestamp
        });
      }
    }

    if (futurePrices.length === 0) {
      performanceData.push({
        symbol: token.symbol,
        address: token.address,
        detectPrice: detectPrice,
        maxFuturePrice: detectPrice,
        maxGain: 0,
        maxGainTime: 'N/A',
        futureDataPoints: 0,
        totalDataPoints: token.totalRecords
      });
      return;
    }

    // 找出最大价格
    let maxPrice = detectPrice;
    let maxPriceIndex = detectIndex;
    let maxGain = 0;

    futurePrices.forEach(fp => {
      const gain = ((fp.price - detectPrice) / detectPrice) * 100;
      if (gain > maxGain) {
        maxGain = gain;
        maxPrice = fp.price;
        maxPriceIndex = fp.index;
      }
    });

    // 计算从检测点到最大价格点的数据点数
    const dataPointsToMax = maxPriceIndex - detectIndex;

    // 获取当前最后价格
    const lastPrice = token.totalRecords > 0 ?
      (token.allRecords[token.totalRecords - 1].factor_values?.currentPrice || detectPrice) :
      detectPrice;
    const currentGain = ((lastPrice - detectPrice) / detectPrice) * 100;

    performanceData.push({
      symbol: token.symbol,
      address: token.address,
      detectPrice: detectPrice,
      maxFuturePrice: maxPrice,
      maxGain: maxGain,
      maxGainDataPoints: dataPointsToMax,
      currentPrice: lastPrice,
      currentGain: currentGain,
      futureDataPoints: futurePrices.length,
      totalDataPoints: token.totalRecords
    });
  });

  // 统计分析
  const maxGains = performanceData.map(d => d.maxGain);
  const currentGains = performanceData.map(d => d.currentGain);

  maxGains.sort((a, b) => a - b);
  currentGains.sort((a, b) => a - b);

  const sum = arr => arr.reduce((a, b) => a + b, 0);
  const avg = arr => arr.length > 0 ? sum(arr) / arr.length : 0;
  const median = arr => arr.length > 0 ? arr[Math.floor(arr.length / 2)] : 0;
  const max = arr => arr.length > 0 ? arr[arr.length - 1] : 0;
  const min = arr => arr.length > 0 ? arr[0] : 0;

  console.log('========================================');
  console.log('   检测通过后涨幅统计');
  console.log('========================================\n');

  console.log('最大涨幅统计:');
  console.log('  平均值: ' + avg(maxGains).toFixed(2) + '%');
  console.log('  中位数: ' + median(maxGains).toFixed(2) + '%');
  console.log('  最大值: ' + max(maxGains).toFixed(2) + '%');
  console.log('  最小值: ' + min(maxGains).toFixed(2) + '%');

  console.log('\n当前收益统计:');
  console.log('  平均值: ' + avg(currentGains).toFixed(2) + '%');
  console.log('  中位数: ' + median(currentGains).toFixed(2) + '%');

  // 分位数
  console.log('\n最大涨幅分位数:');
  console.log('  25分位: ' + maxGains[Math.floor(maxGains.length * 0.25)].toFixed(2) + '%');
  console.log('  50分位(中位数): ' + median(maxGains).toFixed(2) + '%');
  console.log('  75分位: ' + maxGains[Math.floor(maxGains.length * 0.75)].toFixed(2) + '%');
  console.log('  90分位: ' + maxGains[Math.floor(maxGains.length * 0.9)].toFixed(2) + '%');

  // 赢面分析
  const profitCount = maxGains.filter(g => g > 0).length;
  const breakEvenCount = maxGains.filter(g => Math.abs(g) < 0.01).length;
  const lossCount = maxGains.filter(g => g < -0.01).length;

  console.log('\n盈亏分布:');
  console.log('  盈利: ' + profitCount + ' 个 (' + (profitCount / maxGains.length * 100).toFixed(1) + '%)');
  console.log('  持平: ' + breakEvenCount + ' 个 (' + (breakEvenCount / maxGains.length * 100).toFixed(1) + '%)');
  console.log('  亏损: ' + lossCount + ' 个 (' + (lossCount / maxGains.length * 100).toFixed(1) + '%)');

  // 详细列表
  console.log('\n========================================');
  console.log('   各代币详细表现');
  console.log('========================================\n');

  performanceData.sort((a, b) => b.maxGain - a.maxGain);

  performanceData.forEach((d, i) => {
    const maxGainSign = d.maxGain > 0 ? '+' : '';
    const currentGainSign = d.currentGain > 0 ? '+' : '';

    console.log((i + 1) + '. ' + d.symbol);
    console.log('   地址: ' + d.address);
    console.log('   检测时价格: ' + d.detectPrice.toFixed(8));
    console.log('   后续最大涨幅: ' + maxGainSign + d.maxGain.toFixed(2) + '%');
    console.log('   当前价格: ' + d.currentPrice.toFixed(8));
    console.log('   当前收益: ' + currentGainSign + d.currentGain.toFixed(2) + '%');
    console.log('   后续数据点: ' + d.futureDataPoints + ' (总数据点: ' + d.totalDataPoints + ')');
    console.log('');
  });

  // 达到最大涨幅所需的数据点数统计
  const dataPointsToMax = performanceData.map(d => d.maxGainDataPoints).filter(d => d > 0);
  dataPointsToMax.sort((a, b) => a - b);

  console.log('========================================');
  console.log('   达到最大涨幅所需时间');
  console.log('========================================\n');

  console.log('有后续上涨的代币数: ' + dataPointsToMax.length);
  if (dataPointsToMax.length > 0) {
    console.log('所需数据点数:');
    console.log('  平均值: ' + (sum(dataPointsToMax) / dataPointsToMax.length).toFixed(1) + ' 个数据点');
    console.log('  中位数: ' + median(dataPointsToMax).toFixed(0) + ' 个数据点');
    console.log('  最小值: ' + min(dataPointsToMax) + ' 个数据点');
    console.log('  最大值: ' + max(dataPointsToMax) + ' 个数据点');
    console.log('\n  按20秒/点计算:');
    console.log('  平均时间: ' + ((sum(dataPointsToMax) / dataPointsToMax.length) * 20 / 60).toFixed(1) + ' 分钟');
    console.log('  中位时间: ' + (median(dataPointsToMax) * 20 / 60).toFixed(1) + ' 分钟');
  }
}

analyzePassedTokensFuturePerformance().catch(console.error);
