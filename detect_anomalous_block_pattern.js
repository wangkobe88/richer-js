/**
 * 修正版：深入分析有"单钱包多次交易"的代币
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

async function deepAnalyzeToken(tokenAddress, symbol) {
  console.log(`=== 深入分析 ${symbol} ===\n`);

  const { data: signal } = await supabase
    .from('strategy_signals')
    .select('created_at')
    .eq('experiment_id', 'd951c4b9-6f3a-4784-afd4-cf93525fc914')
    .eq('token_address', tokenAddress)
    .eq('action', 'buy')
    .single();

  if (!signal) return;

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

  // 去重并排序
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

  // 按区块交易数排序
  const sortedBlocks = Object.keys(blockGroups)
    .map(Number)
    .sort((a, b) => blockGroups[b].length - blockGroups[a].length);

  console.log('【按交易数排序的区块（前10）】\n');

  for (let i = 0; i < Math.min(10, sortedBlocks.length); i++) {
    const block = sortedBlocks[i];
    const trades = blockGroups[block];
    const wallets = new Set();
    const walletAmounts = {};
    let totalAmount = 0;

    trades.forEach(t => {
      if (t.from_address) wallets.add(t.from_address.toLowerCase());
      if (t.to_address) wallets.add(t.to_address.toLowerCase());
      const amount = t.from_usd || t.to_usd || 0;
      totalAmount += amount;

      const wallet = (t.from_address || '').toLowerCase();
      if (!walletAmounts[wallet]) {
        walletAmounts[wallet] = { count: 0, amount: 0 };
      }
      walletAmounts[wallet].count++;
      walletAmounts[wallet].amount += amount;
    });

    console.log(`#${i + 1} 区块${block}: ${trades.length}笔交易, ${wallets.size}个钱包, $${totalAmount.toFixed(2)}`);

    // 找出交易次数最多的钱包
    const sortedWallets = Object.entries(walletAmounts)
      .map(([wallet, data]) => ({
        wallet,
        count: data.count,
        amount: data.amount
      }))
      .sort((a, b) => b.count - a.count || b.amount - a.amount);

    if (sortedWallets.length > 0 && sortedWallets[0].count > 1) {
      const topWallet = sortedWallets[0];
      console.log(`  ⚠️  单钱包多次交易: ${topWallet.wallet.substring(0, 10)}... ${topWallet.count}笔, $${topWallet.amount.toFixed(2)}`);
      console.log(`  钱包/交易: ${wallets.size}/${trades.length} = ${(wallets.size / trades.length * 100).toFixed(1)}%`);
    }

    console.log('');
  }

  // 检查异常模式
  const top3Blocks = sortedBlocks.slice(0, 3);
  const top3Trades = top3Blocks.reduce((sum, b) => sum + blockGroups[b].length, 0);
  const totalTrades = uniqueTrades.length;

  console.log('【异常模式检测】\n');
  console.log(`前3个区块: ${top3Trades}笔交易 (${(top3Trades / totalTrades * 100).toFixed(1)}%)`);
  console.log(`最大区块: ${top3Blocks[0]}有${blockGroups[top3Blocks[0]].length}笔交易`);

  if (top3Trades / totalTrades > 0.2) {
    console.log('⚠️  前3个区块占20%以上的交易');
  }

  if (blockGroups[top3Blocks[0]].length > 5) {
    console.log('⚠️  单个区块超过5笔交易');
  }

  return {
    totalTrades: uniqueTrades.length,
    top3BlockRatio: top3Trades / totalTrades,
    maxBlockSize: blockGroups[top3Blocks[0]].length
  };
}

async function main() {
  console.log('=== 检测"同一区块捆绑交易"模式 ===\n');

  // 分析所有拉砸代币
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

  for (const tokenAddr of pumpAndDump) {
    const { data: signal } = await supabase
      .from('strategy_signals')
      .select('metadata')
      .eq('experiment_id', 'd951c4b9-6f3a-4784-afd4-cf93525fc914')
      .eq('token_address', tokenAddr)
      .eq('action', 'buy')
      .single();

    const symbol = signal?.metadata?.symbol || tokenAddr.substring(0, 8);

    try {
      const result = await deepAnalyzeToken(tokenAddr, symbol);

      if (result && (result.maxBlockSize > 5 || result.top3BlockRatio > 0.2)) {
        console.log(`\n→ ${symbol} 可能存在异常模式\n`);
        console.log('='.repeat(60) + '\n');
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (error) {
      console.error(`分析 ${symbol} 失败: ${error.message}`);
    }
  }
}

main().catch(console.error);
