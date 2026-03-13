/**
 * Step 2: 获取早期交易数据 (1.5分钟回溯版本)
 * 支持跳过已获取过数据的代币
 */

const fs = require('fs');
const path = require('path');
const { AveTxAPI } = require('../../src/core/ave-api');
const config = require('../../config/default.json');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const DATA_DIR = path.join(__dirname, 'data');
const INPUT_FILE = path.join(DATA_DIR, 'step1_signals_and_tokens.json');
const PROCESSED_TOKENS_FILE = path.join(DATA_DIR, 'processed_tokens.json');
const OUTPUT_FILE = path.join(DATA_DIR, 'step2_early_trades.json');

const txApi = new AveTxAPI(
  config.ave?.apiUrl || 'https://prod.ave-api.com',
  config.ave?.timeout || 30000,
  process.env.AVE_API_KEY
);

const WINDOW_SECONDS = 90;

// 加载已处理的代币
let processedTokens = new Set();
if (fs.existsSync(PROCESSED_TOKENS_FILE)) {
  try {
    const data = JSON.parse(fs.readFileSync(PROCESSED_TOKENS_FILE, 'utf8'));
    processedTokens = new Set(data);
  } catch (e) {
    console.log('未找到 processed_tokens.json，将从头开始获取所有代币数据');
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== Step 2: 获取早期交易数据 ===\n');

  // 读取步骤1的数据
  if (!fs.existsSync(INPUT_FILE)) {
    console.error('请先运行 step1_fetch_signals_with_exp_id.js <实验ID>');
    process.exit(1);
  }

  const inputData = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
  const signals = inputData.signals;

  console.log(`实验: ${inputData.experiment_id}`);
  console.log(`处理 ${signals.length} 个信号...`);
  console.log(`回溯窗口: ${WINDOW_SECONDS}秒 (1.5分钟)\n`);
  console.log(`已缓存 ${processedTokens.size} 个代币的交易数据\n`);

  // 按代币去重
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

  // 分离需要获取和已缓存的代币
  const tokensToFetch = [];
  const cachedTokens = [];

  for (const signal of uniqueSignals) {
    if (processedTokens.has(signal.token_address)) {
      cachedTokens.push(signal);
    } else {
      tokensToFetch.push(signal);
    }
  }

  console.log(`需从 API 获取: ${tokensToFetch.length} 个代币`);
  console.log(`使用缓存: ${cachedTokens.length} 个代币\n`);

  // 获取交易数据
  const results = [];
  let successCount = 0;
  let failCount = 0;

  // 处理需要获取的代币
  for (let i = 0; i < tokensToFetch.length; i++) {
    const signal = tokensToFetch[i];
    const checkTime = signal.timestamp;
    const targetFromTime = checkTime - WINDOW_SECONDS;

    process.stdout.write(`\r[${i+1}/${tokensToFetch.length}] ${signal.token_symbol}: 获取交易数据...`);

    try {
      const pairId = `${signal.main_pair}-bsc`;
      const tokenTrades = [];

      // 循环获取交易数据
      let currentToTime = checkTime;
      let loopCount = 0;
      const maxLoops = 10;

      while (currentToTime > targetFromTime && loopCount < maxLoops) {
        const batch = await txApi.getSwapTransactions(
          pairId,
          100,
          targetFromTime,
          currentToTime,
          'asc',
          0
        );

        if (batch.length === 0) break;

        tokenTrades.push(...batch);

        // 更新 currentToTime 为最早交易的时间（继续往前查）
        const earliestTime = batch[0].time;
        if (earliestTime <= targetFromTime) break;

        currentToTime = earliestTime - 1; // 往前移1秒
        loopCount++;
      }

      // 过滤时间窗口内的交易
      const filteredTrades = tokenTrades.filter(t =>
        t.time >= targetFromTime && t.time <= checkTime
      );

      results.push({
        token_address: signal.token_address,
        token_symbol: signal.token_symbol,
        timestamp: checkTime,
        target_from_time: targetFromTime,
        trades: filteredTrades,
        trade_count: filteredTrades.length
      });

      // 添加到已处理列表
      processedTokens.add(signal.token_address);
      successCount++;

      if ((i + 1) % 10 === 0) {
        await sleep(1000); // 每10个代币暂停1秒
      }

    } catch (error) {
      results.push({
        token_address: signal.token_address,
        token_symbol: signal.token_symbol,
        timestamp: checkTime,
        target_from_time: targetFromTime,
        trades: [],
        trade_count: 0,
        error: error.message
      });
      failCount++;
    }
  }

  console.log(`\n\n新获取完成: 成功 ${successCount}, 失败 ${failCount}`);

  // 从缓存加载已处理的代币数据（如果存在）
  const existingResults = [];
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      const existingData = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
      const existingResultsMap = new Map(
        existingData.results.map(r => [r.token_address.toLowerCase(), r])
      );

      for (const cached of cachedTokens) {
        if (existingResultsMap.has(cached.token_address.toLowerCase())) {
          existingResults.push(existingResultsMap.get(cached.token_address.toLowerCase()));
        }
      }
    } catch (e) {
      console.log('无法读取现有数据，将只保存新数据');
    }
  }

  // 合并新旧结果
  const allResults = [...existingResults, ...results];

  // 按代币去重（优先使用新获取的数据）
  const resultMap = new Map();
  for (const r of allResults) {
    resultMap.set(r.token_address.toLowerCase(), r);
  }

  const finalResults = Array.from(resultMap.values());

  // 保存结果
  const outputData = {
    experiment_id: inputData.experiment_id,
    window_seconds: WINDOW_SECONDS,
    total_tokens: finalResults.length,
    new_tokens_fetched: tokensToFetch.length,
    cached_tokens: cachedTokens.length,
    results: finalResults
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(outputData, null, 2));
  console.log(`\n✅ 交易数据已保存到 ${OUTPUT_FILE}`);

  // 更新已处理代币缓存
  fs.writeFileSync(PROCESSED_TOKENS_FILE, JSON.stringify([...processedTokens]));
  console.log(`✅ 已更新 processed_tokens.json (${processedTokens.size} 个代币)`);
}

main().catch(error => {
  console.error('\n错误:', error);
  process.exit(1);
});
