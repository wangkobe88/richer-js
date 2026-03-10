/**
 * 使用正确的时间窗口重新检查
 * 只使用信号时间之前的交易数据
 */

const { createClient } = require('@supabase/supabase-js');
const { AveTxAPI } = require('./src/core/ave-api/tx-api');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const txApi = new AveTxAPI(
  process.env.AVE_API_BASE_URL || 'https://prod.ave-api.com',
  30000,
  process.env.AVE_API_KEY
);

const experiments = [
  { id: '6b17ff18-002d-4ce0-a745-b8e02676abd4', name: '实验1' },
  { id: '1dde2be5-2f4e-49fb-9520-cb032e9ef759', name: '实验2' }
];

async function checkTokenWithCorrectTimeWindow(tokenAddress) {
  // 获取该代币的信号时间
  let checkTime = null;
  let symbol = tokenAddress.substring(0, 8);

  for (const exp of experiments) {
    const { data: signals } = await supabase
      .from('strategy_signals')
      .select('created_at, metadata')
      .eq('experiment_id', exp.id)
      .eq('token_address', tokenAddress)
      .eq('action', 'buy')
      .eq('metadata->>execution_status', 'executed')
      .limit(1);

    if (signals && signals.length > 0) {
      const preBuyCheckTime = signals[0].metadata?.preBuyCheckFactors?.earlyTradesCheckTime;
      checkTime = preBuyCheckTime || (new Date(signals[0].created_at).getTime() / 1000);
      symbol = signals[0].metadata?.symbol || symbol;
      break;
    }
  }

  if (!checkTime) {
    console.log(`${tokenAddress.substring(0, 10)}...: 未找到执行的买入信号\n`);
    return null;
  }

  console.log(`【${symbol}】`);
  console.log(`  信号时间: ${new Date(checkTime * 1000).toLocaleString()}`);
  console.log(`  分析窗口: 代币创建时间 ~ 信号时间（只使用信号前的交易）\n`);

  // 只获取信号时间之前的交易
  const innerPair = `${tokenAddress}_fo`;
  const pairId = `${innerPair}-bsc`;

  try {
    const allTrades = [];
    let currentToTime = checkTime;  // 使用信号时间，不是当前时间

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
      console.log(`  无交易数据\n`);
      return null;
    }

    console.log(`  交易数据: ${uniqueTrades.length}笔交易`);

    if (uniqueTrades.length > 0) {
      const earliestTime = uniqueTrades[0].time;
      const latestTime = uniqueTrades[uniqueTrades.length - 1].time;
      const duration = (latestTime - earliestTime) / 60;
      console.log(`  时间跨度: ${duration.toFixed(1)}分钟`);
      console.log(`  最后交易时间: ${new Date(latestTime * 1000).toLocaleString()}`);
      console.log(`  距离信号时间: ${checkTime - latestTime}秒`);
    }

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

    console.log(`\n  早期大户(>$200, 前${earlyTradeCount}笔): ${earlyWhales.length}个`);

    if (earlyWhales.length > 0) {
      console.log(`  大户详情:`);
      earlyWhales.forEach(w => {
        const status = w.hasSold ? `已卖出${(w.sellRatio * 100).toFixed(0)}%` : '持有';
        console.log(`    - ${w.wallet}: $${w.amount.toFixed(0)} (${status})`);
      });
      console.log(`\n  持有率: ${(holdRatio * 100).toFixed(0)}%`);
      console.log(`  卖出率: ${(avgSellRatio * 100).toFixed(0)}%`);
    }

    // 判断是否会被召回
    const wouldBeFiltered = avgSellRatio > 0.7;
    console.log(`\n  是否召回: ${wouldBeFiltered ? '✓ 是（过滤）' : '✗ 否（通过）'}`);
    console.log(`  条件: earlyWhaleSellRatio > 0.7`);
    console.log(`  实际值: ${avgSellRatio.toFixed(2)}`);

    console.log('\n');

    return {
      symbol,
      checkTime,
      whaleCount: earlyWhales.length,
      holdRatio,
      sellRatio: avgSellRatio,
      wouldBeFiltered
    };

  } catch (error) {
    console.log(`  错误: ${error.message}\n`);
    return null;
  }
}

async function checkAllTokensWithCorrectWindow() {
  console.log('=== 使用正确的时间窗口重新检查 ===\n');
  console.log('只使用信号时间之前的交易数据（模拟生产环境）\n');

  const specificTokens = [
    '0xb9b1142a28fade5771b7ae076c96c3bee8beffff',
    '0xf3372a3dbc824f0b0044ca77209559514b294444',
    '0x5850bbdd3fd65a4d7c23623ffc7c3f041d954444',
    '0x6df5fd6949f2527ee99ce7c979c00f2a5bd34444',
    '0xd8d4ddeb91987a121422567260a88230dbb34444',
    '0x9b58b98a1ea58d59ffaaa9f1d2e5fd4168444444',
    '0x71c06c7064c5aaf398f6f956d8146ad0e0e84444',
    '0xd3b4d55ef44da2fee0e78e478d2fe94751514444'
  ];

  const results = [];

  for (const tokenAddress of specificTokens) {
    const result = await checkTokenWithCorrectTimeWindow(tokenAddress);

    if (result) {
      results.push(result);
    }

    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  console.log('=== 总结 ===\n');

  const filtered = results.filter(r => r.wouldBeFiltered);
  const passed = results.filter(r => !r.wouldBeFiltered);

  console.log(`成功检查: ${results.length}个`);
  console.log(`被召回（过滤）: ${filtered.length}个`);
  console.log(`通过（未过滤）: ${passed.length}个`);

  if (filtered.length > 0) {
    console.log('\n被召回的代币:');
    filtered.forEach(r => {
      console.log(`  ${r.symbol}: ${r.whaleCount}大户, 卖出率${(r.sellRatio * 100).toFixed(0)}%`);
    });
  }

  if (passed.length > 0) {
    console.log('\n通过的代币:');
    passed.forEach(r => {
      console.log(`  ${r.symbol}: ${r.whaleCount}大户, 卖出率${(r.sellRatio * 100).toFixed(0)}%`);
    });
  }
}

checkAllTokensWithCorrectWindow().catch(console.error);
