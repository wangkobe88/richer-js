/**
 * 对比拉盘代币和正常代币的区块交易分布
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
];

const normalTokens = [
  '0x16aeb87aeb78e4cf7987f16e910c285d77354444',  // WorkBuddy
  '0x343aa540ca10b117a70e14f0bd592c860fb64444',  // 来宝
];

async function analyzeBlockDistribution(tokenAddress) {
  // 获取信号数据
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

  // 获取交易数据
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

  // 去重
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

  // 按区块分组
  const blockGroups = {};

  for (const trade of uniqueTrades) {
    const block = trade.block_number;
    if (!blockGroups[block]) {
      blockGroups[block] = [];
    }
    blockGroups[block].push(trade);
  }

  // 计算区块分布统计
  const blockSizes = Object.values(blockGroups).map(trades => trades.length);
  const maxBlockSize = Math.max(...blockSizes);
  const totalBlocks = blockSizes.length;
  const avgBlockSize = uniqueTrades.length / totalBlocks;
  const maxBlockRatio = maxBlockSize / uniqueTrades.length;

  // 计算Gini系数（衡量集中度）
  const sortedSizes = [...blockSizes].sort((a, b) => a - b);
  const n = sortedSizes.length;
  let giniSum = 0;
  for (let i = 0; i < n; i++) {
    giniSum += (2 * (i + 1) - n - 1) * sortedSizes[i];
  }
  const gini = giniSum / (n * sortedSizes.reduce((a, b) => a + b, 0));

  return {
    symbol: signal.metadata?.symbol || tokenAddress.substring(0, 8),
    totalTrades: uniqueTrades.length,
    totalBlocks,
    maxBlockSize,
    avgBlockSize,
    maxBlockRatio,
    gini,
    blockSizes: sortedSizes.slice(-5).reverse() // 前5个最大区块
  };
}

async function main() {
  console.log('=== 对比拉盘代币 vs 正常代币的区块分布 ===\n');

  console.log('【拉盘代币】\n');
  const pumpResults = [];
  for (const tokenAddr of pumpTokens) {
    const result = await analyzeBlockDistribution(tokenAddr);
    if (result) {
      pumpResults.push(result);
      console.log(`${result.symbol}:`);
      console.log(`  总交易: ${result.totalTrades}, 区块数: ${result.totalBlocks}`);
      console.log(`  平均每区块: ${result.avgBlockSize.toFixed(1)}笔`);
      console.log(`  最大区块: ${result.maxBlockSize}笔 (${(result.maxBlockRatio * 100).toFixed(1)}%)`);
      console.log(`  Gini系数: ${result.gini.toFixed(3)} (0=均匀, 1=集中)`);
      console.log(`  前5大区块: [${result.blockSizes.join(', ')}]`);
      console.log('');
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('【正常代币】\n');
  const normalResults = [];
  for (const tokenAddr of normalTokens) {
    const result = await analyzeBlockDistribution(tokenAddr);
    if (result) {
      normalResults.push(result);
      console.log(`${result.symbol}:`);
      console.log(`  总交易: ${result.totalTrades}, 区块数: ${result.totalBlocks}`);
      console.log(`  平均每区块: ${result.avgBlockSize.toFixed(1)}笔`);
      console.log(`  最大区块: ${result.maxBlockSize}笔 (${(result.maxBlockRatio * 100).toFixed(1)}%)`);
      console.log(`  Gini系数: ${result.gini.toFixed(3)} (0=均匀, 1=集中)`);
      console.log(`  前5大区块: [${result.blockSizes.join(', ')}]`);
      console.log('');
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('【统计对比】\n');
  const avgPumpMaxRatio = pumpResults.reduce((sum, r) => sum + r.maxBlockRatio, 0) / pumpResults.length;
  const avgNormalMaxRatio = normalResults.reduce((sum, r) => sum + r.maxBlockRatio, 0) / normalResults.length;
  const avgPumpGini = pumpResults.reduce((sum, r) => sum + r.gini, 0) / pumpResults.length;
  const avgNormalGini = normalResults.reduce((sum, r) => sum + r.gini, 0) / normalResults.length;

  console.log(`平均最大区块占比:`);
  console.log(`  拉盘代币: ${(avgPumpMaxRatio * 100).toFixed(1)}%`);
  console.log(`  正常代币: ${(avgNormalMaxRatio * 100).toFixed(1)}%`);
  console.log('');
  console.log(`平均Gini系数:`);
  console.log(`  拉盘代币: ${avgPumpGini.toFixed(3)}`);
  console.log(`  正常代币: ${avgNormalGini.toFixed(3)}`);
}

main().catch(console.error);
