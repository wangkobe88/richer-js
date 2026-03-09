/**
 * 完整的区块号间隔分析
 * 包含：平均值、标准差、各分位数、gap=0比例等
 */

const { createClient } = require('@supabase/supabase-js');
const { AveTxAPI } = require('./src/core/ave-api/tx-api');
const fs = require('fs');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const pumpAndDump = [
  '0x2be52e98e45ed3d27f56284972b3545dac964444',
  '0x281f05868b5ba9e55869541a117ebb661f474444',
  '0xf3372a3dbc824f0b0044ca77209559514b294444',
  '0xb9b1142a28fade5771b7ae076c96c3bee8beffff',
  '0xd8d4ddeb91987a121422567260a88230dbb34444',
  '0x68b04d6e06495866cc810d4179caf97651a5ffff',
  '0x98fe71847aa16d9e40a4f0e123d172bc71d14444',
  '0x721f5abc0d34948aa0904ba135cc4d9c6ff84444',
  '0xf40dec26ab76df60a761e78c84682d7117a64444',
  '0x0da3a0a3bd66bbeaaa4d35d12cb9ea3725294444'
];

const notPumpAndDump = [
  '0x1443d233e2dbad52df65e6b17063274e6c844444',
  '0x16aeb87aeb78e4cf7987f16e910c285d77354444',
  '0xa9fe96fd5230a135ada220523032b3e1a67d4444',
  '0x4d15d67fcf9bd0b109efa7fc1b150416cca04444',
  '0xd7a23f95c6698c44c7b861408f0d7b47acc74444'
];

const txApi = new AveTxAPI(
  process.env.AVE_API_BASE_URL || 'https://prod.ave-api.com',
  30000,
  process.env.AVE_API_KEY
);

