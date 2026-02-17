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
    breakdown: { slopeScore, returnScore, consistencyScore, stabilityScore, directionMultiplier },
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

// 新增：计算价格加速度（二阶导数）
function calculateAcceleration(prices) {
  const n = prices.length;
  if (n < 3) return 0;

  // 计算一阶差分（速度）
  const velocities = [];
  for (let i = 1; i < n; i++) {
    velocities.push(prices[i] - prices[i-1]);
  }

  // 计算二阶差分（加速度）
  const accelerations = [];
  for (let i = 1; i < velocities.length; i++) {
    accelerations.push(velocities[i] - velocities[i-1]);
  }

  // 平均加速度（相对于价格的百分比）
  const avgPrice = prices.reduce((a, b) => a + b, 0) / n;
  const avgAcceleration = accelerations.reduce((a, b) => a + b, 0) / accelerations.length;

  return (avgAcceleration / avgPrice) * 100; // 转换为百分比
}

// 新增：计算价格动量强度（最近涨幅 vs 整体涨幅）
function calculateMomentumStrength(prices) {
  const n = prices.length;
  if (n < 4) return 0;

  const firstHalf = prices.slice(0, Math.floor(n / 2));
  const secondHalf = prices.slice(Math.floor(n / 2));

  const firstReturn = ((firstHalf[firstHalf.length - 1] - firstHalf[0]) / firstHalf[0]) * 100;
  const secondReturn = ((secondHalf[secondHalf.length - 1] - secondHalf[0]) / secondHalf[0]) * 100;

  return secondReturn - firstReturn; // 正值表示后半段涨得更猛
}

// 新增：计算价格稳定性（R²改进版）
function calculatePriceStability(prices) {
  const n = prices.length;
  if (n < 4) return 0;

  const slope = calculateLinearRegressionSlope(prices);
  const mean = prices.reduce((a, b) => a + b, 0) / n;

  // 计算R²
  const sumX = (n - 1) * n / 2;
  const sumY = prices.reduce((a, b) => a + b, 0);
  const sumXY = prices.reduce((a, p, i) => a + i * p, 0);
  const sumX2 = (n - 1) * n * (2 * n - 1) / 6;

  const sst = prices.reduce((a, p) => a + Math.pow(p - mean, 2), 0);
  const ssr = slope === 0 ? 0 : prices.reduce((a, p, i) => {
    const predicted = (sumY + slope * (i - sumX/n));
    return a + Math.pow(predicted - mean, 2);
  }, 0);

  if (sst === 0) return 1;
  return ssr / sst;
}

