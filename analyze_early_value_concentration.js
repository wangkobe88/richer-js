/**
 * 分析代币刚创建时的价值集中度
 * 类似Dev持仓比例的逻辑
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
  '0x16aeb87aeb78e4cf7987f16e910c285d77354444',  // AGENTGDP
];

async function analyzeEarlyValueConcentration(tokenAddress) {
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

  // 计算总金额
  const totalAmount = uniqueTrades.reduce((sum, t) => sum + (t.from_usd || t.to_usd || 0), 0);

  // 按秒分组计算金额
  const secondAmounts = {};
  for (const trade of uniqueTrades) {
    const amount = trade.from_usd || trade.to_usd || 0;
    if (!secondAmounts[trade.time]) {
      secondAmounts[trade.time] = 0;
    }
    secondAmounts[trade.time] += amount;
  }

  // 按区块分组计算金额
  const blockAmounts = {};
  for (const trade of uniqueTrades) {
    const amount = trade.from_usd || trade.to_usd || 0;
    if (!blockAmounts[trade.block_number]) {
      blockAmounts[trade.block_number] = 0;
    }
    blockAmounts[trade.block_number] += amount;
  }

  // 找出第一笔交易的时间
  const firstTradeTime = uniqueTrades[0].time;

  // 计算前N秒的金额占比
  const timeWindows = [5, 10, 15, 20, 30];
  const timeWindowRatios = {};

  for (const window of timeWindows) {
    const windowEnd = firstTradeTime + window;
    let windowAmount = 0;
    for (const trade of uniqueTrades) {
      if (trade.time <= windowEnd) {
        windowAmount += (trade.from_usd || trade.to_usd || 0);
      }
    }
    timeWindowRatios[window] = windowAmount / totalAmount;
  }

  // 计算第一个区块的金额占比
  const sortedBlocks = Object.keys(blockAmounts).map(Number).sort((a, b) => a - b);
  const firstBlockAmount = blockAmounts[sortedBlocks[0]];
  const firstBlockRatio = firstBlockAmount / totalAmount;

  // 计算最大金额区块的占比
  const maxAmountBlock = Object.entries(blockAmounts).sort((a, b) => b[1] - a[1])[0];
  const maxBlockRatio = maxAmountBlock[1] / totalAmount;

  // 找出金额最大的秒
  const maxAmountSecond = Object.entries(secondAmounts).sort((a, b) => b[1] - a[1])[0];
  const maxSecondRatio = maxAmountSecond[1] / totalAmount;

  return {
    symbol: signal.metadata?.symbol || tokenAddress.substring(0, 8),
    totalAmount,
    firstBlockRatio,
    maxBlockRatio,
    maxSecondRatio,
    timeWindowRatios,
    firstTradeTime,
    sortedBlocks,
    blockAmounts,
    secondAmounts,
  };
}

async function main() {
  console.log('=== 分析代币刚创建时的价值集中度 ===\n');

  const pumpResults = [];
  for (const tokenAddr of pumpTokens) {
    const result = await analyzeEarlyValueConcentration(tokenAddr);
    if (result) pumpResults.push(result);
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  const normalResults = [];
  for (const tokenAddr of normalTokens) {
    const result = await analyzeEarlyValueConcentration(tokenAddr);
    if (result) normalResults.push(result);
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log('【拉盘代币】\n');
  pumpResults.forEach(r => {
    console.log(`${r.symbol}:`);
    console.log(`  总金额: $${r.totalAmount.toFixed(2)}`);
    console.log(`  第一区块占比: ${(r.firstBlockRatio * 100).toFixed(1)}%`);
    console.log(`  最大区块占比: ${(r.maxBlockRatio * 100).toFixed(1)}%`);
    console.log(`  最大秒占比: ${(r.maxSecondRatio * 100).toFixed(1)}%`);
    console.log(`  前5秒占比: ${(r.timeWindowRatios[5] * 100).toFixed(1)}%`);
    console.log(`  前10秒占比: ${(r.timeWindowRatios[10] * 100).toFixed(1)}%`);
    console.log(`  前15秒占比: ${(r.timeWindowRatios[15] * 100).toFixed(1)}%`);
    console.log('');
  });

  console.log('【正常代币】\n');
  normalResults.forEach(r => {
    console.log(`${r.symbol}:`);
    console.log(`  总金额: $${r.totalAmount.toFixed(2)}`);
    console.log(`  第一区块占比: ${(r.firstBlockRatio * 100).toFixed(1)}%`);
    console.log(`  最大区块占比: ${(r.maxBlockRatio * 100).toFixed(1)}%`);
    console.log(`  最大秒占比: ${(r.maxSecondRatio * 100).toFixed(1)}%`);
    console.log(`  前5秒占比: ${(r.timeWindowRatios[5] * 100).toFixed(1)}%`);
    console.log(`  前10秒占比: ${(r.timeWindowRatios[10] * 100).toFixed(1)}%`);
    console.log(`  前15秒占比: ${(r.timeWindowRatios[15] * 100).toFixed(1)}%`);
    console.log('');
  });

  // 汇总对比
  console.log('【汇总对比】\n');
  console.log('代币名称    | 总金额  | 第一区块 | 最大区块 | 最大秒 | 前5秒 | 前10秒 | 前15秒');
  console.log('-----------|---------|---------|---------|--------|-------|--------|--------');

  pumpResults.forEach(r => {
    console.log(`${r.symbol.substring(0, 10).padEnd(10)} | $${r.totalAmount.toFixed(0).padStart(6)} | ${(r.firstBlockRatio * 100).toFixed(1).padStart(6)}% | ${(r.maxBlockRatio * 100).toFixed(1).padStart(6)}% | ${(r.maxSecondRatio * 100).toFixed(1).padStart(5)}% | ${(r.timeWindowRatios[5] * 100).toFixed(1).padStart(5)}% | ${(r.timeWindowRatios[10] * 100).toFixed(1).padStart(6)}% | ${(r.timeWindowRatios[15] * 100).toFixed(1).padStart(6)}%`);
  });

  normalResults.forEach(r => {
    console.log(`${r.symbol.substring(0, 10).padEnd(10)} | $${r.totalAmount.toFixed(0).padStart(6)} | ${(r.firstBlockRatio * 100).toFixed(1).padStart(6)}% | ${(r.maxBlockRatio * 100).toFixed(1).padStart(6)}% | ${(r.maxSecondRatio * 100).toFixed(1).padStart(5)}% | ${(r.timeWindowRatios[5] * 100).toFixed(1).padStart(5)}% | ${(r.timeWindowRatios[10] * 100).toFixed(1).padStart(6)}% | ${(r.timeWindowRatios[15] * 100).toFixed(1).padStart(6)}%`);
  });

  // 计算平均值
  console.log('\n【平均值对比】\n');

  const avgPumpFirstBlock = pumpResults.reduce((sum, r) => sum + r.firstBlockRatio, 0) / pumpResults.length;
  const avgNormalFirstBlock = normalResults.reduce((sum, r) => sum + r.firstBlockRatio, 0) / normalResults.length;
  const avgPumpMaxBlock = pumpResults.reduce((sum, r) => sum + r.maxBlockRatio, 0) / pumpResults.length;
  const avgNormalMaxBlock = normalResults.reduce((sum, r) => sum + r.maxBlockRatio, 0) / normalResults.length;
  const avgPumpMaxSecond = pumpResults.reduce((sum, r) => sum + r.maxSecondRatio, 0) / pumpResults.length;
  const avgNormalMaxSecond = normalResults.reduce((sum, r) => sum + r.maxSecondRatio, 0) / normalResults.length;
  const avgPump5s = pumpResults.reduce((sum, r) => sum + r.timeWindowRatios[5], 0) / pumpResults.length;
  const avgNormal5s = normalResults.reduce((sum, r) => sum + r.timeWindowRatios[5], 0) / normalResults.length;
  const avgPump10s = pumpResults.reduce((sum, r) => sum + r.timeWindowRatios[10], 0) / pumpResults.length;
  const avgNormal10s = normalResults.reduce((sum, r) => sum + r.timeWindowRatios[10], 0) / normalResults.length;
  const avgPump15s = pumpResults.reduce((sum, r) => sum + r.timeWindowRatios[15], 0) / pumpResults.length;
  const avgNormal15s = normalResults.reduce((sum, r) => sum + r.timeWindowRatios[15], 0) / normalResults.length;

  console.log(`指标              | 拉盘代币 | 正常代币 | 倍数`);
  console.log('------------------|---------|---------|------');
  console.log(`第一区块占比       | ${(avgPumpFirstBlock * 100).toFixed(1)}% | ${(avgNormalFirstBlock * 100).toFixed(1)}% | ${(avgPumpFirstBlock / avgNormalFirstBlock).toFixed(2)}x`);
  console.log(`最大区块占比       | ${(avgPumpMaxBlock * 100).toFixed(1)}% | ${(avgNormalMaxBlock * 100).toFixed(1)}% | ${(avgPumpMaxBlock / avgNormalMaxBlock).toFixed(2)}x`);
  console.log(`最大秒占比         | ${(avgPumpMaxSecond * 100).toFixed(1)}% | ${(avgNormalMaxSecond * 100).toFixed(1)}% | ${(avgPumpMaxSecond / avgNormalMaxSecond).toFixed(2)}x`);
  console.log(`前5秒占比          | ${(avgPump5s * 100).toFixed(1)}% | ${(avgNormal5s * 100).toFixed(1)}% | ${(avgPump5s / avgNormal5s).toFixed(2)}x`);
  console.log(`前10秒占比         | ${(avgPump10s * 100).toFixed(1)}% | ${(avgNormal10s * 100).toFixed(1)}% | ${(avgPump10s / avgNormal10s).toFixed(2)}x`);
  console.log(`前15秒占比         | ${(avgPump15s * 100).toFixed(1)}% | ${(avgNormal15s * 100).toFixed(1)}% | ${(avgPump15s / avgNormal15s).toFixed(2)}x`);
}

main().catch(console.error);
