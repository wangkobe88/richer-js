/**
 * 深入分析有"单钱包多次交易"的代币
 * 重点: 宝贝龙虾和 GLUBSCHIS
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

  console.log('【按交易数排序的区块】\n');

  sortedBlocks.slice(0, 10).forEach((block, idx) => {
    const trades = blockGroups[block];
    const wallets = new Set();
    let totalAmount = 0;

    trades.forEach(t => {
      if (t.from_address) wallets.add(t.from_address.toLowerCase());
      if (t.to_address) wallets.add(t.to_address.toLowerCase());
      totalAmount += (t.from_usd || t.to_usd || 0);
    });

    console.log(`#${idx + 1} 区块${block}: ${trades.length}笔交易, ${wallets.size}个钱包, $${totalAmount.toFixed(2)}`);

    // 统计每个钱包的交易次数
    const walletTradeCounts = {};
    trades.forEach(t => {
      const wallet = (t.from_address || '').toLowerCase();
      if (!walletTradeCounts[wallet]) {
        walletTradeCounts[wallet] = 0;
      }
      walletTradeCounts[wallet]++;
      walletTradeCounts[wallet] += (t.from_usd || t.to_usd || 0);
    });

    // 找出交易次数最多的钱包
    const sortedWallets = Object.entries(walletTradeCounts)
      .sort((a, b) => {
        // 先按交易次数排序
        const countCompare = b[1].count - a[1].count;
        if (countCompare !== 0) return countCompare;
        // 交易次数相同，按金额排序
        return b[1].amount - a[1].amount;
      });

    if (sortedWallets.length > 0) {
      const topWallet = sortedWallets[0];
      const wallet = topWallet[0];
      const count = Math.floor(topWallet[1].count); // 交易次数
      const amount = topWallet[1].amount - count; // 金额

      console.log(`  最大钱包: ${wallet.substring(0, 10)}... ${count}笔交易, $${amount.toFixed(2)}`);
      console.log(`  钱包/交易: ${wallets.size}/${trades.length} = ${(wallets.size / trades.length * 100).toFixed(1)}%`);
    }

    console.log('');
  });

  // 检查是否有异常模式
  console.log('【异常模式检测】\n');

  const top3Blocks = sortedBlocks.slice(0, 3);
  const top3Trades = top3Blocks.reduce((sum, b) => sum + blockGroups[b].length, 0);
  const totalTrades = uniqueTrades.length;

  console.log(`前3个区块: ${top3Trades}笔交易 (${(top3Trades / totalTrades * 100).toFixed(1)}%)`);

  if (top3Trades / totalTrades > 0.3) {
    console.log('⚠️  前3个区块占30%以上的交易，可能存在集中模式');
  }
}

async function main() {
  // 分析有单钱包多次交易的代币
  await deepAnalyzeToken('0x281f05868b5ba9e55869541a117ebb661f474444', '宝贝龙虾');

  console.log('\n' + '='.repeat(60) + '\n');

  await deepAnalyzeToken('0xf3372a3dbc824f0b0044ca77209559514b294444', 'GLUBSCHIS');
}

main().catch(console.error);
