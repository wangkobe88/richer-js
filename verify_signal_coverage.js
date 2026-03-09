/**
 * 验证：信号时间回溯90秒能否覆盖第一笔交易
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

async function verifySignalCoverage(tokenAddress) {
  // 获取信号时间
  const { data: signal } = await supabase
    .from('strategy_signals')
    .select('created_at, metadata')
    .eq('experiment_id', 'd951c4b9-6f3a-4784-afd4-cf93525fc914')
    .eq('token_address', tokenAddress)
    .eq('action', 'buy')
    .single();

  if (!signal) return null;

  const signalTime = Math.floor(new Date(signal.created_at).getTime() / 1000);
  const factors = signal.metadata?.preBuyCheckFactors;

  const expectedFirstTime = factors?.earlyTradesExpectedFirstTime;
  const actualFirstTime = factors?.earlyTradesDataFirstTime;
  const actualLastTime = factors?.earlyTradesDataLastTime;

  // 使用信号时间回溯90秒
  const signalBackward = signalTime - 90;

  console.log(`=== ${signal.metadata?.symbol || tokenAddress.substring(0, 8)} ===\n`);
  console.log(`信号时间: ${signalTime} (${new Date(signalTime * 1000).toISOString()})`);
  console.log(`信号回溯90秒: ${signalBackward} (${new Date(signalBackward * 1000).toISOString()})`);
  console.log(`\n引擎记录的预期最早时间: ${expectedFirstTime}`);
  console.log(`引擎记录的实际最早时间: ${actualFirstTime}`);
  console.log(`引擎记录的实际最晚时间: ${actualLastTime}`);
  console.log(`\n代币年龄: ${signal.metadata?.trendFactors?.age || 'N/A'} 分钟`);

  // 计算覆盖情况
  console.log(`\n【覆盖情况】\n`);

  if (actualFirstTime >= signalBackward) {
    console.log(`✓ 信号回溯90秒能覆盖第一笔交易`);
    console.log(`  实际第一笔: ${actualFirstTime} >= 回溯起点: ${signalBackward}`);
    console.log(`  覆盖余量: ${actualFirstTime - signalBackward}秒`);
  } else {
    console.log(`✗ 信号回溯90秒不能覆盖第一笔交易`);
    console.log(`  实际第一笔: ${actualFirstTime} < 回溯起点: ${signalBackward}`);
    console.log(`  缺口: ${signalBackward - actualFirstTime}秒`);
  }

  if (actualLastTime <= signalTime) {
    console.log(`✓ 信号时间能覆盖最后一笔交易`);
  } else {
    console.log(`✗ 信号时间不能覆盖最后一笔交易`);
  }

  // 验证：使用信号时间回溯获取的交易
  const innerPair = `${tokenAddress}_fo`;
  const pairId = `${innerPair}-bsc`;

  const allTrades = [];
  let currentToTime = signalTime;

  for (let loop = 1; loop <= 10; loop++) {
    try {
      const trades = await txApi.getSwapTransactions(
        pairId, 300, signalBackward, currentToTime, 'asc'
      );
      if (trades.length === 0) break;
      allTrades.push(...trades);
      if (trades[0].time <= signalBackward || trades.length < 300) break;
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

  console.log(`\n【验证】\n`);
  console.log(`使用信号回溯获取的交易数: ${uniqueTrades.length}`);
  console.log(`引擎记录的交易数: ${factors?.earlyTradesTotalCount || 'N/A'}`);

  if (uniqueTrades.length > 0) {
    const fetchedFirst = uniqueTrades[0].time;
    const fetchedLast = uniqueTrades[uniqueTrades.length - 1].time;

    console.log(`获取的最早交易: ${fetchedFirst} (${new Date(fetchedFirst * 1000).toISOString()})`);
    console.log(`获取的最晚交易: ${fetchedLast} (${new Date(fetchedLast * 1000).toISOString()})`);

    if (actualFirstTime && fetchedFirst === actualFirstTime) {
      console.log(`✓ 获取的最早交易与引擎记录一致`);
    } else if (actualFirstTime) {
      console.log(`✗ 获取的最早交易与引擎记录不一致 (${fetchedFirst} vs ${actualFirstTime})`);
    }
  }

  return {
    symbol: signal.metadata?.symbol || tokenAddress.substring(0, 8),
    signalTime,
    signalBackward,
    actualFirstTime,
    canCover: actualFirstTime >= signalBackward,
  };
}

async function main() {
  const tokens = [
    '0x2be52e98e45ed3d27f56284972b3545dac964444',  // 逆克莱默
    '0x16aeb87aeb78e4cf7987f16e910c285d77354444',  // AGENTGDP
  ];

  const results = [];
  for (const tokenAddr of tokens) {
    const result = await verifySignalCoverage(tokenAddr);
    if (result) results.push(result);
    console.log('\n' + '='.repeat(60) + '\n');
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // 汇总
  console.log('【汇总】\n');
  console.log('代币名称    | 信号回溯90秒 | 实际第一笔 | 能覆盖');
  console.log('-----------|-------------|-----------|------');
  results.forEach(r => {
    const cover = r.canCover ? '✓' : '✗';
    console.log(`${r.symbol.padEnd(10)} | ${r.signalBackward} | ${r.actualFirstTime} | ${cover}`);
  });
}

main().catch(console.error);
