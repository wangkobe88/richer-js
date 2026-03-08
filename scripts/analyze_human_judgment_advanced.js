/**
 * 高级分析：基于人工判断数据评估购买前检查特征的区分能力
 * 并提供优化建议
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

function calculateStats(values) {
  if (values.length === 0) return { min: 0, max: 0, avg: 0, median: 0, stdDev: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  const avg = sum / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg,
    median: sorted[Math.floor(sorted.length / 2)],
    stdDev: Math.sqrt(variance)
  };
}

// 计算两个分布的重叠度
function calculateOverlap(values1, values2) {
  const allValues = [...values1, ...values2].sort((a, b) => a - b);
  const min = allValues[0];
  const max = allValues[allValues.length - 1];
  const range = max - min;

  if (range === 0) return 1; // 完全重叠

  // 使用核密度估计的简化版
  const bins = 20;
  const binSize = range / bins;
  const hist1 = new Array(bins).fill(0);
  const hist2 = new Array(bins).fill(0);

  values1.forEach(v => {
    const bin = Math.min(Math.floor((v - min) / binSize), bins - 1);
    hist1[bin]++;
  });
  values2.forEach(v => {
    const bin = Math.min(Math.floor((v - min) / binSize), bins - 1);
    hist2[bin]++;
  });

  // 归一化
  const sum1 = hist1.reduce((a, b) => a + b, 0);
  const sum2 = hist2.reduce((a, b) => a + b, 0);
  for (let i = 0; i < bins; i++) {
    hist1[i] /= sum1;
    hist2[i] /= sum2;
  }

  // 计算重叠区域
  let overlap = 0;
  for (let i = 0; i < bins; i++) {
    overlap += Math.min(hist1[i], hist2[i]);
  }

  return overlap;
}

// 计算分离度 (discriminant power)
function calculateDiscriminantPower(values1, values2) {
  const stats1 = calculateStats(values1);
  const stats2 = calculateStats(values2);

  const pooledStdDev = Math.sqrt(
    (Math.pow(stats1.stdDev, 2) * (values1.length - 1) +
     Math.pow(stats2.stdDev, 2) * (values2.length - 1)) /
    (values1.length + values2.length - 2)
  );

  if (pooledStdDev === 0) return 0;

  // Cohen's d
  return Math.abs(stats1.avg - stats2.avg) / pooledStdDev;
}

// 寻找最佳阈值
function findOptimalThreshold(goodValues, badValues) {
  const allValues = [...goodValues, ...badValues].sort((a, b) => a - b);
  let bestThreshold = 0;
  let bestScore = 0;

  for (let i = 0; i < allValues.length - 1; i++) {
    const threshold = (allValues[i] + allValues[i + 1]) / 2;

    // 假设高质量值更好（大于阈值为好）
    let truePositive = goodValues.filter(v => v >= threshold).length;
    let falsePositive = badValues.filter(v => v >= threshold).length;

    // 或者假设低质量值更好（小于阈值为好）
    let truePositive2 = goodValues.filter(v => v <= threshold).length;
    let falsePositive2 = badValues.filter(v => v <= threshold).length;

    const score1 = truePositive / goodValues.length - falsePositive / badValues.length;
    const score2 = truePositive2 / goodValues.length - falsePositive2 / badValues.length;

    if (score1 > bestScore) {
      bestScore = score1;
      bestThreshold = threshold;
    }
    if (score2 > bestScore) {
      bestScore = score2;
      bestThreshold = -threshold; // 负值表示小于阈值
    }
  }

  return { threshold: Math.abs(bestThreshold), direction: bestThreshold >= 0 ? '>' : '<=', score: bestScore };
}

async function analyzeAdvanced() {
  const experimentId = 'afed3289-2f89-4da5-88f1-1468d61f8b3d';

  console.log('=== 高级分析：购买前检查特征区分能力评估 ===\n');

  // 1. 获取人工判断数据
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('token_address, human_judges, token_symbol')
    .eq('experiment_id', experimentId)
    .not('human_judges', 'is', null);

  // 2. 获取信号数据
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy');

  // 3. 构建信号数据映射
  const signalDataMap = new Map();
  signals.forEach(signal => {
    try {
      let metadata = signal.metadata;
      if (typeof metadata === 'string') {
        metadata = JSON.parse(metadata);
      }
      const preBuyCheckFactors = metadata?.preBuyCheckFactors || {};
      signalDataMap.set(signal.token_address, preBuyCheckFactors);
    } catch (e) {
      // 忽略解析错误
    }
  });

  // 4. 按质量分组
  const factorKeys = [
    'holderBlacklistCount',
    'holderWhitelistCount',
    'devHoldingRatio',
    'maxHoldingRatio',
    'earlyTradesCountPerMin',
    'earlyTradesVolumePerMin',
    'earlyTradesHighValuePerMin',
    'earlyTradesWalletsPerMin',
    'earlyTradesUniqueWallets'
  ];

  const goodTokens = [];
  const badTokens = [];

  tokens.forEach(token => {
    const category = token.human_judges?.category?.toLowerCase();
    const isGood = category === 'high_quality' || category === 'mid_quality';
    const isBad = category === 'low_quality';

    const factors = signalDataMap.get(token.token_address);
    if (factors && (isGood || isBad)) {
      const tokenData = { token: token.token_address, symbol: token.token_symbol, ...factors };
      if (isGood) goodTokens.push(tokenData);
      if (isBad) badTokens.push(tokenData);
    }
  });

  console.log(`数据概况:`);
  console.log(`  中高质量代币: ${goodTokens.length}`);
  console.log(`  低质量代币: ${badTokens.length}\n`);

  // 5. 计算各特征的区分能力
  console.log('=== 特征区分能力分析 ===\n');

  const featureAnalysis = [];

  factorKeys.forEach(key => {
    const goodValues = goodTokens.map(t => t[key]).filter(v => v !== null && v !== undefined);
    const badValues = badTokens.map(t => t[key]).filter(v => v !== null && v !== undefined);

    if (goodValues.length > 0 && badValues.length > 0) {
      const goodStats = calculateStats(goodValues);
      const badStats = calculateStats(badValues);
      const overlap = calculateOverlap(goodValues, badValues);
      const discriminantPower = calculateDiscriminantPower(goodValues, badValues);
      const optimalThreshold = findOptimalThreshold(goodValues, badValues);

      // 计算方向
      const direction = goodStats.avg >= badStats.avg ? 'higher' : 'lower';
      const diffPercent = badStats.avg !== 0 ? ((goodStats.avg - badStats.avg) / Math.abs(badStats.avg) * 100) : 0;

      featureAnalysis.push({
        feature: key,
        goodStats,
        badStats,
        overlap,
        discriminantPower,
        optimalThreshold,
        direction,
        diffPercent
      });

      console.log(`【${key}】`);
      console.log(`  中高质量: 平均=${goodStats.avg.toFixed(2)}, 中位数=${goodStats.median.toFixed(2)}, 标准差=${goodStats.stdDev.toFixed(2)}`);
      console.log(`  低质量:   平均=${badStats.avg.toFixed(2)}, 中位数=${badStats.median.toFixed(2)}, 标准差=${badStats.stdDev.toFixed(2)}`);
      console.log(`  差异:     ${direction === 'higher' ? '+' : ''}${diffPercent.toFixed(1)}%`);
      console.log(`  重叠度:   ${(overlap * 100).toFixed(1)}% (越低越好)`);
      console.log(`  分离度:   ${discriminantPower.toFixed(2)} (越高越好)`);
      console.log(`  最佳阈值: ${optimalThreshold.direction === '>' ? '>' : '<='} ${optimalThreshold.threshold.toFixed(2)} (得分: ${optimalThreshold.score.toFixed(2)})`);
      console.log('');
    }
  });

  // 6. 排序并给出建议
  console.log('=== 特征重要性排序 ===\n');

  const sortedByDiscriminant = [...featureAnalysis].sort((a, b) => b.discriminantPower - a.discriminantPower);

  sortedByDiscriminant.forEach((f, index) => {
    console.log(`${index + 1}. ${f.feature}`);
    console.log(`   分离度: ${f.discriminantPower.toFixed(2)} | 重叠度: ${(f.overlap * 100).toFixed(1)}% | 差异: ${f.diffPercent > 0 ? '+' : ''}${f.diffPercent.toFixed(1)}%`);
  });

  // 7. 生成过滤建议
  console.log('\n=== 优化建议 ===\n');

  const topFeatures = sortedByDiscriminant.slice(0, 5);

  console.log('建议优先使用以下特征进行过滤：\n');

  topFeatures.forEach(f => {
    const threshold = f.optimalThreshold.threshold;
    const direction = f.optimalThreshold.direction;
    const condition = direction === '>' ? `>= ${threshold.toFixed(2)}` : `< ${threshold.toFixed(2)}`;

    console.log(`【${f.feature}】`);
    console.log(`  当前配置中阈值: ${getCurrentThreshold(f.feature) || '未设置'}`);
    console.log(`  建议阈值: ${condition}`);
    console.log(`  预期改善: 分离度 ${f.discriminantPower.toFixed(2)}, 重叠度 ${(f.overlap * 100).toFixed(1)}%`);
    console.log('');
  });

  // 8. 构建复合条件建议
  console.log('=== 复合过滤条件建议 ===\n');

  const bestLowOverlapFeatures = sortedByDiscriminant
    .filter(f => f.overlap < 0.3)
    .slice(0, 3);

  if (bestLowOverlapFeatures.length > 0) {
    console.log('推荐使用以下低重叠度特征的组合：');
    console.log('preBuyCheckCondition = "');

    const conditions = bestLowOverlapFeatures.map(f => {
      const threshold = f.optimalThreshold.threshold;
      const direction = f.optimalThreshold.direction;
      const op = direction === '>' ? '>=' : '<';
      return `${f.feature} ${op} ${threshold.toFixed(2)}`;
    });

    console.log(conditions.join(' AND '));
    console.log('"\n');
  } else {
    console.log('没有找到重叠度低于30%的特征，建议考虑组合多个特征使用。\n');
  }

  // 9. 数据分布详情
  console.log('=== 数据分布详情 (用于调参) ===\n');

  sortedByDiscriminant.slice(0, 5).forEach(f => {
    console.log(`【${f.feature}】`);

    const goodValues = goodTokens.map(t => t[f.feature]).filter(v => v !== null && v !== undefined);
    const badValues = badTokens.map(t => t[f.feature]).filter(v => v !== null && v !== undefined);

    // 按百分位显示
    const percentiles = [10, 25, 50, 75, 90];
    console.log('  中高质量百分位:');
    percentiles.forEach(p => {
      const index = Math.floor(goodValues.length * p / 100);
      console.log(`    P${p}: ${goodValues[index]?.toFixed(2) || 'N/A'}`);
    });
    console.log('  低质量百分位:');
    percentiles.forEach(p => {
      const index = Math.floor(badValues.length * p / 100);
      console.log(`    P${p}: ${badValues[index]?.toFixed(2) || 'N/A'}`);
    });
    console.log('');
  });
}

// 获取当前配置中的阈值
function getCurrentThreshold(featureName) {
  const currentThresholds = {
    holderBlacklistCount: '<= 5',
    holderWhitelistCount: '>= holderBlacklistCount * 2',
    devHoldingRatio: '< 15',
    maxHoldingRatio: '< 18',
    earlyTradesCountPerMin: '>= 30',
    earlyTradesVolumePerMin: '>= 4000',
    earlyTradesHighValuePerMin: '>= 10',
    earlyTradesWalletsPerMin: '未设置',
    earlyTradesUniqueWallets: '未设置'
  };
  return currentThresholds[featureName] || null;
}

analyzeAdvanced().then(() => {
  console.log('\n分析完成');
  process.exit(0);
}).catch(error => {
  console.error('分析失败:', error);
  process.exit(1);
});
