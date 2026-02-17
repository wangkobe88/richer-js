require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

/**
 * 趋势确认三步法
 */

// 第一步：噪音过滤 - 计算变异系数CV
function calculateCV(prices) {
  const n = prices.length;
  if (n < 2) return 0;

  const mean = prices.reduce((a, b) => a + b, 0) / n;
  if (mean === 0) return 0;

  const variance = prices.reduce((a, p) => a + Math.pow(p - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);

  return stdDev / mean;
}

// 第二步：方向确认 - 三个独立指标
function confirmDirection(prices) {
  const n = prices.length;
  if (n < 4) return { passed: 0, total: 3, details: [] };

  const details = [];
  let passed = 0;

  // 指标1：线性回归斜率 > 0
  const slope = calculateLinearRegressionSlope(prices);
  const slopePassed = slope > 0;
  if (slopePassed) passed++;
  details.push({ name: '线性回归斜率', passed: slopePassed, value: slope });

  // 指标2：首尾价格差 > 0
  const firstLastPassed = prices[n-1] > prices[0];
  if (firstLastPassed) passed++;
  details.push({ name: '首尾价格上涨', passed: firstLastPassed, value: ((prices[n-1] - prices[0]) / prices[0] * 100).toFixed(2) + '%' });

  // 指标3：中位数趋势 - 后半段中位数 > 前半段中位数
  const mid = Math.floor(n / 2);
  const firstHalf = prices.slice(0, mid);
  const secondHalf = prices.slice(mid);
  const firstHalfMedian = median(firstHalf);
  const secondHalfMedian = median(secondHalf);
  const medianTrendPassed = secondHalfMedian > firstHalfMedian;
  if (medianTrendPassed) passed++;
  details.push({ name: '后半段中位数提升', passed: medianTrendPassed, value: '前=' + firstHalfMedian.toFixed(8) + ' 后=' + secondHalfMedian.toFixed(8) });

  return { passed, total: 3, details };
}

// 辅助函数：计算线性回归斜率
function calculateLinearRegressionSlope(prices) {
  const n = prices.length;
  if (n < 2) return 0;

  const sumX = (n - 1) * n / 2;
  const sumY = prices.reduce((a, b) => a + b, 0);
  const sumXY = prices.reduce((a, p, i) => a + i * p, 0);
  const sumX2 = (n - 1) * n * (2 * n - 1) / 6;

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  return slope;
}

// 辅助函数：计算中位数
function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// 第三步：强度验证 - 计算趋势强度评分
function calculateTrendStrengthScore(prices) {
  const n = prices.length;
  if (n < 4) return { score: 0, breakdown: {} };

  const avgPrice = prices.reduce((a, b) => a + b, 0) / n;

  // 1. 斜率得分 (30%)
  const slope = calculateLinearRegressionSlope(prices);
  const normalizedSlope = (slope / avgPrice) * 100; // 转换为百分比
  const slopeScore = Math.min(Math.abs(normalizedSlope) * 1000, 100);

  // 2. 涨幅得分 (30%)
  const totalReturn = ((prices[n-1] - prices[0]) / prices[0]) * 100;
  const returnScore = Math.min(Math.abs(totalReturn) * 10, 100);

  // 3. 一致性得分 (20%)
  let riseCount = 0;
  for (let i = 1; i < n; i++) {
    if (prices[i] > prices[i-1]) riseCount++;
  }
  const consistencyScore = (riseCount / (n - 1)) * 100;

  // 4. 稳定性得分 (20%) - 反向CV，CV越小越稳定
  const cv = calculateCV(prices);
  const stabilityScore = Math.max((1 - cv * 10) * 100, 0); // CV>10%则得分为0

  // 只在上涨时给高分，下跌时扣分
  let directionMultiplier = 1;
  if (totalReturn < 0) {
    directionMultiplier = 0.3; // 下跌时只给30%分数
  } else if (totalReturn === 0) {
    directionMultiplier = 0.1; // 不变时只给10%分数
  }

  const finalScore = (
    slopeScore * 0.3 +
    returnScore * 0.3 +
    consistencyScore * 0.2 +
    stabilityScore * 0.2
  ) * directionMultiplier;

  return {
    score: finalScore,
    breakdown: {
      slopeScore: slopeScore * 0.3 * directionMultiplier,
      returnScore: returnScore * 0.3 * directionMultiplier,
      consistencyScore: consistencyScore * 0.2 * directionMultiplier,
      stabilityScore: stabilityScore * 0.2 * directionMultiplier,
      directionMultiplier
    },
    details: {
      normalizedSlope,
      totalReturn,
      riseCount,
      riseRatio: riseCount / (n - 1),
      cv,
      avgPrice
    }
  };
}

// 完整的趋势确认流程
function confirmUptrend(prices) {
  const result = {
    passed: false,
    step1: { passed: false, reason: '' },
    step2: { passed: false, reason: '' },
    step3: { passed: false, reason: '', score: 0 },
    details: {}
  };

  const n = prices.length;

  // 第一步：噪音过滤
  const cv = calculateCV(prices);
  const cvThreshold = 0.01; // 1%
  result.step1 = {
    passed: cv > cvThreshold,
    cv: cv,
    threshold: cvThreshold,
    reason: cv > cvThreshold ? `CV=${(cv*100).toFixed(2)}% > ${cvThreshold*100}%` : `CV=${(cv*100).toFixed(2)}% <= ${cvThreshold*100}%`
  };

  if (!result.step1.passed) {
    return result;
  }

  // 第二步：方向确认
  const direction = confirmDirection(prices);
  result.step2 = {
    passed: direction.passed >= 2,
    directionPassed: direction.passed,
    directionRequired: 2,
    details: direction.details,
    reason: `${direction.passed}/${direction.total} 指标确认上涨`
  };

  if (!result.step2.passed) {
    return result;
  }

  // 第三步：强度验证
  const strength = calculateTrendStrengthScore(prices);
  const scoreThreshold = 40;
  result.step3 = {
    passed: strength.score >= scoreThreshold,
    score: strength.score,
    threshold: scoreThreshold,
    breakdown: strength.breakdown,
    reason: `评分=${strength.score.toFixed(1)} ${strength.score >= scoreThreshold ? '>=' : '<'}${scoreThreshold}`
  };

  result.details = strength.details;
  result.passed = result.step3.passed;

  return result;
}

async function verifyTrendConfirmationMethod() {
  const experimentId = '21b23e96-e25d-4ea2-bcf8-1762ffffc702';

  console.log('========================================');
  console.log('   趋势确认三步法 - 验证分析');
  console.log('========================================\n');

  console.log('正在获取时序数据...');
  const { data: timeSeriesData, error: tsError } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('timestamp', { ascending: true });

  if (tsError) {
    console.log('查询时序数据错误:', tsError.message);
    return;
  }

  console.log('获取到 ' + timeSeriesData.length + ' 条时序记录\n');

  // 按代币分组
  const byToken = new Map();
  timeSeriesData.forEach(ts => {
    const addr = ts.token_address;
    if (!byToken.has(addr)) {
      byToken.set(addr, []);
    }
    byToken.get(addr).push(ts);
  });

  console.log('共有 ' + byToken.size + ' 个代币\n');

  // 分析每个代币
  const results = [];
  const passedTokens = [];
  const failedTokens = [];

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

    const confirmation = confirmUptrend(prices);

    const tokenResult = {
      address: addr,
      symbol: symbol,
      prices: prices,
      dataPoints: dataPoints,
      confirmation: confirmation
    };

    results.push(tokenResult);

    if (confirmation.passed) {
      passedTokens.push(tokenResult);
    } else {
      failedTokens.push(tokenResult);
    }
  });

  // 统计结果
  console.log('========================================');
  console.log('   验证结果统计');
  console.log('========================================\n');

  const totalAnalyzed = results.length;
  const totalPassed = passedTokens.length;
  const totalFailed = failedTokens.length;

  console.log('总代币数: ' + byToken.size);
  console.log('可分析代币 (>=4数据点): ' + totalAnalyzed);
  console.log('通过趋势确认: ' + totalPassed + ' 个 (' + (totalAnalyzed > 0 ? (totalPassed/totalAnalyzed*100).toFixed(1) : 0) + '%)');
  console.log('未通过: ' + totalFailed + ' 个 (' + (totalAnalyzed > 0 ? (totalFailed/totalAnalyzed*100).toFixed(1) : 0) + '%)');

  // 第一步过滤统计
  console.log('\n--- 第一步：噪音过滤 (CV > 1%) ---');
  const step1Passed = results.filter(r => r.confirmation.step1.passed);
  const step1Failed = results.filter(r => !r.confirmation.step1.passed);
  console.log('通过: ' + step1Passed.length + ' 个');
  console.log('过滤: ' + step1Failed.length + ' 个 (' + (results.length > 0 ? (step1Failed.length/results.length*100).toFixed(1) : 0) + '% 被过滤为"无真实波动")');

  // 第二步过滤统计
  console.log('\n--- 第二步：方向确认 (至少2/3指标) ---');
  const step2Tested = step1Passed.filter(r => r.confirmation.step2.passed !== null);
  const step2Passed = step2Tested.filter(r => r.confirmation.step2.passed);
  const step2Failed = step2Tested.filter(r => !r.confirmation.step2.passed);
  console.log('测试: ' + step2Tested.length + ' 个');
  console.log('通过: ' + step2Passed.length + ' 个');
  console.log('未通过: ' + step2Failed.length + ' 个');

  // 第三步过滤统计
  console.log('\n--- 第三步：强度验证 (评分 > 40) ---');
  const step3Tested = step2Passed;
  const step3Passed = step3Tested.filter(r => r.confirmation.step3.passed);
  const step3Failed = step3Tested.filter(r => !r.confirmation.step3.passed);
  console.log('测试: ' + step3Tested.length + ' 个');
  console.log('通过: ' + step3Passed.length + ' 个');
  console.log('未通过: ' + step3Failed.length + ' 个');

  // 显示通过的代币详情
  if (passedTokens.length > 0) {
    console.log('\n========================================');
    console.log('   通过趋势确认的代币');
    console.log('========================================\n');

    passedTokens.sort((a, b) => b.confirmation.step3.score - a.confirmation.step3.score);

    passedTokens.forEach((t, i) => {
      console.log((i + 1) + '. ' + t.symbol);
      console.log('   地址: ' + t.address);
      console.log('   数据点数: ' + t.dataPoints);
      console.log('   价格: ' + t.prices.map(p => p.toFixed(8)).join(' -> '));

      const c = t.confirmation;
      console.log('\n   第一步 - 噪音过滤:');
      console.log('     ' + c.step1.reason);

      console.log('\n   第二步 - 方向确认:');
      console.log('     ' + c.step2.reason);
      c.step2.details.forEach(d => {
        console.log('       ' + (d.passed ? '✓' : '✗') + ' ' + d.name + ': ' + d.value);
      });

      console.log('\n   第三步 - 强度验证:');
      console.log('     ' + c.step3.reason);
      console.log('     评分构成:');
      console.log('       斜率得分: ' + c.step3.breakdown.slopeScore.toFixed(1));
      console.log('       涨幅得分: ' + c.step3.breakdown.returnScore.toFixed(1));
      console.log('       一致性得分: ' + c.step3.breakdown.consistencyScore.toFixed(1));
      console.log('       稳定性得分: ' + c.step3.breakdown.stabilityScore.toFixed(1));

      console.log('\n   详细指标:');
      console.log('     总涨幅: ' + c.details.totalReturn.toFixed(2) + '%');
      console.log('     归一化斜率: ' + c.details.normalizedSlope.toFixed(4) + '%/步');
      console.log('     上涨占比: ' + (c.details.riseRatio * 100).toFixed(1) + '%');
      console.log('     CV: ' + (c.details.cv * 100).toFixed(2) + '%');
      console.log('');
    });
  } else {
    console.log('\n========================================');
    console.log('   没有代币通过趋势确认');
    console.log('========================================\n');
  }

  // 分析未通过的代币（按失败原因分类）
  console.log('\n========================================');
  console.log('   未通过代币分析');
  console.log('========================================\n');

  const failedByStep1 = failedTokens.filter(t => !t.confirmation.step1.passed);
  const failedByStep2 = failedTokens.filter(t => t.confirmation.step1.passed && !t.confirmation.step2.passed);
  const failedByStep3 = failedTokens.filter(t => t.confirmation.step1.passed && t.confirmation.step2.passed && !t.confirmation.step3.passed);

  console.log('第一步失败 (噪音过滤): ' + failedByStep1.length + ' 个');
  console.log('第二步失败 (方向确认): ' + failedByStep2.length + ' 个');
  console.log('第三步失败 (强度不足): ' + failedByStep3.length + ' 个');

  // 显示一些第一步失败的代币示例
  if (failedByStep1.length > 0) {
    console.log('\n--- 第一步失败示例 (低波动代币) ---');
    failedByStep1.slice(0, 3).forEach((t, i) => {
      const c = t.confirmation;
      console.log((i + 1) + '. ' + t.symbol + ': ' + c.step1.reason);
      console.log('   CV=' + (c.step1.cv * 100).toFixed(3) + '%');
      console.log('   价格: ' + t.prices.slice(0, 3).map(p => p.toFixed(8)).join(' -> '));
    });
  }

  // 显示第二步失败的代币
  if (failedByStep2.length > 0) {
    console.log('\n--- 第二步失败示例 (方向不明确) ---');
    failedByStep2.slice(0, 3).forEach((t, i) => {
      const c = t.confirmation;
      console.log((i + 1) + '. ' + t.symbol + ': ' + c.step2.reason);
      c.step2.details.forEach(d => {
        console.log('   ' + (d.passed ? '✓' : '✗') + ' ' + d.name + ': ' + d.value);
      });
    });
  }

  // 显示第三步失败的代币
  if (failedByStep3.length > 0) {
    console.log('\n--- 第三步失败示例 (强度不足) ---');
    failedByStep3.sort((a, b) => b.confirmation.step3.score - a.confirmation.step3.score);
    failedByStep3.slice(0, 5).forEach((t, i) => {
      const c = t.confirmation;
      console.log((i + 1) + '. ' + t.symbol + ': 评分=' + c.step3.score.toFixed(1) + ' (需要>40)');
      console.log('   总涨幅: ' + c.details.totalReturn.toFixed(2) + '%');
      console.log('   上涨占比: ' + (c.details.riseRatio * 100).toFixed(1) + '%');
    });
  }

  // 导出CSV
  const csvRows = [];
  csvRows.push(['代币', '地址', '数据点', '通过', 'CV%', '步骤1', '步骤2', '步骤3', '评分', '涨幅%', '斜率%/步', '上涨占比']);

  results.forEach(t => {
    const c = t.confirmation;
    csvRows.push([
      t.symbol,
      t.address,
      t.dataPoints,
      c.passed ? 'Y' : 'N',
      (c.step1.cv * 100).toFixed(3),
      c.step1.passed ? 'Y' : 'N',
      c.step2.passed ? 'Y' : 'N',
      c.step3.passed ? 'Y' : 'N',
      c.step3.score.toFixed(1),
      c.details.totalReturn?.toFixed(2) || 'N/A',
      c.details.normalizedSlope?.toFixed(4) || 'N/A',
      ((c.details.riseRatio || 0) * 100).toFixed(1) + '%'
    ]);
  });

  const csvContent = csvRows.map(row => row.map(c => `"${c}"`).join(',')).join('\n');
  fs.writeFileSync('trend_confirmation_results.csv', csvContent, 'utf8');

  console.log('\n详细结果已导出到: trend_confirmation_results.csv');

  // 有效性分析
  console.log('\n========================================');
  console.log('   有效性分析');
  console.log('========================================\n');

  console.log('方案特点:');
  console.log('1. 严格过滤噪音 - 第一步过滤了 ' + (step1Failed.length) + ' 个低波动代币');
  console.log('2. 多维确认方向 - 第二步确保上涨趋势的真实性');
  console.log('3. 量化强度评分 - 第三步保证趋势足够强');

  console.log('\n方案评估:');
  if (passedTokens.length === 0) {
    console.log('- 当前实验数据中没有任何代币通过完整验证');
    console.log('- 这说明:');
    console.log('  a) 数据采集频率可能过高（20秒），价格响应慢');
    console.log('  b) 代币流动性普遍较低');
    console.log('  c) 阈值设置可能需要放宽');
  } else {
    console.log('- 成功识别出 ' + passedTokens.length + ' 个有明确上涨趋势的代币');
    console.log('- 这些代币通过了严格的三步验证，可信度较高');
  }

  console.log('\n建议调整:');
  console.log('- 如果希望放宽标准，可以降低CV阈值到0.005 (0.5%)');
  console.log('- 或者降低评分阈值到30分');
  console.log('- 或者增加数据采集间隔到1-2分钟');
}

verifyTrendConfirmationMethod().catch(console.error);
