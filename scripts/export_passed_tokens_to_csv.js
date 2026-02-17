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
  details.push({ name: '斜率', passed: slope > 0 });

  if (prices[n-1] > prices[0]) passed++;
  details.push({ name: '首尾', passed: prices[n-1] > prices[0] });

  const mid = Math.floor(n / 2);
  if (median(prices.slice(mid)) > median(prices.slice(0, mid))) passed++;
  details.push({ name: '中位数', passed: median(prices.slice(mid)) > median(prices.slice(0, mid)) });

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

async function exportPassedTokensToCSV() {
  const experimentId = '21b23e96-e25d-4ea2-bcf8-1762ffffc702';

  console.log('正在获取数据...');

  // 获取总数
  const { count } = await supabase
    .from('experiment_time_series_data')
    .select('*', { count: 'exact', head: true })
    .eq('experiment_id', experimentId);

  // 分页获取所有数据
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

    // 检测是否通过
    const cv = calculateCV(prices);
    const direction = confirmDirection(prices);
    const strength = calculateTrendStrengthScore(prices);

    const passed = cv > 0.005 && direction.passed >= 2 && strength.score >= 30;

    if (!passed) return;

    const detectPrice = prices[prices.length - 1];
    const detectIndex = dataPoints - 1;

    // 获取检测点之后的价格
    let maxGain = 0;
    let maxPrice = detectPrice;
    let currentPrice = detectPrice;

    for (let i = detectIndex + 1; i < records.length; i++) {
      const f = records[i].factor_values || {};
      const price = f.currentPrice;
      if (price && price > 0) {
        const gain = ((price - detectPrice) / detectPrice) * 100;
        if (gain > maxGain) {
          maxGain = gain;
          maxPrice = price;
        }
        currentPrice = price;
      }
    }

    const currentGain = ((currentPrice - detectPrice) / detectPrice) * 100;

    passedTokens.push({
      symbol,
      address: addr,
      totalRecords: records.length,
      detectDataPoints: dataPoints,
      detectPrice,
      cv: (cv * 100).toFixed(3),
      directionPassed: direction.passed + '/3',
      trendScore: strength.score.toFixed(1),
      detectTotalReturn: strength.details.totalReturn.toFixed(2),
      detectSlope: strength.details.normalizedSlope.toFixed(4),
      detectRiseRatio: (strength.details.riseRatio * 100).toFixed(1),
      maxGain: maxGain.toFixed(2),
      maxPrice,
      currentGain: currentGain.toFixed(2),
      currentPrice
    });
  });

  // 按最大涨幅排序
  passedTokens.sort((a, b) => parseFloat(b.maxGain) - parseFloat(a.maxGain));

  // 生成CSV
  const headers = [
    '排名',
    '代币符号',
    '代币地址',
    '总数据点数',
    '检测数据点数',
    '检测时价格',
    'CV(%)',
    '方向确认',
    '趋势评分',
    '检测时涨幅(%)',
    '检测时斜率(%/步)',
    '检测时上涨占比(%)',
    '后续最大涨幅(%)',
    '最大价格',
    '当前收益(%)',
    '当前价格'
  ];

  const csvRows = [headers];

  passedTokens.forEach((token, index) => {
    csvRows.push([
      index + 1,
      token.symbol,
      token.address,
      token.totalRecords,
      token.detectDataPoints,
      token.detectPrice.toFixed(8),
      token.cv,
      token.directionPassed,
      token.trendScore,
      token.detectTotalReturn,
      token.detectSlope,
      token.detectRiseRatio,
      token.maxGain,
      token.maxPrice.toFixed(8),
      token.currentGain,
      token.currentPrice.toFixed(8)
    ]);
  });

  const csvContent = csvRows.map(row => row.map(c => `"${c}"`).join(',')).join('\n');

  const filename = 'passed_tokens_future_performance.csv';
  fs.writeFileSync(filename, '\ufeff' + csvContent, 'utf8');

  console.log('已导出 ' + passedTokens.length + ' 个通过趋势确认的代币');
  console.log('文件: ' + filename);

  // 统计摘要
  const maxGains = passedTokens.map(t => parseFloat(t.maxGain));
  const currentGains = passedTokens.map(t => parseFloat(t.currentGain));

  const sum = arr => arr.reduce((a, b) => a + b, 0);
  const median = arr => {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };

  console.log('\n统计摘要:');
  console.log('最大涨幅 - 平均: ' + (sum(maxGains) / maxGains.length).toFixed(2) + '%, 中位数: ' + median(maxGains).toFixed(2) + '%');
  console.log('当前收益 - 平均: ' + (sum(currentGains) / currentGains.length).toFixed(2) + '%, 中位数: ' + median(currentGains).toFixed(2) + '%');
}

exportPassedTokensToCSV().catch(console.error);
