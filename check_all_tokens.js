/**
 * 检查所有交易的 from_token 类型
 */

require('dotenv').config({ path: 'config/.env' });
const { AveTxAPI } = require('./src/core/ave-api');

const txApi = new AveTxAPI('https://prod.ave-api.com', 30000, process.env.AVE_API_KEY);

async function checkAllTokens() {
  const tokenAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';
  const pairId = `${tokenAddress}_fo-bsc`;

  const launchAt = 1773077436;
  const checkTime = 1773077512;

  const trades = await txApi.getSwapTransactions(pairId, 300, launchAt, checkTime, 'asc');

  console.log('=== 检查所有交易的 from_token ===\n');

  const baseCurrencies = ['WBNB', 'USDT', 'BUSD', 'USDC', 'ETH'];

  // 统计所有 from_token
  const fromTokenStats = new Map();

  trades.forEach(t => {
    const fromToken = t.from_token || 'null';
    const fromSymbol = t.from_token_symbol || 'null';
    const key = `${fromToken} (${fromSymbol})`;

    if (!fromTokenStats.has(key)) {
      fromTokenStats.set(key, {
        fromToken,
        fromSymbol,
        count: 0,
        totalUsd: 0,
        isBaseCurrency: baseCurrencies.includes(fromToken)
      });
    }

    const stats = fromTokenStats.get(key);
    stats.count++;
    stats.totalUsd += t.from_usd || 0;
  });

  console.log('from_token 统计:');
  console.log('');
  console.log('from_token | symbol | 是基准货币 | 交易数 | 总金额USD');
  console.log('-----------|--------|-----------|--------|----------');

  fromTokenStats.forEach((stats, key) => {
    const isBase = stats.isBaseCurrency ? '✓' : '✗';
    console.log(`${stats.fromToken.padEnd(10)} | ${stats.fromSymbol.padEnd(6)} | ${isBase.padStart(9)} | ${stats.count.toString().padStart(6)} | $${stats.totalUsd.toFixed(2).padStart(8)}`);
  });

  console.log('');
  console.log('=== 前20笔交易的 from_token ===\n');
  console.log('序号 | from_token_symbol | from_usd | 是基准货币');
  console.log('-----|------------------|----------|----------');

  trades.slice(0, 20).forEach((t, i) => {
    const fromToken = t.from_token || 'null';
    const isBase = baseCurrencies.includes(fromToken) ? '✓' : '✗';
    const fromUsd = (t.from_usd || 0).toFixed(2);
    console.log(`${(i + 1).toString().padStart(4)} | ${t.from_token_symbol?.padEnd(16)} | $${fromUsd.padStart(7)} | ${isBase}`);
  });

  console.log('');
  console.log('=== 分析 ===\n');

  // 检查是否有大额买入不是基准货币
  let nonBaseBigBuys = 0;
  trades.slice(0, 90).forEach(t => {
    const fromToken = t.from_token || '';
    const isBase = baseCurrencies.includes(fromToken);
    const fromUsd = t.from_usd || 0;

    if (!isBase && fromUsd > 200) {
      nonBaseBigBuys++;
      if (nonBaseBigBuys <= 5) {
        console.log(`交易 ${trades.indexOf(t) + 1}:`);
        console.log(`  from_token: ${fromToken}`);
        console.log(`  from_symbol: ${t.from_token_symbol}`);
        console.log(`  from_usd: $${fromUsd.toFixed(2)}`);
        console.log(`  不是基准货币，不被识别为买入`);
      }
    }
  });

  console.log('');
  console.log(`前90笔交易中，金额 > $200 但不是基准货币的交易: ${nonBaseBigBuys} 笔`);
  console.log('');
  console.log('⚠️  问题：早期大户识别只统计使用 WBNB/USDT/BUSD/USDC/ETH 的买入！');
  console.log('    使用其他代币（如 USD1）的买入，即使金额很大也不会被识别为早期大户。');
}

checkAllTokens().catch(console.error);
