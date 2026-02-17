require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

async function analyzeDataPointsNeeded() {
  const experimentId = '21b23e96-e25d-4ea2-bcf8-1762ffffc702';

  console.log('========================================');
  console.log('   不同数据量对检测效果的影响');
  console.log('========================================\n');

  const { count } = await supabase
    .from('experiment_time_series_data')
    .select('*', { count: 'exact', head: true })
    .eq('experiment_id', experimentId);

  console.log('时序数据总记录数: ' + count);

  const allRecords = [];
  const pageSize = 1000;
  let page = 0;

  console.log('正在获取数据...\n');

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

  const byToken = new Map();
  allRecords.forEach(ts => {
    const addr = ts.token_address;
    if (!byToken.has(addr)) {
      byToken.set(addr, []);
    }
    byToken.get(addr).push(ts);
  });

  console.log(', 共 ' + byToken.size + ' 个代币\n');

  // 分析每个代币最早通过的数据点
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

    // 找到最早通过四步法的数据点数
    let firstPassPoint = null;
    let firstPassDetails = null;

    for (let dp = 4; dp <= 10; dp++) {
      const checkPrices = prices.slice(0, dp);

      // 四步法检测
      const cv = calculateCV(checkPrices);
      if (cv <= 0.005) continue;

      const direction = confirmDirection(checkPrices);
      if (direction.passed < 2) continue;

      const strength = calculateTrendStrengthScore(checkPrices);
      if (strength.score < 30) continue;

      if (strength.details.totalReturn > 5 && strength.details.riseRatio > 0.5) {
        firstPassPoint = dp;
        firstPassDetails = {
          cv: cv,
          totalReturn: strength.details.totalReturn,
          riseRatio: strength.details.riseRatio
        };
        break;
      }
    }

    if (firstPassPoint) {
      tokenAnalysis.push({
        symbol,
        address: addr,
        firstPassPoint,
        cvAtPass: firstPassDetails.cv * 100,
        returnAtPass: firstPassDetails.totalReturn
      });
    }
  });

  console.log('========================================');
  console.log('   渐进式检测结果');
  console.log('========================================\n');

  console.log('通过四步法的代币: ' + tokenAnalysis.length + ' 个\n');

  // 按首次通过的数据点分组
  const byPassPoint = new Map();
  tokenAnalysis.forEach(t => {
    const point = t.firstPassPoint;
    if (!byPassPoint.has(point)) {
      byPassPoint.set(point, []);
    }
    byPassPoint.get(point).push(t);
  });

  console.log('首次通过所需数据点分布:');
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
        (tokens.length / tokenAnalysis.length * 100).toFixed(1).padStart(5) + '%'
      );
    }
  }

  // 统计分析
  const avgPassPoint = tokenAnalysis.reduce((s, t) => s + t.firstPassPoint, 0) / tokenAnalysis.length;
  const maxPassPoint = Math.max(...tokenAnalysis.map(t => t.firstPassPoint));
  const minPassPoint = Math.min(...tokenAnalysis.map(t => t.firstPassPoint));

  console.log('\n统计:');
  console.log('平均数据点: ' + avgPassPoint.toFixed(2));
  console.log('最小数据点: ' + minPassPoint);
  console.log('最大数据点: ' + maxPassPoint);

  console.log('\n时间对比:');
  console.log('固定10次: 10次 × 20秒 = 200秒 ≈ 3.33分钟');
  console.log('渐进式平均: ' + avgPassPoint.toFixed(2) + '次 × 20秒 = ' + (avgPassPoint * 20).toFixed(1) + '秒 ≈ ' + (avgPassPoint * 20 / 60).toFixed(2) + '分钟');
  console.log('时间节省: ' + ((10 - avgPassPoint) * 20 / 60).toFixed(2) + '分钟 (' + ((1 - avgPassPoint/10) * 100).toFixed(1) + '%)');

  // 早期通过的代币
  console.log('\n最早通过的代币 (4-5次数据点):');
  const earlyPassers = tokenAnalysis.filter(t => t.firstPassPoint <= 5).sort((a, b) => a.firstPassPoint - b.firstPassPoint || 0);

  earlyPassers.slice(0, 10).forEach((t, i) => {
    console.log((i + 1) + '. ' + t.symbol + ' - 第' + t.firstPassPoint + '次数据 (' + (t.firstPassPoint * 20) + '秒 ≈ ' + (t.firstPassPoint * 20 / 60).toFixed(2) + '分钟)');
    console.log('   当时涨幅: ' + t.returnAtPass.toFixed(2) + '%');
  });
}

// 辅助函数
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
  if (calculateLinearRegressionSlope(prices) > 0) passed++;
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
  const finalScore = (slopeScore * 0.3 + returnScore * 0.3 + consistencyScore * 0.2 + stabilityScore * 0.2) * directionMultiplier;
  return { score: finalScore, details: { normalizedSlope, totalReturn, riseRatio: riseCount / (n - 1), cv } };
}

analyzeDataPointsNeeded().catch(console.error);
