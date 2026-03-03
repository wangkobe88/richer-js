/**
 * 早期参与者数据修正脚本
 * 用方案C（代币年龄）重新计算早期参与者指标
 *
 * 方案C：用代币年龄（检查时间）作为窗口
 * countPerMin = totalCount / (checkTime / 60)
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// 实验配置
const EXPERIMENTS = [
  { id: 'ca51587b-8607-4af2-b57c-5826a848b245', name: 'ca51587b (age>1.3)' },
  { id: 'e689c80a-6b70-44f6-8e40-ffd720412780', name: 'e689c80a (age>1.5)' },
  { id: 'ec66badb-023e-40a9-8faf-b11dfe436910', name: 'ec66badb (age>1.5)' }
];

const CATEGORY_MAP = {
  fake_pump: { label: '流水盘', tier: 0 },
  low_quality: { label: '低质量', tier: 0 },
  mid_quality: { label: '中质量', tier: 1 },
  high_quality: { label: '高质量', tier: 1 }
};

/**
 * 从原始数据重新计算指标（方案C）
 */
function recalculateMetrics(metadata) {
  if (!metadata || metadata.earlyTradesChecked !== 1) {
    return null;
  }

  const m = metadata;

  // 方案C：用代币年龄（检查时间）作为窗口
  const checkTimeSeconds = m.earlyTradesCheckTime || 0;
  const ageMinutes = checkTimeSeconds / 60;

  if (ageMinutes <= 0 || m.earlyTradesTotalCount === 0) {
    return {
      ...m,
      _recalculated: true,
      _method: 'C',
      _ageMinutes: ageMinutes
    };
  }

  // 重新计算每分钟指标
  const totalCount = m.earlyTradesTotalCount || 0;
  const totalVolume = m.earlyTradesVolume || 0;
  const uniqueWallets = m.earlyTradesUniqueWallets || 0;
  const highValueCount = m.earlyTradesHighValueCount || 0;

  return {
    ...m,

    // 标记为重新计算
    _recalculated: true,
    _method: 'C',
    _ageMinutes: ageMinutes,

    // 重新计算的指标（方案C）
    _countPerMin: parseFloat((totalCount / ageMinutes).toFixed(1)),
    _volumePerMin: parseFloat((totalVolume / ageMinutes).toFixed(2)),
    _walletsPerMin: parseFloat((uniqueWallets / ageMinutes).toFixed(1)),
    _highValuePerMin: parseFloat((highValueCount / ageMinutes).toFixed(1)),

    // 原始指标（用于对比）
    _origCountPerMin: m.earlyTradesCountPerMin,
    _origVolumePerMin: m.earlyTradesVolumePerMin
  };
}

/**
 * 获取实验的代币分类（从 human_judges 字段）
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
 * 分析单个实验
 */
async function analyzeExperiment(experimentId, tokenInfo) {
  console.log(`\n========================================`);
  console.log(`分析实验: ${experimentId}`);
  console.log(`========================================\n`);

  // 获取所有买入信号
  const { data: signals, error } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy');

  if (error) {
    console.error('获取信号失败:', error);
    return [];
  }

  console.log(`找到 ${signals.length} 个买入信号\n`);

  // 筛选有早期参与者数据的信号
  const validSignals = signals.filter(s =>
    s.metadata &&
    s.metadata.earlyTradesChecked === 1 &&
    s.metadata.earlyTradesTotalCount > 0
  );

  console.log(`有早期参与者数据的信号: ${validSignals.length}\n`);

  // 重新计算指标
  const samples = [];
  for (const signal of validSignals) {
    const info = tokenInfo[signal.token_address];
    if (!info) continue;

    const m = signal.metadata;
    const ageMinutes = (m.earlyTradesCheckTime || 0) / 60;

    const recalculated = {
      tokenAddress: signal.token_address,
      symbol: info.symbol,
      category: info.category,
      tier: info.tier,
      pnlRoi: info.pnl_roi,
      isPositive: info.tier === 1, // tier=1 为正样本

      // 原始数据
      totalCount: m.earlyTradesTotalCount,
      totalVolume: m.earlyTradesVolume || 0,
      uniqueWallets: m.earlyTradesUniqueWallets || 0,
      highValueCount: m.earlyTradesHighValueCount || 0,
      checkTime: m.earlyTradesCheckTime || 0,
      ageMinutes: ageMinutes,

      // 方案C重新计算的指标
      countPerMin: parseFloat((m.earlyTradesTotalCount / ageMinutes).toFixed(1)),
      volumePerMin: parseFloat(((m.earlyTradesVolume || 0) / ageMinutes).toFixed(2)),
      walletsPerMin: parseFloat(((m.earlyTradesUniqueWallets || 0) / ageMinutes).toFixed(1)),
      highValuePerMin: parseFloat(((m.earlyTradesHighValueCount || 0) / ageMinutes).toFixed(1)),

      // 原始存储的指标（用于对比）
      origCountPerMin: m.earlyTradesCountPerMin,
      origVolumePerMin: m.earlyTradesVolumePerMin
    };

    samples.push(recalculated);
  }

  return samples;
}

