require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

// 趋势确认函数
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
  if (n < 4) return { passed: 0, total: 3, details: [] };
  let passed = 0;
  const details = [];

  const slope = calculateLinearRegressionSlope(prices);
  if (slope > 0) passed++;
  details.push({ name: '斜率', passed: slope > 0, value: slope });

  if (prices[n-1] > prices[0]) passed++;
  details.push({ name: '首尾', passed: prices[n-1] > prices[0], value: ((prices[n-1] - prices[0]) / prices[0] * 100).toFixed(2) + '%' });

  const mid = Math.floor(n / 2);
  if (median(prices.slice(mid)) > median(prices.slice(0, mid))) passed++;
  details.push({ name: '中位数', passed: median(prices.slice(mid)) > median(prices.slice(0, mid)), value: '' });

  return { passed, total: 3, details };
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

function confirmUptrend(prices, cvThreshold = 0.005, scoreThreshold = 30) {
  const result = { passed: false, step1: false, step2: false, step3: false, cv: 0, score: 0, details: {} };

  const n = prices.length;
  if (n < 4) return result;

  // 第一步：噪音过滤
  const cv = calculateCV(prices);
  result.cv = cv;
  result.step1 = cv > cvThreshold;

  if (!result.step1) return result;

  // 第二步：方向确认
  const direction = confirmDirection(prices);
  result.step2 = direction.passed >= 2;

  if (!result.step2) return result;

  // 第三步：强度验证
  const strength = calculateTrendStrengthScore(prices);
  result.score = strength.score;
  result.details = strength.details;
  result.step3 = strength.score >= scoreThreshold;
  result.passed = result.step3;

  return result;
}

