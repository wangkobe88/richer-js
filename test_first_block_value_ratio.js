/**
 * 测试第一区块价值占比作为检测因子
 */

const { createClient } = require('@supabase/supabase-js');
const { AveTxAPI } = require('./src/core/ave-api/tx-api');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const txApi = new AveTxAPI(
  process.env.AVE_API_BASE_URL || 'https://prod.ave-api.com',
  30000,
  process.env.AVE_API_KEY
);

const pumpTokens = [
  '0x2be52e98e45ed3d27f56284972b3545dac964444',  // 逆克莱默
  '0x281f05868b5ba9e55869541a117ebb661f474444',  // 宝贝龙虾
  '0xf3372a3dbc824f0b0044ca77209559514b294444',  // GLUBSCHIS
  '0xb9b1142a28fade5771b7ae076c96c3bee8beffff',  // 龙虾基金
  '0xd8d4ddeb91987a121422567260a88230dbb34444',  // CTO
  '0x68b04d6e06495866cc810d4179caf97651a5ffff',  // NINA基金会
  '0x98fe71847aa16d9e40a4f0e123d172bc71d14444',  // 虾头男
];

const normalTokens = [
  '0x16aeb87aeb78e4cf7987f16e910c285d77354444',  // AGENTGDP
  '0x343aa540ca10b117a70e14f0bd592c860fb64444',  // 来宝
];

async function analyzeFirstBlockValueRatio(tokenAddress) {
  const { data: signal } = await supabase
    .from('strategy_signals')
    .select('metadata')
    .eq('experiment_id', 'd951c4b9-6f3a-4784-afd4-cf93525fc914')
    .eq('token_address', tokenAddress)
    .eq('action', 'buy')
    .single();

  if (!signal) return null;

  const factors = signal.metadata?.preBuyCheckFactors;
  if (!factors) return null;

  const expectedFirstTime = factors.earlyTradesExpectedFirstTime;
  const targetToTime = expectedFirstTime + 90;

  const innerPair = `${tokenAddress}_fo`;
  const pairId = `${innerPair}-bsc`;

  const allTrades = [];
  let currentToTime = targetToTime;

  for (let loop = 1; loop <= 10; loop++) {
    try {
      const trades = await txApi.getSwapTransactions(
        pairId, 300, expectedFirstTime, currentToTime, 'asc'
      );
      if (trades.length === 0) break;
      allTrades.push(...trades);
      if (trades[0].time <= expectedFirstTime || trades.length < 300) break;
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

  if (uniqueTrades.length === 0) return null;

  // 计算总金额
  const totalAmount = uniqueTrades.reduce((sum, t) => sum + (t.from_usd || t.to_usd || 0), 0);

  // 按区块分组计算金额
  const blockAmounts = {};
  for (const trade of uniqueTrades) {
    const amount = trade.from_usd || trade.to_usd || 0;
    if (!blockAmounts[trade.block_number]) {
      blockAmounts[trade.block_number] = 0;
    }
    blockAmounts[trade.block_number] += amount;
  }

  // 找出第一个区块（按区块号排序）
  const sortedBlocks = Object.keys(blockAmounts).map(Number).sort((a, b) => a - b);
  const firstBlock = sortedBlocks[0];
  const firstBlockAmount = blockAmounts[firstBlock];
  const firstBlockRatio = firstBlockAmount / totalAmount;

  return {
    symbol: signal.metadata?.symbol || tokenAddress.substring(0, 8),
    totalAmount,
    firstBlock,
    firstBlockAmount,
    firstBlockRatio,
  };
}

async function main() {
  console.log('=== 测试第一区块价值占比 ===\n');

  const pumpResults = [];
  for (const tokenAddr of pumpTokens) {
    const result = await analyzeFirstBlockValueRatio(tokenAddr);
    if (result) pumpResults.push(result);
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  const normalResults = [];
  for (const tokenAddr of normalTokens) {
    const result = await analyzeFirstBlockValueRatio(tokenAddr);
    if (result) normalResults.push(result);
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log('【拉盘代币】\n');
  pumpResults.forEach(r => {
    console.log(`${r.symbol.padEnd(12)} 第一区块: ${r.firstBlock} 金额: $${r.firstBlockAmount.toFixed(2)} 占比: ${(r.firstBlockRatio * 100).toFixed(1)}%`);
  });

  console.log('\n【正常代币】\n');
  normalResults.forEach(r => {
    console.log(`${r.symbol.padEnd(12)} 第一区块: ${r.firstBlock} 金额: $${r.firstBlockAmount.toFixed(2)} 占比: ${(r.firstBlockRatio * 100).toFixed(1)}%`);
  });

  // 测试不同阈值
  console.log('\n【测试不同阈值】\n');

  function testThreshold(threshold, results) {
    return results.filter(r => r.firstBlockRatio >= threshold).length;
  }

  const thresholds = [0.05, 0.08, 0.10, 0.12, 0.15, 0.18];

  console.log('阈值 | 拉盘拦截 | 正常误伤');
  console.log('-----|---------|--------');

  thresholds.forEach(t => {
    const pumpBlocked = testThreshold(t, pumpResults);
    const normalBlocked = testThreshold(t, normalResults);
    console.log(`${(t * 100).toFixed(0).padStart(3)}% | ${pumpBlocked}/${pumpResults.length} | ${normalBlocked}/${normalResults.length}`);
  });

  // 推荐阈值
  console.log('\n【推荐】\n');

  const threshold15 = testThreshold(0.15, pumpResults);
  const threshold15Normal = testThreshold(0.15, normalResults);

  console.log(`阈值15%:`);
  console.log(`  拉盘代币: ${threshold15}/${pumpResults.length} 被拦截`);
  console.log(`  正常代币: ${threshold15Normal}/${normalResults.length} 被误伤`);

  if (threshold15Normal === 0) {
    console.log(`  → 可以使用阈值15%，不会误伤正常代币`);
  } else {
    console.log(`  → 阈值15%会误伤正常代币，建议调整`);
  }
}

main().catch(console.error);