/**
 * 打印统计摘要
 */
function printSummary(allSamples) {
  console.log('\n========================================');
  console.log('总体统计摘要');
  console.log('========================================\n');

  const positiveSamples = allSamples.filter(s => s.isPositive);
  const negativeSamples = allSamples.filter(s => !s.isPositive);

  console.log(`正样本数量: ${positiveSamples.length}`);
  console.log(`负样本数量: ${negativeSamples.length}`);
  console.log(`总样本数量: ${allSamples.length}\n`);

  // 按分类统计
  const categoryCount = {};
  for (const s of allSamples) {
    categoryCount[s.category] = (categoryCount[s.category] || 0) + 1;
  }

  console.log('分类分布:');
  for (const [cat, count] of Object.entries(categoryCount)) {
    console.log(`  ${cat}: ${count}`);
  }
  console.log('');

  // checkTime 分布
  const checkTimeRanges = [
    { label: '< 90s', min: 0, max: 90 },
    { label: '90-120s', min: 90, max: 120 },
    { label: '120-150s', min: 120, max: 150 },
    { label: '> 150s', min: 150, max: Infinity }
  ];

  console.log('检查时间分布:');
  for (const range of checkTimeRanges) {
    const count = allSamples.filter(s =>
      s.checkTime >= range.min && s.checkTime < range.max
    ).length;
    console.log(`  ${range.label}: ${count}`);
  }
  console.log('');
}

/**
 * 导出修正后的数据
 */
function exportData(allSamples) {
  const fs = require('fs');

  const output = {
    exportTime: new Date().toISOString(),
    method: '方案C（代币年龄）',
    formula: 'countPerMin = totalCount / (checkTime / 60)',
    sampleCount: allSamples.length,
    samples: allSamples.map(s => ({
      tokenAddress: s.tokenAddress,
      symbol: s.symbol,
      category: s.category,
      tier: s.tier,
      pnlRoi: s.pnlRoi,
      isPositive: s.isPositive,
      totalCount: s.totalCount,
      totalVolume: s.totalVolume,
      uniqueWallets: s.uniqueWallets,
      highValueCount: s.highValueCount,
      checkTime: s.checkTime,
      ageMinutes: s.ageMinutes,
      countPerMin: s.countPerMin,
      volumePerMin: s.volumePerMin,
      walletsPerMin: s.walletsPerMin,
      highValuePerMin: s.highValuePerMin,
      origCountPerMin: s.origCountPerMin,
      origVolumePerMin: s.origVolumePerMin
    }))
  };

  const outputFile = '/Users/nobody1/Desktop/Codes/richer-js/scripts/early_participants_corrected.json';
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  console.log(`\n数据已导出到: ${outputFile}`);
}

/**
 * 主函数
 */
async function main() {
  console.log('========================================');
  console.log('早期参与者数据修正分析');
  console.log('方案C：用代币年龄作为窗口');
  console.log('========================================\n');

  const allSamples = [];

  for (const exp of EXPERIMENTS) {
    const tokenInfo = await getTokenCategories(exp.id);
    const samples = await analyzeExperiment(exp.id, tokenInfo);
    allSamples.push(...samples);
  }

  if (allSamples.length === 0) {
    console.log('没有找到任何有效数据！');
    return;
  }

  // 打印摘要
  printSummary(allSamples);

  // 导出数据
  exportData(allSamples);

  console.log('\n✅ 数据修正完成！');
  console.log('请运行下一步：node scripts/analyze_early_features.js');
}

main().catch(console.error);
