/**
 * 早期参与者阈值优化脚本
 * 寻找最优的特征组合和阈值
 */

const fs = require('fs');

const DATA_FILE = '/Users/nobody1/Desktop/Codes/richer-js/scripts/early_participants_corrected.json';

/**
 * 加载数据
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
 * 评估预测结果
 */
function evaluate(samples, predictFn) {
  let tp = 0, tn = 0, fp = 0, fn = 0;

  for (const s of samples) {
    const predicted = predictFn(s);
    const actual = s.isPositive;

    if (predicted && actual) tp++;
    else if (!predicted && !actual) tn++;
    else if (predicted && !actual) fp++;
    else fn++;
  }

  const accuracy = (tp + tn) / (tp + tn + fp + fn);
  const precision = tp > 0 ? tp / (tp + fp) : 0;
  const recall = tp > 0 ? tp / (tp + fn) : 0;
  const f1 = (precision + recall) > 0 ? 2 * precision * recall / (precision + recall) : 0;
  const passRate = (tp + fp) / (tp + tn + fp + fn);

  return { tp, tn, fp, fn, accuracy, precision, recall, f1, passRate };
}

/**
 * 定义候选策略
 */
function defineStrategies(thresholds) {
  const strategies = [];

  // 单特征策略（不同分位数）
  for (const feat of ['countPerMin', 'volumePerMin', 'highValuePerMin']) {
    for (const percentile of ['p25', 'p50', 'p60', 'p70', 'p75', 'p80']) {
      const threshold = thresholds[feat][percentile];
      strategies.push({
        name: `单特征-${feat}-${percentile}`,
        predict: (s) => s[feat] >= threshold
      });
    }
  }

  // 双特征 AND 组合
  const dualCombos = [
    ['countPerMin', 'volumePerMin'],
    ['countPerMin', 'highValuePerMin'],
    ['volumePerMin', 'highValuePerMin']
  ];

  for (const [feat1, feat2] of dualCombos) {
    for (const pct1 of ['p50', 'p60', 'p70', 'p75']) {
      for (const pct2 of ['p50', 'p60', 'p70', 'p75']) {
        strategies.push({
          name: `双AND-${feat1}-${pct1}&${feat2}-${pct2}`,
          predict: (s) => s[feat1] >= thresholds[feat1][pct1] && s[feat2] >= thresholds[feat2][pct2]
        });
      }
    }
  }

  // 三特征 AND（策略8变体）
  for (const pct of ['p25', 'p50', 'p60', 'p70', 'p75']) {
    strategies.push({
      name: `三AND-p${pct}`,
      predict: (s) =>
        s.countPerMin >= thresholds.countPerMin[pct] &&
        s.volumePerMin >= thresholds.volumePerMin[pct] &&
        s.highValuePerMin >= thresholds.highValuePerMin[pct]
    });
  }

  // 四特征 AND
  for (const pct of ['p50', 'p60', 'p70', 'p75']) {
    strategies.push({
      name: `四AND-p${pct}`,
      predict: (s) =>
        s.countPerMin >= thresholds.countPerMin[pct] &&
        s.volumePerMin >= thresholds.volumePerMin[pct] &&
        s.walletsPerMin >= thresholds.walletsPerMin[pct] &&
        s.highValuePerMin >= thresholds.highValuePerMin[pct]
    });
  }

  // OR 组合
  strategies.push({
    name: '双OR-count&volume-p50',
    predict: (s) => s.countPerMin >= thresholds.countPerMin.p50 || s.volumePerMin >= thresholds.volumePerMin.p50
  });

  strategies.push({
    name: '三OR-p60',
    predict: (s) =>
      s.countPerMin >= thresholds.countPerMin.p60 ||
      s.volumePerMin >= thresholds.volumePerMin.p60 ||
      s.highValuePerMin >= thresholds.highValuePerMin.p60
  });

  return strategies;
}

/**
 * 打印混淆矩阵详情
 */
function printConfusionMatrix(result, strategyName) {
  console.log(`\n${strategyName}:`);
  console.log(`         | 预测正 | 预测负 |`);
  console.log(`---------|--------|--------|`);
  console.log(`实际正  |   ${result.tp}   |   ${result.fn}   |`);
  console.log(`实际负  |   ${result.fp}   |   ${result.tn}   |`);
}