async function optimizeTrendIndicators() {
  const experimentId = '21b23e96-e25d-4ea2-bcf8-1762ffffc702';

  console.log('========================================');
  console.log('   趋势指标优化分析');
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

  // 分析每个代币
  const passedTokens = [];

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

    // 原始检测
    const originalResult = confirmUptrend(prices, 0.005, 30);

    if (!originalResult.passed) return;

    const detectPrice = prices[prices.length - 1];
    const detectIndex = dataPoints - 1;

    // 计算后续最大涨幅
    let maxGain = 0;
    for (let i = detectIndex + 1; i < records.length; i++) {
      const f = records[i].factor_values || {};
      const price = f.currentPrice;
      if (price && price > 0) {
        const gain = ((price - detectPrice) / detectPrice) * 100;
        if (gain > maxGain) {
          maxGain = gain;
        }
      }
    }

    // 计算额外指标
    const acceleration = calculateAcceleration(prices);
    const momentumStrength = calculateMomentumStrength(prices);
    const priceStability = calculatePriceStability(prices);

    // 计算原始价格数据的一些特征
    const priceMean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const priceMin = Math.min(...prices);
    const priceMax = Math.max(...prices);
    const priceRange = ((priceMax - priceMin) / priceMin) * 100;

    passedTokens.push({
      symbol,
      address: addr,
      // 原始指标
      cv: originalResult.cv,
      directionPassed: originalResult.step2 ? originalResult.details : null,
      trendScore: originalResult.score,
      detectTotalReturn: originalResult.details.totalReturn,
      detectSlope: originalResult.details.normalizedSlope,
      detectRiseRatio: originalResult.details.riseRatio,
      // 新增指标
      acceleration,
      momentumStrength,
      priceStability,
      priceRange,
      // 结果
      maxGain
    });
  });

  console.log('\n\n通过原始标准的代币: ' + passedTokens.length + ' 个\n');

  // 按最大涨幅分组
  const sortedByGain = [...passedTokens].sort((a, b) => b.maxGain - a.maxGain);

  // 找出最佳分割点
  const gainThresholds = [5, 10, 20, 30, 50];
  const medianIndex = Math.floor(sortedByGain.length / 2);
  const medianGain = sortedByGain[medianIndex].maxGain;

  console.log('========================================');
  console.log('   最大涨幅分布');
  console.log('========================================\n');

  console.log('最大涨幅中位数: ' + medianGain.toFixed(2) + '%');
  console.log('各阈值以上代币数:');
  gainThresholds.forEach(th => {
    const count = sortedByGain.filter(t => t.maxGain >= th).length;
    console.log('  >= ' + th + '%: ' + count + ' 个 (' + (count / sortedByGain.length * 100).toFixed(1) + '%)');
  });

  // 分析高涨幅组和低涨幅组的指标差异
  console.log('\n========================================');
  console.log('   高涨幅 vs 低涨幅 指标对比');
  console.log('========================================\n');

  const highGainThreshold = medianGain;
  const highGainGroup = sortedByGain.filter(t => t.maxGain >= highGainThreshold);
  const lowGainGroup = sortedByGain.filter(t => t.maxGain < highGainThreshold);

  function avg(arr, key) {
    const values = arr.map(t => t[key]);
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  function median(arr, key) {
    const values = arr.map(t => t[key]).sort((a, b) => a - b);
    if (values.length === 0) return 0;
    return values[Math.floor(values.length / 2)];
  }

  const metrics = [
    { key: 'cv', name: 'CV (%)', scale: 100 },
    { key: 'trendScore', name: '趋势评分', scale: 1 },
    { key: 'detectTotalReturn', name: '检测时涨幅 (%)', scale: 1 },
    { key: 'detectSlope', name: '检测时斜率 (%/步)', scale: 1 },
    { key: 'detectRiseRatio', name: '检测时上涨占比', scale: 100 },
    { key: 'acceleration', name: '加速度 (%/步²)', scale: 1 },
    { key: 'momentumStrength', name: '动量强度 (%)', scale: 1 },
    { key: 'priceStability', name: '价格稳定性 (R²)', scale: 1 },
    { key: 'priceRange', name: '价格区间 (%)', scale: 1 },
  ];

  console.log('指标 | 高涨幅组 (' + highGainGroup.length + ') | 低涨幅组 (' + lowGainGroup.length + ') | 差异');
  console.log('-----|------------------------|------------------------|--------');

  metrics.forEach(m => {
    const highAvg = avg(highGainGroup, m.key) * m.scale;
    const lowAvg = avg(lowGainGroup, m.key) * m.scale;
    const diff = ((highAvg - lowAvg) / (Math.abs(lowAvg) || 1) * 100).toFixed(1);
    const better = highAvg > lowAvg ? '✓' : '✗';

    console.log(
      m.name.padEnd(20) + ' | ' +
      highAvg.toFixed(2).padStart(22) + ' | ' +
      lowAvg.toFixed(2).padStart(22) + ' | ' +
      better + ' ' + diff + '%'
    );
  });

  // 尝试不同的筛选条件
  console.log('\n========================================');
  console.log('   尝试不同筛选条件');
  console.log('========================================\n');

  const conditions = [
    {
      name: '原始标准',
      filter: t => true  // 所有通过原始标准的
    },
    {
      name: '加速度 > 0',
      filter: t => t.acceleration > 0
    },
    {
      name: '动量强度 > 0',
      filter: t => t.momentumStrength > 0
    },
    {
      name: '价格稳定性 > 0.5',
      filter: t => t.priceStability > 0.5
    },
    {
      name: '检测时涨幅 > 5%',
      filter: t => t.detectTotalReturn > 5
    },
    {
      name: '检测时斜率 > 0.5',
      filter: t => t.detectSlope > 0.5
    },
    {
      name: '检测时上涨占比 > 0.5',
      filter: t => t.detectRiseRatio > 0.5
    },
    {
      name: '综合: 加速度>0 且 动量>0',
      filter: t => t.acceleration > 0 && t.momentumStrength > 0
    },
    {
      name: '综合: 涨幅>5% 且 上涨占比>0.5',
      filter: t => t.detectTotalReturn > 5 && t.detectRiseRatio > 0.5
    },
    {
      name: '综合: 加速度>0 且 涨幅>5%',
      filter: t => t.acceleration > 0 && t.detectTotalReturn > 5
    },
    {
      name: '综合: 动量>0 且 稳定性>0.5',
      filter: t => t.momentumStrength > 0 && t.priceStability > 0.5
    },
    {
      name: '推荐: 加速度>0 且 动量>0 且 涨幅>5%',
      filter: t => t.acceleration > 0 && t.momentumStrength > 0 && t.detectTotalReturn > 5
    },
  ];

  console.log('条件 | 通过数 | 平均最大涨幅 | 中位最大涨幅 | 胜率(>5%)');
  console.log('-----|--------|-------------|-------------|-----------');

  conditions.forEach(cond => {
    const filtered = passedTokens.filter(cond.filter);
    if (filtered.length === 0) return;

    const avgMaxGain = filtered.reduce((s, t) => s + t.maxGain, 0) / filtered.length;
    const gains = filtered.map(t => t.maxGain).sort((a, b) => a - b);
    const medianMaxGain = gains[Math.floor(gains.length / 2)];
    const winRate = filtered.filter(t => t.maxGain > 5).length / filtered.length * 100;

    console.log(
      cond.name.padEnd(40) + ' | ' +
      String(filtered.length).padStart(6) + ' | ' +
      avgMaxGain.toFixed(2).padStart(11) + '% | ' +
      medianMaxGain.toFixed(2).padStart(11) + '% | ' +
      winRate.toFixed(1).padStart(5) + '%'
    );
  });

  // 找出最优条件
  console.log('\n========================================');
  console.log('   推荐优化方案');
  console.log('========================================\n');

  // 计算每个条件的综合得分
  const scoredConditions = conditions.map(cond => {
    const filtered = passedTokens.filter(cond.filter);
    if (filtered.length < 3) return { ...cond, score: -1 }; // 至少3个样本

    const avgMaxGain = filtered.reduce((s, t) => s + t.maxGain, 0) / filtered.length;
    const medianMaxGain = filtered.sort((a, b) => b.maxGain - a.maxGain)[Math.floor(filtered.length / 2)].maxGain;
    const winRate = filtered.filter(t => t.maxGain > 5).length / filtered.length * 100;

    // 综合得分：平均涨幅权重40%，中位数权重40%，胜率权重20%
    const score = avgMaxGain * 0.4 + medianMaxGain * 0.4 + winRate * 0.5;

    return {
      ...cond,
      filteredCount: filtered.length,
      avgMaxGain,
      medianMaxGain,
      winRate,
      score
    };
  }).filter(c => c.score >= 0);

  scoredConditions.sort((a, b) => b.score - a.score);

  console.log('TOP 5 最优条件:');
  scoredConditions.slice(0, 5).forEach((c, i) => {
    console.log((i + 1) + '. ' + c.name);
    console.log('   通过数: ' + c.filteredCount);
    console.log('   平均最大涨幅: ' + c.avgMaxGain.toFixed(2) + '%');
    console.log('   中位最大涨幅: ' + c.medianMaxGain.toFixed(2) + '%');
    console.log('   胜率: ' + c.winRate.toFixed(1) + '%');
    console.log('   综合得分: ' + c.score.toFixed(2));
    console.log('');
  });

  // 导出详细数据
  const csvHeaders = [
    '代币', '地址', '最大涨幅(%)',
    'CV(%)', '趋势评分', '检测时涨幅(%)', '检测时斜率', '检测时上涨占比',
    '加速度', '动量强度', '价格稳定性', '价格区间(%)',
    '高涨幅组', '是否通过加速度>0', '是否通过动量>0', '是否通过涨幅>5%'
  ];

  const csvRows = [csvHeaders];

  sortedByGain.forEach(t => {
    csvRows.push([
      t.symbol,
      t.address,
      t.maxGain.toFixed(2),
      (t.cv * 100).toFixed(3),
      t.trendScore.toFixed(1),
      t.detectTotalReturn.toFixed(2),
      t.detectSlope.toFixed(4),
      (t.detectRiseRatio * 100).toFixed(1),
      t.acceleration.toFixed(4),
      t.momentumStrength.toFixed(2),
      t.priceStability.toFixed(3),
      t.priceRange.toFixed(2),
      t.maxGain >= medianGain ? 'Y' : 'N',
      t.acceleration > 0 ? 'Y' : 'N',
      t.momentumStrength > 0 ? 'Y' : 'N',
      t.detectTotalReturn > 5 ? 'Y' : 'N'
    ]);
  });

  const csvContent = csvRows.map(row => row.map(c => `"${c}"`).join(',')).join('\n');
  fs.writeFileSync('trend_optimization_analysis.csv', csvContent, 'utf8');

  console.log('详细数据已导出到: trend_optimization_analysis.csv');
}

optimizeTrendIndicators().catch(console.error);
