require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

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

async function validateProgressiveMethod() {
  const experimentIds = [
    '21b23e96-e25d-4ea2-bcf8-1762ffffc702',
    '6eddf257-0564-4377-96d3-2c1a9430b28a',
    '11d5c655-5ccb-489c-a56a-27d20d1ee071',
    'b574d8b9-f6d5-4a5c-b02f-f4433e6b2194',
    '6b7d207d-07a0-4818-8bf9-aed59e7eacba',
    '38225250-aae6-410f-bd37-946c4c9844f8',
    '98e47362-675e-483e-b29a-1e4d420e7bac'
  ];

  console.log('========================================');
  console.log('   渐进式验证 - 所有实验数据');
  console.log('========================================\n');

  let totalRecords = 0;
  const allRecords = [];

  // 获取所有实验的数据
  for (const expId of experimentIds) {
    const { count } = await supabase
      .from('experiment_time_series_data')
      .select('*', { count: 'exact', head: true })
      .eq('experiment_id', expId);

    console.log('实验 ' + expId.substring(0, 8) + ': ' + count + ' 条记录');
    totalRecords += count;

    const pageSize = 1000;
    let page = 0;

    while (page * pageSize < count) {
      const { data } = await supabase
        .from('experiment_time_series_data')
        .select('*')
        .eq('experiment_id', expId)
        .range(page * pageSize, (page + 1) * pageSize - 1)
        .order('timestamp', { ascending: true });

      if (data) {
        allRecords.push(...data);
      }
      page++;

      if (!data || data.length < pageSize) break;
    }
  }

  console.log('\n总共获取: ' + allRecords.length + ' 条记录');

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
  const tokenAnalysis = [];

  byToken.forEach((records, addr) => {
    records.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    if (records.length < 10) return;

    const prices = records.slice(0, 10).map(r => {
      const f = r.factor_values || {};
      return f.currentPrice;
    });

    if (prices.some(p => !p || p <= 0)) return;

    const symbol = records[0]?.token_symbol || 'Unknown';

    // 固定10次检测
    const cv10 = calculateCV(prices);
    const dir10 = confirmDirection(prices);
    const str10 = calculateTrendStrengthScore(prices);

    const fixed10Pass = cv10 > 0.005 &&
                        dir10.passed >= 2 &&
                        str10.score >= 30 &&
                        str10.details.totalReturn > 5 &&
                        str10.details.riseRatio > 0.5;

    // 渐进式检测
    let firstPassPoint = null;
    for (let dp = 4; dp <= 10; dp++) {
      const checkPrices = prices.slice(0, dp);
      const cv = calculateCV(checkPrices);
      if (cv <= 0.005) continue;

      const direction = confirmDirection(checkPrices);
      if (direction.passed < 2) continue;

      const strength = calculateTrendStrengthScore(checkPrices);
      if (strength.score < 30) continue;

      if (strength.details.totalReturn > 5 && strength.details.riseRatio > 0.5) {
        firstPassPoint = dp;
        break;
      }
    }

    if (fixed10Pass || firstPassPoint) {
      // 计算后续表现
      const detectPrice = prices[9];
      let maxGain = 0;
      for (let i = 10; i < records.length; i++) {
        const f = records[i].factor_values || {};
        const price = f.currentPrice;
        if (price && price > 0) {
          const gain = ((price - detectPrice) / detectPrice) * 100;
          if (gain > maxGain) maxGain = gain;
        }
      }

      tokenAnalysis.push({
        symbol,
        address: addr,
        totalRecords: records.length,
        fixed10Pass,
        progressivePass: firstPassPoint !== null,
        firstPassPoint,
        maxGain,
        detectTotalReturn: str10.details.totalReturn
      });
    }
  });

  console.log('========================================');
  console.log('   验证结果');
  console.log('========================================\n');

  const fixed10Count = tokenAnalysis.filter(t => t.fixed10Pass).length;
  const progressiveCount = tokenAnalysis.filter(t => t.progressivePass).length;

  console.log('固定10次检测通过: ' + fixed10Count + ' 个');
  console.log('渐进式检测通过: ' + progressiveCount + ' 个');

  // 渐进式通过的代币按首次通过点分组
  const progressiveTokens = tokenAnalysis.filter(t => t.progressivePass);
  const byPassPoint = new Map();
  progressiveTokens.forEach(t => {
    const point = t.firstPassPoint;
    if (!byPassPoint.has(point)) {
      byPassPoint.set(point, []);
    }
    byPassPoint.get(point).push(t);
  });

  console.log('\n渐进式首次通过数据点分布:');
  console.log('数据点 | 时间(秒) | 时间(分钟) | 代币数 | 占比');
  console.log('-------|----------|-----------|--------|------');

  for (let dp = 4; dp <= 10; dp++) {
    if (byPassPoint.has(dp)) {
      const tokens = byPassPoint.get(dp);
      const timeSec = dp * 20;
      const timeMin = timeSec / 60;

      console.log(
        String(dp).padStart(6) + ' | ' +
        timeSec.toString().padStart(8) + ' | ' +
        timeMin.toFixed(2).padStart(9) + ' | ' +
        String(tokens.length).padStart(6) + ' | ' +
        (tokens.length / progressiveCount * 100).toFixed(1).padStart(5) + '%'
      );
    }
  }

  // 统计
  const avgPassPoint = progressiveTokens.reduce((s, t) => s + t.firstPassPoint, 0) / progressiveTokens.length;
  const maxPassPoint = Math.max(...progressiveTokens.map(t => t.firstPassPoint));

  console.log('\n统计:');
  console.log('平均数据点: ' + avgPassPoint.toFixed(2));
  console.log('最大数据点: ' + maxPassPoint);

  console.log('\n时间对比:');
  console.log('固定10次: 200秒 ≈ 3.33分钟');
  console.log('渐进式平均: ' + (avgPassPoint * 20).toFixed(1) + '秒 ≈ ' + (avgPassPoint * 20 / 60).toFixed(2) + '分钟');
  console.log('时间节省: ' + ((10 - avgPassPoint) * 20 / 60).toFixed(2) + '分钟 (' + ((1 - avgPassPoint/10) * 100).toFixed(1) + '%)');

  // 后续表现分析
  const progressiveGains = progressiveTokens.map(t => t.maxGain);
  const avgGain = progressiveGains.reduce((a, b) => a + b, 0) / progressiveGains.length;
  const sortedGains = [...progressiveGains].sort((a, b) => a - b);
  const medianGain = sortedGains[Math.floor(sortedGains.length / 2)];
  const winRate = progressiveGains.filter(g => g > 5).length / progressiveGains.length * 100;

  console.log('\n渐进式检测后续表现:');
  console.log('平均最大涨幅: ' + avgGain.toFixed(2) + '%');
  console.log('中位最大涨幅: ' + medianGain.toFixed(2) + '%');
  console.log('胜率(>5%): ' + winRate.toFixed(1) + '%');
}

validateProgressiveMethod().catch(console.error);
