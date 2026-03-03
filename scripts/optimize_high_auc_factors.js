/**
 * 高AUC因子策略优化脚本
 * 使用区分度更高的因子作为主因子
 */

const fs = require('fs');

const DATA_FILE = '/Users/nobody1/Desktop/Codes/richer-js/scripts/early_participants_corrected.json';

/**
 * 加载数据
 */
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    console.error('数据文件不存在');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
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

  const precision = tp > 0 ? tp / (tp + fp) : 0;
  const recall = tp > 0 ? tp / (tp + fn) : 0;
  const f1 = (precision + recall) > 0 ? 2 * precision * recall / (precision + recall) : 0;
  const passRate = (tp + fp) / samples.length;

  return { tp, tn, fp, fn, precision, recall, f1, passRate };
}

/**
 * 计算分位数
 */
function getPercentile(values, pct) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(pct * (sorted.length - 1))] || 0;
}

/**
 * 主函数
 */
async function main() {
  console.log('========================================');
  console.log('高AUC因子策略优化');
  console.log('========================================\n');

  const samples = loadData();
  const positiveSamples = samples.filter(s => s.isPositive);

  console.log(`正样本: ${positiveSamples.length}, 负样本: ${samples.length - positiveSamples.length}\n`);

  // 按AUC排序的因子
  const factors = [
    { key: 'totalVolume', name: '总交易额', auc: 0.879 },
    { key: 'filteredCount', name: '过滤后交易数', auc: 0.835 },
    { key: 'highValueCount', name: '高价值交易数', auc: 0.830 },
    { key: 'totalCount', name: '总交易数', auc: 0.827 },
    { key: 'uniqueWallets', name: '独立钱包数', auc: 0.826 },
    { key: 'walletsPerMin', name: '钱包数/分', auc: 0.788 },
    { key: 'countPerMin', name: '交易次数/分', auc: 0.787 },
    { key: 'highValuePerMin', name: '高价值/分', auc: 0.785 },
    { key: 'volumePerMin', name: '交易额/分', auc: 0.780 }
  ];

  // 计算阈值
  for (const f of factors) {
    const posValues = positiveSamples.map(s => s[f.key]).filter(v => v > 0);
    posValues.sort((a, b) => a - b);
    f.p25 = posValues[Math.floor(posValues.length * 0.25)] || 0;
    f.p40 = posValues[Math.floor(posValues.length * 0.40)] || 0;
    f.p50 = posValues[Math.floor(posValues.length * 0.50)] || 0;
    f.p60 = posValues[Math.floor(posValues.length * 0.60)] || 0;
  }

  console.log('因子阈值（正样本）:');
  for (const f of factors) {
    console.log(`  ${f.name.padEnd(12)}: P25=${f.p25}, P40=${f.p40}, P50=${f.p50}, P60=${f.p60}`);
  }
  console.log('');

  // 定义策略
  const strategies = [];

  // 单因子策略（高AUC因子）
  for (const f of factors.slice(0, 6)) {
    for (const pct of ['p25', 'p40', 'p50']) {
      const threshold = f[pct];
      strategies.push({
        name: `单-${f.name}-${pct}`,
        predict: (s) => s[f.key] >= threshold
      });
    }
  }

  // 双因子AND组合（高AUC因子优先）
  const topFactors = factors.slice(0, 5);
  for (let i = 0; i < topFactors.length; i++) {
    for (let j = i + 1; j < topFactors.length; j++) {
      for (const pct1 of ['p25', 'p40']) {
        for (const pct2 of ['p25', 'p40']) {
          strategies.push({
            name: `双-${topFactors[i].name}-${pct1}&${topFactors[j].name}-${pct2}`,
            predict: (s) => s[topFactors[i].key] >= topFactors[i][pct1] && s[topFactors[j].key] >= topFactors[j][pct2]
          });
        }
      }
    }
  }

  // 三因子AND
  for (const pct of ['p25', 'p40']) {
    strategies.push({
      name: `三-绝对值-${pct}`,
      predict: (s) => s.totalVolume >= factors[0][pct] && s.totalCount >= factors[3][pct] && s.uniqueWallets >= factors[4][pct]
    });
  }

  // 混合策略：绝对值 + 速率
  strategies.push({
    name: `混合-交易额+次数/分`,
    predict: (s) => s.totalVolume >= 2066 && s.countPerMin >= 10.6
  });

  strategies.push({
    name: `混合-总交易+钱包/分`,
    predict: (s) => s.totalCount >= 17 && s.walletsPerMin >= 7.1
  });

  strategies.push({
    name: `混合-高价值数+高价值/分`,
    predict: (s) => s.highValueCount >= 8 && s.highValuePerMin >= 5.6
  });

  // OR策略
  strategies.push({
    name: `OR-交易额|次数`,
    predict: (s) => s.totalVolume >= 2066 || s.totalCount >= 44
  });

  strategies.push({
    name: `OR-交易额|钱包数`,
    predict: (s) => s.totalVolume >= 2066 || s.uniqueWallets >= 19
  });

  console.log(`定义了 ${strategies.length} 个策略\n`);

  // 评估
  const results = [];
  for (const s of strategies) {
    const r = evaluate(samples, s.predict);
    results.push({ ...r, name: s.name });
  }

  results.sort((a, b) => b.f1 - a.f1);

  console.log('========================================');
  console.log('策略性能排名（Top 40）');
  console.log('========================================\n');
  console.log('策略                          | 精确率 | 召回率 | F1  | TP | TN | FP | FN | 通过率');
  console.log('------------------------------|--------|--------|-----|----|----|----|----|--------');

  for (const r of results.slice(0, 40)) {
    console.log(
      `${r.name.padEnd(30)} | ${(r.precision*100).toFixed(1).padStart(6)}% | ${(r.recall*100).toFixed(1).padStart(6)}% | ${r.f1.toFixed(2).padStart(3)} | ${r.tp} | ${r.tn} | ${r.fp} | ${r.fn} | ${(r.passRate*100).toFixed(1).padStart(5)}%`
    );
  }

  // 打印混淆矩阵
  console.log('\n========================================');
  console.log('推荐策略详情');
  console.log('========================================\n');

  const best = results[0];
  console.log(`最佳: ${best.name}`);
  console.log(`         | 预测正 | 预测负 |`);
  console.log(`---------|--------|--------|`);
  console.log(`实际正  |   ${best.tp}   |   ${best.fn}   |`);
  console.log(`实际负  |   ${best.fp}   |   ${best.tn}   |`);
  console.log(`F1: ${best.f1.toFixed(2)}, 精确率: ${(best.precision*100).toFixed(1)}%, 召回率: ${(best.recall*100).toFixed(1)}%, 通过率: ${(best.passRate*100).toFixed(1)}%\n`);

  // 不同目标的最佳
  const highRecall = results.filter(r => r.recall >= 0.65).sort((a, b) => b.f1 - a.f1)[0];
  if (highRecall) {
    console.log(`高召回率: ${highRecall.name}`);
    console.log(`         | 预测正 | 预测负 |`);
    console.log(`---------|--------|--------|`);
    console.log(`实际正  |   ${highRecall.tp}   |   ${highRecall.fn}   |`);
    console.log(`实际负  |   ${highRecall.fp}   |   ${highRecall.tn}   |`);
    console.log(`F1: ${highRecall.f1.toFixed(2)}, 精确率: ${(highRecall.precision*100).toFixed(1)}%, 召回率: ${(highRecall.recall*100).toFixed(1)}%, 通过率: ${(highRecall.passRate*100).toFixed(1)}%\n`);
  }

  const highPrecision = results.filter(r => r.precision >= 0.7).sort((a, b) => b.recall - a.recall)[0];
  if (highPrecision) {
    console.log(`高精确率: ${highPrecision.name}`);
    console.log(`         | 预测正 | 预测负 |`);
    console.log(`---------|--------|--------|`);
    console.log(`实际正  |   ${highPrecision.tp}   |   ${highPrecision.fn}   |`);
    console.log(`实际负  |   ${highPrecision.fp}   |   ${highPrecision.tn}   |`);
    console.log(`F1: ${highPrecision.f1.toFixed(2)}, 精确率: ${(highPrecision.precision*100).toFixed(1)}%, 召回率: ${(highPrecision.recall*100).toFixed(1)}%, 通过率: ${(highPrecision.passRate*100).toFixed(1)}%\n`);
  }

  // 导出
  fs.writeFileSync('/Users/nobody1/Desktop/Codes/richer-js/scripts/high_auc_factors_results.json', JSON.stringify({
    exportTime: new Date().toISOString(),
    factors: factors.map(f => ({ name: f.name, key: f.key, auc: f.auc, p25: f.p25, p40: f.p40, p50: f.p50 })),
    results: results.slice(0, 50)
  }, null, 2));

  console.log('✅ 完成！');
}

main().catch(console.error);
