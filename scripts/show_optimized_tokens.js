require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

// 复用趋势确认函数
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
  if (n < 4) return { passed: 0 };
  let passed = 0;
  const slope = calculateLinearRegressionSlope(prices);
  if (slope > 0) passed++;
  if (prices[n-1] > prices[0]) passed++;
  const mid = Math.floor(n / 2);
  if (median(prices.slice(mid)) > median(prices.slice(0, mid))) passed++;
  return { passed };
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

async function showOptimizedTokens() {
  const experimentId = '21b23e96-e25d-4ea2-bcf8-1762ffffc702';

  console.log('========================================');
  console.log('   优化四步法 - 通过的代币');
  console.log('========================================\n');

  // 获取数据
  const { count } = await supabase
    .from('experiment_time_series_data')
    .select('*', { count: 'exact', head: true })
    .eq('experiment_id', experimentId);

  const allRecords = [];
  const pageSize = 1000;
  let page = 0;

  while (page * pageSize < count) {
    const { data } = await supabase
      .from('experiment_time_series_data')
      .select('*')
      .eq('experiment_id', experimentId)
      .range(page * pageSize, (page + 1) * pageSize - 1)
      .order('timestamp', { ascending: true });

    allRecords.push(...data);
    page++;
    if (data.length < pageSize) break;
  }

  // 按代币分组
  const byToken = new Map();
  allRecords.forEach(ts => {
    const addr = ts.token_address;
    if (!byToken.has(addr)) {
      byToken.set(addr, []);
    }
    byToken.get(addr).push(ts);
  });

  // 分析每个代币
  const optimizedTokens = [];

  byToken.forEach((records, addr) => {
    records.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const dataPoints = Math.min(10, records.length);
    if (dataPoints < 4) return;

    const prices = records.slice(0, dataPoints).map(r => {
      const f = r.factor_values || {};
      return f.currentPrice;
    });

    if (prices.some(p => !p || p <= 0)) return;

    const symbol = records[0]?.token_symbol || 'Unknown';

    // 四步法检测
    const cv = calculateCV(prices);
    if (cv <= 0.005) return; // 第一步：CV > 0.5%

    const direction = confirmDirection(prices);
    if (direction.passed < 2) return; // 第二步：方向确认 >= 2

    const strength = calculateTrendStrengthScore(prices);
    if (strength.score < 30) return; // 第三步：评分 >= 30

    // 第四步：质量筛选
    if (strength.details.totalReturn <= 5 || strength.details.riseRatio <= 0.5) return;

    const detectPrice = prices[prices.length - 1];
    const detectIndex = dataPoints - 1;

    // 计算后续最大涨幅
    let maxGain = 0;
    let maxPrice = detectPrice;
    for (let i = detectIndex + 1; i < records.length; i++) {
      const f = records[i].factor_values || {};
      const price = f.currentPrice;
      if (price && price > 0) {
        const gain = ((price - detectPrice) / detectPrice) * 100;
        if (gain > maxGain) {
          maxGain = gain;
          maxPrice = price;
        }
      }
    }

    optimizedTokens.push({
      symbol,
      address: addr,
      totalRecords: records.length,
      cv: (cv * 100).toFixed(3),
      trendScore: strength.score.toFixed(1),
      detectTotalReturn: strength.details.totalReturn.toFixed(2),
      detectRiseRatio: (strength.details.riseRatio * 100).toFixed(1),
      maxGain: maxGain.toFixed(2),
      detectPrice: detectPrice.toFixed(8),
      maxPrice: maxPrice.toFixed(8)
    });
  });

  // 按最大涨幅排序
  optimizedTokens.sort((a, b) => parseFloat(b.maxGain) - parseFloat(a.maxGain));

  console.log('通过优化四步法的代币: ' + optimizedTokens.length + ' 个\n');

  optimizedTokens.forEach((t, i) => {
    console.log((i + 1) + '. ' + t.symbol);
    console.log('   地址: ' + t.address);
    console.log('   CV: ' + t.cv + '%');
    console.log('   趋势评分: ' + t.trendScore);
    console.log('   检测时涨幅: ' + t.detectTotalReturn + '%');
    console.log('   检测时上涨占比: ' + t.detectRiseRatio + '%');
    console.log('   后续最大涨幅: ' + t.maxGain + '%');
    console.log('   检测时价格: ' + t.detectPrice);
    console.log('   最高价格: ' + t.maxPrice);
    console.log('');
  });

  console.log('代币地址:');
  optimizedTokens.forEach(t => {
    console.log(t.address);
  });
}

showOptimizedTokens().catch(console.error);