async function verifyAllTokensComplete() {
  const experimentId = '21b23e96-e25d-4ea2-bcf8-1762ffffc702';

  console.log('========================================');
  console.log('   全量代币趋势验证 (完整数据)');
  console.log('========================================\n');

  // 获取总数
  const { count } = await supabase
    .from('experiment_time_series_data')
    .select('*', { count: 'exact', head: true })
    .eq('experiment_id', experimentId);

  console.log('时序数据总记录数: ' + count);

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

    // 取前10次数据
    const dataPoints = Math.min(10, records.length);
    if (dataPoints < 4) return;

    const prices = records.slice(0, dataPoints).map(r => {
      const f = r.factor_values || {};
      return f.currentPrice;
    });

    if (prices.some(p => !p || p <= 0)) return;

    const symbol = records[0]?.token_symbol || 'Unknown';

    // 推荐标准
    const result = confirmUptrend(prices, 0.005, 30);

    // 获取基础指标
    const cv = calculateCV(prices);
    const direction = confirmDirection(prices);
    const strength = calculateTrendStrengthScore(prices);

    allResults.push({
      address: addr,
      symbol: symbol,
      dataPoints: dataPoints,
      totalRecords: records.length,
      prices: prices,
      cv: cv,
      directionPassed: direction.passed,
      strengthScore: strength.score,
      totalReturn: strength.details.totalReturn,
      normalizedSlope: strength.details.normalizedSlope,
      riseRatio: strength.details.riseRatio,
      passed: result.passed
    });
  });

  console.log('可分析代币数 (>=4数据点): ' + allResults.length + '\n');

  // 统计通过情况
  const passedTokens = allResults.filter(r => r.passed);

  console.log('========================================');
  console.log('   推荐标准验证结果');
  console.log('   CV > 0.5% 且 评分 > 30');
  console.log('========================================\n');

  console.log('总代币数: ' + allResults.length);
  console.log('通过数: ' + passedTokens.length + ' (' + (allResults.length > 0 ? (passedTokens.length / allResults.length * 100).toFixed(1) : 0) + '%)');
  console.log('未通过: ' + (allResults.length - passedTokens.length) + ' (' + (allResults.length > 0 ? ((allResults.length - passedTokens.length) / allResults.length * 100).toFixed(1) : 0) + '%)\n');

  if (passedTokens.length > 0) {
    passedTokens.sort((a, b) => b.strengthScore - a.strengthScore);

    console.log('通过验证的代币:\n');
    passedTokens.forEach((t, i) => {
      console.log((i + 1) + '. ' + t.symbol);
      console.log('   地址: ' + t.address);
      console.log('   时序记录数: ' + t.totalRecords);
      console.log('   CV: ' + (t.cv * 100).toFixed(3) + '%');
      console.log('   方向确认: ' + t.directionPassed + '/3');
      console.log('   趋势强度评分: ' + t.strengthScore.toFixed(1));
      console.log('   总涨幅: ' + t.totalReturn.toFixed(2) + '%');
      console.log('   归一化斜率: ' + t.normalizedSlope.toFixed(4) + '%/步');
      console.log('   上涨占比: ' + (t.riseRatio * 100).toFixed(1) + '%');
      console.log('');
    });

    console.log('通过的代币地址:');
    passedTokens.forEach(t => {
      console.log(t.address);
    });
  } else {
    console.log('没有代币通过推荐标准\n');
  }

  // 统计分析
  console.log('\n========================================');
  console.log('   统计分析');
  console.log('========================================\n');

  const cvDistribution = {
    zero: allResults.filter(r => r.cv === 0).length,
    veryLow: allResults.filter(r => r.cv > 0 && r.cv <= 0.002).length,
    low: allResults.filter(r => r.cv > 0.002 && r.cv <= 0.005).length,
    medium: allResults.filter(r => r.cv > 0.005 && r.cv <= 0.01).length,
    high: allResults.filter(r => r.cv > 0.01).length
  };

  console.log('CV分布（波动性）:');
  console.log('  0% (完全无波动): ' + cvDistribution.zero + ' (' + (cvDistribution.zero / allResults.length * 100).toFixed(1) + '%)');
  console.log('  0-0.2% (极低波动): ' + cvDistribution.veryLow + ' (' + (cvDistribution.veryLow / allResults.length * 100).toFixed(1) + '%)');
  console.log('  0.2-0.5% (低波动): ' + cvDistribution.low + ' (' + (cvDistribution.low / allResults.length * 100).toFixed(1) + '%)');
  console.log('  0.5-1% (中等波动): ' + cvDistribution.medium + ' (' + (cvDistribution.medium / allResults.length * 100).toFixed(1) + '%)');
  console.log('  >1% (高波动): ' + cvDistribution.high + ' (' + (cvDistribution.high / allResults.length * 100).toFixed(1) + '%)');

  const directionDistribution = {
    none: allResults.filter(r => r.directionPassed === 0).length,
    one: allResults.filter(r => r.directionPassed === 1).length,
    two: allResults.filter(r => r.directionPassed === 2).length,
    three: allResults.filter(r => r.directionPassed === 3).length
  };

  console.log('\n方向确认分布:');
  console.log('  0/3 通过: ' + directionDistribution.none + ' (' + (directionDistribution.none / allResults.length * 100).toFixed(1) + '%)');
  console.log('  1/3 通过: ' + directionDistribution.one + ' (' + (directionDistribution.one / allResults.length * 100).toFixed(1) + '%)');
  console.log('  2/3 通过: ' + directionDistribution.two + ' (' + (directionDistribution.two / allResults.length * 100).toFixed(1) + '%)');
  console.log('  3/3 通过: ' + directionDistribution.three + ' (' + (directionDistribution.three / allResults.length * 100).toFixed(1) + '%)');

  const returnDistribution = {
    negative: allResults.filter(r => r.totalReturn < 0).length,
    zero: allResults.filter(r => Math.abs(r.totalReturn) < 0.01).length,
    positive: allResults.filter(r => r.totalReturn >= 0.01).length
  };

  console.log('\n收益率分布:');
  console.log('  下跌: ' + returnDistribution.negative + ' (' + (returnDistribution.negative / allResults.length * 100).toFixed(1) + '%)');
  console.log('  持平: ' + returnDistribution.zero + ' (' + (returnDistribution.zero / allResults.length * 100).toFixed(1) + '%)');
  console.log('  上涨: ' + returnDistribution.positive + ' (' + (returnDistribution.positive / allResults.length * 100).toFixed(1) + '%)');

  // 导出CSV
  const csvRows = [];
  csvRows.push(['代币', '地址', '时序记录数', '分析数据点', 'CV%', '方向通过', '评分', '涨幅%', '斜率%/步', '上涨占比', '通过']);

  allResults.forEach(t => {
    csvRows.push([
      t.symbol,
      t.address,
      t.totalRecords,
      t.dataPoints,
      (t.cv * 100).toFixed(3),
      t.directionPassed + '/3',
      t.strengthScore.toFixed(1),
      t.totalReturn.toFixed(2),
      t.normalizedSlope.toFixed(4),
      (t.riseRatio * 100).toFixed(1) + '%',
      t.passed ? 'Y' : 'N'
    ]);
  });

  const csvContent = csvRows.map(row => row.map(c => `"${c}"`).join(',')).join('\n');
  fs.writeFileSync('all_tokens_trend_complete.csv', csvContent, 'utf8');

  console.log('\n详细结果已导出到: all_tokens_trend_complete.csv');
}

verifyAllTokensComplete().catch(console.error);
