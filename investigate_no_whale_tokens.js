/**
 * 详细检查无大户数据的代币
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

// 用户指定的代币地址
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

async function investigateNoWhaleTokens() {
  console.log('=== 详细检查用户指定代币 ===\n');

  // 获取代币创建时间和信号时间
  const tokenInfo = {};

  for (const exp of experiments) {
    // 获取代币创建时间
    const { data: tokens } = await supabase
      .from('experiment_tokens')
      .select('token_address, created_at, symbol')
      .eq('experiment_id', exp.id);

    for (const token of tokens || []) {
      if (specificTokens.includes(token.token_address)) {
        tokenInfo[token.token_address] = {
          tokenAddress: token.token_address,
          symbol: token.symbol,
          tokenCreatedAt: new Date(token.created_at).getTime() / 1000
        };
      }
    }

    // 获取信号时间
    const { data: signals } = await supabase
      .from('strategy_signals')
      .select('token_address, created_at, metadata')
      .eq('experiment_id', exp.id)
      .eq('action', 'buy');

    for (const signal of signals || []) {
      if (specificTokens.includes(signal.token_address)) {
        const preBuyCheckTime = signal.metadata?.preBuyCheckFactors?.earlyTradesCheckTime;
        const checkTime = preBuyCheckTime || (new Date(signal.created_at).getTime() / 1000);

        if (!tokenInfo[signal.token_address]) {
          tokenInfo[signal.token_address] = { tokenAddress: signal.token_address };
        }
        tokenInfo[signal.token_address].checkTime = checkTime;
        if (signal.token_address) {
          tokenInfo[signal.token_address].symbol = signal.metadata?.symbol || signal.token_address.substring(0, 8);
        }
      }
    }

    // 获取收益
    const { data: sellTrades } = await supabase
      .from('trades')
      .select('token_address, metadata')
      .eq('experiment_id', exp.id)
      .eq('trade_direction', 'sell')
      .not('metadata->>profitPercent', 'is', null);

    for (const trade of sellTrades || []) {
      if (specificTokens.includes(trade.token_address)) {
        if (!tokenInfo[trade.token_address]) {
          tokenInfo[trade.token_address] = { tokenAddress: trade.token_address };
        }
        tokenInfo[trade.token_address].profit = trade.metadata?.profitPercent;
      }
    }
  }

  console.log(`找到 ${Object.keys(tokenInfo).length} 个代币的信息\n`);

  // 分析每个代币
  for (const tokenAddress of specificTokens) {
    const info = tokenInfo[tokenAddress];

    if (!info) {
      console.log(`${tokenAddress.substring(0, 10)}...: 在实验数据中未找到\n`);
      continue;
    }

    console.log(`【${info.symbol || tokenAddress.substring(0, 8)}】`);
    console.log(`  地址: ${tokenAddress}`);
    const profitDisplay = info.profit !== undefined
      ? (info.profit > 0 ? `+${info.profit.toFixed(1)}%` : `${info.profit.toFixed(1)}%`)
      : 'N/A';
    console.log(`  收益: ${profitDisplay}`);

    if (info.tokenCreatedAt && info.checkTime) {
      const timeGap = info.checkTime - info.tokenCreatedAt;
      console.log(`  时间差距: ${timeGap.toFixed(1)}秒`);
      console.log(`  方法: ${timeGap <= 120 ? '真实早期数据' : '相对交易位置'}`);
    }

    // 尝试获取交易数据
    const innerPair = `${tokenAddress}_fo`;
    const pairId = `${innerPair}-bsc`;
    const checkTime = info.checkTime || info.tokenCreatedAt + 120;

    try {
      const allTrades = [];
      let currentToTime = checkTime;

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
        console.log(`  交易数据: 无交易数据`);
      } else {
        console.log(`  交易数据: ${uniqueTrades.length}笔交易`);

        if (uniqueTrades.length > 0) {
          const earliestTime = uniqueTrades[0].time;
          const latestTime = uniqueTrades[uniqueTrades.length - 1].time;
          const duration = (latestTime - earliestTime) / 60;
          console.log(`  时间跨度: ${duration.toFixed(1)}分钟`);
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
              hasSold: data.sellTrades.length > 0
            });
          }
        }

        // 统计所有大额买家（不限制早期）
        const allBigBuyers = [];
        for (const [wallet, data] of walletMap) {
          if (data.totalBuyAmount > 200) {
            allBigBuyers.push({
              wallet: wallet.substring(0, 10),
              amount: data.totalBuyAmount,
              hasSold: data.sellTrades.length > 0
            });
          }
        }

        console.log(`  早期大户(>$200, 前${earlyTradeCount}笔): ${earlyWhales.length}个`);
        if (earlyWhales.length > 0) {
          earlyWhales.slice(0, 3).forEach(w => {
            console.log(`    - ${w.wallet}: $${w.amount.toFixed(0)} ${w.hasSold ? '(已卖出)' : '(持有)'}`);
          });
        }

        console.log(`  所有大额买家(>$200): ${allBigBuyers.length}个`);
        if (allBigBuyers.length > 0) {
          allBigBuyers.slice(0, 3).forEach(w => {
            console.log(`    - ${w.wallet}: $${w.amount.toFixed(0)} ${w.hasSold ? '(已卖出)' : '(持有)'}`);
          });
        }
      }
    } catch (error) {
      console.log(`  错误: ${error.message}`);
    }

    console.log('');
  }
}

investigateNoWhaleTokens().catch(console.error);
