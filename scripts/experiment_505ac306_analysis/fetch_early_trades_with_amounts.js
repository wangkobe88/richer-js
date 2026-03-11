/**
 * 获取早期参与者交易数据（包含投入金额）
 * 复用之前成功的方法
 */

require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });
const fs = require('fs');
const path = require('path');
const http = require('http');

const DATA_DIR = '/Users/nobody1/Desktop/Codes/richer-js/scripts/experiment_505ac306_analysis';

// 加载买入信号
const buySignals = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'data/buy_signals.json'), 'utf8'));

// HTTP 工具（用于本地API）
function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ success: false, error: e.message });
        }
      });
    }).on('error', reject);
  });
}

// 延迟函数
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 带重试的 API 调用
async function getTradesWithRetry(txApi, pairId, limit, fromTime, toTime, sort, maxRetries = 10) {
  const delays = [1000, 2000, 3000, 5000, 8000, 10000, 15000, 20000, 30000];

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const trades = await txApi.getSwapTransactions(pairId, limit, fromTime, toTime, sort);
      return trades;
    } catch (error) {
      const isLastAttempt = attempt === maxRetries - 1;

      if (!isLastAttempt) {
        const delay = delays[attempt] || 30000;
        await sleep(delay);
      } else {
        throw error;
      }
    }
  }
  return [];
}

// 获取早期交易（买入前90秒）
async function getEarlyTradesWithAmounts(tokenInfo) {
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

    // 统计每个钱包的投入金额
    const walletInvestments = {};

    uniqueTrades.forEach(trade => {
      const wallet = trade.from_address?.toLowerCase();
      const amountUSD = trade.from_usd || 0; // from_usd 是投入的USD金额

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

// 主函数
async function main() {
  console.log('='.repeat(80));
  console.log('获取早期参与者交易数据（包含投入金额）');
  console.log('='.repeat(80));
  console.log(`总代币数: ${buySignals.length}`);

  const results = [];
  let processed = 0;
  let skipped = 0;
  let errorCount = 0;

  for (const signal of buySignals) {
    processed++;
    process.stdout.write(`\r进度: ${processed}/${buySignals.length} (${skipped}个无数据)`);

    const result = await getEarlyTradesWithAmounts(signal);
    results.push(result);

    if (result.wallet_count === 0) {
      skipped++;
    }
    if (result.error) {
      errorCount++;
    }

    // 速率限制
    await sleep(200);
  }

  console.log(`\r完成: ${processed}/${buySignals.length}`);

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
  console.log(`处理失败: ${errorCount}`);
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
