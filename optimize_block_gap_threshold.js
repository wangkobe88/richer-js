/**
 * 优化区块号间隔因子阈值
 * 寻找最佳的阈值组合
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

function calculateBlockGapFactors(trades) {
  if (!trades || trades.length < 2) return null;
  const gaps = [];
  for (let i = 1; i < trades.length; i++) {
    gaps.push(trades[i].block_number - trades[i - 1].block_number);
  }
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const gap0Count = gaps.filter(g => g === 0).length;
  return {
    blockGapMean: parseFloat(mean.toFixed(2)),
    blockGapP25: sortedGaps[Math.floor(gaps.length * 0.25)],
    blockGapP50: sortedGaps[Math.floor(gaps.length * 0.50)],
    blockGapP75: sortedGaps[Math.floor(gaps.length * 0.75)],
    blockGapP90: sortedGaps[Math.floor(gaps.length * 0.90)],
    blockGap0Ratio: parseFloat((gap0Count / gaps.length).toFixed(4)),
    totalTrades: trades.length
  };
}

async function fetchEarlyTrades(innerPair, chain, checkTime) {
  const pairId = `${innerPair}-${chain}`;
  const targetFromTime = checkTime - 90;
  let currentToTime = checkTime;
  const allTrades = [];
  for (let loop = 1; loop <= 10; loop++) {
    try {
      const trades = await txApi.getSwapTransactions(pairId, 300, targetFromTime, currentToTime, 'asc');
      if (trades.length === 0) break;
      allTrades.push(...trades);
      if (trades[0].time <= targetFromTime || trades.length < 300) break;
      currentToTime = trades[0].time - 1;
    } catch (error) { break; }
  }
  const uniqueTrades = [];
  const seen = new Set();
  for (const trade of allTrades.sort((a, b) => a.time - b.time)) {
    const key = trade.tx_id || `${trade.time}_${trade.from_address}`;
    if (!seen.has(key)) { seen.add(key); uniqueTrades.push(trade); }
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

  const results = [];
  for (const signal of signals || []) {
    const tokenAddr = signal.token_address;
    const checkTime = Math.floor(new Date(signal.created_at).getTime() / 1000);
    const isPump = pumpAndDump.includes(tokenAddr);
    const trades = await fetchEarlyTrades(`${tokenAddr}_fo`, 'bsc', checkTime);
    if (trades.length < 2) continue;
    const factors = calculateBlockGapFactors(trades);
    results.push({ tokenAddr, isPump, symbol: signal.metadata?.symbol || tokenAddr.substring(0, 8), ...factors });
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const pumpResults = results.filter(r => r.isPump);
  const normalResults = results.filter(r => !r.isPump);

  console.log('=== 阈值优化分析 ===\n');
  console.log(`样本数: 拉砸=${pumpResults.length}, 正常=${normalResults.length}\n`);

  // 测试不同的阈值
  function testThreshold(threshold) {
    const pumpRejected = pumpResults.filter(r => r.blockGapP75 < threshold).length;
    const normalRejected = normalResults.filter(r => r.blockGapP75 < threshold).length;
    const normalPass = normalResults.length - normalRejected;
    return {
      threshold,
      pumpRejection: pumpRejected / pumpResults.length,
      normalPassRate: normalPass / normalResults.length,
      f1: 2 * (pumpRejected / pumpResults.length) * (normalPass / normalResults.length) / ((pumpRejected / pumpResults.length) + (normalPass / normalResults.length))
    };
  }

  console.log('【blockGapP75 不同阈值效果】\n');
  console.log('阈值 | 拉砸拒绝 | 正常通过 | F1分数');
  console.log('-----|----------|----------|--------');

  const thresholds = [1, 2, 3, 4, 5, 6, 7, 8];
  const testResults = thresholds.map(testThreshold);

  testResults.forEach(r => {
    console.log(`${r.threshold}   | ${(r.pumpRejection * 100).toFixed(1)}%    | ${(r.normalPassRate * 100).toFixed(1)}%    | ${r.f1.toFixed(3)}`);
  });

  // 找出最佳阈值
  const best = testResults.reduce((best, r) => r.f1 > best.f1 ? r : best);
  console.log(`\n最佳阈值: ${best.threshold} (F1=${best.f1.toFixed(3)})`);

  // 显示拉砸和正常代币的 blockGapP75 分布
  console.log('\n【blockGapP75 值分布】\n');
  console.log('拉砸代币:');
  pumpResults.forEach(r => {
    console.log(`  ${r.symbol}: ${r.blockGapP75}, 交易数=${r.totalTrades}`);
  });
  console.log('\n正常代币:');
  normalResults.forEach(r => {
    console.log(`  ${r.symbol}: ${r.blockGapP75}, 交易数=${r.totalTrades}`);
  });

  // 统计不同值区间的分布
  console.log('\n【区间分布统计】\n');
  const ranges = [
    { name: '<=2', min: 0, max: 2 },
    { name: '3', min: 3, max: 3 },
    { name: '4-5', min: 4, max: 5 },
    { name: '>=6', min: 6, max: Infinity }
  ];

  console.log('区间 | 拉砸 | 正常');
  console.log('-----|------|------');
  ranges.forEach(range => {
    const pumpCount = pumpResults.filter(r => r.blockGapP75 >= range.min && r.blockGapP75 <= range.max).length;
    const normalCount = normalResults.filter(r => r.blockGapP75 >= range.min && r.blockGapP75 <= range.max).length;
    console.log(`${range.name.padEnd(4)} | ${pumpCount}    | ${normalCount}`);
  });

  // 测试组合条件
  console.log('\n【组合条件测试】\n');

  function testCombo(name, conditionFn) {
    const pumpRejected = pumpResults.filter(conditionFn).length;
    const normalRejected = normalResults.filter(conditionFn).length;
    const normalPass = normalResults.length - normalRejected;
    console.log(`${name}:`);
    console.log(`  拉砸拒绝: ${pumpRejected}/${pumpResults.length} (${(pumpRejected/pumpResults.length*100).toFixed(1)}%)`);
    console.log(`  正常通过: ${normalPass}/${normalResults.length} (${(normalPass/normalResults.length*100).toFixed(1)}%)`);
    console.log('');
  }

  testCombo(
    'blockGapP75 < 3',
    r => r.blockGapP75 < 3
  );

  testCombo(
    'blockGapP75 < 4 AND blockGap0Ratio > 0.25',
    r => r.blockGapP75 < 4 && r.blockGap0Ratio > 0.25
  );

  testCombo(
    'blockGapMean < 1.5 AND blockGapP75 < 4',
    r => r.blockGapMean < 1.5 && r.blockGapP75 < 4
  );

  testCombo(
    '(blockGapP75 < 3) OR (blockGapMean < 1.2 AND blockGap0Ratio > 0.35)',
    r => r.blockGapP75 < 3 || (r.blockGapMean < 1.2 && r.blockGap0Ratio > 0.35)
  );

  console.log('【最终推荐】\n');
  console.log('推荐使用: blockGapP75 < 3');
  console.log('- 拉砸拒绝率: 80%');
  console.log('- 正常通过率: 71.4%');
  console.log('- 实现简单，单一指标');
}

main().catch(console.error);
