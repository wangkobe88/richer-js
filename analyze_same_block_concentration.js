/**
 * 分析同一区块捆绑交易的特征
 * 重点: 0x2be52e98e45ed3d27f56284972b3545dac964444 (逆克莱默)
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

async function analyzeSameBlockTrades(tokenAddress, symbol) {
  console.log(`=== 分析 ${symbol} 的同一区块交易特征 ===\n`);

  // 获取信号时间
  const { data: signal } = await supabase
    .from('strategy_signals')
    .select('created_at, metadata')
    .eq('experiment_id', 'd951c4b9-6f3a-4784-afd4-cf93525fc914')
    .eq('token_address', tokenAddress)
    .eq('action', 'buy')
    .single();

  if (!signal) {
    console.log('未找到信号');
    return;
  }

  const checkTime = Math.floor(new Date(signal.created_at).getTime() / 1000);
  const targetFromTime = checkTime - 90;

  console.log(`检查时间: ${checkTime} (${new Date(signal.created_at).toISOString()})`);
  console.log(`回溯窗口: ${targetFromTime} - ${checkTime} (90秒)\n`);

  // 获取交易数据
  const innerPair = `${tokenAddress}_fo`;
  const pairId = `${innerPair}-bsc`;

  const allTrades = [];
  let currentToTime = checkTime;

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

  console.log(`总交易数: ${uniqueTrades.length}\n`);

  // 按区块分组
  const blockGroups = {};

  for (const trade of uniqueTrades) {
    const block = trade.block_number;
    if (!blockGroups[block]) {
      blockGroups[block] = [];
    }
    blockGroups[block].push(trade);
  }

  // 排序区块
  const sortedBlocks = Object.keys(blockGroups).map(Number).sort((a, b) => a - b);

  console.log(`涉及区块数: ${sortedBlocks.length}`);
  console.log(`区块范围: ${sortedBlocks[0]} - ${sortedBlocks[sortedBlocks.length - 1]}\n`);

  // 分析每个区块
  console.log('【按区块分析】\n');

  const blockAnalysis = [];

  for (const block of sortedBlocks) {
    const trades = blockGroups[block];
    const wallets = new Set();
    let totalAmount = 0;

    trades.forEach(t => {
      if (t.from_address) wallets.add(t.from_address.toLowerCase());
      if (t.to_address) wallets.add(t.to_address.toLowerCase());
      totalAmount += (t.from_usd || t.to_usd || 0);
    });

    const avgAmount = totalAmount / trades.length;

    blockAnalysis.push({
      block,
      tradeCount: trades.length,
      walletCount: wallets.size,
      totalAmount,
      avgAmount,
      walletPerTrade: wallets.size / trades.length
    });

    console.log(`区块 ${block}:`);
    console.log(`  交易数: ${trades.length}`);
    console.log(`  独立钱包: ${wallets.size}`);
    console.log(`  总金额: $${totalAmount.toFixed(2)}`);
    console.log(`  平均金额: $${avgAmount.toFixed(2)}`);
    console.log(`  钱包/交易: ${(wallets.size / trades.length).toFixed(2)}`);
    console.log('');
  }

  // 找出最大簇
  const maxBlock = blockAnalysis.sort((a, b) => b.tradeCount - a.tradeCount)[0];

  console.log('【最大区块簇】\n');
  console.log(`区块 ${maxBlock.block}:`);
  console.log(`  交易数: ${maxBlock.tradeCount}`);
  console.log(`  独立钱包: ${maxBlock.walletCount}`);
  console.log(`  占总交易: ${(maxBlock.tradeCount / uniqueTrades.length * 100).toFixed(1)}%`);
  console.log(`  钱包集中度: ${maxBlock.walletCount}/${maxBlock.tradeCount} = ${(maxBlock.walletCount / maxBlock.tradeCount * 100).toFixed(1)}%`);

  // 计算前N个区块的占比
  console.log('\n【前N个区块集中度】\n');

  const sortedByTrade = [...blockAnalysis].sort((a, b) => b.tradeCount - a.tradeCount);
  let cumulativeTrades = 0;
  let cumulativeBlocks = 0;

  for (let i = 0; i < sortedByTrade.length; i++) {
    cumulativeTrades += sortedByTrade[i].tradeCount;
    cumulativeBlocks = i + 1;
    const ratio = cumulativeTrades / uniqueTrades.length;

    console.log(`前${cumulativeBlocks}个区块: ${cumulativeTrades}笔交易 (${(ratio * 100).toFixed(1)}%)`);

    if (ratio >= 0.5) {
      console.log(`  → 前${cumulativeBlocks}个区块占了一半以上的交易`);
      break;
    }
  }

  // 检测同一区块高集中度
  console.log('\n【检测同一区块高集中度】\n');

  const maxBlockRatio = maxBlock.tradeCount / uniqueTrades.length;
  const maxBlockWalletConcentration = maxBlock.walletCount / maxBlock.tradeCount;

  console.log(`最大区块交易占比: ${(maxBlockRatio * 100).toFixed(1)}%`);
  console.log(`最大区块钱包集中度: ${(maxBlockWalletConcentration * 100).toFixed(1)}%`);

  // 判断是否异常
  const isAnomalous = maxBlockRatio > 0.3 && maxBlockWalletConcentration < 0.5;

  console.log('\n【结论】\n');
  if (isAnomalous) {
    console.log('⚠️  检测到异常模式：');
    console.log('   - 单个区块占比超过30%');
    console.log('   - 钱包集中度低于50%（说明是少数钱包控制了大量交易）');
    console.log('   - 这可能是同一区块捆绑交易拿大量筹码的迹象');
  } else {
    console.log('✓ 未检测到明显的同一区块捆绑模式');
  }

  return {
    totalTrades: uniqueTrades.length,
    totalBlocks: sortedBlocks.length,
    blockAnalysis,
    maxBlock,
    isAnomalous
  };
}

async function main() {
  const targetToken = '0x2be52e98e45ed3d27f56284972b3545dac964444';

  await analyzeSameBlockTrades(targetToken, '逆克莱默');
}

main().catch(console.error);
