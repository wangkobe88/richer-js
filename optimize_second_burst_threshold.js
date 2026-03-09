/**
 * 优化"同一秒爆发"检测阈值
 * 对比拉盘代币和正常代币
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

async function analyzeToken(tokenAddress) {
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

  if (uniqueTrades.length < 2) return null;

  // 按秒分组
  const secondGroups = {};
  for (const trade of uniqueTrades) {
    if (!secondGroups[trade.time]) {
      secondGroups[trade.time] = [];
    }
    secondGroups[trade.time].push(trade);
  }

  const sortedSeconds = Object.keys(secondGroups).map(Number).sort((a, b) => secondGroups[b].length - secondGroups[a].length);

  // 按区块分组
  const blockGroups = {};
  for (const trade of uniqueTrades) {
    if (!blockGroups[trade.block_number]) {
      blockGroups[trade.block_number] = [];
    }
    blockGroups[trade.block_number].push(trade);
  }

  const sortedBlocks = Object.keys(blockGroups).map(Number).sort((a, b) => blockGroups[b].length - blockGroups[a].length);

  return {
    symbol: signal.metadata?.symbol || tokenAddress.substring(0, 8),
    maxSecondTrades: secondGroups[sortedSeconds[0]].length,
    maxSecondRatio: secondGroups[sortedSeconds[0]].length / uniqueTrades.length,
    maxBlockTrades: blockGroups[sortedBlocks[0]].length,
    maxBlockRatio: blockGroups[sortedBlocks[0]].length / uniqueTrades.length,
    secondMaxBlockTrades: sortedBlocks.length > 1 ? blockGroups[sortedBlocks[1]].length : 0,
    totalTrades: uniqueTrades.length,
  };
}

async function main() {
  console.log('=== 优化"同一秒爆发"检测阈值 ===\n');

  const pumpResults = [];
  for (const tokenAddr of pumpTokens) {
    const result = await analyzeToken(tokenAddr);
    if (result) pumpResults.push(result);
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  const normalResults = [];
  for (const tokenAddr of normalTokens) {
    const result = await analyzeToken(tokenAddr);
    if (result) normalResults.push(result);
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  // 计算最大/第二大比例
  pumpResults.forEach(r => {
    r.maxBlockToSecondRatio = r.secondMaxBlockTrades > 0 ? r.maxBlockTrades / r.secondMaxBlockTrades : 1;
  });
  normalResults.forEach(r => {
    r.maxBlockToSecondRatio = r.secondMaxBlockTrades > 0 ? r.maxBlockTrades / r.secondMaxBlockTrades : 1;
  });

  console.log('【拉盘代币】\n');
  pumpResults.forEach(r => {
    const maxBlockToSecondRatio = r.secondMaxBlockTrades > 0 ? (r.maxBlockTrades / r.secondMaxBlockTrades).toFixed(2) : 'N/A';
    console.log(`${r.symbol.padEnd(12)} 最大秒:${r.maxSecondTrades}笔 最大区块:${r.maxBlockTrades}笔 (${(r.maxBlockRatio * 100).toFixed(1)}%) 最大/第二大:${maxBlockToSecondRatio}x`);
  });

  console.log('\n【正常代币】\n');
  normalResults.forEach(r => {
    const maxBlockToSecondRatio = r.secondMaxBlockTrades > 0 ? (r.maxBlockTrades / r.secondMaxBlockTrades).toFixed(2) : 'N/A';
    console.log(`${r.symbol.padEnd(12)} 最大秒:${r.maxSecondTrades}笔 最大区块:${r.maxBlockTrades}笔 (${(r.maxBlockRatio * 100).toFixed(1)}%) 最大/第二大:${maxBlockToSecondRatio}x`);
  });

  // 测试不同阈值
  console.log('\n【测试不同阈值】\n');

  function evaluate(thresholds, results) {
    const filtered = results.filter(r => {
      if (thresholds.maxSecondTrades && r.maxSecondTrades < thresholds.maxSecondTrades) return false;
      if (thresholds.maxBlockRatio && r.maxBlockRatio < thresholds.maxBlockRatio) return false;
      if (thresholds.maxBlockToSecondRatio && r.maxBlockToSecondRatio < thresholds.maxBlockToSecondRatio) return false;
      return true;
    });
    return filtered.length;
  }

  const testCases = [
    { name: '同一秒>=5', thresholds: { maxSecondTrades: 5 } },
    { name: '同一秒>=8', thresholds: { maxSecondTrades: 8 } },
    { name: '同一秒>=10', thresholds: { maxSecondTrades: 10 } },
    { name: '区块占比>10%', thresholds: { maxBlockRatio: 0.1 } },
    { name: '区块占比>5%', thresholds: { maxBlockRatio: 0.05 } },
    { name: '最大/第二大>2', thresholds: { maxBlockToSecondRatio: 2 } },
    { name: '最大/第二大>3', thresholds: { maxBlockToSecondRatio: 3 } },
    { name: '组合: 同一秒>=8 && 区块占比>5%', thresholds: { maxSecondTrades: 8, maxBlockRatio: 0.05 } },
    { name: '组合: 同一秒>=5 && 最大/第二大>2', thresholds: { maxSecondTrades: 5, maxBlockToSecondRatio: 2 } },
    { name: '组合: 区块占比>10% && 最大/第二大>2', thresholds: { maxBlockRatio: 0.1, maxBlockToSecondRatio: 2 } },
  ];

  console.log('条件名称                          | 拉盘拦截 | 正常误伤');
  console.log('--------------------------------|---------|--------');

  testCases.forEach(tc => {
    const pumpBlocked = evaluate(tc.thresholds, pumpResults);
    const normalBlocked = evaluate(tc.thresholds, normalResults);
    const pumpBlockRate = (pumpBlocked / pumpResults.length * 100).toFixed(0);
    const normalBlockRate = (normalBlocked / normalResults.length * 100).toFixed(0);

    console.log(`${tc.name.padEnd(32)} | ${pumpBlocked.toString().padStart(2)}/${pumpResults.length} (${pumpBlockRate}%) | ${normalBlocked.toString().padStart(1)}/${normalResults.length} (${normalBlockRate}%)`);
  });
}

main().catch(console.error);
