/**
 * 分析区块85547523的交易详情
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

async function analyzeBlockDetail(tokenAddress) {
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

  // 按区块分组
  const blockGroups = {};
  for (const trade of uniqueTrades) {
    const block = trade.block_number;
    if (!blockGroups[block]) {
      blockGroups[block] = [];
    }
    blockGroups[block].push(trade);
  }

  // 找出85547523区块
  const targetBlock = blockGroups['85547523'];
  if (!targetBlock) {
    console.log('未找到区块85547523');
    return;
  }

  console.log(`=== 区块85547523详细分析 ===\n`);
  console.log(`交易数: ${targetBlock.length}`);
  console.log(`\n【交易详情】\n`);

  // 按时间排序
  targetBlock.sort((a, b) => a.time - b.time);

  targetBlock.forEach((trade, idx) => {
    console.log(`#${idx + 1} 时间${trade.time}:`);
    console.log(`  钱包: ${trade.from_address}`);
    console.log(`  金额: $${(trade.from_usd || trade.to_usd || 0).toFixed(2)}`);
    console.log(`  TxID: ${trade.tx_id}`);
    console.log('');
  });

  // 统计分析
  const amounts = targetBlock.map(t => t.from_usd || t.to_usd || 0);
  const totalAmount = amounts.reduce((a, b) => a + b, 0);
  const avgAmount = totalAmount / targetBlock.length;
  const maxAmount = Math.max(...amounts);
  const minAmount = Math.min(...amounts);

  console.log('【统计分析】\n');
  console.log(`总金额: $${totalAmount.toFixed(2)}`);
  console.log(`平均金额: $${avgAmount.toFixed(2)}`);
  console.log(`最大金额: $${maxAmount.toFixed(2)}`);
  console.log(`最小金额: $${minAmount.toFixed(2)}`);
  console.log(`金额标准差: ${Math.sqrt(amounts.map(a => Math.pow(a - avgAmount, 2)).reduce((a, b) => a + b, 0) / targetBlock.length).toFixed(2)}`);

  // 时间间隔分析
  const timeGaps = [];
  for (let i = 1; i < targetBlock.length; i++) {
    timeGaps.push(targetBlock[i].time - targetBlock[i - 1].time);
  }

  console.log(`\n时间间隔:`);
  console.log(`  平均间隔: ${(timeGaps.reduce((a, b) => a + b, 0) / timeGaps.length).toFixed(2)}秒`);
  console.log(`  最大间隔: ${Math.max(...timeGaps)}秒`);
  console.log(`  最小间隔: ${Math.min(...timeGaps)}秒`);

  // 检查是否有规律模式
  console.log(`\n【模式分析】\n`);

  // 1. 金额相似度
  const amountVariation = maxAmount / minAmount;
  console.log(`金额变异系数: ${amountVariation.toFixed(2)}x (${minAmount < 5 ? '小额交易较多' : '金额较均匀'})`);

  // 2. 时间集中度
  const timeSpan = targetBlock[targetBlock.length - 1].time - targetBlock[0].time;
  console.log(`时间跨度: ${timeSpan}秒`);

  if (timeSpan < 1) {
    console.log(`→ 非常集中（可能同一秒内）`);
  } else if (timeSpan < 3) {
    console.log(`→ 高度集中`);
  } else {
    console.log(`→ 分散在${timeSpan}秒内`);
  }

  // 3. 钱包地址分析
  const wallets = targetBlock.map(t => t.from_address);
  const uniqueWallets = [...new Set(wallets)];
  console.log(`\n独立钱包数: ${uniqueWallets.length}/${targetBlock.length}`);

  // 4. 与其他区块对比
  console.log(`\n【与其他区块对比】\n`);

  const sortedBlocks = Object.keys(blockGroups)
    .map(Number)
    .sort((a, b) => blockGroups[b].length - blockGroups[a].length);

  console.log(`最大区块排名: #1 (共${sortedBlocks.length}个区块)`);
  console.log(`第二大区块: ${sortedBlocks[1]} 有 ${blockGroups[sortedBlocks[1]].length} 笔交易`);
  console.log(`第三大区块: ${sortedBlocks[2]} 有 ${blockGroups[sortedBlocks[2]].length} 笔交易`);

  const secondMaxSize = blockGroups[sortedBlocks[1]].length;
  const ratio = targetBlock.length / secondMaxSize;
  console.log(`\n最大/第二大比例: ${ratio.toFixed(2)}x`);

  if (ratio > 2) {
    console.log(`→ 第一个区块明显大于其他区块，可能是异常集中`);
  } else {
    console.log(`→ 区块大小差异不大`);
  }
}

async function main() {
  await analyzeBlockDetail('0x2be52e98e45ed3d27f56284972b3545dac964444');
}

main().catch(console.error);