/**
 * 主函数
 */
async function main() {
  console.log('========================================');
  console.log('早期参与者阈值优化');
  console.log('========================================\n');

  const samples = loadData();

  const positiveSamples = samples.filter(s => s.isPositive);
  const negativeSamples = samples.filter(s => !s.isPositive);

  console.log(`正样本: ${positiveSamples.length}`);
  console.log(`负样本: ${negativeSamples.length}`);
  console.log(`总计: ${samples.length}\n`);

  // 计算正样本的分位数阈值
  const thresholds = {};
  const features = ['countPerMin', 'volumePerMin', 'walletsPerMin', 'highValuePerMin'];

  for (const feat of features) {
    const posValues = positiveSamples.map(s => s[feat]).filter(v => v > 0).sort((a, b) => a - b);

    thresholds[feat] = {
      p25: posValues[Math.floor(posValues.length * 0.25)] || 0,
      p50: posValues[Math.floor(posValues.length * 0.50)] || 0,
      p60: posValues[Math.floor(posValues.length * 0.60)] || 0,
      p70: posValues[Math.floor(posValues.length * 0.70)] || 0,
      p75: posValues[Math.floor(posValues.length * 0.75)] || 0,
      p80: posValues[Math.floor(posValues.length * 0.80)] || 0,
      p90: posValues[Math.floor(posValues.length * 0.90)] || 0
    };
  }

  console.log('正样本分位数阈值:');
  for (const feat of features) {
    console.log(`  ${feat}:`);
    console.log(`    P25: ${thresholds[feat].p25}, P50: ${thresholds[feat].p50}, P70: ${thresholds[feat].p70}, P75: ${thresholds[feat].p75}`);
  }
  console.log('');

  // 定义策略
  const strategies = defineStrategies(thresholds);
  console.log(`定义了 ${strategies.length} 个候选策略\n`);

  // 评估所有策略
  const results = [];
  for (const strategy of strategies) {
    const result = evaluate(samples, strategy.predict);
    results.push({ ...result, name: strategy.name });
  }

  // 排序：按 F1 分数降序
  results.sort((a, b) => b.f1 - a.f1);

  console.log('========================================');
  console.log('策略性能排名（Top 20）');
  console.log('========================================\n');
  console.log('策略                          | 准确率 | 精确率 | 召回率 | F1  | TP | TN | FP | FN | 通过率');
  console.log('------------------------------|--------|--------|--------|-----|----|----|----|----|--------');

  for (const r of results.slice(0, 20)) {
    console.log(
      `${r.name.padEnd(28)} | ${(r.accuracy*100).toFixed(1).padStart(6)}% | ${(r.precision*100).toFixed(1).padStart(6)}% | ${(r.recall*100).toFixed(1).padStart(6)}% | ${r.f1.toFixed(2).padStart(3)} | ${r.tp} | ${r.tn} | ${r.fp} | ${r.fn} | ${(r.passRate*100).toFixed(1).padStart(5)}%`
    );
  }

  // 打印最佳策略的详情
  const best = results[0];
  console.log('\n========================================');
  console.log('最佳策略详情');
  console.log('========================================\n');
  printConfusionMatrix(best, `最佳: ${best.name}`);

  // 找出精确率最高的策略
  const highPrecision = results.filter(r => r.precision >= 0.5 && r.tp > 5).sort((a, b) => b.precision - a.precision)[0];
  if (highPrecision) {
    console.log(`\n高精确率策略: ${highPrecision.name}`);
    console.log(`  精确率: ${(highPrecision.precision * 100).toFixed(1)}%`);
    printConfusionMatrix(highPrecision, `高精确率`);
  }

  // 导出结果
  const outputFile = '/Users/nobody1/Desktop/Codes/richer-js/scripts/threshold_optimization_results.json';
  fs.writeFileSync(outputFile, JSON.stringify({
    exportTime: new Date().toISOString(),
    sampleCount: samples.length,
    positiveCount: positiveSamples.length,
    negativeCount: negativeSamples.length,
    thresholds,
    results: results.slice(0, 30) // 保存前30个结果
  }, null, 2));
  console.log(`\n结果已保存到: ${outputFile}`);

  console.log('\n========================================');
  console.log('✅ 阈值优化完成！');
  console.log('========================================');
}

main().catch(console.error);
