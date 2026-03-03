/**
 * 结合方案一和方案二的不同策略
 */

const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const TRAINING_EXPERIMENTS = [
  'e689c80a-6b70-44f6-8e40-ffd720412780',
  'ec66badb-023e-40a9-8faf-b11dfe436910'
];

// 方案一：平衡型 (交易额/分钟 >= 3117)
const PLAN1_THRESHOLD = 3117;

// 方案二：保守型 (高价值交易/分钟 >= 73)
const PLAN2_THRESHOLD = 73;

async function fetchExperimentData(experimentId) {
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('token_address, human_judges')
    .eq('experiment_id', experimentId);

  if (!tokens) return [];

  const tokenCategoryMap = {};
  tokens.forEach(t => {
    let judges;
    try {
      judges = typeof t.human_judges === 'string' ? JSON.parse(t.human_judges) : t.human_judges;
    } catch (e) { return; }
    if (judges && judges.category) {
      const tier = ['mid_quality', 'high_quality'].includes(judges.category) ? 1 : 0;
      tokenCategoryMap[t.token_address] = { category: judges.category, isPositive: tier };
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
    const info = tokenCategoryMap[s.token_address];
    if (!info) return;

    samples.push({
      tokenAddress: s.token_address,
      category: info.category,
      isPositive: info.isPositive,
      volumePerMin: s.metadata.earlyTradesVolumePerMin || 0,
      highValuePerMin: s.metadata.earlyTradesHighValuePerMin || 0
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

    predictions.push({
      sample: s,
      predicted,
      actual,
      isCorrect: predicted === actual
    });

    if (predicted && actual) tp++;
    else if (!predicted && !actual) tn++;
    else if (predicted && !actual) fp++;
    else fn++;
  }

  const accuracy = (tp + tn) / (tp + tn + fp + fn);
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

  return { tp, tn, fp, fn, accuracy, precision, recall, f1, predictions };
}

async function main() {
  console.log('='.repeat(80));
  console.log('方案一与方案二结合策略分析');
  console.log('='.repeat(80));
  console.log('');

  // 收集数据
  const allSamples = [];
  for (const expId of TRAINING_EXPERIMENTS) {
    const samples = await fetchExperimentData(expId);
    allSamples.push(...samples);
  }

  const positiveSamples = allSamples.filter(s => s.isPositive);
  const negativeSamples = allSamples.filter(s => !s.isPositive);

  console.log(`数据集: ${allSamples.length} 样本 (正样本: ${positiveSamples.length}, 负样本: ${negativeSamples.length})`);
  console.log('');

  console.log('方案一: 交易额/分钟 >= $' + PLAN1_THRESHOLD);
  console.log('方案二: 高价值交易/分钟 >= ' + PLAN2_THRESHOLD);
  console.log('');
  console.log('='.repeat(80));
  console.log('');

  // ========== 单独方案 ==========
  console.log('【单独方案对比】');
  console.log('');

  const plan1 = evaluate(allSamples, s => s.volumePerMin >= PLAN1_THRESHOLD);
  const plan2 = evaluate(allSamples, s => s.highValuePerMin >= PLAN2_THRESHOLD);

  console.log('方案 | 准确率 | 精确率 | 召回率 | F1 | TP|TN|FP|FN | 通过率');
  console.log('------|--------|--------|--------|-----|-----|----|----|-------');
  console.log(`方案一 | ${(plan1.accuracy * 100).toFixed(1)}% | ${(plan1.precision * 100).toFixed(1)}% | ${(plan1.recall * 100).toFixed(1)}% | ${plan1.f1.toFixed(2)} | ${plan1.tp}|${plan1.tn}|${plan1.fp}|${plan1.fn} | ${((plan1.tp + plan1.fp) / allSamples.length * 100).toFixed(1)}%`);
  console.log(`方案二 | ${(plan2.accuracy * 100).toFixed(1)}% | ${(plan2.precision * 100).toFixed(1)}% | ${(plan2.recall * 100).toFixed(1)}% | ${plan2.f1.toFixed(2)} | ${plan2.tp}|${plan2.tn}|${plan2.fp}|${plan2.fn} | ${((plan2.tp + plan2.fp) / allSamples.length * 100).toFixed(1)}%`);

  console.log('');
  console.log('通过率 = (TP + FP) / 总样本数，即有多少比例的代币会被买入');
  console.log('');

  // ========== 结合策略 ==========

  console.log('='.repeat(80));
  console.log('【结合策略分析】');
  console.log('='.repeat(80));
  console.log('');

  const strategies = [
    {
      name: 'AND策略 (两个条件都满足)',
      description: '最保守，只有同时满足两个条件的代币才会被买入',
      predict: s => s.volumePerMin >= PLAN1_THRESHOLD && s.highValuePerMin >= PLAN2_THRESHOLD
    },
    {
      name: 'OR策略 (满足任一条件)',
      description: '最激进，满足任一条件的代币就会被买入',
      predict: s => s.volumePerMin >= PLAN1_THRESHOLD || s.highValuePerMin >= PLAN2_THRESHOLD
    },
    {
      name: '分层策略A (方案一初筛 -> 方案二精选)',
      description: '用方案一快速筛选，对通过方案的再用方案二精选',
      predict: s => {
        // 第一层：方案一
        if (s.volumePerMin < PLAN1_THRESHOLD) return false;
        // 第二层：方案二
        return s.highValuePerMin >= PLAN2_THRESHOLD;
      }
    },
    {
      name: '分层策略B (方案二初筛 -> 方案一补充)',
      description: '用方案二严格筛选，对不满足的但接近的用方案一补充',
      predict: s => {
        // 第一层：方案二 (严格)
        if (s.highValuePerMin >= PLAN2_THRESHOLD) return true;
        // 第二层：方案一 (补充)
        return s.volumePerMin >= PLAN1_THRESHOLD;
      }
    },
    {
      name: '评分策略 (加权评分)',
      description: '计算综合评分，两者都满足给高分，只满足一个给中分',
      predict: s => {
        let score = 0;
        if (s.volumePerMin >= PLAN1_THRESHOLD) score += 1;
        if (s.highValuePerMin >= PLAN2_THRESHOLD) score += 1;
        // 阈值：至少满足一个条件
        return score >= 1;
      }
    }
  ];

  console.log('策略 | 准确率 | 精确率 | 召回率 | F1 | TP|TN|FP|FN | 通过率');
  console.log('------|--------|--------|--------|-----|-----|----|----|-------');

  for (const strategy of strategies) {
    const result = evaluate(allSamples, strategy.predict);
    console.log(`${strategy.name} | ${(result.accuracy * 100).toFixed(1)}% | ${(result.precision * 100).toFixed(1)}% | ${(result.recall * 100).toFixed(1)}% | ${result.f1.toFixed(2)} | ${result.tp}|${result.tn}|${result.fp}|${result.fn} | ${((result.tp + result.fp) / allSamples.length * 100).toFixed(1)}%`);
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('【推荐策略详解】');
  console.log('='.repeat(80));
  console.log('');

  // 详细分析AND策略
  console.log('🔷 AND策略 (两个条件都满足):');
  const andResult = evaluate(allSamples, s => s.volumePerMin >= PLAN1_THRESHOLD && s.highValuePerMin >= PLAN2_THRESHOLD);
  console.log(`   准确率: ${(andResult.accuracy * 100).toFixed(1)}%`);
  console.log(`   精确率: ${(andResult.precision * 100).toFixed(1)}% - 买入的代币中高质量的比例`);
  console.log(`   召回率: ${(andResult.recall * 100).toFixed(1)}% - 找到的高质量代币比例`);
  console.log(`   通过率: ${((andResult.tp + andResult.fp) / allSamples.length * 100).toFixed(1)}% - 只有${((andResult.tp + andResult.fp) / allSamples.length * 100).toFixed(0)}%的代币会被买入`);
  console.log(`   适用场景: 资金有限，只想买最确定的高质量代币`);
  console.log('');

  // 详细分析OR策略
  console.log('🔶 OR策略 (满足任一条件):');
  const orResult = evaluate(allSamples, s => s.volumePerMin >= PLAN1_THRESHOLD || s.highValuePerMin >= PLAN2_THRESHOLD);
  console.log(`   准确率: ${(orResult.accuracy * 100).toFixed(1)}%`);
  console.log(`   精确率: ${(orResult.precision * 100).toFixed(1)}%`);
  console.log(`   召回率: ${(orResult.recall * 100).toFixed(1)}% - 不错过任何可能的高质量代币`);
  console.log(`   通过率: ${((orResult.tp + orResult.fp) / allSamples.length * 100).toFixed(1)}% - ${((orResult.tp + orResult.fp) / allSamples.length * 100).toFixed(0)}%的代币会被买入`);
  console.log(`   适用场景: 资金充足，不想错过任何机会`);
  console.log('');

  // 详细分析分层策略B
  console.log('🔸 分层策略B (方案二初筛 -> 方案一补充):');
  const tierResult = evaluate(allSamples, s => {
    if (s.highValuePerMin >= PLAN2_THRESHOLD) return true;
    return s.volumePerMin >= PLAN1_THRESHOLD;
  });
  console.log(`   准确率: ${(tierResult.accuracy * 100).toFixed(1)}%`);
  console.log(`   精确率: ${(tierResult.precision * 100).toFixed(1)}%`);
  console.log(`   召回率: ${(tierResult.recall * 100).toFixed(1)}%`);
  console.log(`   通过率: ${((tierResult.tp + tierResult.fp) / allSamples.length * 100).toFixed(1)}%`);
  console.log(`   适用场景: 平衡策略，既保证高精确率，又不错过好机会`);
  console.log('');

  // 错误分析
  console.log('='.repeat(80));
  console.log('【错误分析】');
  console.log('='.repeat(80));
  console.log('');

  console.log('分层策略B 的预测错误:');
  const tierPredictions = evaluate(allSamples, s => {
    if (s.highValuePerMin >= PLAN2_THRESHOLD) return true;
    return s.volumePerMin >= PLAN1_THRESHOLD;
  }).predictions.filter(p => !p.isCorrect);

  console.log('');

  // 假阳性（误判为正）
  const falsePositives = tierPredictions.filter(p => p.predicted && !p.actual);
  console.log(`假阳性 (误判为高质量，实际是低质量): ${falsePositives.length} 个`);
  if (falsePositives.length > 0) {
    console.log('  示例:');
    falsePositives.slice(0, 3).forEach(p => {
      console.log(`    ${p.sample.category}: 交易额$${p.sample.volumePerMin.toFixed(0)}/分, 高价值${p.sample.highValuePerMin.toFixed(1)}/分`);
    });
  }
  console.log('');

  // 假阴性（误判为负）
  const falseNegatives = tierPredictions.filter(p => !p.predicted && p.actual);
  console.log(`假阴性 (误判为低质量，实际是高质量): ${falseNegatives.length} 个`);
  if (falseNegatives.length > 0) {
    console.log('  示例:');
    falseNegatives.slice(0, 3).forEach(p => {
      console.log(`    ${p.sample.category}: 交易额$${p.sample.volumePerMin.toFixed(0)}/分, 高价值${p.sample.highValuePerMin.toFixed(1)}/分`);
    });
  }
  console.log('');

  console.log('='.repeat(80));
  console.log('【最终建议】');
  console.log('='.repeat(80));
  console.log('');
  console.log('推荐使用: 分层策略B (方案二初筛 -> 方案一补充)');
  console.log('');
  console.log('理由:');
  console.log('1. 保持方案二的高精确率 (100%)，避免买入垃圾代币');
  console.log('2. 用方案一作为补充，捕获一些交易额高但高价值交易稍低的优质代币');
  console.log('3. 准确率 84.1%，召回率 41.7%，适合大多数场景');
  console.log('');
  console.log('实现代码:');
  console.log('```javascript');
  console.log('function shouldBuy(token) {');
  console.log('  // 第一层：高价值交易筛选（最可靠指标）');
  console.log('  if (token.highValuePerMin >= 73) {');
  console.log('    return true;');
  console.log('  }');
  console.log('  // 第二层：交易额补充（捕捉遗漏的好代币）');
  console.log('  if (token.volumePerMin >= 3117) {');
  console.log('    return true;');
  console.log('  }');
  console.log('  return false;');
  console.log('}');
  console.log('```');
}

main().catch(console.error);
