require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

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

async function analyzeByDataPoint() {
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
  console.log('   按数据点分析后续表现');
  console.log('========================================\n');

  const allRecords = [];

  // 获取所有实验的数据
  for (const expId of experimentIds) {
    const { count } = await supabase
      .from('experiment_time_series_data')
      .select('*', { count: 'exact', head: true })
      .eq('experiment_id', expId);

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

  console.log('获取了 ' + allRecords.length + ' 条记录\n');

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
  const byPassPoint = new Map();

  byToken.forEach((records, addr) => {
    records.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    if (records.length < 10) return;

    const prices = records.slice(0, 10).map(r => {
      const f = r.factor_values || {};
      return f.currentPrice;
    });

    if (prices.some(p => !p || p <= 0)) return;

    const symbol = records[0]?.token_symbol || 'Unknown';

    // 渐进式检测
    let firstPassPoint = null;
    let passDetails = null;

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
        passDetails = {
          cv: cv,
          totalReturn: strength.details.totalReturn,
          riseRatio: strength.details.riseRatio,
          detectPrice: checkPrices[checkPrices.length - 1]
        };
        break;
      }
    }

    if (firstPassPoint) {
      // 计算后续表现
      let maxGain = 0;
      let maxPrice = passDetails.detectPrice;

      for (let i = firstPassPoint; i < records.length; i++) {
        const f = records[i].factor_values || {};
        const price = f.currentPrice;
        if (price && price > 0) {
          const gain = ((price - passDetails.detectPrice) / passDetails.detectPrice) * 100;
          if (gain > maxGain) {
            maxGain = gain;
            maxPrice = price;
          }
        }
      }

      if (!byPassPoint.has(firstPassPoint)) {
        byPassPoint.set(firstPassPoint, []);
      }

      byPassPoint.get(firstPassPoint).push({
        symbol,
        address: addr,
        maxGain,
        detectTotalReturn: passDetails.totalReturn,
        detectRiseRatio: passDetails.riseRatio,
        cv: passDetails.cv
      });
    }
  });

  console.log('========================================');
  console.log('   按首次通过数据点的后续表现');
  console.log('========================================\n');

  console.log('数据点 | 数量 | 平均涨幅 | 中位涨幅 | 胜率(>5%) | 检测时平均涨幅 | 检测时平均上涨比');
  console.log('-------|------|----------|----------|-----------|----------------|------------------');

  for (let dp = 4; dp <= 10; dp++) {
    if (byPassPoint.has(dp)) {
      const tokens = byPassPoint.get(dp);
      const gains = tokens.map(t => t.maxGain);
      const avgGain = gains.reduce((a, b) => a + b, 0) / gains.length;
      const sortedGains = [...gains].sort((a, b) => a - b);
      const medianGain = sortedGains[Math.floor(sortedGains.length / 2)];
      const winRate = gains.filter(g => g > 5).length / gains.length * 100;
      const avgDetectReturn = tokens.reduce((s, t) => s + t.detectTotalReturn, 0) / tokens.length;
      const avgDetectRiseRatio = tokens.reduce((s, t) => s + t.detectRiseRatio, 0) / tokens.length;

      console.log(
        String(dp).padStart(6) + ' | ' +
        String(tokens.length).padStart(4) + ' | ' +
        avgGain.toFixed(2).padStart(8) + '% | ' +
        medianGain.toFixed(2).padStart(8) + '% | ' +
        winRate.toFixed(1).padStart(8) + '% | ' +
        avgDetectReturn.toFixed(2).padStart(13) + '% | ' +
        (avgDetectRiseRatio * 100).toFixed(1).padStart(14) + '%'
      );
    }
  }

  // 显示各数据点通过的代表代币
  console.log('
========================================');
  console.log('   各数据点通过的代表代币 (涨幅最高)');
  console.log('========================================\n');

  for (let dp = 4; dp <= 10; dp++) {
    if (byPassPoint.has(dp)) {
      const tokens = byPassPoint.get(dp).sort((a, b) => b.maxGain - a.maxGain);

      console.log('--- 第' + dp + '次数据通过 (' + (dp * 20) + '秒) ---');
      tokens.slice(0, 3).forEach((t, i) => {
        console.log((i + 1) + '. ' + t.symbol + ': 后续涨幅 ' + t.maxGain.toFixed(2) + '%');
      });
      console.log('');
    }
  }
}

analyzeByDataPoint().catch(console.error);
