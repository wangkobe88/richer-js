require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

// 趋势确认函数（四步法）
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

function confirmUptrend(prices, cvThreshold = 0.005, scoreThreshold = 30, totalReturnThreshold = 5, riseRatioThreshold = 0.5) {
  const result = { passed: false, step1: false, step2: false, step3: false, step4: false, cv: 0, score: 0, details: {} };

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

  if (!result.step3) return result;

  // 第四步：质量筛选
  result.step4 = strength.details.totalReturn > totalReturnThreshold && strength.details.riseRatio > riseRatioThreshold;
  result.passed = result.step4;

  return result;
}

async function verifyTrendMethod() {
  const experimentId = '21b23e96-e25d-4ea2-bcf8-1762ffffc702';

  console.log('========================================');
  console.log('   趋势确认四步法 - 重新验证');
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
  const passed3Step = [];
  const passed4Step = [];

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

    // 三步法检测
    const result3Step = confirmUptrend(prices, 0.005, 30, 0, 0); // 不启用第四步
    const result4Step = confirmUptrend(prices, 0.005, 30, 5, 0.5);

    allResults.push({
      symbol,
      address: addr,
      totalRecords: records.length,
      dataPoints,
      prices,
      result3Step,
      result4Step
    });

    if (result3Step.passed) {
      passed3Step.push({ symbol, address: addr, prices, allRecords: records, result: result3Step });
    }

    if (result4Step.passed) {
      passed4Step.push({ symbol, address: addr, prices, allRecords: records, result: result4Step });
    }
  });

  console.log('========================================');
  console.log('   验证结果统计');
  console.log('========================================\n');

  console.log('总代币数: ' + allResults.length);

  console.log('\n--- 三步法验证 ---');
  console.log('通过数: ' + passed3Step.length + ' (' + (allResults.length > 0 ? (passed3Step.length / allResults.length * 100).toFixed(1) : 0) + '%)');

  console.log('\n--- 四步法验证 ---');
  console.log('通过数: ' + passed4Step.length + ' (' + (allResults.length > 0 ? (passed4Step.length / allResults.length * 100).toFixed(1) : 0) + '%)');

  // 分析后续表现
  console.log('\n========================================');
  console.log('   后续表现分析');
  console.log('========================================\n');

  function calculateFuturePerformance(tokenData) {
    const prices = tokenData.prices;
    const allRecords = tokenData.allRecords;

    if (!allRecords || allRecords.length === 0) {
      return 0;
    }

    const detectPrice = prices[prices.length - 1];
    const detectIndex = prices.length - 1;

    let maxGain = 0;
    for (let i = detectIndex + 1; i < allRecords.length; i++) {
      const record = allRecords[i];
      const f = record.factor_values || {};
      const price = f.currentPrice;
      if (price && price > 0) {
        const gain = ((price - detectPrice) / detectPrice) * 100;
        if (gain > maxGain) maxGain = gain;
      }
    }

    return maxGain;
  }

  // 分析三步法通过后的表现
  const gains3Step = passed3Step.map(t => ({
    symbol: t.symbol,
    address: t.address,
    maxGain: calculateFuturePerformance(t),
    detectTotalReturn: t.result.details.totalReturn,
    detectRiseRatio: t.result.details.riseRatio
  }));

  const gains4Step = passed4Step.map(t => ({
    symbol: t.symbol,
    address: t.address,
    maxGain: calculateFuturePerformance(t),
    detectTotalReturn: t.result.details.totalReturn,
    detectRiseRatio: t.result.details.riseRatio
  }));

  const avg = arr => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const med = arr => {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };

  console.log('三步法后续表现:');
  console.log('  平均最大涨幅: ' + avg(gains3Step.map(g => g.maxGain)).toFixed(2) + '%');
  console.log('  中位最大涨幅: ' + med(gains3Step.map(g => g.maxGain)).toFixed(2) + '%');
  console.log('  胜率(>5%): ' + (gains3Step.filter(g => g.maxGain > 5).length / gains3Step.length * 100).toFixed(1) + '%');

  console.log('\n四步法后续表现:');
  console.log('  平均最大涨幅: ' + avg(gains4Step.map(g => g.maxGain)).toFixed(2) + '%');
  console.log('  中位最大涨幅: ' + med(gains4Step.map(g => g.maxGain)).toFixed(2) + '%');
  console.log('  胜率(>5%): ' + (gains4Step.filter(g => g.maxGain > 5).length / gains4Step.length * 100).toFixed(1) + '%');

  // 显示四步法通过的代币
  if (passed4Step.length > 0) {
    console.log('\n========================================');
    console.log('   四步法通过的代币');
    console.log('========================================\n');

    gains4Step.sort((a, b) => b.maxGain - a.maxGain);

    gains4Step.forEach((t, i) => {
      console.log((i + 1) + '. ' + t.symbol);
      console.log('   地址: ' + t.address);
      console.log('   后续最大涨幅: ' + t.maxGain.toFixed(2) + '%');
      console.log('   检测时涨幅: ' + t.detectTotalReturn.toFixed(2) + '%');
      console.log('   检测时上涨占比: ' + (t.detectRiseRatio * 100).toFixed(1) + '%');
      console.log('');
    });
  }

  // 导出CSV
  const csvRows = [];
  csvRows.push(['代币', '地址', '三步法通过', '四步法通过', '后续最大涨幅%', '检测时涨幅%', '检测时上涨占比%']);

  allResults.forEach(r => {
    const maxGain = r.result3Step.passed ? calculateFuturePerformance(r) : 0;
    csvRows.push([
      r.symbol,
      r.address,
      r.result3Step.passed ? 'Y' : 'N',
      r.result4Step.passed ? 'Y' : 'N',
      r.result3Step.passed ? maxGain.toFixed(2) : '',
      r.result3Step.details.totalReturn?.toFixed(2) || '',
      (r.result3Step.details.riseRatio * 100).toFixed(1) || ''
    ]);
  });

  const csvContent = csvRows.map(row => row.map(c => `"${c}"`).join(',')).join('\n');
  fs.writeFileSync('trend_method_verification.csv', csvContent, 'utf8');

  console.log('详细结果已导出到: trend_method_verification.csv');
}

verifyTrendMethod().catch(console.error);
