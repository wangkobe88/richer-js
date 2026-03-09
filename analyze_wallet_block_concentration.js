/**
 * 分析同一区块内钱包的交易集中度
 * 检查是否有钱包在同一区块进行了多笔交易（捆绑买入）
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

async function analyzeWalletBlockConcentration(tokenAddress, symbol) {
  console.log(`=== 分析 ${symbol} 的同一区块钱包交易集中度 ===\n`);

  // 获取信号时间
  const { data: signal } = await supabase
    .from('strategy_signals')
    .select('created_at')
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

  // 按区块分组，并统计每个区块内的钱包交易次数
  const blockWalletStats = {};

  for (const trade of uniqueTrades) {
    const block = trade.block_number;
    const wallet = (trade.from_address || '').toLowerCase();

    if (!blockWalletStats[block]) {
      blockWalletStats[block] = {};
    }

    if (!blockWalletStats[block][wallet]) {
      blockWalletStats[block][wallet] = 0;
    }

    blockWalletStats[block][wallet]++;
  }

  // 找出每个区块内交易最多的钱包
  console.log('【同一区块内钱包交易次数】\n');

  const blockMaxWallets = [];

  for (const block in blockWalletStats) {
    const wallets = blockWalletStats[block];
    let maxCount = 0;
    let maxWallet = null;
    let totalWallets = Object.keys(wallets).length;
    let totalTradesInBlock = 0;

    for (const wallet in wallets) {
      totalTradesInBlock += wallets[wallet];
      if (wallets[wallet] > maxCount) {
        maxCount = wallets[wallet];
        maxWallet = wallet;
      }
    }

    blockMaxWallets.push({
      block: parseInt(block),
      maxWallet,
      maxCount,
      totalWallets,
      totalTrades: totalTradesInBlock,
      maxWalletRatio: maxCount / totalTradesInBlock
    });

    if (maxCount > 1) {
      console.log(`区块 ${block}: 钱包 ${maxWallet.substring(0, 10)}... 交易${maxCount}次/总${totalTradesInBlock} (${(maxCount / totalTradesInBlock * 100).toFixed(1)}%)`);
    }
  }

  // 统计有单个钱包多次交易的区块
  const blocksWithMultipleTrades = blockMaxWallets.filter(b => b.maxCount > 1);

  console.log(`\n总区块数: ${Object.keys(blockWalletStats).length}`);
  console.log(`单个钱包多次交易的区块: ${blocksWithMultipleTrades.length}个`);

  if (blocksWithMultipleTrades.length > 0) {
    const totalTradesInMultiBlocks = blocksWithMultipleTrades.reduce((sum, b) => sum + b.totalTrades, 0);
    const maxWalletTradesInMultiBlocks = blocksWithMultipleTrades.reduce((sum, b) => sum + b.maxCount, 0);

    console.log(`这些区块的总交易数: ${totalTradesInMultiBlocks}`);
    console.log(`最大钱包的交易数: ${maxWalletTradesInMultiBlocks}`);
    console.log(`占比: ${(maxWalletTradesInMultiBlocks / uniqueTrades.length * 100).toFixed(1)}%`);
  }

  // 检测是否有异常集中
  console.log('\n【检测异常集中模式】\n');

  // 条件1: 某个区块内单个钱包交易占比超过50%
  const highConcentrationBlocks = blockMaxWallets.filter(b => b.maxWalletRatio > 0.5);

  if (highConcentrationBlocks.length > 0) {
    console.log('⚠️  检测到高集中度区块:');
    highConcentrationBlocks.forEach(b => {
      console.log(`   区块${b.block}: 钱包交易${b.maxCount}次/总${b.totalTrades}次 (${(b.maxWalletRatio * 100).toFixed(1)}%)`);
    });
  }

  // 条件2: 前10个区块中，有多少个有单个钱包多次交易
  const sortedBlocks = blockMaxWallets.sort((a, b) => a.block - b.block);
  const first10Blocks = sortedBlocks.slice(0, Math.min(10, sortedBlocks.length));
  const multiTradeInFirst10 = first10Blocks.filter(b => b.maxCount > 1).length;

  console.log(`\n前10个区块中，${multiTradeInFirst10}个有单个钱包多次交易`);

  return {
    totalTrades: uniqueTrades.length,
    totalBlocks: Object.keys(blockWalletStats).length,
    blocksWithMultipleTrades: blocksWithMultipleTrades.length,
    highConcentrationBlocks
  };
}

async function main() {
  const targetToken = '0x2be52e98e45ed3d27f56284972b3545dac964444';

  await analyzeWalletBlockConcentration(targetToken, '逆克莱默');
}

main().catch(console.error);
