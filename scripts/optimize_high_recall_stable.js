/**
 * 高召回率+多因子稳定性优化
 * 基于策略4（高价值数+高价值/分，召回率75%）增加更多因子
 */

const fs = require('fs');

const DATA_FILE = '/Users/nobody1/Desktop/Codes/richer-js/scripts/early_participants_corrected.json';

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    console.error('数据文件不存在');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')).samples;
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
  console.log('高召回率+多因子稳定性优化');
  console.log('========================================\n');

  const samples = loadData();
  const positiveSamples = samples.filter(s => s.isPositive);

  console.log(`正样本: ${positiveSamples.length}, 负样本: ${samples.length - positiveSamples.length}\n`);

  // 计算阈值
  const factors = [
    { key: 'totalVolume', name: '总交易额', auc: 0.879 },
    { key: 'highValueCount', name: '高价值交易数', auc: 0.830 },
    { key: 'totalCount', name: '总交易数', auc: 0.827 },
    { key: 'uniqueWallets', name: '独立钱包数', auc: 0.826 },
    { key: 'walletsPerMin', name: '钱包数/分', auc: 0.788 },
    { key: 'countPerMin', name: '交易次数/分', auc: 0.787 },
    { key: 'highValuePerMin', name: '高价值/分', auc: 0.785 },
    { key: 'volumePerMin', name: '交易额/分', auc: 0.780 }
  ];

  for (const f of factors) {
    const posValues = positiveSamples.map(s => s[f.key]).filter(v => v > 0).sort((a, b) => a - b);
    f.p25 = posValues[Math.floor(posValues.length * 0.25)] || 0;
    f.p40 = posValues[Math.floor(posValues.length * 0.40)] || 0;
  }

  console.log('因子阈值（正样本）:');
  for (const f of factors) {
    console.log(`  ${f.name.padEnd(12)}: P25=${f.p25}, P40=${f.p40}`);
  }
  console.log('');

  // 基础策略4（高召回率基准）
  const baseRecall = evaluate(samples, s =>
    s.highValueCount >= 8 && s.highValuePerMin >= 5.6
  );
  console.log(`基准策略4: 精确率=${(baseRecall.precision*100).toFixed(1)}%, 召回率=${(baseRecall.recall*100).toFixed(1)}%, F1=${baseRecall.f1.toFixed(2)}\n`);

  // 定义多因子策略（在保持高召回率的基础上增加因子）
  const strategies = [];

  // 基础: highValueCount >= 8 && highValuePerMin >= 5.6
  // 在此基础上增加1-3个额外因子

  const extraFactors = [
    { key: 'totalVolume', name: '总交易额' },
    { key: 'totalCount', name: '总交易数' },
    { key: 'uniqueWallets', name: '独立钱包数' },
    { key: 'walletsPerMin', name: '钱包数/分' },
    { key: 'countPerMin', name: '交易次数/分' },
    { key: 'volumePerMin', name: '交易额/分' }
  ];

  // 基础 + 1个额外因子 (P25)
  for (const ef of extraFactors) {
    const f = factors.find(f => f.key === ef.key);
    strategies.push({
      name: `基础+${ef.name}(P25)`,
      predict: (s) => s.highValueCount >= 8 && s.highValuePerMin >= 5.6 && s[ef.key] >= f.p25
    });
  }

  // 基础 + 1个额外因子 (P40)
  for (const ef of extraFactors) {
    const f = factors.find(f => f.key === ef.key);
    strategies.push({
      name: `基础+${ef.name}(P40)`,
      predict: (s) => s.highValueCount >= 8 && s.highValuePerMin >= 5.6 && s[ef.key] >= f.p40
    });
  }

  // 基础 + 2个额外因子
  const twoFactorCombos = [
    ['totalVolume', 'uniqueWallets'],
    ['totalVolume', 'walletsPerMin'],
    ['totalCount', 'uniqueWallets'],
    ['totalCount', 'walletsPerMin'],
    ['uniqueWallets', 'walletsPerMin'],
    ['totalVolume', 'totalCount'],
    ['countPerMin', 'walletsPerMin']
  ];

  for (const [k1, k2] of twoFactorCombos) {
    const f1 = factors.find(f => f.key === k1);
    const f2 = factors.find(f => f.key === k2);
    strategies.push({
      name: `基础+${f1.name}+${f2.name}`,
      predict: (s) => s.highValueCount >= 8 && s.highValuePerMin >= 5.6 && s[k1] >= f1.p25 && s[k2] >= f2.p25
    });
  }

  // 基础 + 3个额外因子
  const threeFactorCombos = [
    ['totalVolume', 'totalCount', 'uniqueWallets'],
    ['totalVolume', 'uniqueWallets', 'walletsPerMin'],
    ['totalCount', 'uniqueWallets', 'walletsPerMin'],
    ['totalVolume', 'totalCount', 'walletsPerMin']
  ];

  for (const [k1, k2, k3] of threeFactorCombos) {
    const f1 = factors.find(f => f.key === k1);
    const f2 = factors.find(f => f.key === k2);
    const f3 = factors.find(f => f.key === k3);
    strategies.push({
      name: `基础+${f1.name}+${f2.name}+${f3.name}`,
      predict: (s) => s.highValueCount >= 8 && s.highValuePerMin >= 5.6 && s[k1] >= f1.p25 && s[k2] >= f2.p25 && s[k3] >= f3.p25
    });
  }

  // 基础 + 4个核心因子
  strategies.push({
    name: `基础+总交易额+总交易数+钱包数+钱包/分`,
    predict: (s) =>
      s.highValueCount >= 8 &&
      s.highValuePerMin >= 5.6 &&
      s.totalVolume >= factors[0].p25 &&
      s.totalCount >= factors[2].p25 &&
      s.uniqueWallets >= factors[3].p25 &&
      s.walletsPerMin >= factors[4].p25
  });

  console.log(`定义了 ${strategies.length} 个策略\n`);

  // 评估
  const results = [];
  for (const s of strategies) {
    const r = evaluate(samples, s.predict);
    results.push({ ...r, name: s.name });
  }

  // 只保留召回率 >= 60% 的策略
  const validResults = results.filter(r => r.recall >= 0.60);
  validResults.sort((a, b) => b.f1 - a.f1);

  console.log('========================================');
  console.log('策略性能排名（召回率>=60%）');
  console.log('========================================\n');
  console.log('策略                              | 精确率 | 召回率 | F1  | TP | TN | FP | FN | 通过率');
  console.log('----------------------------------|--------|--------|-----|----|----|----|----|--------');

  for (const r of validResults.slice(0, 30)) {
    console.log(
      `${r.name.padEnd(34)} | ${(r.precision*100).toFixed(1).padStart(6)}% | ${(r.recall*100).toFixed(1).padStart(6)}% | ${r.f1.toFixed(2).padStart(3)} | ${r.tp} | ${r.tn} | ${r.fp} | ${r.fn} | ${(r.passRate*100).toFixed(1).padStart(5)}%`
    );
  }

  // 找出最优的几个策略
  console.log('\n========================================');
  console.log('推荐策略详情');
  console.log('========================================\n');

  const bestF1 = validResults[0];
  const bestPrecision = [...validResults].sort((a, b) => b.precision - a.precision)[0];
  const bestRecall = [...validResults].sort((a, b) => b.recall - a.recall)[0];
  const balanced = validResults.filter(r => r.passRate >= 0.15 && r.passRate <= 0.25).sort((a, b) => b.f1 - a.f1)[0];

  function printMatrix(name, result) {
    console.log(`${name}:`);
    console.log(`         | 预测正 | 预测负 |`);
    console.log(`---------|--------|--------|`);
    console.log(`实际正  |   ${result.tp}   |   ${result.fn}   |`);
    console.log(`实际负  |   ${result.fp}   |   ${result.tn}   |`);
    console.log(`F1: ${result.f1.toFixed(2)}, 精确率: ${(result.precision*100).toFixed(1)}%, 召回率: ${(result.recall*100).toFixed(1)}%, 通过率: ${(result.passRate*100).toFixed(1)}%\n`);
  }

  printMatrix('最佳F1', bestF1);
  printMatrix('最佳精确率', bestPrecision);
  printMatrix('最佳召回率', bestRecall);
  if (balanced) printMatrix('平衡通过率', balanced);

  // 对比基准
  console.log('========================================');
  console.log('与基准策略4对比');
  console.log('========================================\n');
  console.log('策略                    | 精确率变化 | 召回率变化 | F1变化');
  console.log('------------------------|-----------|-----------|-------');
  console.log(`基准(策略4)              |    --     |    --     |  --`);
  console.log(`最佳F1                   |  +${((bestF1.precision - baseRecall.precision)*100).toFixed(1)}pp  |  ${((bestF1.recall - baseRecall.recall)*100).toFixed(1)}pp  | +${(bestF1.f1 - baseRecall.f1).toFixed(2)}`);
  console.log(`最佳精确率               |  +${((bestPrecision.precision - baseRecall.precision)*100).toFixed(1)}pp  |  ${((bestPrecision.recall - baseRecall.recall)*100).toFixed(1)}pp  | +${(bestPrecision.f1 - baseRecall.f1).toFixed(2)}`);

  // 导出结果
  fs.writeFileSync('/Users/nobody1/Desktop/Codes/richer-js/scripts/high_recall_stable_results.json', JSON.stringify({
    exportTime: new Date().toISOString(),
    base: { name: '策略4', ...baseRecall },
    bestF1: { name: bestF1.name, ...bestF1 },
    bestPrecision: { name: bestPrecision.name, ...bestPrecision },
    bestRecall: { name: bestRecall.name, ...bestRecall },
    results: validResults.slice(0, 20)
  }, null, 2));

  console.log('\n✅ 完成！');
}

main().catch(console.error);
