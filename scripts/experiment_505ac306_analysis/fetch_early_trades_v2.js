/**
 * 获取早期参与者交易数据（包含投入金额）
 * 参考之前成功的 get_all_tokens.js 方法
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
console.log('获取早期参与者交易数据（包含投入金额）');
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
async function getEarlyTradesWithAmounts(tokenInfo) {
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

    // 统计每个钱包的投入金额
    // 参考：get_all_tokens.js 使用 trade.from_address 作为参与者
    const walletInvestments = {};

    uniqueTrades.forEach(trade => {
      const wallet = trade.from_address?.toLowerCase();
      // 使用 from_usd 作为投入金额（无论方向，都记录）
      const amountUSD = trade.from_usd || 0;

      if (wallet && amountUSD > 0) {
        walletInvestments[wallet] = (walletInvestments[wallet] || 0) + amountUSD;
      }
    });

    return {
      token_symbol: tokenInfo.token_symbol,
      token_address: tokenInfo.token_address,
      total_investment_usd: Object.values(walletInvestments).reduce((a, b) => a + b, 0),
      wallet_count: Object.keys(walletInvestments).length,
      wallet_investments: walletInvestments,
      transaction_count: uniqueTrades.length,
      participants: Object.keys(walletInvestments) // 保存参与者地址列表
    };

  } catch (error) {
    console.log(`    [${tokenInfo.token_symbol}] 获取失败: ${error.message}`);
    return {
      token_symbol: tokenInfo.token_symbol,
      token_address: tokenInfo.token_address,
      total_investment_usd: 0,
      wallet_count: 0,
      wallet_investments: {},
      transaction_count: 0,
      participants: [],
      error: error.message
    };
  }
}

// 主函数
async function main() {
  const results = [];
  let skipped = 0;
  let errorCount = 0;

  for (let i = 0; i < uniqueTokens.length; i++) {
    const tokenInfo = uniqueTokens[i];
    process.stdout.write(`\r进度: ${i + 1}/${uniqueTokens.length} (跳过:${skipped} 错误:${errorCount})`);

    const result = await getEarlyTradesWithAmounts(tokenInfo);
    results.push(result);

    if (result.wallet_count === 0) {
      skipped++;
    }
    if (result.error) {
      errorCount++;
    }

    // 速率限制
    await sleep(500);
  }

  console.log(`\r完成: ${uniqueTokens.length}/${uniqueTokens.length}`);

  // 统计
  const totalTokens = results.length;
  const tokensWithData = results.filter(r => r.wallet_count > 0).length;
  const totalWallets = new Set();
  let totalInvestment = 0;
  let totalTransactions = 0;

  results.forEach(r => {
    (r.participants || []).forEach(w => totalWallets.add(w));
    totalInvestment += r.total_investment_usd || 0;
    totalTransactions += r.transaction_count || 0;
  });

  console.log('\n' + '='.repeat(80));
  console.log('统计结果');
  console.log('='.repeat(80));
  console.log(`总代币数: ${totalTokens}`);
  console.log(`有交易数据的代币: ${tokensWithData}`);
  console.log(`无交易数据的代币: ${totalTokens - tokensWithData}`);
  console.log(`唯一钱包数: ${totalWallets.size}`);
  console.log(`总投入金额: $${totalInvestment.toFixed(2)}`);
  console.log(`总交易数: ${totalTransactions}`);

  // 显示示例
  console.log('\n示例数据:');
  results.filter(r => r.wallet_count > 0).slice(0, 3).forEach(t => {
    console.log(`  ${t.token_symbol}: ${t.wallet_count}个钱包, $${t.total_investment_usd.toFixed(2)}, ${t.transaction_count}笔交易`);
  });

  // 保存结果
  fs.writeFileSync(
    path.join(DATA_DIR, 'data/token_early_participants_with_investment.json'),
    JSON.stringify(results, null, 2)
  );

  console.log(`\n✅ 数据已保存到 data/token_early_participants_with_investment.json`);
}

main().catch(console.error);
