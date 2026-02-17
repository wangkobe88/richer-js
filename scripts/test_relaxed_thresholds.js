require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

// 复用之前的函数
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
  if (calculateLinearRegressionSlope(prices) > 0) passed++;
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

async function testRelaxedThresholds() {
  const experimentId = '21b23e96-e25d-4ea2-bcf8-1762ffffc702';

  console.log('========================================');
  console.log('   放宽标准测试');
  console.log('========================================\n');

  const { data: timeSeriesData } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('timestamp', { ascending: true });

  const byToken = new Map();
  timeSeriesData.forEach(ts => {
    const addr = ts.token_address;
    if (!byToken.has(addr)) {
      byToken.set(addr, []);
    }
    byToken.get(addr).push(ts);
  });

  // 测试不同的阈值组合
  const scenarios = [
    { name: '原始标准', cvThreshold: 0.01, scoreThreshold: 40 },
    { name: '放宽CV阈值', cvThreshold: 0.005, scoreThreshold: 40 },
    { name: '放宽评分阈值', cvThreshold: 0.01, scoreThreshold: 30 },
    { name: '两者都放宽', cvThreshold: 0.005, scoreThreshold: 30 },
    { name: '更宽松标准', cvThreshold: 0.003, scoreThreshold: 25 },
    { name: '极宽松标准', cvThreshold: 0.002, scoreThreshold: 20 },
  ];

  const results = [];

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
    const cv = calculateCV(prices);
    const direction = confirmDirection(prices);
    const strength = calculateTrendStrengthScore(prices);

    results.push({
      address: addr,
      symbol,
      prices,
      cv,
      directionPassed: direction.passed,
      strengthScore: strength.score,
      details: strength.details
    });
  });

  console.log('场景 | CV阈值 | 评分阈值 | 通过数 | 通过率\n');
  console.log('------|--------|----------|--------|--------');

  scenarios.forEach(scenario => {
    const passed = results.filter(r =>
      r.cv > scenario.cvThreshold &&
      r.directionPassed >= 2 &&
      r.strengthScore >= scenario.scoreThreshold
    );

    const passRate = (passed.length / results.length * 100).toFixed(1);

    console.log(
      scenario.name.padEnd(12) + ' | ' +
      (scenario.cvThreshold * 100).toFixed(1).padStart(6) + '% | ' +
      scenario.scoreThreshold.toString().padStart(6) + ' | ' +
      String(passed.length).padStart(6) + ' | ' +
      passRate.padStart(5) + '%'
    );

    // 显示通过的代币
    if (passed.length > 0 && scenario.name === '更宽松标准') {
      console.log('\n  --- ' + scenario.name + ' 通过的代币 ---');
      passed.sort((a, b) => b.strengthScore - a.strengthScore);
      passed.forEach((t, i) => {
        console.log('  ' + (i + 1) + '. ' + t.symbol);
        console.log('     CV=' + (t.cv * 100).toFixed(3) + '%, 方向通过=' + t.directionPassed + '/3, 评分=' + t.strengthScore.toFixed(1));
        console.log('     涨幅=' + t.details.totalReturn.toFixed(2) + '%, 斜率=' + t.details.normalizedSlope.toFixed(4) + '%/步');
      });
    }
  });

  // 推荐标准
  console.log('\n========================================');
  console.log('   推荐标准');
  console.log('========================================\n');

  const recommended = { cvThreshold: 0.005, scoreThreshold: 30 };
  const recommendedPassed = results.filter(r =>
    r.cv > recommended.cvThreshold &&
    r.directionPassed >= 2 &&
    r.strengthScore >= recommended.scoreThreshold
  );

  console.log('推荐: CV > 0.5% 且 评分 > 30');
  console.log('通过数: ' + recommendedPassed.length + ' 个\n');

  if (recommendedPassed.length > 0) {
    recommendedPassed.sort((a, b) => b.strengthScore - a.strengthScore);

    console.log('通过的代币详情:');
    recommendedPassed.forEach((t, i) => {
      console.log('\n' + (i + 1) + '. ' + t.symbol);
      console.log('   地址: ' + t.address);
      console.log('   CV: ' + (t.cv * 100).toFixed(3) + '%');
      console.log('   方向确认: ' + t.directionPassed + '/3');
      console.log('   趋势强度评分: ' + t.strengthScore.toFixed(1));
      console.log('   总涨幅: ' + t.details.totalReturn.toFixed(2) + '%');
      console.log('   归一化斜率: ' + t.details.normalizedSlope.toFixed(4) + '%/步');
      console.log('   上涨占比: ' + (t.details.riseRatio * 100).toFixed(1) + '%');
      console.log('   价格: ' + t.prices.map(p => p.toFixed(8)).join(' -> '));
    });
  } else {
    console.log('没有代币通过推荐标准');
    console.log('\n可能需要进一步放宽标准，或者接受当前数据质量较低的现实');
  }

  // 最终建议
  console.log('\n========================================');
  console.log('   最终建议');
  console.log('========================================\n');

  console.log('基于当前数据质量分析：');
  console.log('1. 数据采集频率(20秒)相对于价格波动过高');
  console.log('2. 大部分代币流动性极低');
  console.log('3. 即使放宽标准，通过的代币也很少且质量不高');
  console.log('\n建议：');
  console.log('- 方案本身是有效的，能够严格过滤噪音代币');
  console.log('- 如果要使用，建议 CV > 0.5% 且 评分 > 30');
  console.log('- 更重要的是改善数据采集策略：');
  console.log('  * 增加采集间隔到 1-2 分钟');
  console.log('  * 或者只关注流动性更好的代币');
  console.log('  * 或者使用更长的时间窗口（20-30次采集）');
}

testRelaxedThresholds().catch(console.error);
