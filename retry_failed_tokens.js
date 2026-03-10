/**
 * 重试检查失败的代币（分批进行）
 */

const { AveTxAPI } = require('./src/core/ave-api/tx-api');
require('dotenv').config({ path: 'config/.env' });

const txApi = new AveTxAPI(
  process.env.AVE_API_BASE_URL || 'https://prod.ave-api.com',
  30000,
  process.env.AVE_API_KEY
);

// 之前失败的代币
const failedTokens = [
  { address: '0x6df5fd6949f2527ee99ce7c979c00f2a5bd34444', name: '0x6df5fd', profit: 'N/A' },
  { address: '0xd8d4ddeb91987a121422567260a88230dbb34444', name: '0xd8d4dd', profit: '-29.7%' },
  { address: '0x9b58b98a1ea58d59ffaaa9f1d2e5fd4168444444', name: 'BINANCEANWHERE', profit: '-54.6%' },
  { address: '0x71c06c7064c5aaf398f6f956d8146ad0e0e84444', name: "Dude's Day", profit: 'N/A' },
  { address: '0xd3b4d55ef44da2fee0e78e478d2fe94751514444', name: '抖音求真', profit: '-35.9%' }
];

async function checkToken(tokenInfo) {
  const { address, name, profit } = tokenInfo;

  console.log(`\n【${name}】`);
  console.log(`  收益: ${profit}`);

  const innerPair = `${address}_fo`;
  const pairId = `${innerPair}-bsc`;

  try {
    const allTrades = [];
    let currentToTime = Date.now() / 1000;

    for (let loop = 1; loop <= 15; loop++) {
      const trades = await txApi.getSwapTransactions(
        pairId, 300, 0, currentToTime, 'asc'
      );
      if (trades.length === 0) break;
      allTrades.push(...trades);
      if (trades[0].time <= 0 || trades.length < 300) break;
      currentToTime = trades[0].time - 1;
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

    if (uniqueTrades.length === 0) {
      console.log(`  结果: 无交易数据`);
      return null;
    }

    console.log(`  交易数据: ${uniqueTrades.length}笔交易`);

    // 分析早期大户
    const earlyTradeCount = Math.min(30, Math.floor(uniqueTrades.length * 0.2));
    const earlyTradeEndTime = uniqueTrades[earlyTradeCount - 1]?.time || uniqueTrades[0].time;

    const baseCurrencies = ['WBNB', 'USDT', 'BUSD', 'USDC', 'ETH'];
    const walletMap = new Map();

    for (const trade of uniqueTrades) {
      const wallet = trade.wallet_address?.toLowerCase();
      if (!wallet) continue;

      if (!walletMap.has(wallet)) {
        walletMap.set(wallet, {
          firstBuyTime: null,
          totalBuyAmount: 0,
          totalBuyTokens: 0,
          sellTrades: []
        });
      }

      const walletData = walletMap.get(wallet);
      const fromToken = trade.from_token_symbol;
      const toToken = trade.to_token_symbol;
      const fromUsd = trade.from_usd || 0;
      const toAmount = trade.to_amount || 0;
      const toUsd = trade.to_usd || 0;
      const fromAmount = trade.from_amount || 0;
      const relTime = trade.time - uniqueTrades[0].time;

      const isBuy = fromToken && baseCurrencies.includes(fromToken);
      const isSell = toToken && baseCurrencies.includes(toToken);

      if (isBuy) {
        if (walletData.firstBuyTime === null || relTime < walletData.firstBuyTime) {
          walletData.firstBuyTime = relTime;
        }
        walletData.totalBuyAmount += fromUsd;
        walletData.totalBuyTokens += toAmount;
      }

      if (isSell) {
        walletData.sellTrades.push({ toUsd, fromAmount });
      }
    }

    // 统计早期大户
    const earlyWhales = [];
    const earlyWhaleThreshold = earlyTradeEndTime - uniqueTrades[0].time;

    for (const [wallet, data] of walletMap) {
      if (data.firstBuyTime !== null &&
          data.totalBuyAmount > 200 &&
          data.firstBuyTime <= earlyWhaleThreshold) {
        earlyWhales.push({
          wallet: wallet.substring(0, 10),
          amount: data.totalBuyAmount,
          hasSold: data.sellTrades.length > 0,
          sellRatio: data.sellTrades.length > 0
            ? (data.sellTrades.reduce((sum, s) => sum + s.fromAmount, 0) / data.totalBuyTokens)
            : 0
        });
      }
    }

    // 计算持有率和卖出率
    const holdingWhales = earlyWhales.filter(w => !w.hasSold);
    const holdRatio = earlyWhales.length > 0 ? holdingWhales.length / earlyWhales.length : 0;
    const avgSellRatio = earlyWhales.length > 0
      ? earlyWhales.reduce((sum, w) => sum + w.sellRatio, 0) / earlyWhales.length
      : 0;

    console.log(`  早期大户(>$200, 前${earlyTradeCount}笔): ${earlyWhales.length}个`);

    if (earlyWhales.length > 0) {
      earlyWhales.slice(0, 3).forEach(w => {
        const status = w.hasSold ? `已卖出${(w.sellRatio * 100).toFixed(0)}%` : '持有';
        console.log(`    - ${w.wallet}: $${w.amount.toFixed(0)} (${status})`);
      });
      console.log(`  持有率: ${(holdRatio * 100).toFixed(0)}%`);
      console.log(`  卖出率: ${(avgSellRatio * 100).toFixed(0)}%`);
    }

    // 判断是否会被召回（使用条件 earlyWhaleSellRatio > 0.7）
    const wouldBeFiltered = avgSellRatio > 0.7;
    console.log(`  是否召回: ${wouldBeFiltered ? '✓ 是（过滤）' : '✗ 否（通过）'}`);

    return {
      name,
      profit,
      whaleCount: earlyWhales.length,
      holdRatio,
      sellRatio: avgSellRatio,
      wouldBeFiltered
    };

  } catch (error) {
    console.log(`  错误: ${error.message}`);
    return null;
  }
}

async function retryFailedTokens() {
  console.log('=== 重试检查失败的代币 ===\n');

  const results = [];

  for (let i = 0; i < failedTokens.length; i++) {
    const result = await checkToken(failedTokens[i]);

    if (result) {
      results.push(result);
    }

    // 每个请求之间等待，避免限流
    if (i < failedTokens.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  console.log('\n=== 总结 ===\n');

  const filtered = results.filter(r => r.wouldBeFiltered);
  const passed = results.filter(r => !r.wouldBeFiltered);

  console.log(`成功检查: ${results.length}个`);
  console.log(`被召回（过滤）: ${filtered.length}个`);
  console.log(`通过（未过滤）: ${passed.length}个`);

  if (filtered.length > 0) {
    console.log('\n被召回的代币:');
    filtered.forEach(r => {
      console.log(`  ${r.name}: ${r.profit}, ${r.whaleCount}大户, 卖出率${(r.sellRatio * 100).toFixed(0)}%`);
    });
  }

  if (passed.length > 0) {
    console.log('\n通过的代币:');
    passed.forEach(r => {
      console.log(`  ${r.name}: ${r.profit}, ${r.whaleCount}大户, 卖出率${(r.sellRatio * 100).toFixed(0)}%`);
    });
  }

  console.log('\n=== 所有用户指定代币召回情况 ===\n');

  // 加上之前成功的
  const allResults = [
    { name: '0xb9b114', profit: '-30.9%', wouldBeFiltered: true },
    { name: '0xf3372a', profit: '-36.0%', wouldBeFiltered: true },
    { name: '0x5850bb', profit: 'N/A', wouldBeFiltered: true },
    ...results
  ];

  const totalFiltered = allResults.filter(r => r.wouldBeFiltered).length;
  const totalPassed = allResults.filter(r => !r.wouldBeFiltered).length;
  const knownLoss = allResults.filter(r => r.profit && r.profit !== 'N/A' && parseFloat(r.profit) < 0);
  const filteredKnownLoss = knownLoss.filter(r => r.wouldBeFiltered).length;

  console.log(`总共: ${allResults.length}个代币`);
  console.log(`被召回: ${totalFiltered}个`);
  console.log(`通过: ${totalPassed}个`);
  console.log(`已知亏损代币: ${knownLoss.length}个`);
  console.log(`召回的亏损代币: ${filteredKnownLoss}/${knownLoss.length} (${knownLoss.length > 0 ? (filteredKnownLoss / knownLoss.length * 100).toFixed(1) : 0}%)`);
}

retryFailedTokens().catch(console.error);
