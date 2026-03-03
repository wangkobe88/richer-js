/**
 * 早期交易者全因子分析脚本
 * 分析所有早期交易者相关因子的有效性
 */

const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// 实验配置
const EXPERIMENTS = [
  { id: 'ca51587b-8607-4af2-b57c-5826a848b245', name: 'ca51587b' },
  { id: 'e689c80a-6b70-44f6-8e40-ffd720412780', name: 'e689c80a' },
  { id: 'ec66badb-023e-40a9-8faf-b11dfe436910', name: 'ec66badb' }
];

const CATEGORY_MAP = {
  fake_pump: { label: '流水盘', tier: 0 },
  low_quality: { label: '低质量', tier: 0 },
  mid_quality: { label: '中质量', tier: 1 },
  high_quality: { label: '高质量', tier: 1 }
};

/**
 * 获取代币分类
 */
async function getTokenCategories(experimentId) {
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol, human_judges')
    .eq('experiment_id', experimentId);

  const categoryMap = {};
  for (const token of tokens || []) {
    let judges;
    try {
      judges = typeof token.human_judges === 'string'
        ? JSON.parse(token.human_judges)
        : token.human_judges;
    } catch (e) {
      continue;
    }

    if (judges && judges.category) {
      const tier = CATEGORY_MAP[judges.category]?.tier ?? 0;
      categoryMap[token.token_address] = {
        symbol: token.token_symbol,
        category: judges.category,
        tier: tier
      };
    }
  }

  return categoryMap;
}

/**
 * 获取所有信号数据
 */
async function getAllSignals() {
  const allSamples = [];

  for (const exp of EXPERIMENTS) {
    console.log(`获取实验 ${exp.id} 的数据...`);

    const tokenInfo = await getTokenCategories(exp.id);

    const { data: signals } = await supabase
      .from('strategy_signals')
      .select('*')
      .eq('experiment_id', exp.id)
      .eq('action', 'buy');

    for (const signal of signals || []) {
      const info = tokenInfo[signal.token_address];
      if (!info) continue;

      const m = signal.metadata;
      if (!m || !m.earlyTradesChecked || m.earlyTradesTotalCount === 0) continue;

      allSamples.push({
        tokenAddress: signal.token_address,
        symbol: info.symbol,
        category: info.category,
        tier: info.tier,
        isPositive: info.tier === 1,

        // 基础信息
        checkTime: m.earlyTradesCheckTime || 0,
        window: m.earlyTradesWindow || 0,

        // 数据覆盖度
        dataCoverage: m.earlyTradesDataCoverage || 0,
        gapBefore: m.earlyTradesDataGapBefore || 0,
        gapAfter: m.earlyTradesDataGapAfter || 0,

        // 速率指标
        countPerMin: m.earlyTradesCountPerMin || 0,
        volumePerMin: m.earlyTradesVolumePerMin || 0,
        walletsPerMin: m.earlyTradesWalletsPerMin || 0,
        highValuePerMin: m.earlyTradesHighValuePerMin || 0,

        // 绝对值
        totalCount: m.earlyTradesTotalCount || 0,
        totalVolume: m.earlyTradesVolume || 0,
        uniqueWallets: m.earlyTradesUniqueWallets || 0,
        highValueCount: m.earlyTradesHighValueCount || 0,
        filteredCount: m.earlyTradesFilteredCount || 0,

        // 增长特征
        acceleration: m.earlyTradesAcceleration || 0,
        accelerationRatio: m.earlyTradesAccelerationRatio,
        growthTrend: m.earlyTradesGrowthTrend || 'unknown',

        // 衍生指标
        avgTradeValue: (m.earlyTradesTotalVolume || 0) / (m.earlyTradesTotalCount || 1),
        walletEfficiency: (m.earlyTradesTotalCount || 0) / (m.earlyTradesUniqueWallets || 1), // 每个钱包的平均交易数
        highValueRatio: (m.earlyTradesHighValueCount || 0) / (m.earlyTradesTotalCount || 1), // 高价值交易占比
        filteredRatio: (m.earlyTradesFilteredCount || 0) / (m.earlyTradesTotalCount || 1), // >=10USD交易占比
      });
    }
  }

  return allSamples;
}

/**
 * 计算分位数
 */
