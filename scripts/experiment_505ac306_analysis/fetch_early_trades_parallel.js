/**
 * 获取早期参与者交易数据（包含投入金额）
 * 使用并行处理加速
 */

require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });
const fs = require('fs');
const path = require('path');

const DATA_DIR = '/Users/nobody1/Desktop/Codes/richer-js/scripts/experiment_505ac306_analysis';

// 加载买入信号
const buySignals = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'data/buy_signals.json'), 'utf8'));

// 去重，只处理唯一代币
const tokenMap = new Map();
buySignals.forEach(signal => {
  if (!tokenMap.has(signal.token_address)) {
    tokenMap.set(signal.token_address, signal);
  }
});
const uniqueTokens = Array.from(tokenMap.values());

console.log(`总代币数: ${uniqueTokens.length}`);

// 延迟函数
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 处理单个代币
async function processToken(tokenInfo, index, total) {
  const { AveTxAPI } = require('/Users/nobody1/Desktop/Codes/richer-js/src/core/ave-api');
  const config = require('/Users/nobody1/Desktop/Codes/richer-js/config/default.json');

  const txApi = new AveTxAPI(
    config.ave?.apiUrl || 'https://prod.ave-api.com',
    config.ave?.timeout || 30000,
    process.env.AVE_API_KEY
  );

  const innerPair = `${tokenInfo.token_address}_fo`;
  const pairId = `${innerPair}-${tokenInfo.blockchain}`;

  const checkTime = Math.floor(new Date(tokenInfo.metadata.timestamp).getTime() / 1000);
  const targetFromTime = checkTime - 90;

  let currentToTime = checkTime;
  const allTrades = [];
  let loopCount = 0;
  const maxLoops = 10;

  try {
    while (loopCount < maxLoops) {
      loopCount++;

      const trades = await txApi.getSwapTransactions(pairId, 300, targetFromTime, currentToTime, 'asc');

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

    // 统计每个钱包的投入金额（from_usd是卖出代币获得的USD，相当于买入成本）
    const walletInvestments = {};

    uniqueTrades.forEach(trade => {
      const wallet = trade.from_address?.toLowerCase();
      // 判断是否是买入：from是代币，to是BNB
      const isBuy = trade.to_token_symbol === 'BNB' || trade.to_token?.toLowerCase() === 'bnb';
      const amountUSD = isBuy ? (trade.from_usd || 0) : 0;

      if (wallet && amountUSD > 0) {
        walletInvestments[wallet] = (walletInvestments[wallet] || 0) + amountUSD;
      }
    });

    process.stdout.write(`\r进度: ${index + 1}/${total} (${uniqueTrades.length}笔交易)`);

    return {
      token_symbol: tokenInfo.token_symbol,
      token_address: tokenInfo.token_address,
      total_investment_usd: Object.values(walletInvestments).reduce((a, b) => a + b, 0),
      wallet_count: Object.keys(walletInvestments).length,
      wallet_investments: walletInvestments,
      transaction_count: uniqueTrades.length
    };

  } catch (error) {
    return {
      token_symbol: tokenInfo.token_symbol,
      token_address: tokenInfo.token_address,
      total_investment_usd: 0,
      wallet_count: 0,
      wallet_investments: {},
      transaction_count: 0,
      error: error.message
    };
  }
}

// 并行处理
async function main() {
  console.log('='.repeat(80));
  console.log('获取早期参与者交易数据（包含投入金额）- 并行版');
  console.log('='.repeat(80));

  const results = [];
  const concurrency = 10; // 并发数
  let processed = 0;

  for (let i = 0; i < uniqueTokens.length; i += concurrency) {
    const batch = uniqueTokens.slice(i, i + concurrency);
    const batchPromises = batch.map((token, idx) =>
      processToken(token, i + idx, uniqueTokens.length)
    );

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    await sleep(1000); // 批次间延迟
  }

  console.log(`\r完成: ${uniqueTokens.length}/${uniqueTokens.length}`);

  // 统计
  const totalTokens = results.length;
  const tokensWithData = results.filter(r => r.wallet_count > 0).length;
  const totalWallets = new Set();
  let totalInvestment = 0;
  let totalTransactions = 0;

  results.forEach(r => {
    Object.keys(r.wallet_investments).forEach(w => totalWallets.add(w));
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

  // 保存结果
  fs.writeFileSync(
    path.join(DATA_DIR, 'data/token_early_trades_with_amounts.json'),
    JSON.stringify(results, null, 2)
  );

  console.log(`\n✅ 数据已保存到 data/token_early_trades_with_amounts.json`);
}

main().catch(console.error);
