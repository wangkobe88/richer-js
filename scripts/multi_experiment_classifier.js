/**
 * 合并三个实验数据构建多特征筛选条件
 * 目标：尽可能过滤掉流水盘/低质量
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
  // 获取所有代币
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('token_address, human_judges')
    .eq('experiment_id', experimentId);

  if (!tokens) return [];

  // 建立代币到类别的映射
  const tokenInfo = {};
  tokens.forEach(t => {
    let judges;
    try {
      judges = typeof t.human_judges === 'string' ? JSON.parse(t.human_judges) : t.human_judges;
    } catch (e) { return; }
    if (judges && judges.category) {
      const tier = CATEGORY_MAP[judges.category]?.tier ?? 0;
      tokenInfo[t.token_address] = {
        category: judges.category,
        tier: tier
      };
    }
  });

  // 获取买入信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy');

  if (!signals) return [];

  // 筛选有早期参与者数据的信号
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
        highValuePerMin: m.earlyTradesHighValuePerMin || 0,
        checkTime: m.earlyTradesCheckTime || 0,
        window: m.earlyTradesWindow || 0
      }
    });
  });

  return samples;
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
  const accuracy = (tp + tn) / (tp + tn + fp + fn);
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
  const passRate = (tp + fp) / samples.length;
  return { tp, tn, fp, fn, accuracy, precision, recall, f1, passRate };
}

async function main() {
  console.log('='.repeat(80));
  console.log('三实验合并数据：多特征筛选条件构建');
  console.log('='.repeat(80));
  console.log('');

  // 收集所有实验数据
  console.log('收集实验数据...\n');
  const allSamples = [];

  for (const exp of EXPERIMENTS) {
    const samples = await fetchExperimentData(exp.id);
    console.log(`${exp.name}: ${samples.length} 个有早期参与者数据的信号`);
    allSamples.push(...samples);
  }

  console.log(`\n总样本数: ${allSamples.length}`);

  // 统计各类别
  const categoryCount = {};
  allSamples.forEach(s => {
    categoryCount[s.category] = (categoryCount[s.category] || 0) + 1;
  });

  console.log('各类别样本数:');
  for (const [cat, label] of Object.entries(CATEGORY_MAP)) {
    console.log(`  ${label.label}: ${categoryCount[cat] || 0}`);
  }

  const positiveSamples = allSamples.filter(s => s.isPositive);
  const negativeSamples = allSamples.filter(s => !s.isPositive);

  console.log(`\n正样本 (中高质量): ${positiveSamples.length}`);
  console.log(`负样本 (流水盘/低质量): ${negativeSamples.length}`);
  console.log('');

  // 分析特征分布
  console.log('='.repeat(80));
  console.log('特征分布分析');
  console.log('='.repeat(80));
  console.log('');

  const features = [
    { key: 'volumePerMin', name: '交易额/分钟' },
    { key: 'countPerMin', name: '交易次数/分钟' },
    { key: 'walletsPerMin', name: '钱包数/分钟' },
    { key: 'highValuePerMin', name: '高价值交易/分钟' }
  ];

  for (const feat of features) {
    const posVals = positiveSamples.map(s => s.features[feat.key]).filter(v => v > 0).sort((a, b) => a - b);
    const negVals = negativeSamples.map(s => s.features[feat.key]).filter(v => v > 0).sort((a, b) => a - b);

    if (posVals.length === 0 || negVals.length === 0) continue;

    const posStats = {
      min: posVals[0],
      p25: posVals[Math.floor(posVals.length * 0.25)],
      p50: posVals[Math.floor(posVals.length * 0.50)],
      p75: posVals[Math.floor(posVals.length * 0.75)],
      max: posVals[posVals.length - 1]
    };

    const negStats = {
      min: negVals[0],
      p25: negVals[Math.floor(negVals.length * 0.25)],
      p50: negVals[Math.floor(negVals.length * 0.50)],
      p75: negVals[Math.floor(negVals.length * 0.75)],
      max: negVals[negVals.length - 1]
    };

    console.log(`${feat.name}:`);
    console.log(`  负样本: min=${negStats.min.toFixed(0)}, p25=${negStats.p25.toFixed(0)}, median=${negStats.p50.toFixed(0)}, p75=${negStats.p75.toFixed(0)}, max=${negStats.max.toFixed(0)}`);
    console.log(`  正样本: min=${posStats.min.toFixed(0)}, p25=${posStats.p25.toFixed(0)}, median=${posStats.p50.toFixed(0)}, p75=${posStats.p75.toFixed(0)}, max=${posStats.max.toFixed(0)}`);
    console.log(`  区分度(正样本p50/负样本p50): ${(posStats.p50 / negStats.p50).toFixed(2)}x`);
    console.log('');
  }

  // 多特征组合策略
  console.log('='.repeat(80));
  console.log('多特征组合策略评估');
  console.log('='.repeat(80));
  console.log('');

  // 计算不同分位数的阈值
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

  // 定义多种策略
  const strategies = [
    {
      name: '单特征-交易额',
      predict: s => s.features.volumePerMin >= thresholds.volumePerMin.p50
    },
    {
      name: '单特征-高价值交易',
      predict: s => s.features.highValuePerMin >= thresholds.highValuePerMin.p50
    },
    {
      name: 'AND-交易额+高价值',
      predict: s => s.features.volumePerMin >= thresholds.volumePerMin.p50 && s.features.highValuePerMin >= thresholds.highValuePerMin.p50
    },
    {
      name: 'AND-三特征(交易额+次数+高价值)',
      predict: s => s.features.volumePerMin >= thresholds.volumePerMin.p50 &&
                  s.features.countPerMin >= thresholds.countPerMin.p50 &&
                  s.features.highValuePerMin >= thresholds.highValuePerMin.p50
    },
    {
      name: 'AND-四特征',
      predict: s => s.features.volumePerMin >= thresholds.volumePerMin.p50 &&
                  s.features.countPerMin >= thresholds.countPerMin.p50 &&
                  s.features.walletsPerMin >= thresholds.walletsPerMin.p50 &&
                  s.features.highValuePerMin >= thresholds.highValuePerMin.p50
    },
    {
      name: 'OR-交易额或高价值',
      predict: s => s.features.volumePerMin >= thresholds.volumePerMin.p50 || s.features.highValuePerMin >= thresholds.highValuePerMin.p50
    },
    {
      name: '评分-至少2项达标',
      predict: s => {
        let score = 0;
        if (s.features.volumePerMin >= thresholds.volumePerMin.p50) score++;
        if (s.features.countPerMin >= thresholds.countPerMin.p50) score++;
        if (s.features.highValuePerMin >= thresholds.highValuePerMin.p50) score++;
        return score >= 2;
      }
    },
    {
      name: '评分-至少3项达标',
      predict: s => {
        let score = 0;
        if (s.features.volumePerMin >= thresholds.volumePerMin.p50) score++;
        if (s.features.countPerMin >= thresholds.countPerMin.p50) score++;
        if (s.features.walletsPerMin >= thresholds.walletsPerMin.p50) score++;
        if (s.features.highValuePerMin >= thresholds.highValuePerMin.p50) score++;
        return score >= 3;
      }
    }
  ];

  // 调整阈值：使用p75获得更高精确率
  const strategies_high_precision = [
    {
      name: 'AND-p75-交易额+高价值',
      predict: s => s.features.volumePerMin >= thresholds.volumePerMin.p75 && s.features.highValuePerMin >= thresholds.highValuePerMin.p75
    },
    {
      name: 'AND-p75-三特征',
      predict: s => s.features.volumePerMin >= thresholds.volumePerMin.p75 &&
                  s.features.countPerMin >= thresholds.countPerMin.p75 &&
                  s.features.highValuePerMin >= thresholds.highValuePerMin.p75
    },
    {
      name: 'AND-p75-四特征',
      predict: s => s.features.volumePerMin >= thresholds.volumePerMin.p75 &&
                  s.features.countPerMin >= thresholds.countPerMin.p75 &&
                  s.features.walletsPerMin >= thresholds.walletsPerMin.p75 &&
                  s.features.highValuePerMin >= thresholds.highValuePerMin.p75
    }
  ];

  console.log('【使用p50阈值】');
  console.log('');
  console.log('策略 | 准确率 | 精确率 | 召回率 | F1 | TP|TN|FP|FN | 通过率');
  console.log('------|--------|--------|--------|-----|-----|----|----|-------');

  for (const strategy of strategies) {
    const result = evaluate(allSamples, strategy.predict);
    console.log(`${strategy.name.padEnd(28)} | ${(result.accuracy * 100).toFixed(1).padStart(6)}% | ${(result.precision * 100).toFixed(1).padStart(6)}% | ${(result.recall * 100).toFixed(1).padStart(6)}% | ${result.f1.toFixed(2).padStart(3)} | ${result.tp}|${result.tn}|${result.fp}|${result.fn} | ${(result.passRate * 100).toFixed(1).padStart(5)}%`);
  }

  console.log('');
  console.log('【使用p75阈值（更严格）】');
  console.log('');
  console.log('策略 | 准确率 | 精确率 | 召回率 | F1 | TP|TN|FP|FN | 通过率');
  console.log('------|--------|--------|--------|-----|-----|----|----|-------');

  for (const strategy of strategies_high_precision) {
    const result = evaluate(allSamples, strategy.predict);
    console.log(`${strategy.name.padEnd(28)} | ${(result.accuracy * 100).toFixed(1).padStart(6)}% | ${(result.precision * 100).toFixed(1).padStart(6)}% | ${(result.recall * 100).toFixed(1).padStart(6)}% | ${result.f1.toFixed(2).padStart(3)} | ${result.tp}|${result.tn}|${result.fp}|${result.fn} | ${(result.passRate * 100).toFixed(1).padStart(5)}%`);
  }

  // 找到最佳策略
  console.log('');
  console.log('='.repeat(80));
  console.log('【推荐策略】');
  console.log('='.repeat(80));
  console.log('');

  const allStrategies = [...strategies, ...strategies_high_precision];
  allStrategies.sort((a, b) => {
    // 优先选择精确率高的，然后F1高的
    const resultA = evaluate(allSamples, a.predict);
    const resultB = evaluate(allSamples, b.predict);
    if (resultA.precision !== resultB.precision) {
      return resultB.precision - resultA.precision;
    }
    return resultB.f1 - resultA.f1;
  });

  const bestResult = evaluate(allSamples, allStrategies[0].predict);
  console.log(`最优策略: ${allStrategies[0].name}`);
  console.log(`  准确率: ${(bestResult.accuracy * 100).toFixed(2)}%`);
  console.log(`  精确率: ${(bestResult.precision * 100).toFixed(2)}%`);
  console.log(`  召回率: ${(bestResult.recall * 100).toFixed(2)}%`);
  console.log(`  F1分数: ${bestResult.f1.toFixed(3)}`);
  console.log(`  通过率: ${(bestResult.passRate * 100).toFixed(1)}%`);
  console.log('');

  // 输出阈值详情
  console.log('阈值详情:');
  for (const feat of features) {
    const t = thresholds[feat.key];
    console.log(`  ${feat.name}: p50=${t.p50.toFixed(0)}, p75=${t.p75.toFixed(0)}`);
  }
  console.log('');
}

main().catch(console.error);