function calculatePercentiles(values, percentiles) {
  const sorted = [...values].filter(v => !isNaN(v) && v !== null && v !== undefined).sort((a, b) => a - b);
  const result = {};

  for (const p of percentiles) {
    const index = Math.floor((p / 100) * (sorted.length - 1));
    result[p] = sorted[index] || 0;
  }

  return result;
}

/**
 * 计算AUC
 */
function calculateAUC(samples, featureKey) {
  const positiveSamples = samples.filter(s => s.isPositive);
  const negativeSamples = samples.filter(s => !s.isPositive);

  const posValues = positiveSamples.map(s => s[featureKey]).filter(v => !isNaN(v) && v !== null);
  const negValues = negativeSamples.map(s => s[featureKey]).filter(v => !isNaN(v) && v !== null);

  let rankSum = 0;
  let pairs = 0;

  for (const pos of posValues) {
    for (const neg of negValues) {
      if (pos > neg) rankSum++;
      pairs++;
    }
  }

  return pairs > 0 ? rankSum / pairs : 0.5;
}

/**
 * 分析分类特征（增长趋势）
 */
function analyzeCategoricalFeature(samples, featureKey) {
  const positiveSamples = samples.filter(s => s.isPositive);
  const negativeSamples = samples.filter(s => !s.isPositive);

  const posCounts = {};
  const negCounts = {};

  for (const s of positiveSamples) {
    const val = s[featureKey] || 'unknown';
    posCounts[val] = (posCounts[val] || 0) + 1;
  }

  for (const s of negativeSamples) {
    const val = s[featureKey] || 'unknown';
    negCounts[val] = (negCounts[val] || 0) + 1;
  }

  const allValues = [...new Set([...Object.keys(posCounts), ...Object.keys(negCounts)])];

  console.log(`\n  ${featureKey} 分布:`);
  console.log(`  ${'值'.padEnd(15)} | 正样本 | 负样本 | 正占比 | 负占比`);
  console.log(`  ${'-' * 15} |--------|--------|--------|--------`);

  for (const val of allValues.sort()) {
    const posCount = posCounts[val] || 0;
    const negCount = negCounts[val] || 0;
    const posPct = positiveSamples.length > 0 ? (posCount / positiveSamples.length * 100).toFixed(1) : '0.0';
    const negPct = negativeSamples.length > 0 ? (negCount / negativeSamples.length * 100).toFixed(1) : '0.0';

    console.log(`  ${val.padEnd(15)} | ${posCount} | ${negCount} | ${posPct}% | ${negPct}%`);
  }

  // 计算信息增益
  const totalSamples = samples.length;
  const baseEntropy = -(
    (positiveSamples.length / totalSamples) * Math.log2(positiveSamples.length / totalSamples) +
    (negativeSamples.length / totalSamples) * Math.log2(negativeSamples.length / totalSamples)
  );

  let weightedEntropy = 0;
  for (const val of allValues) {
    const valSamples = samples.filter(s => (s[featureKey] || 'unknown') === val);
    if (valSamples.length === 0) continue;
    const posCount = valSamples.filter(s => s.isPositive).length;
    const negCount = valSamples.length - posCount;
    if (posCount === 0 || negCount === 0) continue;

    const p = posCount / valSamples.length;
    const entropy = -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
    weightedEntropy += (valSamples.length / totalSamples) * entropy;
  }

  const infoGain = baseEntropy - weightedEntropy;
  console.log(`  信息增益: ${infoGain.toFixed(4)}`);

  return { infoGain, posCounts, negCounts };
}

/**
 * 打印因子分析结果
 */
