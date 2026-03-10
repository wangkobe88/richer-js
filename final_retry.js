/**
 * 最终重试获取0xd8d4dd的数据
 */

const { AveTxAPI } = require('./src/core/ave-api/tx-api');
require('dotenv').config({ path: 'config/.env' });

const txApi = new AveTxAPI(
  process.env.AVE_API_BASE_URL || 'https://prod.ave-api.com',
  30000,
  process.env.AVE_API_KEY
);

async function checkLastToken() {
  const address = '0xd8d4ddeb91987a121422567260a88230dbb34444';
  const name = '0xd8d4dd';
  const profit = '-29.7%';

  console.log(`=== 检查 ${name} ===\n`);
  console.log(`收益: ${profit}\n`);

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
      console.log('无交易数据');
      return;
    }

    console.log(`交易数据: ${uniqueTrades.length}笔交易`);
    const duration = (uniqueTrades[uniqueTrades.length - 1].time - uniqueTrades[0].time) / 60;
    console.log(`时间跨度: ${duration.toFixed(1)}分钟\n`);

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
        const sellRatio = data.sellTrades.length > 0
          ? (data.sellTrades.reduce((sum, s) => sum + s.fromAmount, 0) / data.totalBuyTokens)
          : 0;

        earlyWhales.push({
          wallet: wallet.substring(0, 10),
          amount: data.totalBuyAmount,
          hasSold: data.sellTrades.length > 0,
          sellRatio: sellRatio
        });
      }
    }

    // 计算持有率和卖出率
    const holdingWhales = earlyWhales.filter(w => !w.hasSold);
    const holdRatio = earlyWhales.length > 0 ? holdingWhales.length / earlyWhales.length : 0;
    const avgSellRatio = earlyWhales.length > 0
      ? earlyWhales.reduce((sum, w) => sum + w.sellRatio, 0) / earlyWhales.length
      : 0;

    console.log(`早期大户(>$200, 前${earlyTradeCount}笔): ${earlyWhales.length}个\n`);

    if (earlyWhales.length > 0) {
      console.log('大户详情:');
      earlyWhales.forEach(w => {
        const status = w.hasSold ? `已卖出${(w.sellRatio * 100).toFixed(0)}%` : '持有';
        console.log(`  - ${w.wallet}: $${w.amount.toFixed(0)} (${status})`);
      });
      console.log(`\n持有率: ${(holdRatio * 100).toFixed(0)}%`);
      console.log(`卖出率: ${(avgSellRatio * 100).toFixed(0)}%`);
    }

    // 判断是否会被召回
    const wouldBeFiltered = avgSellRatio > 0.7;
    console.log(`\n是否召回: ${wouldBeFiltered ? '✓ 是（过滤）' : '✗ 否（通过）'}`);

    // 使用条件 earlyWhaleSellRatio > 0.7
    console.log(`\n使用条件: earlyWhaleSellRatio > 0.7`);
    console.log(`实际值: ${avgSellRatio.toFixed(2)}`);
    console.log(`结果: ${avgSellRatio > 0.7 ? '过滤' : '通过'}`);

  } catch (error) {
    console.log(`错误: ${error.message}`);
  }
}

checkLastToken().catch(console.error);
