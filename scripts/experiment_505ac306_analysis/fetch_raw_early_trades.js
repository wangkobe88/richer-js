/**
 * 获取原始早期交易数据（包含买卖方向）
 * 用于分析买卖行为与质量的关系
 */

require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });
const fs = require('fs');
const path = require('path');

const DATA_DIR = '/Users/nobody1/Desktop/Codes/richer-js/scripts/experiment_505ac306_analysis';

// 加载买入信号
const buySignals = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'data/buy_signals.json'), 'utf8'));

// 去重
const tokenMap = new Map();
buySignals.forEach(signal => {
  if (!tokenMap.has(signal.token_address)) {
    tokenMap.set(signal.token_address, signal);
  }
});
const uniqueTokens = Array.from(tokenMap.values());

console.log('='.repeat(80));
console.log('获取原始早期交易数据（包含买卖方向）');
console.log('='.repeat(80));
console.log(`总代币数: ${uniqueTokens.length}`);

// 延迟函数
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 带重试的 API 调用
async function getTradesWithRetry(txApi, pairId, limit, fromTime, toTime, sort, maxRetries = 5) {
  const delays = [2000, 5000, 10000, 20000, 30000];

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const trades = await txApi.getSwapTransactions(pairId, limit, fromTime, toTime, sort);
      return trades;
    } catch (error) {
      if (attempt < maxRetries - 1) {
        const delay = delays[attempt];
        console.log(`    API重试 ${attempt + 1}/${maxRetries}, 等待${delay/1000}s`);
        await sleep(delay);
      } else {
        throw error;
      }
    }
  }
  return [];
}

// 获取早期交易
async function getEarlyTradesWithDirection(tokenInfo) {
  const { AveTxAPI } = require('/Users/nobody1/Desktop/Codes/richer-js/src/core/ave-api');
  const config = require('/Users/nobody1/Desktop/Codes/richer-js/config/default.json');

  const txApi = new AveTxAPI(
    config.ave?.apiUrl || 'https://prod.ave-api.com',
    config.ave?.timeout || 30000,
    process.env.AVE_API_KEY
  );

  // 构造pairId
  const innerPair = `${tokenInfo.token_address}_fo`;
  const pairId = `${innerPair}-${tokenInfo.chain || 'bsc'}`;

  // 使用 checkTime (metadata.timestamp)
  const checkTime = Math.floor(new Date(tokenInfo.metadata.timestamp).getTime() / 1000);
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

    // 去重
    const seen = new Set();
    const uniqueTrades = [];
    for (const trade of allTrades) {
      const key = trade.tx_id || `${trade.time}_${trade.from_address}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueTrades.push(trade);
      }
    }

    // 保存原始交易数据
    return {
      token_symbol: tokenInfo.token_symbol,
      token_address: tokenInfo.token_address,
      trades_count: uniqueTrades.length,
      trades: uniqueTrades  // 保存完整的原始交易数据
    };

  } catch (error) {
    console.log(`    [${tokenInfo.token_symbol}] 获取失败: ${error.message}`);
    return {
      token_symbol: tokenInfo.token_symbol,
      token_address: tokenInfo.token_address,
      trades_count: 0,
      trades: [],
      error: error.message
    };
  }
}

// 主函数
async function main() {
  const results = [];
  let errorCount = 0;

  for (let i = 0; i < uniqueTokens.length; i++) {
    const tokenInfo = uniqueTokens[i];
    process.stdout.write(`\r进度: ${i + 1}/${uniqueTokens.length} (错误:${errorCount})`);

    const result = await getEarlyTradesWithDirection(tokenInfo);
    results.push(result);

    if (result.error) {
      errorCount++;
    }

    // 速率限制
    await sleep(500);
  }

  console.log(`\r完成: ${uniqueTokens.length}/${uniqueTokens.length}`);

  // 统计
  const totalTokens = results.length;
  const tokensWithData = results.filter(r => r.trades_count > 0).length;
  const totalTrades = results.reduce((sum, r) => sum + r.trades_count, 0);

  console.log('\n' + '='.repeat(80));
  console.log('统计结果');
  console.log('='.repeat(80));
  console.log(`总代币数: ${totalTokens}`);
  console.log(`有交易数据的代币: ${tokensWithData}`);
  console.log(`无交易数据的代币: ${totalTokens - tokensWithData}`);
  console.log(`总交易数: ${totalTrades}`);

  // 显示示例
  console.log('\n示例数据:');
  results.filter(r => r.trades_count > 0).slice(0, 3).forEach(t => {
    console.log(`  ${t.token_symbol}: ${t.trades_count}笔交易`);
    if (t.trades.length > 0) {
      const sample = t.trades[0];
      console.log(`    示例: from=${sample.from_token?.slice(0,8)}... to=${sample.to_token?.slice(0,8)}... from_usd=$${sample.from_usd?.toFixed(2)}`);
    }
  });

  // 保存结果
  fs.writeFileSync(
    path.join(DATA_DIR, 'data/token_early_trades_with_direction.json'),
    JSON.stringify(results, null, 2)
  );

  console.log(`\n✅ 数据已保存到 data/token_early_trades_with_direction.json`);
}

main().catch(console.error);
