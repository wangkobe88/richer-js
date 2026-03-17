/**
 * 预测建模分析
 * 用早期特征预测涨幅，找出最重要的预测因子
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data', 'processed');

function loadSequences() {
  const sequencesPath = path.join(DATA_DIR, 'all_sequences.json');
  const content = fs.readFileSync(sequencesPath, 'utf-8');
  const data = JSON.parse(content);
  return data.sequences;
}

/**
 * 提取预测特征
 */
function extractFeatures(sequences) {
  console.log('========================================');
  console.log('特征提取与预测分析');
  console.log('========================================\n');

  const features = sequences.map(seq => {
    // 只用前30秒的数据（早期特征）
    const earlyTimeLimit = 30;
    const earlyTrades = [];
    const lateTrades = [];

    seq.sequence.forEach(([wallet, amount], idx) => {
      const time = idx * 3;
      if (time < earlyTimeLimit) {
        earlyTrades.push([wallet, amount, time]);
      } else {
        lateTrades.push([wallet, amount, time]);
      }
    });

    const earlyWallets = new Set(earlyTrades.map(([w]) => w));
    const uniqueWallets = new Set(seq.sequence.map(([w]) => w));

    // 特征工程
    const feature = {
      token_address: seq.token_address,
      token_symbol: seq.token_symbol,
      max_change_percent: seq.max_change_percent,
      is_high_return: seq.max_change_percent >= 100,

      // 基础特征
      total_trades: seq.sequence.length,
      total_early_trades: earlyTrades.length,

      // 钱包特征
      unique_wallets: uniqueWallets.size,
      early_unique_wallets: earlyWallets.size,

      // 金额特征
      total_buy: seq.sequence.reduce((sum, [, a]) => a > 0 ? sum + a : sum, 0),
      total_sell: seq.sequence.reduce((sum, [, a]) => a < 0 ? sum + Math.abs(a) : sum, 0),
      early_buy: earlyTrades.reduce((sum, [, a]) => a > 0 ? sum + a : sum, 0),
      early_sell: earlyTrades.reduce((sum, [, a]) => a < 0 ? sum + Math.abs(a) : sum, 0),
      net_flow: 0,
      early_net_flow: 0,

      // 买卖比例
      buy_sell_ratio: 0,
      early_buy_sell_ratio: 0,

      // 大额交易特征
      large_buy_count: 0,
      early_large_buy_count: 0,
      avg_buy_amount: 0,
      early_avg_buy_amount: 0,

      // 第一个钱包特征
      first_is_buy: false,
      first_amount: 0,

      // 交易节奏
      avg_time_between_trades: 0,
      early_avg_time_between_trades: 0,
    };

    // 计算衍生特征
    feature.total_buy = seq.sequence.filter(([, a]) => a > 0).length;
    feature.total_sell = seq.sequence.filter(([, a]) => a < 0).length;

    const totalBuyAmount = seq.sequence.reduce((sum, [, a]) => a > 0 ? sum + a : sum, 0);
    const totalSellAmount = seq.sequence.reduce((sum, [, a]) => a < 0 ? sum + Math.abs(a) : sum, 0);
    feature.net_flow = totalBuyAmount - totalSellAmount;

    const earlyBuyAmount = earlyTrades.reduce((sum, [, a]) => a > 0 ? sum + a : sum, 0);
    const earlySellAmount = earlyTrades.reduce((sum, [, a]) => a < 0 ? sum + Math.abs(a) : sum, 0);
    feature.early_net_flow = earlyBuyAmount - earlySellAmount;

    feature.buy_sell_ratio = feature.total_sell > 0 ? feature.total_buy / feature.total_sell : feature.total_buy;
    feature.early_buy_sell_ratio = earlyTrades.filter(([, a]) => a < 0).length > 0 ?
      earlyTrades.filter(([, a]) => a > 0).length / earlyTrades.filter(([, a]) => a < 0).length :
      earlyTrades.filter(([, a]) => a > 0).length;

    // 大额买入（超过中位数）
    const buyAmounts = seq.sequence.filter(([, a]) => a > 0).map(([, a]) => a);
    const medianBuy = buyAmounts.sort((a, b) => a - b)[Math.floor(buyAmounts.length / 2)];
    feature.large_buy_count = buyAmounts.filter(a => a > medianBuy * 2).length;

    const earlyBuyAmounts = earlyTrades.filter(([, a]) => a > 0).map(([, a]) => a);
    if (earlyBuyAmounts.length > 0) {
      const earlyMedianBuy = earlyBuyAmounts.sort((a, b) => a - b)[Math.floor(earlyBuyAmounts.length / 2)];
      feature.early_large_buy_count = earlyBuyAmounts.filter(a => a > earlyMedianBuy * 2).length;
    }

    feature.avg_buy_amount = buyAmounts.length > 0 ? totalBuyAmount / buyAmounts.length : 0;
    feature.early_avg_buy_amount = earlyBuyAmounts.length > 0 ? earlyBuyAmount / earlyBuyAmounts.length : 0;

    if (seq.sequence.length > 0) {
      feature.first_is_buy = seq.sequence[0][1] > 0;
      feature.first_amount = Math.abs(seq.sequence[0][1]);
    }

    return feature;
  });

  return features;
}

