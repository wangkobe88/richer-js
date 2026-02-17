require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

/**
 * 计算线性回归斜率
 */
function calculateLinearRegressionSlope(prices) {
  const n = prices.length;
  if (n < 2) return 0;

  const sumX = (n - 1) * n / 2;  // 0, 1, 2, ..., n-1
  const sumY = prices.reduce((a, b) => a + b, 0);
  const sumXY = prices.reduce((a, p, i) => a + i * p, 0);
  const sumX2 = (n - 1) * n * (2 * n - 1) / 6;

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  return slope;
}

/**
 * 标准化斜率（相对于价格的百分比）
 */
function normalizeSlope(slope, avgPrice) {
  if (avgPrice === 0) return 0;
  return (slope / avgPrice) * 100;
}

/**
 * 计算R²（拟合优度）
 */
function calculateR2(prices, slope) {
  const n = prices.length;
  if (n < 2) return 0;

  const mean = prices.reduce((a, b) => a + b, 0) / n;

  // 计算截距
  const sumX = (n - 1) * n / 2;
  const sumY = prices.reduce((a, b) => a + b, 0);
  const intercept = (sumY - slope * sumX) / n;

  // 预测值
  const predictions = prices.map((_, i) => intercept + slope * i);

  // SST (总平方和)
  const sst = prices.reduce((a, p) => a + Math.pow(p - mean, 2), 0);

  // SSR (回归平方和)
  const ssr = prices.reduce((a, p, i) => a + Math.pow(predictions[i] - mean, 2), 0);

  if (sst === 0) return 0;
  return ssr / sst;
}

/**
 * 判断趋势的多个指标
 */
function analyzeTrendIndicators(prices) {
  const n = prices.length;
  if (n < 4) return null;

  const avgPrice = prices.reduce((a, b) => a + b, 0) / n;

  // 1. 线性回归斜率（标准化）
  const slope = calculateLinearRegressionSlope(prices);
  const normalizedSlope = normalizeSlope(slope, avgPrice);

  // 2. R² (拟合优度)
  const r2 = calculateR2(prices, slope);

  // 3. 总涨幅
  const totalReturn = ((prices[n-1] - prices[0]) / prices[0]) * 100;

  // 4. 上涨次数占比
  let riseCount = 0;
  for (let i = 1; i < n; i++) {
    if (prices[i] > prices[i-1]) riseCount++;
  }
  const riseRatio = riseCount / (n - 1);

  // 5. 价格是否稳定上涨（波动小）
  const returns = [];
  for (let i = 1; i < n; i++) {
    returns.push((prices[i] - prices[i-1]) / prices[i-1]);
  }
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const sharpe = avgReturn / (Math.sqrt(variance) || 1); // 简化的夏普比率

  // 6. 高低点分析
  const firstHalf = prices.slice(0, Math.floor(n/2));
  const secondHalf = prices.slice(Math.floor(n/2));
  const firstHalfMax = Math.max(...firstHalf);
  const firstHalfMin = Math.min(...firstHalf);
  const secondHalfMax = Math.max(...secondHalf);
  const secondHalfMin = Math.min(...secondHalf);
  // 后半段的价格区间是否高于前半段
  const halfPeriodImprovement = (secondHalfMin > firstHalfMax) || (secondHalfMax > firstHalfMax && secondHalfMin >= firstHalfMin);

  return {
    normalizedSlope,  // 归一化斜率（%每步）
    r2,               // 拟合优度 0-1
    totalReturn,      // 总收益率 %
    riseRatio,        // 上涨次数占比 0-1
    sharpe,           // 简化夏普比率
    halfPeriodImprovement, // 后半段是否优于前半段
    avgPrice,
    prices
  };
}

