/**
 * 检测"同一秒爆发"模式
 * 多个钱包在同一秒内集中交易
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

async function detectSecondBurstPattern(tokenAddress) {
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

  if (uniqueTrades.length < 2) return null;

  console.log(`=== 分析 ${signal.metadata?.symbol || tokenAddress.substring(0, 8)} ===\n`);

  // 1. 按秒分组
  const secondGroups = {};
  for (const trade of uniqueTrades) {
    const second = trade.time;
    if (!secondGroups[second]) {
      secondGroups[second] = [];
    }
    secondGroups[second].push(trade);
  }

  const sortedSeconds = Object.keys(secondGroups).map(Number).sort((a, b) => secondGroups[b].length - secondGroups[a].length);
  const maxSecondSize = secondGroups[sortedSeconds[0]].length;
  const maxSecondRatio = maxSecondSize / uniqueTrades.length;

  console.log('【同一秒内交易分析】\n');
  console.log(`最大秒交易数: ${maxSecondSize}笔 (${(maxSecondRatio * 100).toFixed(1)}%)`);
  console.log(`秒数: ${sortedSeconds[0]} (${new Date(sortedSeconds[0] * 1000).toISOString()})`);

  if (maxSecondSize > 1) {
    const wallets = new Set();
    secondGroups[sortedSeconds[0]].forEach(t => {
      if (t.from_address) wallets.add(t.from_address.toLowerCase());
    });
    console.log(`独立钱包: ${wallets.size}/${maxSecondSize}`);
  }

  // 2. 按区块分组
  const blockGroups = {};
  for (const trade of uniqueTrades) {
    const block = trade.block_number;
    if (!blockGroups[block]) {
      blockGroups[block] = [];
    }
    blockGroups[block].push(trade);
  }

  const sortedBlocks = Object.keys(blockGroups).map(Number).sort((a, b) => blockGroups[b].length - blockGroups[a].length);
  const maxBlockSize = blockGroups[sortedBlocks[0]].length;
  const maxBlockRatio = maxBlockSize / uniqueTrades.length;
  const secondMaxBlockSize = sortedBlocks.length > 1 ? blockGroups[sortedBlocks[1]].length : 0;
  const maxBlockToSecondRatio = secondMaxBlockSize > 0 ? maxBlockSize / secondMaxBlockSize : Infinity;

  console.log(`\n【同一区块内交易分析】\n`);
  console.log(`最大区块交易数: ${maxBlockSize}笔 (${(maxBlockRatio * 100).toFixed(1)}%)`);
  console.log(`区块号: ${sortedBlocks[0]}`);
  console.log(`第二大区块: ${secondMaxBlockSize}笔`);
  console.log(`最大/第二大比例: ${maxBlockToSecondRatio.toFixed(2)}x`);

  // 3. 计算因子
  const factors_calc = {
    maxSecondTrades: maxSecondSize,
    maxSecondRatio: maxSecondRatio,
    maxBlockTrades: maxBlockSize,
    maxBlockRatio: maxBlockRatio,
    maxBlockToSecondRatio: maxBlockToSecondRatio,
    totalTrades: uniqueTrades.length,
  };

  // 4. 判断是否异常
  console.log(`\n【异常判断】\n`);

  let isAnomalous = false;
  const reasons = [];

  if (maxSecondSize >= 5) {
    isAnomalous = true;
    reasons.push(`同一秒内${maxSecondSize}笔交易 >= 5`);
  }

  if (maxBlockRatio > 0.1) {
    isAnomalous = true;
    reasons.push(`最大区块占比${(maxBlockRatio * 100).toFixed(1)}% > 10%`);
  }

  if (maxBlockToSecondRatio > 3) {
    isAnomalous = true;
    reasons.push(`最大/第二大区块比例${maxBlockToSecondRatio.toFixed(2)}x > 3`);
  }

  if (isAnomalous) {
    console.log('⚠️  检测到异常模式:');
    reasons.forEach(r => console.log(`   - ${r}`));
    console.log('\n→ 建议: 拒绝此代币');
  } else {
    console.log('✓ 未检测到异常模式');
    console.log('  同一秒内交易分散，或区块分布均匀');
  }

  return {
    symbol: signal.metadata?.symbol || tokenAddress.substring(0, 8),
    ...factors_calc,
    isAnomalous,
    reasons
  };
}

async function main() {
  console.log('=== 检测"同一秒爆发"模式 ===\n');

  const tokens = [
    '0x2be52e98e45ed3d27f56284972b3545dac964444',  // 逆克莱默
    '0x281f05868b5ba9e55869541a117ebb661f474444',  // 宝贝龙虾
    '0xf3372a3dbc824f0b0044ca77209559514b294444',  // GLUBSCHIS
    '0x16aeb87aeb78e4cf7987f16e910c285d77354444',  // AGENTGDP
  ];

  const results = [];
  for (const tokenAddr of tokens) {
    const result = await detectSecondBurstPattern(tokenAddr);
    if (result) {
      results.push(result);
    }
    console.log('\n' + '='.repeat(60) + '\n');
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // 汇总
  console.log('【汇总】\n');
  console.log('代币名称    | 最大秒交易 | 最大区块 | 区块占比 | 最大/第二大 | 异常');
  console.log('-----------|-----------|---------|---------|-----------|-----');
  results.forEach(r => {
    console.log(`${r.symbol.substring(0, 10).padEnd(10)} | ${r.maxSecondTrades.toString().padEnd(9)} | ${r.maxBlockTrades.toString().padEnd(7)} | ${(r.maxBlockRatio * 100).toFixed(1).padEnd(7)}% | ${r.maxBlockToSecondRatio.toFixed(2).padEnd(9)}x | ${r.isAnomalous ? '是' : '否'}`);
  });
}

main().catch(console.error);
