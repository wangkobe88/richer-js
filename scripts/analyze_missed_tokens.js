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
  if (cv <= 0.005) return { passed: false };

  const direction = confirmDirection(prices);
  if (direction.passed < 2) return { passed: false };

  const strength = calculateTrendStrengthScore(prices);
  if (strength.score < 30) return { passed: false };

  if (strength.details.totalReturn > 5 && strength.details.riseRatio > 0.5) {
    return { passed: true, details: strength.details };
  }

  return { passed: false };
}

async function analyzeMissedTokens() {
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
  console.log('   分析：前10次未通过但后续上涨的代币');
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

  // 分析每个代币
  let passed10Count = 0;
  let missedTokens = [];
  let passedTokens = [];

  byToken.forEach((records, addr) => {
    records.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    if (records.length < 15) return;  // 至少需要15次数据才能分析后续

    const prices = records.slice(0, 15).map(r => {
      const f = r.factor_values || {};
      return f.currentPrice;
    });

    if (prices.some(p => !p || p <= 0)) return;

    const symbol = records[0]?.token_symbol || 'Unknown';

    // 检查前10次是否有任何一次通过
    let passedIn10 = false;
    let firstPassPoint = null;
    let passDetails = null;

    for (let dp = 6; dp <= 10; dp++) {
      const checkPrices = prices.slice(0, dp);
      const check = checkTrend(checkPrices);

      if (check.passed) {
        passedIn10 = true;
        firstPassPoint = dp;
        passDetails = check;
        break;
      }
    }

    // 计算后续最大涨幅（从第10次之后）
    const priceAt10 = prices[9];
    let maxGainAfter10 = 0;
    let maxPriceAfter10 = priceAt10;

    for (let i = 10; i < records.length; i++) {
      const f = records[i].factor_values || {};
      const price = f.currentPrice;
      if (price && price > 0) {
        const gain = ((price - priceAt10) / priceAt10) * 100;
        if (gain > maxGainAfter10) {
          maxGainAfter10 = gain;
          maxPriceAfter10 = price;
        }
      }
    }

    // 计算前10次的总涨幅
    const totalReturn10 = ((prices[9] - prices[0]) / prices[0]) * 100;

    if (passedIn10) {
      // 计算通过检测后的最大涨幅
      const detectPrice = prices[firstPassPoint - 1];
      let maxGainAfterDetect = 0;
      for (let i = firstPassPoint; i < records.length; i++) {
        const f = records[i].factor_values || {};
        const price = f.currentPrice;
        if (price && price > 0) {
          const gain = ((price - detectPrice) / detectPrice) * 100;
          if (gain > maxGainAfterDetect) maxGainAfterDetect = gain;
        }
      }

      passedTokens.push({
        symbol,
        address: addr,
        firstPassPoint,
        detectTotalReturn: passDetails.details.totalReturn,
        maxGainAfterDetect,
        maxGainAfter10,
        totalReturn10
      });
      passed10Count++;
    } else {
      // 前10次都没通过，但后续有涨幅
      if (maxGainAfter10 > 0) {
        missedTokens.push({
          symbol,
          address: addr,
          maxGainAfter10,
          totalReturn10,
          priceAt10: prices[9],
          maxPriceAfter10,
          totalRecords: records.length
        });
      }
    }
  });

  console.log('========================================');
  console.log('   统计结果');
  console.log('========================================');
  console.log('');

  console.log('前10次通过检测的代币: ' + passed10Count + ' 个');
  console.log('前10次未通过但后续上涨的代币: ' + missedTokens.length + ' 个');

  // 过滤出涨幅>5%的漏掉代币
  const valuableMissed = missedTokens.filter(t => t.maxGainAfter10 > 5);
  console.log('其中后续涨幅>5%的代币: ' + valuableMissed.length + ' 个');

  console.log('');
  console.log('========================================');
  console.log('   前10次通过检测的代币表现');
  console.log('========================================');
  console.log('');

  const passedGains = passedTokens.map(t => t.maxGainAfter10);
  const avgPassedGain = passedGains.reduce((a, b) => a + b, 0) / passedGains.length;
  const sortedPassedGains = [...passedGains].sort((a, b) => a - b);
  const medianPassedGain = sortedPassedGains[Math.floor(sortedPassedGains.length / 2)];
  const passedWinRate = passedGains.filter(g => g > 5).length / passedGains.length * 100;

  console.log('平均后续涨幅: ' + avgPassedGain.toFixed(2) + '%');
  console.log('中位后续涨幅: ' + medianPassedGain.toFixed(2) + '%');
  console.log('胜率(>5%): ' + passedWinRate.toFixed(1) + '%');

  console.log('');
  console.log('========================================');
  console.log('   漏掉的代币表现 (前10次未通过)');
  console.log('========================================');
  console.log('');

  if (valuableMissed.length > 0) {
    const missedGains = valuableMissed.map(t => t.maxGainAfter10);
    const avgMissedGain = missedGains.reduce((a, b) => a + b, 0) / missedGains.length;
    const sortedMissedGains = [...missedGains].sort((a, b) => a - b);
    const medianMissedGain = sortedMissedGains[Math.floor(sortedMissedGains.length / 2)];

    console.log('平均后续涨幅: ' + avgMissedGain.toFixed(2) + '%');
    console.log('中位后续涨幅: ' + medianMissedGain.toFixed(2) + '%');
    console.log('最大后续涨幅: ' + Math.max(...missedGains).toFixed(2) + '%');
    console.log('最小后续涨幅: ' + Math.min(...missedGains).toFixed(2) + '%');

    console.log('');
    console.log('前10次未通过的原因分析:');
    const lowReturnMissed = valuableMissed.filter(t => t.totalReturn10 <= 5);
    const highReturnMissed = valuableMissed.filter(t => t.totalReturn10 > 5);

    console.log('前10次涨幅<=5%的: ' + lowReturnMissed.length + ' 个 (但后续平均涨 ' +
      (lowReturnMissed.length > 0 ? (lowReturnMissed.reduce((s, t) => s + t.maxGainAfter10, 0) / lowReturnMissed.length).toFixed(2) : '0') + '%)');
    console.log('前10次涨幅>5%的: ' + highReturnMissed.length + ' 个 (后续平均涨 ' +
      (highReturnMissed.length > 0 ? (highReturnMissed.reduce((s, t) => s + t.maxGainAfter10, 0) / highReturnMissed.length).toFixed(2) : '0') + '%)');

    console.log('');
    console.log('========================================');
    console.log('   漏掉的高涨幅代币 (后续涨幅>20%)');
    console.log('========================================');
    console.log('');

    const highGainMissed = valuableMissed.filter(t => t.maxGainAfter10 > 20);
    highGainMissed.sort((a, b) => b.maxGainAfter10 - a.maxGainAfter10);

    highGainMissed.slice(0, 20).forEach((t, i) => {
      console.log((i + 1) + '. ' + t.symbol);
      console.log('   地址: ' + t.address);
      console.log('   前10次涨幅: ' + t.totalReturn10.toFixed(2) + '%');
      console.log('   后续最大涨幅: ' + t.maxGainAfter10.toFixed(2) + '%');
      console.log('   第10次价格: ' + t.priceAt10.toFixed(8));
      console.log('   最高价格: ' + t.maxPriceAfter10.toFixed(8));
      console.log('');
    });
  } else {
    console.log('没有漏掉有价值（涨幅>5%）的代币！');
  }
}

analyzeMissedTokens().catch(console.error);
