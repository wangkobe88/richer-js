const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// TrendDetector 模拟
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
  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return 0;
  return (n * sumXY - sumX * sumY) / denominator;
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function confirmDirection(prices) {
  const n = prices.length;
  if (n < 4) return { passed: 0 };
  let passed = 0;

  const slope = calculateLinearRegressionSlope(prices);
  if (slope > 0) passed++;

  if (prices[n - 1] > prices[0]) passed++;

  const mid = Math.floor(n / 2);
  const firstHalf = prices.slice(0, mid);
  const secondHalf = prices.slice(mid);
  const median1 = median(firstHalf);
  const median2 = median(secondHalf);
  if (median2 > median1) passed++;

  return { passed };
}

function calculateTrendStrength(prices) {
  const n = prices.length;
  const firstPrice = prices[0];
  const lastPrice = prices[n - 1];
  const totalReturn = ((lastPrice - firstPrice) / firstPrice) * 100;

  let riseCount = 0;
  for (let i = 1; i < n; i++) {
    if (prices[i] > prices[i - 1]) riseCount++;
  }
  const riseRatio = riseCount / Math.max(1, n - 1);

  const slope = calculateLinearRegressionSlope(prices);
  const priceMean = prices.reduce((a, b) => a + b, 0) / n;
  const normalizedSlope = priceMean > 0 ? (slope / priceMean) * 1000 : 0;
  const score = Math.max(0, Math.min(100, (normalizedSlope + 50) * (riseRatio * 2)));

  return {
    score: score,
    details: {
      totalReturn: totalReturn,
      riseRatio: riseRatio
    }
  };
}

(async () => {
  const tokenAddress = '0x46745a3d173e8dc0903095add3e2d5224b3c4444';
  const sourceExpId = '0c616581-aa7f-4fcf-beed-6c84488925fb';

  // 获取轮次 449 之前的所有时序数据
  const { data: timeSeries } = await supabase
    .from('experiment_time_series_data')
    .select('timestamp, loop_count, price_usd, factor_values')
    .eq('experiment_id', sourceExpId)
    .eq('token_address', tokenAddress)
    .order('timestamp', { ascending: true })
    .lt('loop_count', 450);

  if (!timeSeries || timeSeries.length === 0) {
    console.log('没有找到时序数据');
    return;
  }

  console.log('代币 WIN (0x46745a3d...) 在轮次 449 之前的趋势分析\n');

  // 检查是否有足够的数据
  if (timeSeries.length < 10) {
    console.log('数据不足 10 个点，只有', timeSeries.length, '个');
    console.log('');
  }

  // 取最近 10 个数据点（或全部，如果不足 10 个）
  const recentData = timeSeries.slice(-10);
  const recentPrices = recentData.map(ts => parseFloat(ts.price_usd));
  const recentLoops = recentData.map(ts => ts.loop_count);

  console.log('最近', recentPrices.length, '个价格点：');
  recentPrices.forEach((p, i) => {
    console.log('  轮次', recentLoops[i].toString().padStart(3), ':', p.toExponential(2));
  });
  console.log('');

  // 计算趋势因子
  const cv = calculateCV(recentPrices);
  const direction = confirmDirection(recentPrices);
  const strength = calculateTrendStrength(recentPrices);

  console.log('趋势因子（修复后的计算方式）：');
  console.log('  trendCV:', cv.toFixed(4), '(需要 > 0.005)');
  console.log('  trendDirectionCount:', direction.passed, '(需要 >= 2)');
  console.log('  trendStrengthScore:', strength.score.toFixed(2), '(需要 >= 30)');
  console.log('  trendTotalReturn:', strength.details.totalReturn.toFixed(2), '% (需要 >= 5)');
  console.log('  trendRiseRatio:', strength.details.riseRatio.toFixed(2), '(需要 > 0.5)');
  console.log('');

  // 检查是否满足条件
  const pass = cv > 0.005 && direction.passed >= 2 && strength.score >= 30 && strength.details.totalReturn >= 5;
  console.log('满足买入条件:', pass ? '是' : '否');

  if (!pass) {
    console.log('');
    console.log('未满足的条件:');
    if (cv <= 0.005) console.log('  - CV <= 0.005，价格波动不足');
    if (direction.passed < 2) console.log('  - 方向确认失败，不是明显的上升趋势');
    if (strength.score < 30) console.log('  - 趋势强度不足');
    if (strength.details.totalReturn < 5) console.log('  - 总涨幅不足 5%');
  }
})();
