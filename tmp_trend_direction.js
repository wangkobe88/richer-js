// 模拟 TrendDetector 的 _confirmDirection 方法

function calculateLinearRegressionSlope(prices) {
  const n = prices.length;
  if (n < 2) return 0;

  const sumX = (n - 1) * n / 2;
  const sumY = prices.reduce((a, b) => a + b, 0);
  const sumXY = prices.reduce((a, p, i) => a + i * p, 0);
  const sumX2 = (n - 1) * n * (2 * n - 1) / 6;

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return 0;

  return (n * sumXY - sumX * sumY) / denominator;
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function confirmDirection(prices) {
  const n = prices.length;
  if (n < 4) return { passed: 0, details: '需要至少4个数据点' };

  let passed = 0;
  const details = [];

  // 方法1：线性回归斜率 > 0
  const slope = calculateLinearRegressionSlope(prices);
  if (slope > 0) {
    passed++;
    details.push(`方法1(斜率): 斜率=${slope.toExponential(4)} > 0 ✓`);
  } else {
    details.push(`方法1(斜率): 斜率=${slope.toExponential(4)} <= 0 ✗`);
  }

  // 方法2：最新价格 > 初始价格
  if (prices[n - 1] > prices[0]) {
    passed++;
    details.push(`方法2(首尾): ${prices[n - 1]} > ${prices[0]} ✓`);
  } else {
    details.push(`方法2(首尾): ${prices[n - 1]} <= ${prices[0]} ✗`);
  }

  // 方法3：后半部分中位数 > 前半部分中位数
  const mid = Math.floor(n / 2);
  const firstHalfMedian = median(prices.slice(0, mid));
  const secondHalfMedian = median(prices.slice(mid));
  if (secondHalfMedian > firstHalfMedian) {
    passed++;
    details.push(`方法3(中位数): 后半(${secondHalfMedian}) > 前半(${firstHalfMedian}) ✓`);
  } else {
    details.push(`方法3(中位数): 后半(${secondHalfMedian}) <= 前半(${firstHalfMedian}) ✗`);
  }

  return { passed, details };
}

// 买入时的价格历史（从数据推算）
// 价格历史缓存第一个价格: 0.0000040275
// 之后每10秒更新一次，到买入时共7个数据点
const prices = [
  0.0000040275,  // 第1个点（收集时）
  0.00000435,    // 第2个点 (Loop 113)
  0.00000435,    // 第3个点 (Loop 114)
  0.00000435,    // 第4个点 (Loop 115)
  0.00000435,    // 第5个点 (Loop 116)
  0.00000434,    // 第6个点 (Loop 117)
  0.00000433     // 第7个点 (Loop 118 买入)
];

console.log('=== 价格历史数据（7个点）===');
prices.forEach((p, i) => {
  console.log(`点${i + 1}: ${p}`);
});
console.log('');

const result = confirmDirection(prices);

console.log('=== trendDirectionCount 计算 ===');
console.log('规则：3种方法中至少2种确认上升趋势才算通过');
console.log('');

result.details.forEach(detail => {
  console.log(detail);
});

console.log('');
console.log(`结果: trendDirectionCount = ${result.passed}/3`);
console.log('');

if (result.passed >= 2) {
  console.log('✓ 趋势方向确认：上升趋势');
} else {
  console.log('✗ 趋势方向未确认：不是明确的上升趋势');
}
