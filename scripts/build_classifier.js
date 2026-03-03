/**
 * 基于早期参与者指标构建简单筛选条件
 * 目标：从中低质量代币中筛选出中高质量
 */

const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const CATEGORY_MAP = {
  fake_pump: { label: '流水盘', emoji: '🎭', tier: 0 },
  low_quality: { label: '低质量', emoji: '📉', tier: 0 },
  mid_quality: { label: '中质量', emoji: '📊', tier: 1 },
  high_quality: { label: '高质量', emoji: '🚀', tier: 1 }
};

// 训练实验列表
const TRAINING_EXPERIMENTS = [
  'e689c80a-6b70-44f6-8e40-ffd720412780',
  'ec66badb-023e-40a9-8faf-b11dfe436910'
];

async function fetchExperimentData(experimentId) {
  // 获取有人工标注的代币
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('token_address, human_judges')
    .eq('experiment_id', experimentId);

  if (!tokens) return { tokens: [], signals: [] };

  // 建立代币到类别的映射
  const tokenCategoryMap = {};
  tokens.forEach(t => {
    let judges;
    try {
      judges = typeof t.human_judges === 'string' ? JSON.parse(t.human_judges) : t.human_judges;
    } catch (e) { return; }
    if (judges && judges.category) {
      tokenCategoryMap[t.token_address] = judges.category;
    }
  });

  // 获取买入信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy');

  if (!signals) return { tokens, signals: [] };

  // 筛选有早期参与者数据的信号
  const signalsWithData = signals.filter(s =>
    s.metadata && s.metadata.earlyTradesChecked === 1
  );

  // 组合数据：每个信号一个样本
  const samples = [];
  signalsWithData.forEach(s => {
    const category = tokenCategoryMap[s.token_address];
    if (!category) return;

    const m = s.metadata;
    samples.push({
      tokenAddress: s.token_address,
      category: category,
      isPositive: CATEGORY_MAP[category].tier === 1, // 中高质量为正样本
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

  return { samples };
}

async function main() {
  console.log('='.repeat(80));
  console.log('基于早期参与者指标的分类器构建与评估');
  console.log('='.repeat(80));
  console.log('');

  // 收集所有训练数据
  console.log('收集训练数据...\n');
  const allSamples = [];

  for (const expId of TRAINING_EXPERIMENTS) {
    console.log(`  ${expId}`);
    const { samples } = await fetchExperimentData(expId);
    console.log(`    样本数: ${samples.length}`);
    allSamples.push(...samples);
  }

  console.log(`\n总样本数: ${allSamples.length}`);

  // 统计正负样本
  const positiveSamples = allSamples.filter(s => s.isPositive);
  const negativeSamples = allSamples.filter(s => !s.isPositive);

  console.log(`  正样本 (中高质量): ${positiveSamples.length}`);
  console.log(`  负样本 (低质量/流水盘): ${negativeSamples.length}`);
  console.log('');

  // 分析各特征的分布
  console.log('='.repeat(80));
  console.log('特征分布分析');
  console.log('='.repeat(80));
  console.log('');

  const features = ['volumePerMin', 'countPerMin', 'walletsPerMin', 'highValuePerMin'];
  const featureNames = {
    volumePerMin: '交易额/分钟',
    countPerMin: '交易次数/分钟',
    walletsPerMin: '钱包数/分钟',
    highValuePerMin: '高价值交易/分钟'
  };

  for (const feat of features) {
    const posVals = positiveSamples.map(s => s.features[feat]).filter(v => v > 0);
    const negVals = negativeSamples.map(s => s.features[feat]).filter(v => v > 0);

    if (posVals.length === 0 || negVals.length === 0) continue;

    posVals.sort((a, b) => a - b);
    negVals.sort((a, b) => a - b);

    const posStats = {
      min: posVals[0],
      max: posVals[posVals.length - 1],
      median: posVals[Math.floor(posVals.length / 2)],
      p25: posVals[Math.floor(posVals.length * 0.25)],
      p75: posVals[Math.floor(posVals.length * 0.75)]
    };

    const negStats = {
      min: negVals[0],
      max: negVals[negVals.length - 1],
      median: negVals[Math.floor(negVals.length / 2)],
      p25: negVals[Math.floor(negVals.length * 0.25)],
      p75: negVals[Math.floor(negVals.length * 0.75)]
    };

    console.log(`${featureNames[feat]}:`);
    console.log(`  负样本: min=${negStats.min.toFixed(0)}, p25=${negStats.p25.toFixed(0)}, median=${negStats.median.toFixed(0)}, p75=${negStats.p75.toFixed(0)}, max=${negStats.max.toFixed(0)}`);
    console.log(`  正样本: min=${posStats.min.toFixed(0)}, p25=${posStats.p25.toFixed(0)}, median=${posStats.median.toFixed(0)}, p75=${posStats.p75.toFixed(0)}, max=${posStats.max.toFixed(0)}`);

    // 计算最佳阈值（使用正样本 p25）
    const threshold = posStats.p25;
    console.log(`  建议阈值: ${threshold.toFixed(0)} (正样本25分位数)`);
    console.log('');
  }

  // 构建简单的单阈值分类器
  console.log('='.repeat(80));
  console.log('单阈值分类器评估');
  console.log('='.repeat(80));
  console.log('');

  const results = [];

  for (const feat of features) {
    const posVals = positiveSamples.map(s => s.features[feat]).filter(v => v > 0);
    const negVals = negativeSamples.map(s => s.features[feat]).filter(v => v > 0);

    if (posVals.length === 0 || negVals.length === 0) continue;

    posVals.sort((a, b) => a - b);
    const thresholds = [
      posVals[Math.floor(posVals.length * 0.25)],  // 正样本 p25
      posVals[Math.floor(posVals.length * 0.50)],  // 正样本 median
      posVals[Math.floor(posVals.length * 0.75)]   // 正样本 p75
    ];

    for (const threshold of thresholds) {
      // 计算混淆矩阵
      let tp = 0, tn = 0, fp = 0, fn = 0;

      for (const s of allSamples) {
        const predicted = s.features[feat] >= threshold;
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

      results.push({
        feature: feat,
        featureName: featureNames[feat],
        threshold: threshold,
        tp, tn, fp, fn,
        accuracy,
        precision,
        recall,
        f1
      });
    }
  }

  // 按F1分数排序
  results.sort((a, b) => b.f1 - a.f1);

  // 打印结果
  console.log('特征 | 阈值 | 准确率 | 精确率 | 召回率 | F1 | TP|TN|FP|FN');
  console.log('------|------|--------|--------|--------|-----|-----|----|----');
  for (const r of results.slice(0, 10)) {
    console.log(`${r.featureName.padEnd(12)} | ${r.threshold.toFixed(0).padStart(6)} | ${(r.accuracy * 100).toFixed(1).padStart(6)}% | ${(r.precision * 100).toFixed(1).padStart(6)}% | ${(r.recall * 100).toFixed(1).padStart(6)}% | ${r.f1.toFixed(2).padStart(3)} | ${r.tp} | ${r.tn} | ${r.fp} | ${r.fn}`);
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('最佳分类器');
  console.log('='.repeat(80));
  console.log('');

  if (results.length > 0) {
    const best = results[0];
    console.log(`特征: ${best.featureName}`);
    console.log(`阈值: ${best.threshold.toFixed(0)}`);
    console.log(`准确率: ${(best.accuracy * 100).toFixed(2)}%`);
    console.log(`精确率: ${(best.precision * 100).toFixed(2)}%`);
    console.log(`召回率: ${(best.recall * 100).toFixed(2)}%`);
    console.log(`F1分数: ${best.f1.toFixed(3)}`);
    console.log('');
    console.log('混淆矩阵:');
    console.log(`  实际正样本: ${best.tp + best.fn} (预测正确: ${best.tp}, 预测错误: ${best.fn})`);
    console.log(`  实际负样本: ${best.tn + best.fp} (预测正确: ${best.tn}, 预测错误: ${best.fp})`);
  }

  // 多特征组合（AND规则）
  console.log('');
  console.log('='.repeat(80));
  console.log('多特征组合分类器 (AND规则：所有条件都满足)');
  console.log('='.repeat(80));
  console.log('');

  // 使用各特征的正样本p50作为阈值
  const multiThresholds = {};
  for (const feat of features) {
    const posVals = positiveSamples.map(s => s.features[feat]).filter(v => v > 0);
    if (posVals.length > 0) {
      posVals.sort((a, b) => a - b);
      multiThresholds[feat] = posVals[Math.floor(posVals.length * 0.50)];
    }
  }

  // 测试不同组合
  const combinations = [
    { name: '高价值交易', features: ['highValuePerMin'] },
    { name: '高价值+交易次数', features: ['highValuePerMin', 'countPerMin'] },
    { name: '高价值+交易额', features: ['highValuePerMin', 'volumePerMin'] },
    { name: '交易额+交易次数+钱包', features: ['volumePerMin', 'countPerMin', 'walletsPerMin'] },
    { name: '全部特征', features: features }
  ];

  for (const combo of combinations) {
    let tp = 0, tn = 0, fp = 0, fn = 0;

    for (const s of allSamples) {
      let predicted = true;
      for (const feat of combo.features) {
        if (s.features[feat] < multiThresholds[feat]) {
          predicted = false;
          break;
        }
      }
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

    console.log(`${combo.name}:`);
    console.log(`  阈值: ${combo.features.map(f => `${featureNames[f]}>=${multiThresholds[f].toFixed(0)}`).join(', ')}`);
    console.log(`  准确率: ${(accuracy * 100).toFixed(1)}%, 精确率: ${(precision * 100).toFixed(1)}%, 召回率: ${(recall * 100).toFixed(1)}%, F1: ${f1.toFixed(3)}`);
    console.log(`  混淆矩阵: TP=${tp}, TN=${tn}, FP=${fp}, FN=${fn}`);
    console.log('');
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('结论');
  console.log('='.repeat(80));
  console.log('');
  console.log('1. 单特征分类器：选择 F1 最高的特征作为主要筛选条件');
  console.log('2. 多特征AND组合：提高精确率但降低召回率（更严格）');
  console.log('3. 建议根据业务需求选择：');
  console.log('   - 追求高召回率（不错过好代币）：使用单特征低阈值');
  console.log('   - 追求高精确率（避免买入垃圾）：使用多特征AND组合');
}

main().catch(console.error);