function calculateBlockGapStats(trades) {
  if (!trades || trades.length < 2) {
    return null;
  }

  // 计算所有相邻交易的区块号间隔
  const gaps = [];
  for (let i = 1; i < trades.length; i++) {
    const gap = trades[i].block_number - trades[i - 1].block_number;
    gaps.push(gap);
  }

  // 排序用于计算分位数
  const sortedGaps = [...gaps].sort((a, b) => a - b);

  // 基础统计
  const sum = gaps.reduce((a, b) => a + b, 0);
  const mean = sum / gaps.length;
  const n = gaps.length;

  // 方差和标准差
  const variance = gaps.reduce((acc, g) => acc + Math.pow(g - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);

  // 分位数
  const p25 = sortedGaps[Math.floor(n * 0.25)];
  const p50 = sortedGaps[Math.floor(n * 0.50)];
  const p75 = sortedGaps[Math.floor(n * 0.75)];
  const p90 = sortedGaps[Math.floor(n * 0.90)];
  const p95 = sortedGaps[Math.floor(n * 0.95)];

  // 分布统计
  const gap0Count = gaps.filter(g => g === 0).length;
  const gap1Count = gaps.filter(g => g === 1).length;
  const gap2Count = gaps.filter(g => g === 2).length;
  const gap3Count = gaps.filter(g => g === 3).length;
  const gap4to5Count = gaps.filter(g => g >= 4 && g <= 5).length;
  const gap6to10Count = gaps.filter(g => g >= 6 && g <= 10).length;
  const gapOver10Count = gaps.filter(g => g > 10).length;

  // 区块范围
  const minBlock = trades[0].block_number;
  const maxBlock = trades[trades.length - 1].block_number;
  const blockRange = maxBlock - minBlock;

  return {
    totalGaps: n,
    blockRange: blockRange,
    // 基础统计
    blockGapMean: parseFloat(mean.toFixed(2)),
    blockGapStdDev: parseFloat(stdDev.toFixed(2)),
    blockGapVariance: parseFloat(variance.toFixed(2)),
    // 极值
    blockGapMin: Math.min(...gaps),
    blockGapMax: Math.max(...gaps),
    // 分位数
    blockGapP25: p25,
    blockGapP50: p50,
    blockGapP75: p75,
    blockGapP90: p90,
    blockGapP95: p95,
    // 分布统计（绝对值）
    gap0Count: gap0Count,
    gap1Count: gap1Count,
    gap2Count: gap2Count,
    gap3Count: gap3Count,
    gap4to5Count: gap4to5Count,
    gap6to10Count: gap6to10Count,
    gapOver10Count: gapOver10Count,
    // 分布统计（比例）
    gap0Ratio: parseFloat((gap0Count / n).toFixed(4)),
    gap1Ratio: parseFloat((gap1Count / n).toFixed(4)),
    gap2to3Ratio: parseFloat(((gap2Count + gap3Count) / n).toFixed(4)),
    gapOver3Ratio: parseFloat(((gap4to5Count + gap6to10Count + gapOver10Count) / n).toFixed(4)),
    // 集中度指标
    concentration: parseFloat(((gap0Count + gap1Count) / n).toFixed(4))
  };
}

async function fetchEarlyTrades(innerPair, chain, checkTime) {
  const pairId = `${innerPair}-${chain}`;
  const targetFromTime = checkTime - 90;
  let currentToTime = checkTime;
  const allTrades = [];

  for (let loop = 1; loop <= 10; loop++) {
    try {
      const trades = await txApi.getSwapTransactions(
        pairId, 300, targetFromTime, currentToTime, 'asc'
      );
      if (trades.length === 0) break;
      allTrades.push(...trades);
      if (trades[0].time <= targetFromTime || trades.length < 300) break;
      currentToTime = trades[0].time - 1;
    } catch (error) {
      break;
    }
  }

  const uniqueTrades = [];
  const seen = new Set();
  for (const trade of allTrades.sort((a, b) => a.time - b.time)) {
    const key = trade.tx_id || `${trade.time}_${trade.from_address}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueTrades.push(trade);
    }
  }
  return uniqueTrades;
}

async function main() {
  const backtestExpId = 'd951c4b9-6f3a-4784-afd4-cf93525fc914';

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, created_at, metadata')
    .eq('experiment_id', backtestExpId)
    .eq('action', 'buy')
    .in('token_address', [...pumpAndDump, ...notPumpAndDump]);

  console.log('=== 完整区块号间隔分析 ===\n');
  console.log(`获取到 ${signals?.length || 0} 个信号\n`);

  const results = [];

  for (const signal of signals || []) {
    const tokenAddr = signal.token_address;
    const checkTime = Math.floor(new Date(signal.created_at).getTime() / 1000);
    const isPump = pumpAndDump.includes(tokenAddr);
    const symbol = signal.metadata?.symbol || tokenAddr.substring(0, 10);

    const trades = await fetchEarlyTrades(`${tokenAddr}_fo`, 'bsc', checkTime);

    if (trades.length < 2) {
      console.log(`${symbol}: 交易数不足，跳过`);
      continue;
    }

    const stats = calculateBlockGapStats(trades);

    results.push({
      token_address: tokenAddr,
      symbol: symbol,
      type: isPump ? 'pump' : 'normal',
      total_trades: trades.length,
      ...stats
    });

    console.log(`${symbol}: ${trades}笔, range=${stats.blockRange}, mean=${stats.blockGapMean}, stdDev=${stats.blockGapStdDev.toFixed(2)}, p75=${stats.blockGapP75}, gap0Ratio=${(stats.gap0Ratio*100).toFixed(1)}%`);

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // 生成CSV
  const headers = [
    'token_address',
    'symbol',
    'type',
    'total_trades',
    'total_gaps',
    'block_range',
    'block_gap_mean',
    'block_gap_std_dev',
    'block_gap_variance',
    'block_gap_min',
    'block_gap_max',
    'block_gap_p25',
    'block_gap_p50',
    'block_gap_p75',
    'block_gap_p90',
    'block_gap_p95',
    'gap_0_count',
    'gap_1_count',
    'gap_2_count',
    'gap_3_count',
    'gap_4to5_count',
    'gap_6to10_count',
    'gap_over10_count',
    'gap_0_ratio',
    'gap_1_ratio',
    'gap_2to3_ratio',
    'gap_over3_ratio',
    'concentration'
  ];

  const csvRows = [];
  csvRows.push(headers.join(','));

  results.forEach(r => {
    const row = [
      r.token_address,
      r.symbol,
      r.type,
      r.total_trades,
      r.totalGaps,
      r.blockRange,
      r.blockGapMean,
      r.blockGapStdDev,
      r.blockGapVariance,
      r.blockGapMin,
      r.blockGapMax,
      r.blockGapP25,
      r.blockGapP50,
      r.blockGapP75,
      r.blockGapP90,
      r.blockGapP95,
      r.gap0Count,
      r.gap1Count,
      r.gap2Count,
      r.gap3Count,
      r.gap4to5Count,
      r.gap6to10Count,
      r.gapOver10Count,
      r.gap0Ratio,
      r.gap1Ratio,
      r.gap2to3Ratio,
      r.gapOver3Ratio,
      r.concentration
    ];
    csvRows.push(row.join(','));
  });

  const csvContent = csvRows.join('\n');
  fs.writeFileSync('block_gap_complete_stats.csv', csvContent);

  console.log('\n=== 完成 ===');
  console.log(`CSV文件: block_gap_complete_stats.csv`);
  console.log(`共 ${results.length} 条记录`);

  // 分析
  const pumpResults = results.filter(r => r.type === 'pump');
  const normalResults = results.filter(r => r.type === 'normal');

  console.log('\n=== 统计对比 ===\n');

  const metrics = [
    { name: 'blockRange', label: '区块范围' },
    { name: 'blockGapMean', label: '平均间隔' },
    { name: 'blockGapStdDev', label: '标准差' },
    { name: 'blockGapP75', label: 'P75' },
    { name: 'gap0Ratio', label: 'gap=0比例' },
    { name: 'concentration', label: '集中度(gap<=1)' }
  ];

  metrics.forEach(m => {
    const pumpAvg = pumpResults.reduce((sum, r) => sum + r[m.name], 0) / pumpResults.length;
    const normalAvg = normalResults.reduce((sum, r) => sum + r[m.name], 0) / normalResults.length;
    const ratio = normalAvg / (pumpAvg || 0.001);
    console.log(`${m.label}: 拉砸=${pumpAvg.toFixed(2)}, 正常=${normalAvg.toFixed(2)}, 差异比=${ratio.toFixed(2)}x`);
  });

  // 测试检测效果
  console.log('\n=== 检测效果测试 ===\n');

  function testCondition(name, conditionFn) {
    const pumpRejected = pumpResults.filter(conditionFn).length;
    const normalRejected = normalResults.filter(conditionFn).length;
    const normalPass = normalResults.length - normalRejected;
    console.log(`${name}:`);
    console.log(`  拉砸拒绝: ${pumpRejected}/${pumpResults.length} (${(pumpRejected/pumpResults.length*100).toFixed(1)}%)`);
    console.log(`  正常通过: ${normalPass}/${normalResults.length} (${(normalPass/normalResults.length*100).toFixed(1)}%)`);
    console.log('');
  }

  testCondition('条件1: gap0Ratio > 0.30', r => r.gap0Ratio > 0.30);
  testCondition('条件2: blockGapP75 < 3', r => r.blockGapP75 < 3);
  testCondition('条件3: concentration > 0.50', r => r.concentration > 0.50);
  testCondition('条件4: blockGapStdDev < 1.5', r => r.blockGapStdDev < 1.5);
  testCondition('组合: (gap0Ratio > 0.30) AND (blockGapP75 < 3)', r => r.gap0Ratio > 0.30 && r.blockGapP75 < 3);
  testCondition('组合: (concentration > 0.50) AND (blockGapP75 < 4)', r => r.concentration > 0.50 && r.blockGapP75 < 4);
}

main().catch(console.error);