function printFactorAnalysis(samples) {
  console.log('\n========================================');
  console.log('因子有效性分析');
  console.log('========================================');

  const positiveSamples = samples.filter(s => s.isPositive);
  const negativeSamples = samples.filter(s => !s.isPositive);

  console.log(`\n正样本: ${positiveSamples.length}, 负样本: ${negativeSamples.length}, 总计: ${samples.length}`);

  // 数值型因子列表
  const numericFactors = [
    { key: 'checkTime', name: '检查时间(秒)' },
    { key: 'dataCoverage', name: '数据覆盖度' },
    { key: 'gapBefore', name: '数据间隙前' },
    { key: 'gapAfter', name: '数据间隙后' },
    { key: 'countPerMin', name: '交易次数/分' },
    { key: 'volumePerMin', name: '交易额/分' },
    { key: 'walletsPerMin', name: '钱包数/分' },
    { key: 'highValuePerMin', name: '高价值/分' },
    { key: 'totalCount', name: '总交易数' },
    { key: 'totalVolume', name: '总交易额' },
    { key: 'uniqueWallets', name: '独立钱包数' },
    { key: 'highValueCount', name: '高价值交易数' },
    { key: 'filteredCount', name: '过滤后交易数' },
    { key: 'acceleration', name: '加速度' },
    { key: 'accelerationRatio', name: '加速度比率' },
    { key: 'avgTradeValue', name: '平均交易额' },
    { key: 'walletEfficiency', name: '钱包效率' },
    { key: 'highValueRatio', name: '高价值占比' },
    { key: 'filteredRatio', name: '过滤交易占比' },
  ];

  console.log('\n========================================');
  console.log('数值型因子排名（按AUC）');
  console.log('========================================\n');

  const aucList = numericFactors.map(feat => ({
    ...feat,
    auc: calculateAUC(samples, feat.key)
  }));

  aucList.sort((a, b) => b.auc - a.auc);

  console.log('排名 | 因子                | AUC    | 解释');
  console.log('-----|--------------------|--------|--------');

  aucList.forEach((f, i) => {
    const interpretation = f.auc > 0.7 ? '很高' : f.auc > 0.6 ? '较高' : f.auc > 0.55 ? '中等' : f.auc > 0.5 ? '较低' : '无效';
    console.log(`${(i+1).toString().padStart(4)} | ${f.name.padEnd(18)} | ${(f.auc*100).toFixed(1)}%   | ${interpretation}`);
  });

  // 打印每个因子的详细统计
  console.log('\n========================================');
  console.log('因子详细统计（正样本 vs 负样本）');
  console.log('========================================\n');

  console.log('因子                    | 正中位数 | 负中位数 | 正均值 | 负均值 | AUC');
  console.log('------------------------|----------|----------|--------|--------|-----');

  for (const feat of aucList.slice(0, 15)) {
    const posValues = positiveSamples.map(s => s[feat.key]).filter(v => !isNaN(v) && v !== null);
    const negValues = negativeSamples.map(s => s[feat.key]).filter(v => !isNaN(v) && v !== null);

    const posPercentiles = calculatePercentiles(posValues, [50]);
    const negPercentiles = calculatePercentiles(negValues, [50]);

    const posMean = posValues.length > 0 ? (posValues.reduce((a,b) => a+b, 0) / posValues.length) : 0;
    const negMean = negValues.length > 0 ? (negValues.reduce((a,b) => a+b, 0) / negValues.length) : 0;

    console.log(`${feat.name.padEnd(22)} | ${(posPercentiles[50] || 0).toFixed(1).padStart(8)} | ${(negPercentiles[50] || 0).toFixed(1).padStart(8)} | ${posMean.toFixed(1).padStart(6)} | ${negMean.toFixed(1).padStart(6)} | ${(feat.auc*100).toFixed(1)}%`);
  }

  // 分类因子分析
  console.log('\n========================================');
  console.log('分类型因子分析');
  console.log('========================================');

  analyzeCategoricalFeature(samples, 'growthTrend');

  return aucList;
}

/**
 * 主函数
 */
async function main() {
  console.log('========================================');
  console.log('早期交易者全因子分析');
  console.log('========================================\n');

  const samples = await getAllSignals();

  if (samples.length === 0) {
    console.log('没有找到任何有效数据！');
    return;
  }

  console.log(`加载 ${samples.length} 个样本\n`);

  const aucList = printFactorAnalysis(samples);

  // 导出结果
  const outputFile = '/Users/nobody1/Desktop/Codes/richer-js/scripts/all_factors_analysis.json';
  fs.writeFileSync(outputFile, JSON.stringify({
    exportTime: new Date().toISOString(),
    sampleCount: samples.length,
    positiveCount: samples.filter(s => s.isPositive).length,
    negativeCount: samples.filter(s => !s.isPositive).length,
    factorRanking: aucList.map(f => ({
      name: f.name,
      key: f.key,
      auc: f.auc
    })),
    samples: samples.map(s => ({
      symbol: s.symbol,
      category: s.category,
      isPositive: s.isPositive,
      ...s
    }))
  }, null, 2));

  console.log(`\n结果已保存到: ${outputFile}`);
  console.log('\n========================================');
  console.log('✅ 全因子分析完成！');
  console.log('========================================');
}

main().catch(console.error);
