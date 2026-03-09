/**
 * 对比所有代币的同一区块内钱包交易集中度
 * 找出真正有"同一区块捆绑交易"模式的代币
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

async function analyzeTokenBlockWalletPattern(tokenAddress) {
  const { data: signal } = await supabase
    .from('strategy_signals')
    .select('created_at, metadata')
    .eq('experiment_id', 'd951c4b9-6f3a-4784-afd4-cf93525fc914')
    .eq('token_address', tokenAddress)
    .eq('action', 'buy')
    .single();

  if (!signal) return null;

  const checkTime = Math.floor(new Date(signal.created_at).getTime() / 1000);
  const targetFromTime = checkTime - 90;
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

  // 按区块分组，统计每个区块内的钱包交易次数
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

  // 分析模式
  let blocksWithMultipleWalletTrades = 0;
  let maxWalletInBlockRatio = 0;
  let maxWalletTradesInAnyBlock = 0;

  for (const block in blockWalletStats) {
    const wallets = blockWalletStats[block];
    const totalWallets = Object.keys(wallets).length;
    const totalTradesInBlock = Object.values(wallets).reduce((a, b) => a + b, 0);

    let maxCount = 0;
    for (const wallet in wallets) {
      if (wallets[wallet] > maxCount) {
        maxCount = wallets[wallet];
      }
    }

    if (maxCount > 1) {
      blocksWithMultipleWalletTrades++;
    }

    const ratio = maxCount / totalTradesInBlock;
    if (ratio > maxWalletInBlockRatio) {
      maxWalletInBlockRatio = ratio;
    }

    if (maxCount > maxWalletTradesInAnyBlock) {
      maxWalletTradesInAnyBlock = maxCount;
    }
  }

  return {
    tokenAddress,
    symbol: signal.metadata?.symbol || tokenAddress.substring(0, 8),
    totalTrades: uniqueTrades.length,
    totalBlocks: Object.keys(blockWalletStats).length,
    blocksWithMultipleWalletTrades,
    maxWalletInBlockRatio,
    maxWalletTradesInAnyBlock,
    avgTradesPerBlock: uniqueTrades.length / Object.keys(blockWalletStats).length
  };
}

async function main() {
  console.log('=== 分析所有代币的同一区块钱包交易模式 ===\n');

  const results = [];

  for (const tokenAddr of pumpAndDump) {
    console.log(`分析 ${tokenAddr.substring(0, 10)}...`);

    const result = await analyzeTokenBlockWalletPattern(tokenAddr);

    if (result) {
      results.push(result);
      console.log(`  交易数: ${result.totalTrades}, 区块数: ${result.totalBlocks}`);
      console.log(`  单钱包多次交易区块: ${result.blocksWithMultipleWalletTrades}`);
      console.log(`  最大区块钱包占比: ${(result.maxWalletInBlockRatio * 100).toFixed(1)}%`);
      console.log('');
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('=== 汇总分析 ===\n');

  console.log('代币名称    | 交易数 | 单钱包多次交易区块数 | 最大区块钱包占比 | 平均每区块交易数');
  console.log('-----------|--------|-------------------|------------------|--------------');

  results.forEach(r => {
    console.log(`${r.symbol.substring(0, 10).padEnd(10)} | ${r.totalTrades.toString().padEnd(6)} | ${r.blocksWithMultipleWalletTrades.toString().padEnd(17)} | ${(r.maxWalletInBlockRatio * 100).toFixed(1).padEnd(16)}% | ${r.avgTradesPerBlock.toFixed(1).padEnd(12)}`);
  });

  // 找出异常的
  console.log('\n【可能异常的代币】\n');

  const suspicious = results.filter(r =>
    r.maxWalletInBlockRatio > 0.3 ||  // 单个钱包在某区块占比>30%
    r.blocksWithMultipleWalletTrades > 0     // 有单钱包多次交易的区块
  );

  if (suspicious.length > 0) {
    suspicious.forEach(r => {
      console.log(`${r.symbol}:`);
      console.log(`  单钱包多次交易区块: ${r.blocksWithMultipleWalletTrades}`);
      console.log(`  最大区块钱包占比: ${(r.maxWalletInBlockRatio * 100).toFixed(1)}%`);
      console.log('');
    });
  } else {
    console.log('未检测到明显的"同一区块捆绑交易"模式');
    console.log('所有代币的交易都是分散的，每个钱包在每个区块只交易一次。');
  }
}

main().catch(console.error);
