/**
 * 生成所有代币的区块号间隔统计数据CSV
 */

const { createClient } = require('@supabase/supabase-js');
const { AveTxAPI } = require('./src/core/ave-api/tx-api');
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
    // 各种间隔的数量
    gap0Count: gaps.filter(g => g === 0).length,
    gap1Count: gaps.filter(g => g === 1).length,
    gap2Count: gaps.filter(g => g === 2).length,
    gap3Count: gaps.filter(g => g === 3).length,
    gap4Count: gaps.filter(g => g === 4).length,
    gap5Count: gaps.filter(g => g === 5).length,
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

  console.log(`获取到 ${signals?.length || 0} 个信号\n`);

  const results = [];

  for (const signal of signals || []) {
    const tokenAddr = signal.token_address;
    const checkTime = Math.floor(new Date(signal.created_at).getTime() / 1000);
    const isPump = pumpAndDump.includes(tokenAddr);
    const symbol = signal.metadata?.symbol || tokenAddr.substring(0, 8);

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

    console.log(`${symbol} (${isPump ? '拉砸' : '正常'}): ${trades}笔交易, blockGapMean=${stats.blockGapMean}, blockGapP75=${stats.blockGapP75}`);

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // 生成CSV
  const headers = [
    'token_address',
    'symbol',
    'type',
    'total_trades',
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
    'gap_4_count',
    'gap_5_count',
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
      r.total_trades,
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
      r.gap4Count,
      r.gap5Count,
      r.gap6to10Count,
      r.gapOver10Count
    ];
    csvRows.push(row.join(','));
  });

  const csvContent = csvRows.join('\n');
  const fs = require('fs');
  fs.writeFileSync('block_gap_stats.csv', csvContent);

  console.log('\nCSV文件已生成: block_gap_stats.csv');
  console.log(`共 ${results.length} 条记录`);
}

main().catch(console.error);
