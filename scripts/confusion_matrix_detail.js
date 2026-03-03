/**
 * 三实验合并数据：多特征筛选条件 + 混淆矩阵详情
 */

const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const CATEGORY_MAP = {
  fake_pump: { label: '流水盘', tier: 0 },
  low_quality: { label: '低质量', tier: 0 },
  mid_quality: { label: '中质量', tier: 1 },
  high_quality: { label: '高质量', tier: 1 }
};

const EXPERIMENTS = [
  { id: 'e689c80a-6b70-44f6-8e40-ffd720412780', name: 'e689c80a (age>1.5)' },
  { id: 'ec66badb-023e-40a9-8faf-b11dfe436910', name: 'ec66badb (age>1.5)' },
  { id: 'ca51587b-8607-4af2-b57c-5826a848b245', name: 'ca51587b (age>1.3)' }
];

async function fetchExperimentData(experimentId) {
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('token_address, human_judges')
    .eq('experiment_id', experimentId);

  if (!tokens) return [];

  const tokenInfo = {};
  tokens.forEach(t => {
    let judges;
    try {
      judges = typeof t.human_judges === 'string' ? JSON.parse(t.human_judges) : t.human_judges;
    } catch (e) { return; }
    if (judges && judges.category) {
      const tier = CATEGORY_MAP[judges.category]?.tier ?? 0;
      tokenInfo[t.token_address] = { category: judges.category, tier: tier };
    }
  });

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy');

  if (!signals) return [];

  const samples = [];
  signals.filter(s => s.metadata && s.metadata.earlyTradesChecked === 1).forEach(s => {
    const info = tokenInfo[s.token_address];
    if (!info) return;

    const m = s.metadata;
    samples.push({
      tokenAddress: s.token_address,
      category: info.category,
      tier: info.tier,
      isPositive: info.tier === 1,
      features: {
        volumePerMin: m.earlyTradesVolumePerMin || 0,
        countPerMin: m.earlyTradesCountPerMin || 0,
        walletsPerMin: m.earlyTradesWalletsPerMin || 0,
        highValuePerMin: m.earlyTradesHighValuePerMin || 0
      }
    });
  });

  return samples;
}

function evaluate(samples, predictFn) {
  let tp = 0, tn = 0, fp = 0, fn = 0;
  const predictions = [];

  for (const s of samples) {
    const predicted = predictFn(s);
    const actual = s.isPositive;

    predictions.push({ sample: s, predicted, actual });

    if (predicted && actual) tp++;
    else if (!predicted && !actual) tn++;
    else if (predicted && !actual) fp++;
    else fn++;
  }

  const accuracy = (tp + tn) / (tp + tn + fp + fn);
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
  const passRate = (tp + fp) / samples.length;

  return { tp, tn, fp, fn, accuracy, precision, recall, f1, passRate, predictions };
}

function drawConfusionMatrix(tp, tn, fp, fn, totalPos, totalNeg) {
  console.log('');
  console.log('                预测正样本(买入)    预测负样本(不买)');
  console.log('  实际正样本(中高) │  TP: ' + String(tp).padStart(2) + '       │  FN: ' + String(fn).padStart(2));
  console.log('  实际负样本(低质) │  FP: ' + String(fp).padStart(2) + '       │  TN: ' + String(tn).padStart(2));
  console.log('');
  console.log('  实际正样本总计: ' + totalPos + '  |  召回率: ' + (totalPos > 0 ? (tp / totalPos * 100).toFixed(1) : '0') + '%');
  console.log('  实际负样本总计: ' + totalNeg + '  |  负样本召回率: ' + (totalNeg > 0 ? (tn / totalNeg * 100).toFixed(1) : '0') + '%');
  console.log('');
  console.log('  预测买入总计: ' + (tp + fp) + '  |  精确率: ' + (tp + fp > 0 ? (tp / (tp + fp) * 100).toFixed(1) : '0') + '%');
  console.log('  预测不买总计: ' + (tn + fn));
}

