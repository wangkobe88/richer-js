/**
 * 混合阈值优化脚本
 * 测试更精细的特征组合策略
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
 * 主函数
 */
async function main() {
  console.log('========================================');
  console.log('混合阈值优化');
  console.log('========================================\n');

  const samples = loadData();
  const positiveSamples = samples.filter(s => s.isPositive);

  console.log(`正样本: ${positiveSamples.length}`);
  console.log(`负样本: ${samples.length - positiveSamples.length}`);
  console.log(`总计: ${samples.length}\n`);

  // 计算正样本的分位数阈值
  const thresholds = {};
  const features = ['countPerMin', 'volumePerMin', 'walletsPerMin', 'highValuePerMin'];

  for (const feat of features) {
    const posValues = positiveSamples.map(s => s[feat]).filter(v => v > 0).sort((a, b) => a - b);
    thresholds[feat] = {
      p25: posValues[Math.floor(posValues.length * 0.25)] || 0,
      p40: posValues[Math.floor(posValues.length * 0.40)] || 0,
      p50: posValues[Math.floor(posValues.length * 0.50)] || 0,
      p60: posValues[Math.floor(posValues.length * 0.60)] || 0,
      p70: posValues[Math.floor(posValues.length * 0.70)] || 0
    };
  }

  console.log('正样本分位数阈值:');
  for (const feat of features) {
    console.log(`  ${feat}: P25=${thresholds[feat].p25}, P40=${thresholds[feat].p40}, P50=${thresholds[feat].p50}, P60=${thresholds[feat].p60}, P70=${thresholds[feat].p70}`);
  }
  console.log('');

  // 定义混合策略
  const strategies = [];

  // 策略家族1: 高精确特征 + 低阈值辅助特征
  // 如果高精确特征通过，降低其他特征的门槛
  for (const primaryFeat of ['countPerMin', 'volumePerMin']) {
    for (const primaryPct of ['p50', 'p60', 'p70']) {
      for (const secondaryFeat of ['countPerMin', 'volumePerMin', 'highValuePerMin']) {
        if (primaryFeat === secondaryFeat) continue;
        for (const secondaryPct of ['p25', 'p40']) {
          strategies.push({
            name: `混合-${primaryFeat}-${primaryPct}+${secondaryFeat}-${secondaryPct}`,
            desc: `${primaryFeat}>=${primaryPct} && (${secondaryFeat}>=${secondaryPct} || ${primaryFeat}达到p70)`,
            predict: (s) => {
              const primaryPass = s[primaryFeat] >= thresholds[primaryFeat][primaryPct];
              const secondaryPass = s[secondaryFeat] >= thresholds[secondaryFeat][secondaryPct];
              const highPrimaryPass = s[primaryFeat] >= thresholds[primaryFeat].p70;
              return primaryPass && (secondaryPass || highPrimaryPass);
            }
          });
        }
      }
    }
  }

  // 策略家族2: 两特征组合 - 至少一个达到高阈值，两个都达到中阈值
  strategies.push({
    name: `混合-count&volume-灵活`,
    desc: `(count>=p60 || volume>=p60) && (count>=p25 && volume>=p25)`,
    predict: (s) => {
      const countHigh = s.countPerMin >= thresholds.countPerMin.p60;
      const volumeHigh = s.volumePerMin >= thresholds.volumePerMin.p60;
      const countMed = s.countPerMin >= thresholds.countPerMin.p25;
      const volumeMed = s.volumePerMin >= thresholds.volumePerMin.p25;
      return (countHigh || volumeHigh) && (countMed && volumeMed);
    }
  });

  // 策略家族3: 加权评分
  // 给每个特征打分，总分达标
  for (const scoreThreshold of [60, 70, 80]) {
    strategies.push({
      name: `评分-阈值${scoreThreshold}`,
      desc: `基于四个特征的加权评分`,
      predict: (s) => {
        let score = 0;
        if (s.countPerMin >= thresholds.countPerMin.p70) score += 30;
        else if (s.countPerMin >= thresholds.countPerMin.p50) score += 20;
        else if (s.countPerMin >= thresholds.countPerMin.p25) score += 10;

        if (s.volumePerMin >= thresholds.volumePerMin.p70) score += 30;
        else if (s.volumePerMin >= thresholds.volumePerMin.p50) score += 20;
        else if (s.volumePerMin >= thresholds.volumePerMin.p25) score += 10;

        if (s.highValuePerMin >= thresholds.highValuePerMin.p70) score += 25;
        else if (s.highValuePerMin >= thresholds.highValuePerMin.p50) score += 18;
        else if (s.highValuePerMin >= thresholds.highValuePerMin.p25) score += 8;

        if (s.walletsPerMin >= thresholds.walletsPerMin.p70) score += 15;
        else if (s.walletsPerMin >= thresholds.walletsPerMin.p50) score += 10;
        else if (s.walletsPerMin >= thresholds.walletsPerMin.p25) score += 5;

        return score >= scoreThreshold;
      }
    });
  }

  // 策略家族4: 分层策略 - 先用高精确特征过滤，再用其他特征放宽
  strategies.push({
    name: `分层-高精+放宽`,
    desc: `volume>=p50 || (count>=p50 && highValue>=p25)`,
    predict: (s) => {
      const volumePass = s.volumePerMin >= thresholds.volumePerMin.p50;
      const countPass = s.countPerMin >= thresholds.countPerMin.p50;
      const highValuePass = s.highValuePerMin >= thresholds.highValuePerMin.p25;
      return volumePass || (countPass && highValuePass);
    }
  });

  strategies.push({
    name: `分层-count+wallet`,
    desc: `count>=p50 || (count>=p25 && wallets>=p25)`,
    predict: (s) => {
      const countPass = s.countPerMin >= thresholds.countPerMin.p50;
      const countLow = s.countPerMin >= thresholds.countPerMin.p25;
      const walletPass = s.walletsPerMin >= thresholds.walletsPerMin.p25;
      return countPass || (countLow && walletPass);
    }
  });

  // 策略家族5: OR组合 - 任一特征达到特定阈值
  const orCombos = [
    { feats: ['countPerMin', 'volumePerMin'], pct: 'p50' },
    { feats: ['countPerMin', 'highValuePerMin'], pct: 'p50' },
    { feats: ['countPerMin', 'volumePerMin'], pct: 'p40' },
    { feats: ['countPerMin', 'highValuePerMin'], pct: 'p40' },
  ];

  for (const combo of orCombos) {
    strategies.push({
      name: `OR-${combo.feats.join('+')}-${combo.pct}`,
      desc: `${combo.feats[0]}>=${combo.pct} || ${combo.feats[1]}>=${combo.pct}`,
      predict: (s) => {
        return s[combo.feats[0]] >= thresholds[combo.feats[0]][combo.pct] ||
               s[combo.feats[1]] >= thresholds[combo.feats[1]][combo.pct];
      }
    });
  }

  // 策略家族6: 三特征混合 - 两个达到P50 或 一个达到P70 + 其他达到P25
  strategies.push({
    name: `三混合-灵活`,
    desc: `(count>=p50 && volume>=p50) || (count>=p70 && volume>=p25 && highValue>=p25)`,
    predict: (s) => {
      const cond1 = s.countPerMin >= thresholds.countPerMin.p50 && s.volumePerMin >= thresholds.volumePerMin.p50;
      const cond2 = s.countPerMin >= thresholds.countPerMin.p70 &&
                    s.volumePerMin >= thresholds.volumePerMin.p25 &&
                    s.highValuePerMin >= thresholds.highValuePerMin.p25;
      return cond1 || cond2;
    }
  });

  // 评估所有策略
  console.log(`定义了 ${strategies.length} 个候选策略\n`);

  const results = [];
  for (const strategy of strategies) {
    const result = evaluate(samples, strategy.predict);
    results.push({ ...result, name: strategy.name, desc: strategy.desc });
  }

  // 排序：按 F1 分数降序
  results.sort((a, b) => b.f1 - a.f1);

  console.log('========================================');
  console.log('策略性能排名（Top 30）');
  console.log('========================================\n');
  console.log('策略                            | 准确率 | 精确率 | 召回率 | F1  | TP | TN | FP | FN | 通过率');
  console.log('--------------------------------|--------|--------|--------|-----|----|----|----|----|--------');

  for (const r of results.slice(0, 30)) {
    console.log(
      `${r.name.padEnd(32)} | ${(r.accuracy*100).toFixed(1).padStart(6)}% | ${(r.precision*100).toFixed(1).padStart(6)}% | ${(r.recall*100).toFixed(1).padStart(6)}% | ${r.f1.toFixed(2).padStart(3)} | ${r.tp} | ${r.tn} | ${r.fp} | ${r.fn} | ${(r.passRate*100).toFixed(1).padStart(5)}%`
    );
  }

  // 打印最佳策略详情
  const best = results[0];
  console.log('\n========================================');
  console.log('最佳策略详情');
  console.log('========================================\n');
  console.log(`${best.name}: ${best.desc}`);
  console.log(`         | 预测正 | 预测负 |`);
  console.log(`---------|--------|--------|`);
  console.log(`实际正  |   ${best.tp}   |   ${best.fn}   |`);
  console.log(`实际负  |   ${best.fp}   |   ${best.tn}   |`);

  // 找出不同目标的最优策略
  console.log('\n========================================');
  console.log('不同目标的最优策略');
  console.log('========================================\n');

  const highRecall = results.filter(r => r.recall >= 0.65).sort((a, b) => b.f1 - a.f1)[0];
  const highPrecision = results.filter(r => r.precision >= 0.70).sort((a, b) => b.recall - a.recall)[0];
  const balanced = results.filter(r => r.passRate >= 0.15 && r.passRate <= 0.30).sort((a, b) => b.f1 - a.f1)[0];

  if (highRecall) {
    console.log(`高召回率 (>=65%): ${highRecall.name}`);
    console.log(`  F1: ${highRecall.f1.toFixed(2)}, 精确率: ${(highRecall.precision*100).toFixed(1)}%, 召回率: ${(highRecall.recall*100).toFixed(1)}%, 通过率: ${(highRecall.passRate*100).toFixed(1)}%`);
  }

  if (highPrecision) {
    console.log(`\n高精确率 (>=70%): ${highPrecision.name}`);
    console.log(`  F1: ${highPrecision.f1.toFixed(2)}, 精确率: ${(highPrecision.precision*100).toFixed(1)}%, 召回率: ${(highPrecision.recall*100).toFixed(1)}%, 通过率: ${(highPrecision.passRate*100).toFixed(1)}%`);
  }

  if (balanced) {
    console.log(`\n平衡策略 (15-30%通过率): ${balanced.name}`);
    console.log(`  F1: ${balanced.f1.toFixed(2)}, 精确率: ${(balanced.precision*100).toFixed(1)}%, 召回率: ${(balanced.recall*100).toFixed(1)}%, 通过率: ${(balanced.passRate*100).toFixed(1)}%`);
  }

  // 导出结果
  const outputFile = '/Users/nobody1/Desktop/Codes/richer-js/scripts/mixed_threshold_results.json';
  fs.writeFileSync(outputFile, JSON.stringify({
    exportTime: new Date().toISOString(),
    sampleCount: samples.length,
    positiveCount: positiveSamples.length,
    thresholds,
    results: results.slice(0, 50)
  }, null, 2));
  console.log(`\n结果已保存到: ${outputFile}`);

  console.log('\n========================================');
  console.log('✅ 混合阈值优化完成！');
  console.log('========================================');
}

main().catch(console.error);
