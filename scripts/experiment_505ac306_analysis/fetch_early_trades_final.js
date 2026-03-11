/**
 * 获取早期参与者交易数据（包含投入金额）
 * 更稳健的版本
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

console.log('='.repeat(80));
console.log('获取早期参与者交易数据（包含投入金额）');
console.log('='.repeat(80));
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
  const pairId = `${innerPair}-${tokenInfo.chain || 'bsc'}`; // 使用 chain 字段，默认为 bsc

  const checkTime = Math.floor(new Date(tokenInfo.metadata.timestamp).getTime() / 1000);
  const targetFromTime = checkTime - 90;
  const currentToTime = checkTime - 30; // 买入前30秒

  let allTrades = [];

  // 尝试获取交易数据，带重试
  const maxRetries = 5;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // 单次请求获取60秒窗口的数据
      const trades = await txApi.getSwapTransactions(pairId, 300, targetFromTime, currentToTime, 'asc');

      if (trades && trades.length > 0) {
        allTrades = trades;
        break;
      } else if (trades && trades.length === 0) {
        // 没有交易数据
        break;
      }
    } catch (error) {
      if (attempt < maxRetries - 1) {
        const waitTime = (attempt + 1) * 5000; // 5s, 10s, 15s, 20s
        console.log(`  [${tokenInfo.token_symbol}] 请求失败，${waitTime/1000}s后重试 (${attempt + 1}/${maxRetries})`);
        await sleep(waitTime);
      } else {
        console.log(`  [${tokenInfo.token_symbol}] 最终失败: ${error.message}`);
      }
    }
  }

  // 统计每个钱包的投入
  const walletInvestments = {};

  allTrades.forEach(trade => {
    // 判断买入方向：
    // four.meme上，交易对格式是 token/BNB
    // 买入token时：from是token，to是BNB（用BNB买token）
    // from_usd是卖出的token的USD价值，即买入成本

    // 更准确的方式：检查from和to的token地址
    const tokenAddress = tokenInfo.token_address.toLowerCase();
    const fromIsToken = trade.from_token && trade.from_token.toLowerCase() === tokenAddress;
    const toIsBNB = trade.to_token_symbol === 'BNB';

    // 如果from是token，to是BNB，说明是买入token
    if (fromIsToken && toIsBNB) {
      const wallet = trade.from_address?.toLowerCase();
      // from_amount是卖出的token数量，from_usd是卖出获得的USD（即买入成本）
      const amountUSD = trade.from_usd || 0;
      const amountToken = trade.from_amount || 0;

      if (wallet && amountUSD > 0) {
        walletInvestments[wallet] = (walletInvestments[wallet] || 0) + amountUSD;
      }
    }
  });

  process.stdout.write(`\r进度: ${index + 1}/${total} (${allTrades.length}笔交易, ${Object.keys(walletInvestments).length}个钱包)`);

  return {
    token_symbol: tokenInfo.token_symbol,
    token_address: tokenInfo.token_address,
    total_investment_usd: Object.values(walletInvestments).reduce((a, b) => a + b, 0),
    wallet_count: Object.keys(walletInvestments).length,
    wallet_investments: walletInvestments,
    transaction_count: allTrades.length
  };
}

// 串行处理（避免API限流）
async function main() {
  const results = [];
  let skipped = 0;

  for (let i = 0; i < uniqueTokens.length; i++) {
    const tokenInfo = uniqueTokens[i];

    const result = await processToken(tokenInfo, i, uniqueTokens.length);
    results.push(result);

    if (result.wallet_count === 0) {
      skipped++;
    }

    // 每个代币之间延迟，避免限流
    await sleep(2000);
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

  // 显示几个示例
  console.log('\n示例代币数据:');
  results.filter(r => r.wallet_count > 0).slice(0, 3).forEach(t => {
    console.log(`  ${t.token_symbol}: ${t.wallet_count}个钱包, $${t.total_investment_usd.toFixed(2)}`);
  });

  // 保存结果
  fs.writeFileSync(
    path.join(DATA_DIR, 'data/token_early_participants_with_investment.json'),
    JSON.stringify(results, null, 2)
  );

  console.log(`\n✅ 数据已保存到 data/token_early_participants_with_investment.json`);
}

main().catch(console.error);
