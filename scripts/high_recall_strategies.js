/**
 * 提高召回率的策略分析
 * 目标：在保持较高精确率的前提下，提高中高质量召回率
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
  { id: 'e689c80a-6b70-44f6-8e40-ffd720412780' },
  { id: 'ec66badb-023e-40a9-8faf-b11dfe436910' },
  { id: 'ca51587b-8607-4af2-b57c-5826a848b245' }
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

function drawMatrix(tp, tn, fp, fn, totalPos, totalNeg) {
  console.log('                预测买入      预测不买');
  console.log('  实际中高质量  │  TP: ' + String(tp).padStart(2) + '     │  FN: ' + String(fn).padStart(2));
  console.log('  实际低质量    │  FP: ' + String(fp).padStart(2) + '     │  TN: ' + String(tn).padStart(2));
  console.log('');
  console.log('  精确率: ' + (tp + fp > 0 ? (tp / (tp + fp) * 100).toFixed(1) : '0') + '%  |  召回率: ' + (totalPos > 0 ? (tp / totalPos * 100).toFixed(1) : '0') + '%  |  买入: ' + (tp + fp) + '个');
}

async function main() {
  console.log('='.repeat(80));
  console.log('提高召回率的策略分析');
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

  const features = ['volumePerMin', 'countPerMin', 'walletsPerMin', 'highValuePerMin'];
  const featureNames = { volumePerMin: '交易额', countPerMin: '交易次数', walletsPerMin: '钱包数', highValuePerMin: '高价值' };

  const thresholds = {};
  for (const feat of features) {
    const posVals = positiveSamples.map(s => s.features[feat]).filter(v => v > 0).sort((a, b) => a - b);
    if (posVals.length > 0) {
      thresholds[feat] = {
        p10: posVals[Math.floor(posVals.length * 0.10)],
        p25: posVals[Math.floor(posVals.length * 0.25)],
        p50: posVals[Math.floor(posVals.length * 0.50)],
        p75: posVals[Math.floor(posVals.length * 0.75)]
      };
    }
  }

  // 定义多种提高召回率的策略
  const strategies = [
    {
      name: '【策略1】高价值交易≥10（低阈值）',
      desc: '降低高价值交易阈值，提高召回率',
      predict: s => s.features.highValuePerMin >= 10
    },
    {
      name: '【策略2】交易额≥2000（低阈值）',
      desc: '降低交易额阈值',
      predict: s => s.features.volumePerMin >= 2000
    },
    {
      name: '【策略3】OR - 交易额≥2000 或 高价值≥10',
      desc: '宽松的OR组合',
      predict: s => s.features.volumePerMin >= 2000 || s.features.highValuePerMin >= 10
    },
    {
      name: '【策略4】评分≥2项（使用p25阈值）',
      desc: '使用更低的p25阈值',
      predict: s => {
        let score = 0;
        if (s.features.volumePerMin >= thresholds.volumePerMin.p25) score++;
        if (s.features.countPerMin >= thresholds.countPerMin.p25) score++;
        if (s.features.highValuePerMin >= thresholds.highValuePerMin.p25) score++;
        return score >= 2;
      }
    },
    {
      name: '【策略5】评分≥1项（使用p25阈值）',
      desc: '至少1项达标（很宽松）',
      predict: s => {
        let score = 0;
        if (s.features.volumePerMin >= thresholds.volumePerMin.p25) score++;
        if (s.features.countPerMin >= thresholds.countPerMin.p25) score++;
        if (s.features.highValuePerMin >= thresholds.highValuePerMin.p25) score++;
        return score >= 1;
      }
    },
    {
      name: '【策略6】分层-高价值≥10 或 (交易额≥4000 且 交易次数≥25)',
      desc: '主要条件宽松 + 补充条件',
      predict: s => {
        if (s.features.highValuePerMin >= 10) return true;
        return s.features.volumePerMin >= 4000 && s.features.countPerMin >= 25;
      }
    },
    {
      name: '【策略7】高价值≥8 或 交易额≥3000',
      desc: '平衡的OR组合',
      predict: s => s.features.highValuePerMin >= 8 || s.features.volumePerMin >= 3000
    },
    {
      name: '【策略8】三特征AND（使用p25阈值）',
      desc: '三特征都用p25，相对宽松',
      predict: s => s.features.volumePerMin >= thresholds.volumePerMin.p25 &&
                  s.features.countPerMin >= thresholds.countPerMin.p25 &&
                  s.features.highValuePerMin >= thresholds.highValuePerMin.p25
    },
    {
      name: '【策略9】交易额≥1500 或 高价值≥8',
      desc: '最宽松的OR组合',
      predict: s => s.features.volumePerMin >= 1500 || s.features.highValuePerMin >= 8
    },
    {
      name: '【策略10】高价值≥12 且 交易额≥2500',
      desc: '平衡的AND组合（中等阈值）',
      predict: s => s.features.highValuePerMin >= 12 && s.features.volumePerMin >= 2500
    },
    {
      name: '【策略11】(高价值≥10 或 交易额≥3000) 且 交易次数≥15',
      desc: 'OR + 最小交易次数要求',
      predict: s => (s.features.highValuePerMin >= 10 || s.features.volumePerMin >= 3000) && s.features.countPerMin >= 15
    }
  ];

  console.log('='.repeat(80));
  console.log('【高召回率策略评估】');
  console.log('='.repeat(80));
  console.log('');

  const results = [];
  for (const strategy of strategies) {
    const result = evaluate(allSamples, strategy.predict);
    results.push({ ...result, name: strategy.name, desc: strategy.desc });
  }

  // 按召回率排序
  results.sort((a, b) => b.recall - a.recall);

  console.log('策略 | 精确率 | 召回率 | F1 | TP|TN|FP|FN | 买入数');
  console.log('------|--------|--------|-----|-----|----|----|-------');
  for (const r of results) {
    const shortName = r.name.replace('【策略', '').replace('】', '').replace(/\d+ /, '');
    console.log(`${shortName.padEnd(28)} | ${(r.precision * 100).toFixed(1).padStart(5)}% | ${(r.recall * 100).toFixed(1).padStart(5)}% | ${r.f1.toFixed(2).padStart(3)} | ${r.tp}|${r.tn}|${r.fp}|${r.fn} | ${(r.tp + r.fp).toString().padStart(3)}`);
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('【推荐策略详解】');
  console.log('='.repeat(80));
  console.log('');

  // 选出召回率>60% 且 精确率>60% 的策略
  const balancedStrategies = results.filter(r => r.recall >= 0.60 && r.precision >= 0.60);

  if (balancedStrategies.length > 0) {
    console.log('平衡型策略（召回率≥60% 且 精确率≥60%）:');
    console.log('');

    for (const r of balancedStrategies.slice(0, 5)) {
      console.log(r.name);
      console.log('  ' + r.desc);
      drawMatrix(r.tp, r.tn, r.fp, r.fn, positiveSamples.length, negativeSamples.length);
      console.log('');
    }
  } else {
    // 如果没有完美平衡的，显示召回率最高的几个
    console.log('高召回率策略（召回率≥50%）:');
    console.log('');

    for (const r of results.filter(r => r.recall >= 0.50).slice(0, 5)) {
      console.log(r.name);
      console.log('  ' + r.desc);
      drawMatrix(r.tp, r.tn, r.fp, r.fn, positiveSamples.length, negativeSamples.length);
      console.log('');
    }
  }

  console.log('='.repeat(80));
  console.log('【阈值参考】');
  console.log('='.repeat(80));
  console.log('');
  console.log('正样本分位数:');
  console.log('  交易额/分钟: p10=' + thresholds.volumePerMin.p10.toFixed(0) + ', p25=' + thresholds.volumePerMin.p25.toFixed(0) + ', p50=' + thresholds.volumePerMin.p50.toFixed(0));
  console.log('  交易次数/分钟: p10=' + thresholds.countPerMin.p10.toFixed(0) + ', p25=' + thresholds.countPerMin.p25.toFixed(0) + ', p50=' + thresholds.countPerMin.p50.toFixed(0));
  console.log('  高价值交易/分钟: p10=' + thresholds.highValuePerMin.p10.toFixed(0) + ', p25=' + thresholds.highValuePerMin.p25.toFixed(0) + ', p50=' + thresholds.highValuePerMin.p50.toFixed(0));
}

main().catch(console.error);
