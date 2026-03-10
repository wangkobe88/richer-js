/**
 * 分析特定代币的详细数据
 */

const { AveTxAPI } = require('./src/core/ave-api/tx-api');
require('dotenv').config({ path: 'config/.env' });

const txApi = new AveTxAPI(
  process.env.AVE_API_BASE_URL || 'https://prod.ave-api.com',
  30000,
  process.env.AVE_API_KEY
);

async function analyzeTokenTrades() {
  const tokenAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';
  const checkTime = Math.floor(new Date('2026-03-10T01:31:52Z').getTime() / 1000);

  const innerPair = `${tokenAddress}_fo`;
  const pairId = `${innerPair}-bsc`;

  console.log('=== 分析代币交易数据 ===');
  console.log('代币地址:', tokenAddress);
  console.log('检查时间:', new Date(checkTime * 1000).toLocaleString());
  console.log('');

  // 获取交易数据
  const allTrades = [];
  let currentToTime = checkTime;

  for (let loop = 1; loop <= 10; loop++) {
    const trades = await txApi.getSwapTransactions(
      pairId, 300, checkTime - 90, currentToTime, 'asc'
    );
    if (trades.length === 0) break;
    allTrades.push(...trades);
    if (trades[0].time <= (checkTime - 90) || trades.length < 300) break;
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

  console.log('=== 交易数据概览 ===');
  console.log('总交易数:', uniqueTrades.length);

  if (uniqueTrades.length === 0) {
    console.log('没有交易数据');
    return;
  }

  const earliestTime = uniqueTrades[0].time;
  const latestTime = uniqueTrades[uniqueTrades.length - 1].time;
  console.log('最早交易时间:', new Date(earliestTime * 1000).toLocaleString());
  console.log('最晚交易时间:', new Date(latestTime * 1000).toLocaleString());
  console.log('时间跨度:', ((latestTime - earliestTime) / 60).toFixed(1) + '分钟');

  // 分析钱包
  const baseCurrencies = ['WBNB', 'USDT', 'BUSD', 'USDC', 'ETH'];
  const walletMap = new Map();

  for (const trade of uniqueTrades) {
    const wallet = trade.wallet_address?.toLowerCase();
    if (!wallet) continue;

    if (!walletMap.has(wallet)) {
      walletMap.set(wallet, {
        firstBuyTime: null,
        totalBuyAmount: 0,
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
    const relTime = trade.time - earliestTime;

    const isBuy = fromToken && baseCurrencies.includes(fromToken);
    const isSell = toToken && baseCurrencies.includes(toToken);

    if (isBuy) {
      if (walletData.firstBuyTime === null || relTime < walletData.firstBuyTime) {
        walletData.firstBuyTime = relTime;
      }
      walletData.totalBuyAmount += fromUsd;
    }

    if (isSell) {
      walletData.sellTrades.push({ toUsd, fromAmount });
    }
  }

  // 分析早期大户
  const earlyThreshold = Math.floor(uniqueTrades.length * 0.3);
  const earlyTradeEndTime = uniqueTrades[earlyThreshold - 1]?.time || earliestTime;
  const earlyTimeThreshold = earlyTradeEndTime - earliestTime;

  console.log('');
  console.log('=== 早期定义 ===');
  console.log('早期阈值（30%）:', earlyThreshold, '笔交易');
  console.log('早期结束时间:', new Date(earlyTradeEndTime * 1000).toLocaleString());

  // 统计大额买家
  const allBigBuyers = [];
  const earlyBigBuyers = [];

  for (const [wallet, data] of walletMap) {
    if (data.totalBuyAmount > 200) {
      allBigBuyers.push({
        wallet: wallet.substring(0, 10),
        amount: data.totalBuyAmount,
        firstBuyTime: data.firstBuyTime,
        hasSold: data.sellTrades.length > 0
      });

      if (data.firstBuyTime !== null && data.firstBuyTime <= earlyTimeThreshold) {
        earlyBigBuyers.push({
          wallet: wallet.substring(0, 10),
          amount: data.totalBuyAmount,
          firstBuyTime: data.firstBuyTime,
          hasSold: data.sellTrades.length > 0
        });
      }
  }

  console.log('');
  console.log('=== 大额买家分析 ===');
  console.log('所有大额买家(>$200):', allBigBuyers.length);
  console.log('早期大额买家(>$200, 前30%):', earlyBigBuyers.length);

  if (allBigBuyers.length > 0) {
    console.log('');
    console.log('所有大额买家详情:');
    allBigBuyers.forEach(b => {
      const timeStr = b.firstBuyTime !== null ? b.firstBuyTime.toFixed(1) + 's' : 'N/A';
      const status = b.hasSold ? '(已卖出)' : '(持有)';
      console.log(`  ${b.wallet}: $${b.amount.toFixed(0)} 在${timeStr} ${status}`);
    });
  }

  if (earlyBigBuyers.length > 0) {
    console.log('');
    console.log('早期大额买家详情:');
    earlyBigBuyers.forEach(b => {
      const timeStr = b.firstBuyTime.toFixed(1) + 's';
      const status = b.hasSold ? '(已卖出)' : '(持有)';
      console.log(`  ${b.wallet}: $${b.amount.toFixed(0)} 在${timeStr} ${status}`);
    });
  }

  // 检查是否应该有早期大户但没被识别
  console.log('');
  console.log('=== 数据合理性检查 ===');

  // 计算前30%交易的时间范围
  const earlyTimeRange = earlyTradeEndTime - earliestTime;
  console.log('早期时间范围:', earlyTimeRange.toFixed(1) + '秒');

  // 统计早期交易的买入金额
  let earlyBuyCount = 0;
  let earlyBuyAmount = 0;
  for (const trade of uniqueTrades) {
    if (trade.time <= earlyTradeEndTime) {
      const fromToken = trade.from_token_symbol;
      if (fromToken && baseCurrencies.includes(fromToken)) {
        earlyBuyCount++;
        earlyBuyAmount += trade.from_usd || 0;
      }
    } else {
      break;
    }
  }

  console.log('早期买入交易数:', earlyBuyCount);
  console.log('早期买入总金额: $' + earlyBuyAmount.toFixed(0));
  console.log('早期平均买入金额: $' + (earlyBuyCount > 0 ? earlyBuyAmount / earlyBuyCount : 0).toFixed(0));

  // 分析为什么没有早期大户
  if (earlyBigBuyers.length === 0) {
    console.log('');
    console.log('⚠️  没有早期大户的原因分析:');

    if (allBigBuyers.length > 0) {
      console.log('  - 有大额买家，但都在早期之后入场');
      const minEntryTime = Math.min(...allBigBuyers.map(b => b.firstBuyTime));
      console.log('  - 最早入场时间:', minEntryTime.toFixed(1) + 's');
      console.log('  - 早期结束时间:', earlyTimeRange.toFixed(1) + 's');
      console.log('  - 结论: 所有买家都在早期之后入场');
    } else {
      console.log('  - 没有任何大额买家(>$200)');
      console.log('  - 结论: 所有买家金额都较小');
    }
  }

  // 显示前10笔交易
  console.log('');
  console.log('=== 前10笔交易 ===');
  uniqueTrades.slice(0, 10).forEach((t, i) => {
    const fromToken = t.from_token_symbol;
    const toToken = t.to_token_symbol;
    const type = fromToken && ['WBNB', 'USDT', 'BUSD', 'USDC', 'ETH'].includes(fromToken) ? '买入' : '卖出';
    const amount = t.from_usd || t.to_usd || 0;
    const wallet = t.wallet_address?.substring(0, 10) || 'unknown';
    const relTime = (t.time - earliestTime).toFixed(1);
    console.log(`  ${i + 1}. ${type} ${wallet} $${amount.toFixed(0)} @ ${relTime}s`);
  });
}

analyzeTokenTrades().catch(console.error);