async function main() {
  console.log('='.repeat(80));
  console.log('三实验合并：多特征筛选条件 + 混淆矩阵详情');
  console.log('='.repeat(80));
  console.log('');

  const allSamples = [];
  for (const exp of EXPERIMENTS) {
    const samples = await fetchExperimentData(exp.id);
    allSamples.push(...samples);
  }

  const positiveSamples = allSamples.filter(s => s.isPositive);
  const negativeSamples = allSamples.filter(s => !s.isPositive);

  console.log(`数据集: ${allSamples.length} 样本 (正样本: ${positiveSamples.length}, 负样本: ${negativeSamples.length})`);
  console.log('');

  const features = [
    { key: 'volumePerMin', name: '交易额/分钟' },
    { key: 'countPerMin', name: '交易次数/分钟' },
    { key: 'walletsPerMin', name: '钱包数/分钟' },
    { key: 'highValuePerMin', name: '高价值交易/分钟' }
  ];

  const thresholds = {};
  for (const feat of features) {
    const posVals = positiveSamples.map(s => s.features[feat.key]).filter(v => v > 0).sort((a, b) => a - b);
    if (posVals.length > 0) {
      thresholds[feat.key] = {
        p25: posVals[Math.floor(posVals.length * 0.25)],
        p50: posVals[Math.floor(posVals.length * 0.50)],
        p75: posVals[Math.floor(posVals.length * 0.75)]
      };
    }
  }

  const strategies = [
    {
      group: '【单特征策略】',
      strategies: [
        { name: '单特征-交易额(p50)', predict: s => s.features.volumePerMin >= thresholds.volumePerMin.p50 },
        { name: '单特征-高价值交易(p50)', predict: s => s.features.highValuePerMin >= thresholds.highValuePerMin.p50 }
      ]
    },
    {
      group: '【AND策略-严格型】',
      strategies: [
        { name: 'AND-交易额+高价值(p50)', predict: s => s.features.volumePerMin >= thresholds.volumePerMin.p50 && s.features.highValuePerMin >= thresholds.highValuePerMin.p50 },
        { name: 'AND-三特征(p50)', predict: s => s.features.volumePerMin >= thresholds.volumePerMin.p50 && s.features.countPerMin >= thresholds.countPerMin.p50 && s.features.highValuePerMin >= thresholds.highValuePerMin.p50 },
        { name: 'AND-四特征(p50)', predict: s => s.features.volumePerMin >= thresholds.volumePerMin.p50 && s.features.countPerMin >= thresholds.countPerMin.p50 && s.features.walletsPerMin >= thresholds.walletsPerMin.p50 && s.features.highValuePerMin >= thresholds.highValuePerMin.p50 }
      ]
    },
    {
      group: '【AND策略-p75阈值（极致精确）】',
      strategies: [
        { name: 'AND-p75-交易额+高价值', predict: s => s.features.volumePerMin >= thresholds.volumePerMin.p75 && s.features.highValuePerMin >= thresholds.highValuePerMin.p75 },
        { name: 'AND-p75-三特征', predict: s => s.features.volumePerMin >= thresholds.volumePerMin.p75 && s.features.countPerMin >= thresholds.countPerMin.p75 && s.features.highValuePerMin >= thresholds.highValuePerMin.p75 },
        { name: 'AND-p75-四特征', predict: s => s.features.volumePerMin >= thresholds.volumePerMin.p75 && s.features.countPerMin >= thresholds.countPerMin.p75 && s.features.walletsPerMin >= thresholds.walletsPerMin.p75 && s.features.highValuePerMin >= thresholds.highValuePerMin.p75 }
      ]
    },
    {
      group: '【OR策略】',
      strategies: [
        { name: 'OR-交易额或高价值(p50)', predict: s => s.features.volumePerMin >= thresholds.volumePerMin.p50 || s.features.highValuePerMin >= thresholds.highValuePerMin.p50 }
      ]
    },
    {
      group: '【评分策略】',
      strategies: [
        { name: '评分-至少2项达标(p50)', predict: s => { let score = 0; if (s.features.volumePerMin >= thresholds.volumePerMin.p50) score++; if (s.features.countPerMin >= thresholds.countPerMin.p50) score++; if (s.features.highValuePerMin >= thresholds.highValuePerMin.p50) score++; return score >= 2; } },
        { name: '评分-至少3项达标(p50)', predict: s => { let score = 0; if (s.features.volumePerMin >= thresholds.volumePerMin.p50) score++; if (s.features.countPerMin >= thresholds.countPerMin.p50) score++; if (s.features.walletsPerMin >= thresholds.walletsPerMin.p50) score++; if (s.features.highValuePerMin >= thresholds.highValuePerMin.p50) score++; return score >= 3; } }
      ]
    }
  ];

  for (const group of strategies) {
    console.log('='.repeat(80));
    console.log(group.group);
    console.log('='.repeat(80));

    for (const strategy of group.strategies) {
      const result = evaluate(allSamples, strategy.predict);

      console.log('');
      console.log('策略: ' + strategy.name);
      console.log('─'.repeat(80));
      console.log(`准确率: ${(result.accuracy * 100).toFixed(2)}%  |  精确率: ${(result.precision * 100).toFixed(2)}%  |  召回率: ${(result.recall * 100).toFixed(2)}%  |  F1: ${result.f1.toFixed(3)}`);
      console.log('通过率: ' + (result.passRate * 100).toFixed(1) + '%  (即 ' + (result.tp + result.fp) + ' / ' + allSamples.length + ' 个代币会被买入)');

      drawConfusionMatrix(result.tp, result.tn, result.fp, result.fn, positiveSamples.length, negativeSamples.length);

      // 条件详情
      console.log('筛选条件:');
      if (strategy.name.includes('volumePerMin') || strategy.name.includes('交易额')) {
        console.log('  交易额/分钟 >= ' + (strategy.name.includes('p75') ? thresholds.volumePerMin.p75 : thresholds.volumePerMin.p50).toFixed(0));
      }
      if (strategy.name.includes('countPerMin') || strategy.name.includes('交易次数')) {
        console.log('  交易次数/分钟 >= ' + (strategy.name.includes('p75') ? thresholds.countPerMin.p75 : thresholds.countPerMin.p50).toFixed(0));
      }
      if (strategy.name.includes('walletsPerMin') || strategy.name.includes('钱包')) {
        console.log('  钱包数/分钟 >= ' + (strategy.name.includes('p75') ? thresholds.walletsPerMin.p75 : thresholds.walletsPerMin.p50).toFixed(0));
      }
      if (strategy.name.includes('highValuePerMin') || strategy.name.includes('高价值')) {
        console.log('  高价值交易/分钟 >= ' + (strategy.name.includes('p75') ? thresholds.highValuePerMin.p75 : thresholds.highValuePerMin.p50).toFixed(0));
      }
    }
    console.log('');
  }

  console.log('='.repeat(80));
  console.log('【策略对比汇总表】');
  console.log('='.repeat(80));
  console.log('');

  const allStrategies = strategies.flatMap(g => g.strategies);

  console.log('策略 | 准确率 | 精确率 | 召回率 | F1 | TP|TN|FP|FN | 买入数');
  console.log('------|--------|--------|--------|-----|-----|----|----|-------');
  for (const strategy of allStrategies) {
    const result = evaluate(allSamples, strategy.predict);
    const shortName = strategy.name
      .replace('p50', '').replace('p75', '')
      .replace('-交易额', '-额')
      .replace('-交易次数', '-次')
      .replace('-钱包数', '-钱包')
      .replace('-高价值交易', '-高值')
      .replace('-至少', '≥')
      .replace('项达标', '项');
    console.log(`${shortName.padEnd(22)} | ${(result.accuracy * 100).toFixed(1).padStart(5)}% | ${(result.precision * 100).toFixed(1).padStart(5)}% | ${(result.recall * 100).toFixed(1).padStart(5)}% | ${result.f1.toFixed(2).padStart(3)} | ${result.tp}|${result.tn}|${result.fp}|${result.fn} | ${(result.tp + result.fp).toString().padStart(3)}`);
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('【阈值参考】');
  console.log('='.repeat(80));
  console.log('');
  for (const feat of features) {
    const t = thresholds[feat.key];
    console.log(`${feat.name}:`);
    console.log(`  p25: ${t.p25.toFixed(0)},  p50: ${t.p50.toFixed(0)},  p75: ${t.p75.toFixed(0)}`);
  }
}

main().catch(console.error);
