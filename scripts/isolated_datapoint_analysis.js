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

function checkTrend(prices) {
  const cv = calculateCV(prices);
  if (cv <= 0.005) return { passed: false, details: null };

  const direction = confirmDirection(prices);
  if (direction.passed < 2) return { passed: false, details: null };

  const strength = calculateTrendStrengthScore(prices);
  if (strength.score < 30) return { passed: false, details: null };

  if (strength.details.totalReturn > 5 && strength.details.riseRatio > 0.5) {
    return { passed: true, details: strength.details };
  }

  return { passed: false, details: null };
}

async function isolatedAnalysis() {
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
  console.log('   孤立测试：不同数据点次数的效果');
  console.log('========================================');
  console.log('');

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

  console.log('获取了 ' + allRecords.length + ' 条记录');
  console.log('');

  // 按代币分组
  const byToken = new Map();
  allRecords.forEach(ts => {
    const addr = ts.token_address;
    if (!byToken.has(addr)) {
      byToken.set(addr, []);
    }
    byToken.get(addr).push(ts);
  });

  console.log('共有 ' + byToken.size + ' 个代币');
  console.log('');

  // 对每个数据点次数进行孤立测试
  const results = [];

  for (let dataPoint = 4; dataPoint <= 10; dataPoint++) {
    const passedTokens = [];
    const totalTokens = [];

    byToken.forEach((records, addr) => {
      records.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      if (records.length < dataPoint) return;

      const prices = records.slice(0, dataPoint).map(r => {
        const f = r.factor_values || {};
        return f.currentPrice;
      });

      if (prices.some(p => !p || p <= 0)) return;

      const symbol = records[0]?.token_symbol || 'Unknown';
      totalTokens.push({ symbol, address: addr, records, prices });

      // 检测
      const check = checkTrend(prices);

      if (check.passed) {
        // 计算后续最大涨幅
        const detectPrice = prices[prices.length - 1];
        let maxGain = 0;

        for (let i = dataPoint; i < records.length; i++) {
          const f = records[i].factor_values || {};
          const price = f.currentPrice;
          if (price && price > 0) {
            const gain = ((price - detectPrice) / detectPrice) * 100;
            if (gain > maxGain) maxGain = gain;
          }
        }

        passedTokens.push({
          symbol,
          address: addr,
          maxGain,
          detectTotalReturn: check.details.totalReturn,
          detectRiseRatio: check.details.riseRatio,
          detectPrice
        });
      }
    });

    // 统计
    const gains = passedTokens.map(t => t.maxGain);
    const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / gains.length : 0;
    const sortedGains = [...gains].sort((a, b) => a - b);
    const medianGain = gains.length > 0 ? sortedGains[Math.floor(sortedGains.length / 2)] : 0;
    const winRate = gains.length > 0 ? gains.filter(g => g > 5).length / gains.length * 100 : 0;
    const avgDetectReturn = passedTokens.length > 0 ? passedTokens.reduce((s, t) => s + t.detectTotalReturn, 0) / passedTokens.length : 0;

    results.push({
      dataPoint,
      timeSec: dataPoint * 20,
      timeMin: dataPoint * 20 / 60,
      totalTested: totalTokens.length,
      passedCount: passedTokens.length,
      passRate: totalTokens.length > 0 ? passedTokens.length / totalTokens.length * 100 : 0,
      avgGain,
      medianGain,
      winRate,
      avgDetectReturn
    });
  }

  // 输出结果
  console.log('========================================');
  console.log('   不同数据点次数的效果对比');
  console.log('========================================');
  console.log('');

  console.log('数据点 | 时间(秒) | 时间(分) | 通过数 | 通过率 | 平均涨幅 | 中位涨幅 | 胜率(>5%) | 检测时平均涨幅');
  console.log('-------|----------|----------|--------|--------|----------|----------|-----------|------------------');

  results.forEach(r => {
    console.log(
      String(r.dataPoint).padStart(6) + ' | ' +
      String(r.timeSec).padStart(8) + ' | ' +
      r.timeMin.toFixed(2).padStart(8) + ' | ' +
      String(r.passedCount).padStart(6) + ' | ' +
      r.passRate.toFixed(1).padStart(6) + '% | ' +
      r.avgGain.toFixed(2).padStart(8) + '% | ' +
      r.medianGain.toFixed(2).padStart(8) + '% | ' +
      r.winRate.toFixed(1).padStart(8) + '% | ' +
      r.avgDetectReturn.toFixed(2).padStart(14) + '%'
    );
  });

  // 找出最优数据点
  console.log('');
  console.log('========================================');
  console.log('   最优数据点分析');
  console.log('========================================');
  console.log('');

  // 按不同标准找出最优
  const byAvgGain = [...results].sort((a, b) => b.avgGain - a.avgGain);
  const byWinRate = [...results].sort((a, b) => b.winRate - a.winRate);
  const byPassRate = [...results].sort((a, b) => b.passRate - a.passRate);
  const byPassCount = [...results].sort((a, b) => b.passedCount - a.passedCount);

  console.log('按平均涨幅最优: 第' + byAvgGain[0].dataPoint + '次 (' + byAvgGain[0].avgGain.toFixed(2) + '%)');
  console.log('按胜率最优: 第' + byWinRate[0].dataPoint + '次 (' + byWinRate[0].winRate.toFixed(1) + '%)');
  console.log('按通过率最优: 第' + byPassRate[0].dataPoint + '次 (' + byPassRate[0].passRate.toFixed(1) + '%)');
  console.log('按通过数量最优: 第' + byPassCount[0].dataPoint + '次 (' + byPassCount[0].passedCount + '个)');
}

isolatedAnalysis().catch(console.error);
