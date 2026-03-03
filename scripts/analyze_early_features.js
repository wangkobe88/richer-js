/**
 * 早期参与者特征分析脚本
 * 分析重新计算后的特征分布和有效性
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = '/Users/nobody1/Desktop/Codes/richer-js/scripts/early_participants_corrected.json';

/**
 * 加载修正后的数据
 */
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    console.error('数据文件不存在，请先运行: node scripts/reanalyze_early_participants.js');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  console.log(`加载 ${data.samples.length} 个样本\n`);
  return data.samples;
}

/**
 * 计算分位数
 */
function calculatePercentiles(values, percentiles) {
  const sorted = [...values].sort((a, b) => a - b);
  const result = {};

  for (const p of percentiles) {
    const index = Math.floor((p / 100) * (sorted.length - 1));
    result[p] = sorted[index];
  }

  return result;
}

/**
 * 打印特征分布对比
 */
function printFeatureDistribution(samples) {
  console.log('========================================');
  console.log('特征分布分析（正样本 vs 负样本）');
  console.log('========================================\n');

  const positiveSamples = samples.filter(s => s.isPositive);
  const negativeSamples = samples.filter(s => !s.isPositive);

  const features = [
    { key: 'countPerMin', name: '交易次数/分' },
    { key: 'volumePerMin', name: '交易额/分' },
    { key: 'walletsPerMin', name: '钱包数/分' },
    { key: 'highValuePerMin', name: '高价值/分' },
    { key: 'totalCount', name: '总交易数' },
    { key: 'totalVolume', name: '总交易额' },
    { key: 'uniqueWallets', name: '独立钱包数' },
    { key: 'highValueCount', name: '高价值交易数' }
  ];

  console.log('特征                    | 正样本(中位数) | 负样本(中位数) |  正均 | 负均');
  console.log('------------------------|---------------|---------------|-------|-------');

  for (const feat of features) {
    const posValues = positiveSamples.map(s => s[feat.key]).filter(v => v > 0);
    const negValues = negativeSamples.map(s => s[feat.key]).filter(v => v > 0);

    const posMedian = posValues.length > 0 ? calculatePercentiles(posValues, [50])[50] : 0;
    const negMedian = negValues.length > 0 ? calculatePercentiles(negValues, [50])[50] : 0;

    const posMean = posValues.length > 0 ? (posValues.reduce((a,b) => a+b, 0) / posValues.length) : 0;
    const negMean = negValues.length > 0 ? (negValues.reduce((a,b) => a+b, 0) / negValues.length) : 0;

    console.log(`${feat.name.padEnd(22)} | ${posMedian.toFixed(1).padStart(13)} | ${negMedian.toFixed(1).padStart(13)} | ${posMean.toFixed(1).padStart(5)} | ${negMean.toFixed(1).padStart(5)}`);
  }

  console.log('');
}

/**
 * 计算特征的AUC（近似）
 */
function calculateAUC(samples, featureKey) {
  const positiveSamples = samples.filter(s => s.isPositive);
  const negativeSamples = samples.filter(s => !s.isPositive);

  const posValues = positiveSamples.map(s => s[featureKey]);
  const negValues = negativeSamples.map(s => s[featureKey]);

  let rankSum = 0;
  for (const pos of posValues) {
    for (const neg of negValues) {
      if (pos > neg) rankSum++;
    }
  }

  return rankSum / (posValues.length * negValues.length);
}

/**
 * 打印特征AUC排名
 */
function printFeatureRanking(samples) {
  console.log('========================================');
  console.log('特征区分度排名（AUC）');
  console.log('========================================\n');

  const features = [
    { key: 'countPerMin', name: '交易次数/分' },
    { key: 'volumePerMin', name: '交易额/分' },
    { key: 'walletsPerMin', name: '钱包数/分' },
    { key: 'highValuePerMin', name: '高价值/分' },
    { key: 'totalCount', name: '总交易数' },
    { key: 'totalVolume', name: '总交易额' },
    { key: 'uniqueWallets', name: '独立钱包数' },
    { key: 'highValueCount', name: '高价值交易数' }
  ];

  const aucList = features.map(feat => ({
    ...feat,
    auc: calculateAUC(samples, feat.key)
  }));

  aucList.sort((a, b) => b.auc - a.auc);

  console.log('排名 | 特征                | AUC    | 解释');
  console.log('-----|--------------------|--------|--------');

  aucList.forEach((f, i) => {
    const interpretation = f.auc > 0.6 ? '较高' : f.auc > 0.5 ? '中等' : '较低';
    console.log(`${(i+1).toString().padStart(4)} | ${f.name.padEnd(18)} | ${(f.auc*100).toFixed(1)}%   | ${interpretation}`);
  });

  console.log('');
  return aucList;
}

/**
 * 打印分位数阈值
 */
function printPercentileThresholds(samples, featureRanking) {
  console.log('========================================');
  console.log('特征阈值建议（基于分位数）');
  console.log('========================================\n');

  const positiveSamples = samples.filter(s => s.isPositive);

  for (const feat of featureRanking.slice(0, 6)) { // 只看前6个特征
    const posValues = positiveSamples.map(s => s[feat.key]).filter(v => v > 0);

    if (posValues.length < 5) continue;

    const percentiles = calculatePercentiles(posValues, [25, 50, 60, 70, 75, 80, 90]);

    console.log(`${feat.name}:`);
    console.log(`  P25: ${percentiles[25].toFixed(1)}`);
    console.log(`  P50: ${percentiles[50].toFixed(1)}  ← 中位数`);
    console.log(`  P60: ${percentiles[60].toFixed(1)}`);
    console.log(`  P70: ${percentiles[70].toFixed(1)}`);
    console.log(`  P75: ${percentiles[75].toFixed(1)}`);
    console.log(`  P90: ${percentiles[90].toFixed(1)}`);
    console.log('');
  }
}

/**
 * 分析原始 vs 重新计算指标的差异
 */
function printComparison(samples) {
  console.log('========================================');
  console.log('原始指标 vs 重新计算指标对比');
  console.log('========================================\n');

  const significantDiff = samples.filter(s =>
    Math.abs(s.countPerMin - s.origCountPerMin) > 1
  );

  console.log(`有 ${significantDiff.length} 个样本的差异超过 1 笔/分\n`);

  if (significantDiff.length > 0 && significantDiff.length <= 10) {
    console.log('差异示例:');
    for (const s of significantDiff.slice(0, 5)) {
      console.log(`  ${s.symbol}: 原始=${s.origCountPerMin}, 重新计算=${s.countPerMin}, checkTime=${s.checkTime}s`);
    }
    console.log('');
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('========================================');
  console.log('早期参与者特征分析');
  console.log('========================================\n');

  const samples = loadData();

  // 1. 特征分布对比
  printFeatureDistribution(samples);

  // 2. 特征AUC排名
  const featureRanking = printFeatureRanking(samples);

  // 3. 分位数阈值建议
  printPercentileThresholds(samples, featureRanking);

  // 4. 原始 vs 重新计算对比
  printComparison(samples);

  console.log('========================================');
  console.log('✅ 特征分析完成！');
  console.log('请运行下一步：node scripts/optimize_thresholds.js');
  console.log('========================================');
}

main().catch(console.error);