/**
 * 计算相关系数
 */
function correlation(xArr, yArr) {
  const n = xArr.length;
  if (n === 0) return 0;

  const meanX = xArr.reduce((a, b) => a + b, 0) / n;
  const meanY = yArr.reduce((a, b) => a + b, 0) / n;

  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xArr[i] - meanX;
    const dy = yArr[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  if (denX === 0 || denY === 0) return 0;
  return num / Math.sqrt(denX * denY);
}

/**
 * 计算信息价值 (IV)
 */
function informationValue(features, targetFeature) {
  // 将特征分成10个分位数
  const buckets = 10;
  const featureValues = features.map(f => f[targetFeature]);
  const sortedValues = [...featureValues].sort((a, b) => a - b);

  const bucketSize = Math.ceil(sortedValues.length / buckets);
  const bucketBounds = [];

  for (let i = 0; i < buckets; i++) {
    bucketBounds.push(sortedValues[Math.min(i * bucketSize, sortedValues.length - 1)]);
  }
  bucketBounds.push(Infinity);

  // 统计每个分位数的好币/坏币数量
  const bucketStats = [];
  for (let i = 0; i < buckets; i++) {
    const bucketFeatures = features.filter(f => {
      const val = f[targetFeature];
      return val >= bucketBounds[i] && (i === buckets - 1 || val < bucketBounds[i + 1]);
    });

    const highCount = bucketFeatures.filter(f => f.is_high_return).length;
    const totalCount = bucketFeatures.length;

    bucketStats.push({
      min: bucketBounds[i],
      max: bucketBounds[i + 1],
      highCount,
      totalCount,
      highRate: totalCount > 0 ? highCount / totalCount : 0
    });
  }

  // 计算 IV
  const totalHigh = features.filter(f => f.is_high_return).length;
  const totalLow = features.length - totalHigh;
  const overallRate = totalHigh / features.length;

  let iv = 0;
  for (const bucket of bucketStats) {
    if (bucket.totalCount === 0) continue;

    const actualRate = bucket.highRate;
    const expectedRate = overallRate;

    if (actualRate === 0 || actualRate === 1) {
      // 避免除零
      continue;
    }

    const weight = bucket.totalCount / features.length;
    iv += weight * (actualRate - expectedRate) * Math.log(actualRate / expectedRate);
  }

  return { iv, bucketStats };
}

/**
 * 分析特征重要性
 */
function analyzeFeatureImportance(features) {
  console.log('【特征与涨幅的相关性】\n');

  const numericFeatures = [
    'total_trades', 'total_early_trades',
    'unique_wallets', 'early_unique_wallets',
    'total_buy', 'total_sell',
    'early_buy', 'early_sell',
    'net_flow', 'early_net_flow',
    'buy_sell_ratio', 'early_buy_sell_ratio',
    'large_buy_count', 'early_large_buy_count',
    'avg_buy_amount', 'early_avg_buy_amount',
    'first_amount'
  ];

  const changes = features.map(f => f.max_change_percent);
  const isHighReturn = features.map(f => f.is_high_return ? 1 : 0);

  // 计算每个特征与涨幅/是否高涨幅的相关性
  const featureCorr = {};
  numericFeatures.forEach(feat => {
    const values = features.map(f => f[feat]);
    featureCorr[feat] = {
      with_change: correlation(values, changes),
      with_high_return: correlation(values, isHighReturn)
    };
  });

  // 排序并打印
  console.log('特征与涨幅的相关性（排序）:');
  Object.entries(featureCorr)
    .sort((a, b) => Math.abs(b[1].with_change) - Math.abs(a[1].with_change))
    .slice(0, 10)
    .forEach(([feat, corr]) => {
      console.log(`  ${feat}: ${corr.with_change.toFixed(3)}`);
    });

  console.log('\n特征与是否高涨幅的相关性（排序）:');
  Object.entries(featureCorr)
    .sort((a, b) => Math.abs(b[1].with_high_return) - Math.abs(a[1].with_high_return))
    .slice(0, 10)
    .forEach(([feat, corr]) => {
      console.log(`  ${feat}: ${corr.with_high_return.toFixed(3)}`);
    });

  // 计算信息价值
  console.log('\n【特征信息价值（IV）】\n');

  const featureIV = {};
  numericFeatures.forEach(feat => {
    try {
      const { iv, bucketStats } = informationValue(features, feat);
      featureIV[feat] = { iv, bucketStats };
    } catch (e) {
      featureIV[feat] = { iv: 0, bucketStats: [] };
    }
  });

  // 排序并打印
  Object.entries(featureIV)
    .sort((a, b) => Math.abs(b[1].iv) - Math.abs(a[1].iv))
    .slice(0, 15)
    .forEach(([feat, { iv, bucketStats }]) => {
      console.log(`\n${feat}: IV = ${iv.toFixed(3)}`);
      console.log('  分位数 高涨幅比例:');
      bucketStats.forEach((bucket, i) => {
        if (bucket.totalCount > 0) {
          console.log(`    分位${i + 1} (${bucket.min.toFixed(0)}-${bucket.max === Infinity ? '∞' : bucket.max.toFixed(0)}): ${(bucket.highRate * 100).toFixed(1)}% (${bucket.highCount}/${bucket.totalCount})`);
        }
      });
    });

  return { featureCorr, featureIV };
}

/**
 * 构建简单预测规则
 */
function buildPredictiveRules(features) {
  console.log('\n========================================');
  console.log('构建预测规则');
  console.log('========================================\n');

  // 基于信息价值最高的几个特征构建规则
  const topFeatures = Object.entries(features)
    .map(([tokenAddr, f]) => ({
      early_net_flow: f.early_net_flow,
      early_large_buy_count: f.early_large_buy_count,
      early_unique_wallets: f.early_unique_wallets,
      is_high_return: f.is_high_return,
      symbol: f.token_symbol,
      change: f.max_change_percent
    }));

  // 找最佳阈值
  console.log('基于 early_net_flow 的预测:');

  let bestThreshold = 0;
  let bestAccuracy = 0;

  for (const threshold of [0, 100, 200, 500, 1000, 2000, 5000]) {
    let correct = 0;
    for (const f of topFeatures) {
      const predicted = f.early_net_flow >= threshold;
      if (predicted === f.is_high_return) correct++;
    }
    const accuracy = correct / topFeatures.length;
    if (accuracy > bestAccuracy) {
      bestAccuracy = accuracy;
      bestThreshold = threshold;
    }
  }

  console.log(`  最佳阈值: $${bestThreshold}`);
  console.log(`  准确率: ${(bestAccuracy * 100).toFixed(1)}%`);

  // 分析这个规则的表现
  const truePositive = topFeatures.filter(f => f.early_net_flow >= bestThreshold && f.is_high_return).length;
  const falsePositive = topFeatures.filter(f => f.early_net_flow >= bestThreshold && !f.is_high_return).length;
  const trueNegative = topFeatures.filter(f => f.early_net_flow < bestThreshold && !f.is_high_return).length;
  const falseNegative = topFeatures.filter(f => f.early_net_flow < bestThreshold && f.is_high_return).length;

  console.log(`  精确率: ${(truePositive / (truePositive + falsePositive) * 100).toFixed(1)}%`);
  console.log(`  召回率: ${(truePositive / (truePositive + falseNegative) * 100).toFixed(1)}%`);
  console.log(`  真正例: ${truePositive}, 假正例: ${falsePositive}`);
  console.log(`  真负例: ${trueNegative}, 假负例: ${falseNegative}`);

  // 多特征组合
  console.log('\n多特征组合规则:');

  // 规则1: early_net_flow > 500 AND early_large_buy_count >= 1
  const rule1Predictions = topFeatures.map(f => ({
    predicted: f.early_net_flow > 500 && f.early_large_buy_count >= 1,
    actual: f.is_high_return,
    symbol: f.symbol,
    change: f.change
  }));

  let rule1Correct = rule1Predictions.filter(p => p.predicted === p.actual).length;
  console.log('  规则1: early_net_flow > $500 AND early_large_buy_count >= 1');
  console.log(`    准确率: ${(rule1Correct / rule1Predictions.length * 100).toFixed(1)}%`);

  const rule1TP = rule1Predictions.filter(p => p.predicted && p.actual).length;
  const rule1FP = rule1Predictions.filter(p => p.predicted && !p.actual).length;
  console.log(`    精确率: ${(rule1TP / (rule1TP + rule1FP) * 100).toFixed(1)}%`);

  // 规则2: early_unique_wallets >= 5 AND early_net_flow > 200
  const rule2Predictions = topFeatures.map(f => ({
    predicted: f.early_unique_wallets >= 5 && f.early_net_flow > 200,
    actual: f.is_high_return,
    symbol: f.symbol,
    change: f.change
  }));

  let rule2Correct = rule2Predictions.filter(p => p.predicted === p.actual).length;
  console.log('\n  规则2: early_unique_wallets >= 5 AND early_net_flow > $200');
  console.log(`    准确率: ${(rule2Correct / rule2Predictions.length * 100).toFixed(1)}%`);

  const rule2TP = rule2Predictions.filter(p => p.predicted && p.actual).length;
  const rule2FP = rule2Predictions.filter(p => p.predicted && !p.actual).length;
  console.log(`    精确率: ${(rule2TP / (rule2TP + rule2FP) * 100).toFixed(1)}%`);
}

async function main() {
  const sequences = loadSequences();
  console.log(`✓ 读取 ${sequences.length} 个代币序列\n`);

  const features = extractFeatures(sequences);
  console.log(`✓ 提取 ${features.length} 个代币的特征\n`);

  const { featureCorr, featureIV } = analyzeFeatureImportance(features);
  buildPredictiveRules(features);

  console.log('\n========================================');
  console.log('✓ 分析完成!');
  console.log('========================================\n');
}

main().catch(err => {
  console.error('分析失败:', err);
  process.exit(1);
});
