/**
 * 修正后的第一区块价值占比计算
 * 确保获取代币创建后第一个有交易的区块
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

async function analyzeCorrectFirstBlock(tokenAddress) {
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

  console.log(`=== ${signal.metadata?.symbol || tokenAddress.substring(0, 8)} ===\n`);

  // 显示时间范围
  const firstTradeTime = uniqueTrades[0].time;
  const lastTradeTime = uniqueTrades[uniqueTrades.length - 1].time;
  console.log(`预期开始时间: ${expectedFirstTime} (${new Date(expectedFirstTime * 1000).toISOString()})`);
  console.log(`实际第一笔: ${firstTradeTime} (${new Date(firstTradeTime * 1000).toISOString()})`);
  console.log(`实际最后一笔: ${lastTradeTime} (${new Date(lastTradeTime * 1000).toISOString()})`);
  console.log(`延迟: ${firstTradeTime - expectedFirstTime}秒\n`);

  // 按时间排序，找到第一笔交易所在的区块
  const firstTradeBlock = uniqueTrades[0].block_number;

  // 计算该区块的交易额
  const firstBlockTrades = uniqueTrades.filter(t => t.block_number === firstTradeBlock);
  const firstBlockAmount = firstBlockTrades.reduce((sum, t) => sum + (t.from_usd || t.to_usd || 0), 0);
  const totalAmount = uniqueTrades.reduce((sum, t) => sum + (t.from_usd || t.to_usd || 0), 0);
  const firstBlockRatio = firstBlockAmount / totalAmount;

  console.log(`【按时间定义的第一区块】`);
  console.log(`第一笔交易所在区块: ${firstTradeBlock}`);
  console.log(`该区块交易数: ${firstBlockTrades.length}`);
  console.log(`该区块金额: $${firstBlockAmount.toFixed(2)}`);
  console.log(`总金额: $${totalAmount.toFixed(2)}`);
  console.log(`第一区块占比: ${(firstBlockRatio * 100).toFixed(1)}%\n`);

  // 对比：按区块号最小定义
  const blockAmounts = {};
  for (const trade of uniqueTrades) {
    const amount = trade.from_usd || trade.to_usd || 0;
    if (!blockAmounts[trade.block_number]) {
      blockAmounts[trade.block_number] = 0;
    }
    blockAmounts[trade.block_number] += amount;
  }

  const sortedBlocks = Object.keys(blockAmounts).map(Number).sort((a, b) => a - b);
  const minBlock = sortedBlocks[0];
  const minBlockAmount = blockAmounts[minBlock];

  console.log(`【按区块号最小定义的第一区块】`);
  console.log(`区块号最小的区块: ${minBlock}`);
  console.log(`金额: $${minBlockAmount.toFixed(2)}`);
  console.log(`占比: ${(minBlockAmount / totalAmount * 100).toFixed(1)}%\n`);

  // 检查是否一致
  if (firstTradeBlock === minBlock) {
    console.log(`✓ 两种定义一致`);
  } else {
    console.log(`⚠️  两种定义不一致！`);
    console.log(`   按时间: ${firstTradeBlock}, 按区块号: ${minBlock}`);
  }

  return {
    symbol: signal.metadata?.symbol || tokenAddress.substring(0, 8),
    firstBlockRatio,
    firstBlock: firstTradeBlock,
    firstBlockTrades: firstBlockTrades.length,
    firstBlockAmount,
    totalAmount,
  };
}

async function main() {
  const tokens = [
    '0x2be52e98e45ed3d27f56284972b3545dac964444',  // 逆克莱默
    '0x16aeb87aeb78e4cf7987f16e910c285d77354444',  // AGENTGDP
  ];

  for (const tokenAddr of tokens) {
    await analyzeCorrectFirstBlock(tokenAddr);
    console.log('\n' + '='.repeat(60) + '\n');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

main().catch(console.error);
