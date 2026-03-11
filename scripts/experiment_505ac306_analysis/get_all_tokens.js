/**
 * 重新获取所有代币的早期参与者数据
 * 直接从 signals 数据中提取代币信息，添加重试和延迟机制
 */

require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });
const fs = require('fs');
const path = require('path');
const http = require('http');

const DATA_DIR = '/Users/nobody1/Desktop/Codes/richer-js/scripts/experiment_505ac306_analysis';
const EXPERIMENT_ID = '505ac306-97fc-43d6-b027-00b909469b81';

// HTTP 工具
function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ success: false, error: e.message, raw: data });
        }
      });
    }).on('error', reject);
  });
}

// 延迟函数
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 获取所有买入信号并提取代币信息
async function getAllTokenInfoFromSignals() {
  console.log('[步骤1] 获取买入信号...');
  const response = await get(`http://localhost:3010/api/experiment/${EXPERIMENT_ID}/signals?signalType=BUY&executed=true&limit=1000`);

  if (!response.success) {
    throw new Error(`获取信号失败: ${response.error}`);
  }

  const signals = response.signals || [];
  console.log(`  获取到 ${signals.length} 个买入信号`);

  // 提取唯一代币信息
  const tokenMap = new Map();

  signals.forEach(signal => {
    const tokenAddress = signal.token_address;
    if (!tokenMap.has(tokenAddress)) {
      tokenMap.set(tokenAddress, {
        token_address: tokenAddress,
        token_symbol: signal.token_symbol,
        blockchain: signal.blockchain || 'bsc',
        executed_at: signal.executed_at,
        timestamp: signal.metadata?.timestamp || signal.created_at
      });
    }
  });

  console.log(`  提取到 ${tokenMap.size} 个唯一代币`);
  return Array.from(tokenMap.values());
}

// 带重试的 API 调用
async function getTradesWithRetry(txApi, pairId, limit, fromTime, toTime, sort, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const trades = await txApi.getSwapTransactions(pairId, limit, fromTime, toTime, sort);
      return trades;
    } catch (error) {
      const isLastAttempt = attempt === maxRetries;
      const isRateLimit = error.message.includes('429');

      if (isRateLimit && !isLastAttempt) {
        // 429 错误，等待更长时间
        const waitTime = attempt * 2000; // 2s, 4s, 6s, 8s, 10s
        console.log(`      [429错误] 等待 ${waitTime/1000}s 后重试 (${attempt}/${maxRetries})...`);
        await sleep(waitTime);
      } else if (!isLastAttempt) {
        // 其他错误，短等待后重试
        await sleep(1000);
      } else {
        throw error;
      }
    }
  }
  return [];
}

// 获取早期交易（买入前90秒）
async function getEarlyTradesBeforeBuy(tokenInfo) {
  const { AveTxAPI } = require('/Users/nobody1/Desktop/Codes/richer-js/src/core/ave-api');
  const config = require('/Users/nobody1/Desktop/Codes/richer-js/config/default.json');

  const txApi = new AveTxAPI(
    config.ave?.apiUrl || 'https://prod.ave-api.com',
    config.ave?.timeout || 30000,
    process.env.AVE_API_KEY
  );

  // 从 signal metadata 中获取 inner_pair
  const innerPair = `${tokenInfo.token_address}_fo`;
  const pairId = `${innerPair}-${tokenInfo.blockchain}`;

  // 使用 checkTime (metadata.timestamp) 而不是 executed_at
  const checkTime = Math.floor(new Date(tokenInfo.timestamp).getTime() / 1000);
  const targetFromTime = checkTime - 90;

  let currentToTime = checkTime;
  const allTrades = [];
  let loopCount = 0;
  const maxLoops = 10;

  try {
    while (loopCount < maxLoops) {
      loopCount++;

      const trades = await getTradesWithRetry(txApi, pairId, 300, targetFromTime, currentToTime, 'asc');

      if (trades.length === 0) break;

      allTrades.push(...trades);

      const batchFirstTime = trades[0].time;

      if (batchFirstTime <= targetFromTime) {
        break;
      }

      if (trades.length === 300) {
        currentToTime = batchFirstTime - 1;
      } else {
        break;
      }
    }

    // 去重并按时间排序
    const seen = new Set();
    const uniqueTrades = [];
    for (const trade of allTrades) {
      const key = trade.tx_id || `${trade.time}_${trade.from_address}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueTrades.push(trade);
      }
    }

    return uniqueTrades.sort((a, b) => a.time - b.time);

  } catch (error) {
    return null; // 返回 null 表示彻底失败
  }
}

// 主函数
async function main() {
  console.log('='.repeat(80));
  console.log('获取所有代币的早期参与者数据');
  console.log('='.repeat(80));

  const allTokens = await getAllTokenInfoFromSignals();

  const tokenEarlyParticipants = {};
  const allWallets = new Set();
  let successCount = 0;
  let failCount = 0;

  console.log(`\n[步骤2] 获取早期交易数据...`);

  for (let i = 0; i < allTokens.length; i++) {
    const token = allTokens[i];

    const earlyTrades = await getEarlyTradesBeforeBuy(token);

    if (earlyTrades === null) {
      failCount++;
      process.stdout.write(`\r  处理中: ${i + 1}/${allTokens.length} (成功:${successCount} 失败:${failCount})`);
      continue;
    }

    if (earlyTrades.length > 0) {
      const participants = new Set();
      earlyTrades.forEach(trade => {
        participants.add(trade.from_address);
      });

      tokenEarlyParticipants[token.token_address] = {
        token_symbol: token.token_symbol,
        participant_count: participants.size,
        participants: Array.from(participants)
      };

      participants.forEach(w => allWallets.add(w));
    }

    successCount++;
    process.stdout.write(`\r  处理中: ${i + 1}/${allTokens.length} (成功:${successCount} 失败:${failCount})`);

    // 每个请求之间添加延迟，避免 429
    await sleep(500);
  }

  console.log(`\r  ✓ 完成: ${allTokens.length} 个代币`);
  console.log(`  ✓ 有早期交易: ${Object.keys(tokenEarlyParticipants).length} 个`);
  console.log(`  ✓ 唯一钱包数: ${allWallets.size}`);
  console.log(`  ✓ 失败: ${failCount} 个`);

  // 保存数据
  fs.writeFileSync(
    path.join(DATA_DIR, 'token_early_participants_all.json'),
    JSON.stringify(tokenEarlyParticipants, null, 2)
  );

  console.log(`\n✅ 数据已保存到: ${DATA_DIR}/token_early_participants_all.json`);
}

main().catch(console.error);
