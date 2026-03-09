/**
 * 分析去掉小额交易后的区块号间隔
 * 小额交易定义: USD价值 < 10
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

// 小额交易阈值 (USD)
const LOW_VALUE_THRESHOLD = 10;

function calculateBlockGapStats(trades) {
  if (!trades || trades.length < 2) {
    return null;
  }

  const gaps = [];
  for (let i = 1; i < trades.length; i++) {
    const gap = trades[i].block_number - trades[i - 1].block_number;
    gaps.push(gap);
  }

  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const sum = gaps.reduce((a, b) => a + b, 0);
  const mean = sum / gaps.length;

  return {
    totalGaps: gaps.length,
    blockGapMean: parseFloat(mean.toFixed(2)),
    blockGapMin: Math.min(...gaps),
    blockGapMax: Math.max(...gaps),
    blockGapP25: sortedGaps[Math.floor(gaps.length * 0.25)],
    blockGapP50: sortedGaps[Math.floor(gaps.length * 0.50)],
    blockGapP75: sortedGaps[Math.floor(gaps.length * 0.75)],
    blockGapP90: sortedGaps[Math.floor(gaps.length * 0.90)],
    blockGapP95: sortedGaps[Math.floor(gaps.length * 0.95)],
    gap0Count: gaps.filter(g => g === 0).length,
    gap1Count: gaps.filter(g => g === 1).length,
    gap2Count: gaps.filter(g => g === 2).length,
    gap3Count: gaps.filter(g => g === 3).length,
    gap4to5Count: gaps.filter(g => g >= 4 && g <= 5).length,
    gap6to10Count: gaps.filter(g => g >= 6 && g <= 10).length,
    gapOver10Count: gaps.filter(g => g > 10).length
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

  console.log(`=== 去掉小额交易 (<$${LOW_VALUE_THRESHOLD})后的区块号间隔分析 ===\n`);
  console.log(`获取到 ${signals?.length || 0} 个信号\n`);

  const results = [];

  for (const signal of signals || []) {
    const tokenAddr = signal.token_address;
    const checkTime = Math.floor(new Date(signal.created_at).getTime() / 1000);
    const isPump = pumpAndDump.includes(tokenAddr);
    const symbol = signal.metadata?.symbol || tokenAddr.substring(0, 10);

    const allTrades = await fetchEarlyTrades(`${tokenAddr}_fo`, 'bsc', checkTime);

    // 过滤掉小额交易
    const filteredTrades = allTrades.filter(t => (t.from_usd || t.to_usd || 0) >= LOW_VALUE_THRESHOLD);
    const filteredCount = allTrades.length - filteredTrades.length;

    if (filteredTrades.length < 2) {
      console.log(`${symbol}: 过滤后交易数不足 (${filteredTrades.length})，跳过`);
      continue;
    }

    const stats = calculateBlockGapStats(filteredTrades);

    results.push({
      token_address: tokenAddr,
      symbol: symbol,
      type: isPump ? 'pump' : 'normal',
      original_trades: allTrades.length,
      filtered_trades: filteredTrades.length,
      filtered_out: filteredCount,
      filter_ratio: (filteredCount / allTrades.length).toFixed(2),
      ...stats
    });

    console.log(`${symbol}: ${allTrades.length}→${filteredTrades.length} (过滤${filteredCount}笔), blockGapMean=${stats.blockGapMean}, blockGapP75=${stats.blockGapP75}`);

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // 生成CSV
  const headers = [
    'token_address',
    'symbol',
    'type',
    'original_trades',
    'filtered_trades',
    'filtered_out',
    'filter_ratio',
    'total_gaps',
    'block_gap_mean',
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
    'gap_over10_count'
  ];

  const csvRows = [];
  csvRows.push(headers.join(','));

  results.forEach(r => {
    const row = [
      r.token_address,
      r.symbol,
      r.type,
      r.original_trades,
      r.filtered_trades,
      r.filtered_out,
      r.filter_ratio,
      r.totalGaps,
      r.blockGapMean,
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
      r.gapOver10Count
    ];
    csvRows.push(row.join(','));
  });

  const csvContent = csvRows.join('\n');
  fs.writeFileSync('block_gap_filtered.csv', csvContent);

  console.log('\n=== 完成 ===');
  console.log(`CSV文件: block_gap_filtered.csv`);
  console.log(`共 ${results.length} 条记录`);

  // 对比分析
  const pumpResults = results.filter(r => r.type === 'pump');
  const normalResults = results.filter(r => r.type === 'normal');

  const avgFilterPump = pumpResults.reduce((sum, r) => sum + parseFloat(r.filter_ratio), 0) / pumpResults.length;
  const avgFilterNormal = normalResults.reduce((sum, r) => sum + parseFloat(r.filter_ratio), 0) / normalResults.length;

  console.log(`\n=== 过滤比例分析 ===`);
  console.log(`拉砸代币平均过滤比例: ${(avgFilterPump * 100).toFixed(1)}%`);
  console.log(`正常代币平均过滤比例: ${(avgFilterNormal * 100).toFixed(1)}%`);

  // 统计不同区间的分布
  console.log(`\n=== blockGapP75 区间分布 ===`);
  console.log(`区间 | 拉砸 | 正常`);
  console.log(`-----|------|------`);

  const ranges = [
    { name: '<=2', min: 0, max: 2 },
    { name: '3', min: 3, max: 3 },
    { name: '4-5', min: 4, max: 5 },
    { name: '>=6', min: 6, max: Infinity }
  ];

  ranges.forEach(range => {
    const pumpCount = pumpResults.filter(r => r.blockGapP75 >= range.min && r.blockGapP75 <= range.max).length;
    const normalCount = normalResults.filter(r => r.blockGapP75 >= range.min && r.blockGapP75 <= range.max).length;
    console.log(`${range.name.padEnd(4)} | ${pumpCount}    | ${normalCount}`);
  });

  // 测试检测效果
  console.log(`\n=== 检测效果测试 (blockGapP75 < 3) ===`);

  const pumpRejected = pumpResults.filter(r => r.blockGapP75 < 3).length;
  const normalRejected = normalResults.filter(r => r.blockGapP75 < 3).length;
  const normalPass = normalResults.length - normalRejected;

  console.log(`拉砸拒绝: ${pumpRejected}/${pumpResults.length} (${(pumpRejected/pumpResults.length*100).toFixed(1)}%)`);
  console.log(`正常通过: ${normalPass}/${normalResults.length} (${(normalPass/normalResults.length*100).toFixed(1)}%)`);
}

main().catch(console.error);
