/**
 * 分析加入交易额/分条件后的效果
 */

const fs = require('fs');

const DATA_FILE = '/Users/nobody1/Desktop/Codes/richer-js/scripts/early_participants_corrected.json';

function loadData() {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  return data.samples;
}

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

async function main() {
  console.log('========================================');
  console.log('策略B + 交易额/分 约束分析');
  console.log('========================================\n');

  const samples = loadData();
  const positiveSamples = samples.filter(s => s.isPositive);

  // 当前策略B（无交易额约束）
  const strategyB = evaluate(samples, s =>
    s.highValueCount >= 8 && s.highValuePerMin >= 5.6 && s.countPerMin >= 10.6
  );

  console.log('当前策略B（无交易额约束）:');
  console.log(`  F1: ${strategyB.f1.toFixed(2)}, 精确率: ${(strategyB.precision*100).toFixed(1)}%, 召回率: ${(strategyB.recall*100).toFixed(1)}%, 通过率: ${(strategyB.passRate*100).toFixed(1)}%`);
  console.log(`         | 预测正 | 预测负 |`);
  console.log(`---------|--------|--------|`);
  console.log(`实际正  |   ${strategyB.tp}   |   ${strategyB.fn}   |`);
  console.log(`实际负  |   ${strategyB.fp}   |   ${strategyB.tn}   |\n`);

  // 测试不同的交易额/分阈值
  const volumeThresholds = [500, 800, 1000, 1200, 1500, 1800, 2000, 2500];

  console.log('加入交易额/分约束后的效果:');
  console.log('交易额/分阈值 | 精确率 | 召回率 | F1  | TP | TN | FP | FN | 通过率');
  console.log('-------------|--------|--------|-----|----|----|----|----|--------');

  const results = [];
  for (const volTh of volumeThresholds) {
    const result = evaluate(samples, s =>
      s.highValueCount >= 8 && s.highValuePerMin >= 5.6 && s.countPerMin >= 10.6 && s.volumePerMin >= volTh
    );
    results.push({ volTh, ...result });
    console.log(
      `${'$' + volTh}   | ${(result.precision*100).toFixed(1).padStart(6)}% | ${(result.recall*100).toFixed(1).padStart(6)}% | ${result.f1.toFixed(2).padStart(3)} | ${result.tp} | ${result.tn} | ${result.fp} | ${result.fn} | ${(result.passRate*100).toFixed(1).padStart(5)}%`
    );
  }

  // 找出最优阈值
  const sortedByF1 = [...results].sort((a, b) => b.f1 - a.f1);
  const bestF1 = sortedByF1[0];

  console.log('\n========================================');
  console.log('推荐阈值');
  console.log('========================================\n');
  console.log(`最佳F1: 交易额/分 >= $${bestF1.volTh}`);
  console.log(`  F1: ${bestF1.f1.toFixed(2)}, 精确率: ${(bestF1.precision*100).toFixed(1)}%, 召回率: ${(bestF1.recall*100).toFixed(1)}%, 通过率: ${(bestF1.passRate*100).toFixed(1)}%`);
  console.log(`         | 预测正 | 预测负 |`);
  console.log(`---------|--------|--------|`);
  console.log(`实际正  |   ${bestF1.tp}   |   ${bestF1.fn}   |`);
  console.log(`实际负  |   ${bestF1.fp}   |   ${bestF1.tn}   |`);
  console.log(`\n相比策略B: 精确率 ${((bestF1.precision - strategyB.precision)*100).toFixed(1)}pp, 召回率 ${((bestF1.recall - strategyB.recall)*100).toFixed(1)}pp, F1 ${(bestF1.f1 - strategyB.f1).toFixed(2)}`);

  // 查看被过滤掉的样本
  const filteredOut = samples.filter(s =>
    s.highValueCount >= 8 && s.highValuePerMin >= 5.6 && s.countPerMin >= 10.6 && s.volumePerMin < bestF1.volTh
  );

  console.log(`\n被交易额/分阈值过滤掉的样本: ${filteredOut.length}个`);
  if (filteredOut.length > 0) {
    const posFiltered = filteredOut.filter(s => s.isPositive);
    const negFiltered = filteredOut.filter(s => !s.isPositive);
    console.log(`  其中正样本: ${posFiltered.length}, 负样本: ${negFiltered.length}`);
  }

  // 用户的例子会被过滤吗？
  const example = { volumePerMin: 1855.84, highValueCount: 9, highValuePerMin: 6.5, countPerMin: 13.0 };
  const examplePass = example.highValueCount >= 8 && example.highValuePerMin >= 5.6 && example.countPerMin >= 10.6 && example.volumePerMin >= bestF1.volTh;
  console.log(`\n用户的代币 (交易额/分=$${example.volumePerMin}) 会被过滤: ${examplePass ? '否' : '是'}`);

  fs.writeFileSync('/Users/nobody1/Desktop/Codes/richer-js/scripts/volume_constraint_analysis.json', JSON.stringify({
    exportTime: new Date().toISOString(),
    strategyB,
    results
  }, null, 2));

  console.log('\n✅ 完成！');
}

main().catch(console.error);
