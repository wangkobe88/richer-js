/**
 * 从代币创建时间开始获取早期交易数据
 * 而不是从信号时间回溯
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

async function analyzeFromTokenCreation(tokenAddress) {
  console.log(`=== 分析 ${tokenAddress.substring(0, 10)}... ===\n`);

  // 获取代币创建时间
  const { data: token } = await supabase
    .from('experiment_tokens')
    .select('created_at')
    .eq('experiment_id', 'd951c4b9-6f3a-4784-afd4-cf93525fc914')
    .eq('token_address', tokenAddress)
    .single();

  if (!token) {
    console.log('未找到代币数据');
    return;
  }

  const tokenCreateTime = Math.floor(new Date(token.created_at).getTime() / 1000);
  const targetFromTime = tokenCreateTime;
  const targetToTime = tokenCreateTime + 90;

  console.log(`代币创建时间: ${tokenCreateTime} (${new Date(token.created_at).toISOString()})`);
  console.log(`分析窗口: ${targetFromTime} - ${targetToTime} (90秒)\n`);

  // 获取信号时间进行对比
  const { data: signal } = await supabase
    .from('strategy_signals')
    .select('created_at')
    .eq('experiment_id', 'd951c4b9-6f3a-4784-afd4-cf93525fc914')
    .eq('token_address', tokenAddress)
    .eq('action', 'buy')
    .single();

  if (signal) {
    const signalTime = Math.floor(new Date(signal.created_at).getTime() / 1000);
    const delay = signalTime - tokenCreateTime;
    console.log(`信号时间: ${signalTime} (${new Date(signal.created_at).toISOString()})`);
    console.log(`信号延迟: ${delay}秒\n`);
  }

  // 获取交易数据
  const innerPair = `${tokenAddress}_fo`;
  const pairId = `${innerPair}-bsc`;

  const allTrades = [];
  let currentToTime = targetToTime;

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

  if (uniqueTrades.length === 0) {
    console.log('未获取到交易数据');
    return;
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
  // 分析逆克莱默
  await analyzeFromTokenCreation('0x2be52e98e45ed3d27f56284972b3545dac964444');
}

main().catch(console.error);