async function findTrendingTokens() {
  const experimentId = '21b23e96-e25d-4ea2-bcf8-1762ffffc702';

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

  // 分析每个代币的趋势指标
  const analyzedTokens = [];

  byToken.forEach((records, addr) => {
    records.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // 取前8条记录（更长的观察期）
    const dataPoints = Math.min(8, records.length);
    if (dataPoints < 4) return;

    const prices = records.slice(0, dataPoints).map(r => {
      const f = r.factor_values || {};
      return f.currentPrice;
    });

    if (prices.some(p => !p || p <= 0)) return;

    // 过滤掉价格完全不变的
    const allSame = prices.every(p => p === prices[0]);
    if (allSame) return;

    const indicators = analyzeTrendIndicators(prices);
    if (!indicators) return;

    analyzedTokens.push({
      address: addr,
      symbol: records[0]?.token_symbol || 'Unknown',
      ...indicators,
      dataPoints
    });
  });

  console.log('有价格波动的代币: ' + analyzedTokens.length + '\n');

  // 按不同标准筛选

  console.log('=== 不同趋势筛选标准对比 ===\n');

  const criteria = [
    {
      name: '标准A: 斜率>0 且 R²>0.5',
      filter: t => t.normalizedSlope > 0 && t.r2 > 0.5
    },
    {
      name: '标准B: 总涨幅>10% 且 上涨占比>60%',
      filter: t => t.totalReturn > 10 && t.riseRatio > 0.6
    },
    {
      name: '标准C: 斜率>0 且 夏普>0',
      filter: t => t.normalizedSlope > 0 && t.sharpe > 0
    },
    {
      name: '标准D: 综合评分（斜率+涨幅+拟合度）',
      filter: t => {
        const score = (
          (t.normalizedSlope > 0 ? 1 : 0) * 30 +
          (t.totalReturn > 5 ? 1 : 0) * 30 +
          t.r2 * 20 +
          t.riseRatio * 20
        );
        return score > 50;
      }
    },
    {
      name: '标准E: 后半段价格提升',
      filter: t => t.halfPeriodImprovement && t.totalReturn > 0
    }
  ];

  criteria.forEach(c => {
    const passed = analyzedTokens.filter(c.filter);
    const sorted = [...passed].sort((a, b) => b.totalReturn - a.totalReturn);

    console.log(c.name + ': ' + passed.length + ' 个代币');

    if (passed.length > 0) {
      console.log('  平均总涨幅: ' + (passed.reduce((s, t) => s + t.totalReturn, 0) / passed.length).toFixed(2) + '%');
      console.log('  平均斜率: ' + (passed.reduce((s, t) => s + t.normalizedSlope, 0) / passed.length).toFixed(4) + '%/步');
      console.log('  示例:');
      sorted.slice(0, 3).forEach((t, i) => {
        console.log('    ' + (i+1) + '. ' + t.symbol + ': 涨' + t.totalReturn.toFixed(2) + '%, 斜率=' + t.normalizedSlope.toFixed(4) + ', R²=' + t.r2.toFixed(2));
      });
    }
    console.log('');
  });

  // 推荐的标准：综合多个指标
  console.log('=== 推荐标准：上涨趋势基本形成 ===\n');
  console.log('条件：');
  console.log('  1. 归一化斜率 > 0 (价格整体向上)');
  console.log('  2. 总涨幅 > 5% (有实际收益)');
  console.log('  3. 上涨次数占比 >= 0.5 (至少一半时间在涨)');
  console.log('');

  const recommended = analyzedTokens.filter(t =>
    t.normalizedSlope > 0 &&
    t.totalReturn > 5 &&
    t.riseRatio >= 0.5
  );

  const sortedRecommended = [...recommended].sort((a, b) => b.totalReturn - a.totalReturn);

  console.log('符合条件: ' + recommended.length + ' 个代币\n');

  if (recommended.length > 0) {
    sortedRecommended.forEach((t, i) => {
      console.log((i + 1) + '. ' + t.symbol);
      console.log('   地址: ' + t.address);
      console.log('   价格: ' + t.prices.map(p => p.toFixed(8)).join(' -> '));
      console.log('   总涨幅: ' + t.totalReturn.toFixed(2) + '%');
      console.log('   斜率: ' + t.normalizedSlope.toFixed(4) + '%/步');
      console.log('   R²: ' + t.r2.toFixed(3));
      console.log('   上涨占比: ' + (t.riseRatio * 100).toFixed(1) + '%');
      console.log('   夏普比率: ' + t.sharpe.toFixed(3));
      console.log('');
    });

    // 如果用户想直接使用这些代币的地址
    console.log('\n=== 符合条件的代币地址 ===\n');
    sortedRecommended.forEach(t => {
      console.log(t.address);
    });
  } else {
    console.log('没有代币符合推荐标准');
  }

  // 导出CSV
  const csvHeaders = [
    'symbol', 'address', 'totalReturn%', 'slope%/step', 'R2', 'riseRatio', 'sharpe', 'halfPeriodImprovement', 'dataPoints'
  ];

  const csvRows = analyzedTokens.map(t => [
    t.symbol, t.address,
    t.totalReturn.toFixed(2),
    t.normalizedSlope.toFixed(4),
    t.r2.toFixed(3),
    t.riseRatio.toFixed(2),
    t.sharpe.toFixed(3),
    t.halfPeriodImprovement ? 'Y' : 'N',
    t.dataPoints
  ]);

  const fs = require('fs');
  const csvContent = [csvHeaders.join(','), ...csvRows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
  fs.writeFileSync('trend_analysis.csv', csvContent, 'utf8');

  console.log('\n趋势分析已导出到: trend_analysis.csv');
}

findTrendingTokens().catch(console.error);
