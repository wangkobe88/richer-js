/**
 * 步骤2: 获取早期交易数据
 * 对每个信号获取买入前30-90秒的交易数据
 * 保存所有交易数据
 */

const fs = require('fs');
const path = require('path');
const { AveTxAPI } = require('../../src/core/ave-api');
const config = require('../../config/default.json');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const DATA_DIR = path.join(__dirname, 'data');
const INPUT_FILE = path.join(DATA_DIR, 'step1_signals_and_tokens.json');

const txApi = new AveTxAPI(
  config.ave?.apiUrl || 'https://prod.ave-api.com',
  config.ave?.timeout || 30000,
  process.env.AVE_API_KEY
);

const WINDOW_SECONDS = 180; // 回溯3分钟（买入前180秒）

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== 步骤2: 获取早期交易数据 ===\n');

  // 读取步骤1的数据
  if (!fs.existsSync(INPUT_FILE)) {
    console.error('请先运行 step1_fetch_signals_and_tokens.js');
    return;
  }

  const inputData = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
  const signals = inputData.signals;

  console.log(`处理 ${signals.length} 个信号...\n`);

  // 按代币去重，避免重复获取同一代币的交易数据
  const uniqueSignals = [];
  const seenTokens = new Set();

  for (const signal of signals) {
    if (!signal.main_pair) {
      console.log(`跳过 ${signal.token_symbol}: 无 main_pair`);
      continue;
    }
    const key = signal.token_address;
    if (!seenTokens.has(key)) {
      seenTokens.add(key);
      uniqueSignals.push(signal);
    }
  }

  console.log(`去重后 ${uniqueSignals.length} 个唯一代币\n`);

  // 获取交易数据
  const results = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < uniqueSignals.length; i++) {
    const signal = uniqueSignals[i];
    const checkTime = signal.timestamp;
    const targetFromTime = checkTime - WINDOW_SECONDS;  // 回溯3分钟

    process.stdout.write(`\r[${i+1}/${uniqueSignals.length}] ${signal.token_symbol}: 获取交易数据...`);

    try {
      const pairId = `${signal.main_pair}-bsc`;

      // 循环获取交易数据，直到覆盖完整时间窗口
      let currentToTime = checkTime;
      const allTrades = [];
      let loopCount = 0;
      const maxLoops = 10; // 防止无限循环

      while (loopCount < maxLoops) {
        loopCount++;

        const trades = await txApi.getSwapTransactions(
          pairId,
          300,
          targetFromTime,
          currentToTime,
          'asc'
        );

        if (!trades || trades.length === 0) {
          break;
        }

        allTrades.push(...trades);

        const batchFirstTime = trades[0].time;

        // 检查是否已经覆盖到目标起始时间
        if (batchFirstTime <= targetFromTime) {
          break;
        }

        // 如果返回了300条数据，可能还有更早的数据
        if (trades.length === 300) {
          currentToTime = batchFirstTime - 1;
        } else {
          // 返回数据不足300条，说明已经没有更早的数据了
          break;
        }
      }

      // 按时间排序并去重
      const uniqueTrades = deduplicateTrades(allTrades);

      // 提取钱包地址
      const wallets = new Set();
      uniqueTrades.forEach(t => {
        if (t.from_address) wallets.add(t.from_address.toLowerCase());
        if (t.to_address) wallets.add(t.to_address.toLowerCase());
      });

      results.push({
        token_address: signal.token_address,
        token_symbol: signal.token_symbol,
        quality_label: signal.quality_label,
        main_pair: signal.main_pair,
        timestamp: signal.timestamp,
        from_time: targetFromTime,
        to_time: checkTime,
        trade_count: uniqueTrades.length,
        wallet_count: wallets.size,
        wallets: Array.from(wallets),
        trades: uniqueTrades,
        loops: loopCount
      });

      successCount++;

    } catch (error) {
      results.push({
        token_address: signal.token_address,
        token_symbol: signal.token_symbol,
        quality_label: signal.quality_label,
        main_pair: signal.main_pair,
        timestamp: signal.timestamp,
        from_time: targetFromTime,
        to_time: checkTime,
        trade_count: 0,
        wallet_count: 0,
        wallets: [],
        trades: [],
        error: error.message
      });
      failCount++;
    }

    // API限流延迟
    await sleep(2000);
  }

  console.log(`\n\n完成: 成功 ${successCount}, 失败 ${failCount}`);

  // 统计
  const totalTrades = results.reduce((sum, r) => sum + r.trade_count, 0);
  const allWallets = new Set();
  results.forEach(r => r.wallets.forEach(w => allWallets.add(w)));

  console.log(`总交易数: ${totalTrades}`);
  console.log(`唯一钱包数: ${allWallets.size}`);

  // 保存数据
  const output = {
    window_seconds: WINDOW_SECONDS,
    total_signals: uniqueSignals.length,
    success_count: successCount,
    fail_count: failCount,
    total_trades: totalTrades,
    unique_wallets: allWallets.size,
    results: results
  };

  fs.writeFileSync(
    path.join(DATA_DIR, 'step2_early_trades.json'),
    JSON.stringify(output, null, 2)
  );

  console.log(`\n✅ 数据已保存到 data/step2_early_trades.json`);

  // 保存唯一钱包列表
  const walletList = Array.from(allWallets);
  fs.writeFileSync(
    path.join(DATA_DIR, 'wallet_list.json'),
    JSON.stringify(walletList, null, 2)
  );

  console.log(`✅ 钱包列表已保存到 data/wallet_list.json (${walletList.length} 个钱包)`);
}

function deduplicateTrades(trades) {
  if (!trades || trades.length === 0) return [];

  const seen = new Set();
  const unique = [];

  // 先按时间排序
  const sorted = trades.sort((a, b) => a.time - b.time);

  for (const trade of sorted) {
    const key = trade.tx_id || `${trade.time}_${trade.from_address}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(trade);
    }
  }

  return unique;
}

main().catch(console.error);
