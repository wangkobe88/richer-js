/**
 * 查询特定代币的收益情况
 * 并调整策略降低盈利误伤
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

async function checkSpecificTokens() {
  console.log('=== 查询特定代币的收益情况 ===\n');

  const tokenData = [];

  for (const tokenAddress of specificTokens) {
    // 查找收益
    let profit = null;
    let symbol = tokenAddress.substring(0, 8);

    for (const exp of experiments) {
      // 查收益
      const { data: sellTrades } = await supabase
        .from('trades')
        .select('metadata, token_address')
        .eq('experiment_id', exp.id)
        .eq('token_address', tokenAddress)
        .eq('trade_direction', 'sell')
        .not('metadata->>profitPercent', 'is', null)
        .limit(1);

      if (sellTrades && sellTrades.length > 0) {
        profit = sellTrades[0].metadata?.profitPercent;
      }

      // 查符号
      const { data: signals } = await supabase
        .from('strategy_signals')
        .select('metadata')
        .eq('experiment_id', exp.id)
        .eq('token_address', tokenAddress)
        .limit(1);

      if (signals && signals.length > 0) {
        symbol = signals[0].metadata?.symbol || tokenAddress.substring(0, 8);
      }
    }

    tokenData.push({
      tokenAddress,
      symbol,
      profit
    });

    const profitStr = profit !== null
      ? (profit > 0 ? `+${profit.toFixed(1)}%` : `${profit.toFixed(1)}%`)
      : 'N/A';

    console.log(`${symbol} (${tokenAddress.substring(0, 10)}...): ${profitStr}`);
  }

  console.log('\n=== 收益分类 ===\n');

  const profitTokens = tokenData.filter(t => t.profit !== null && t.profit > 0);
  const lossTokens = tokenData.filter(t => t.profit !== null && t.profit <= 0);
  const unknownTokens = tokenData.filter(t => t.profit === null);

  console.log(`盈利代币: ${profitTokens.length}个`);
  profitTokens.forEach(t => {
    console.log(`  ${t.symbol}: +${t.profit.toFixed(1)}%`);
  });

  console.log(`\n亏损代币: ${lossTokens.length}个`);
  lossTokens.forEach(t => {
    console.log(`  ${t.symbol}: ${t.profit.toFixed(1)}%`);
  });

  if (unknownTokens.length > 0) {
    console.log(`\n无收益数据: ${unknownTokens.length}个`);
    unknownTokens.forEach(t => {
      console.log(`  ${t.symbol}`);
    });
  }

  return tokenData;
}

async function analyzeWithHybridStrategy(tokenAddress, checkTime, tokenCreatedAt) {
  const timeGap = checkTime - tokenCreatedAt;

  if (timeGap <= 120) {
    return await analyzeWithRealEarlyData(tokenAddress, checkTime);
  } else {
    return await analyzeWithRelativePosition(tokenAddress, checkTime);
  }
}

async function analyzeWithRealEarlyData(tokenAddress, checkTime) {
  const innerPair = `${tokenAddress}_fo`;
  const pairId = `${innerPair}-bsc`;

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

    const uniqueTrades = [];
    const seen = new Set();
    for (const trade of allTrades.sort((a, b) => a.time - b.time)) {
      const key = trade.tx_id || `${trade.time}_${trade.from_address}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueTrades.push(trade);
      }
    }

    if (uniqueTrades.length < 10) {
      return { error: 'insufficient_trades' };
    }

    const earliestTime = uniqueTrades[0].time;
    const earlyTradeCount = Math.min(30, Math.floor(uniqueTrades.length * 0.2));
    const earlyTradeEndTime = uniqueTrades[earlyTradeCount - 1]?.time || earliestTime;

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
      const relTime = trade.time - earliestTime;

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
        walletData.totalSellAmount = (walletData.totalSellAmount || 0) + toUsd;
        walletData.totalSellTokens = (walletData.totalSellTokens || 0) + fromAmount;
      }
    }

    const whales = [];
    for (const [wallet, data] of walletMap) {
      if (data.firstBuyTime !== null &&
          data.totalBuyAmount > 200 &&
          data.firstBuyTime <= (earlyTradeEndTime - earliestTime)) {
        whales.push(data);
      }
    }

    if (whales.length === 0) {
      return {
        method: 'real_early',
        whaleCount: 0,
        earlyWhaleHoldRatio: 1.0,
        earlyWhaleSellRatio: 0
      };
    }

    let totalSellRatio = 0;
    const holdingWhales = whales.filter(w => w.sellTrades.length === 0);

    for (const whale of whales) {
      let sellRatio = 0;
      if (whale.sellTrades.length > 0) {
        sellRatio = whale.totalSellTokens / whale.totalBuyTokens;
      }
      totalSellRatio += sellRatio;
    }

    const holdRatio = holdingWhales.length / whales.length;
    const sellRatio = totalSellRatio / whales.length;

    return {
      method: 'real_early',
      whaleCount: whales.length,
      earlyWhaleHoldRatio: holdRatio,
      earlyWhaleSellRatio: sellRatio
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function analyzeWithRelativePosition(tokenAddress, checkTime) {
  const windowStart = checkTime - 90;

  const innerPair = `${tokenAddress}_fo`;
  const pairId = `${innerPair}-bsc`;

  try {
    const allTrades = [];
    let currentToTime = checkTime;

    for (let loop = 1; loop <= 10; loop++) {
      const trades = await txApi.getSwapTransactions(
        pairId, 300, windowStart, currentToTime, 'asc'
      );
      if (trades.length === 0) break;
      allTrades.push(...trades);
      if (trades[0].time <= windowStart || trades.length < 300) break;
      currentToTime = trades[0].time - 1;
    }

    const uniqueTrades = [];
    const seen = new Set();
    for (const trade of allTrades.sort((a, b) => a.time - b.time)) {
      const key = trade.tx_id || `${trade.time}_${trade.from_address}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueTrades.push(trade);
      }
    }

    if (uniqueTrades.length < 20) {
      return { error: 'insufficient_trades' };
    }

    const earlyThreshold = Math.floor(uniqueTrades.length * 0.3);
    const earlyTradeEndTime = uniqueTrades[earlyThreshold - 1]?.time || windowStart;

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
      const relTime = trade.time - windowStart;

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
        walletData.totalSellAmount = (walletData.totalSellAmount || 0) + toUsd;
        walletData.totalSellTokens = (walletData.totalSellTokens || 0) + fromAmount;
      }
    }

    const whales = [];
    for (const [wallet, data] of walletMap) {
      if (data.firstBuyTime !== null &&
          data.totalBuyAmount > 200 &&
          data.firstBuyTime <= (earlyTradeEndTime - windowStart)) {
        whales.push(data);
      }
    }

    if (whales.length === 0) {
      return {
        method: 'relative',
        whaleCount: 0,
        earlyWhaleHoldRatio: 1.0,
        earlyWhaleSellRatio: 0
      };
    }

    let totalSellRatio = 0;
    const holdingWhales = whales.filter(w => w.sellTrades.length === 0);

    for (const whale of whales) {
      let sellRatio = 0;
      if (whale.sellTrades.length > 0) {
        sellRatio = whale.totalSellTokens / whale.totalBuyTokens;
      }
      totalSellRatio += sellRatio;
    }

    const holdRatio = holdingWhales.length / whales.length;
    const sellRatio = totalSellRatio / whales.length;

    return {
      method: 'relative',
      whaleCount: whales.length,
      earlyWhaleHoldRatio: holdRatio,
      earlyWhaleSellRatio: sellRatio
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function testOptimizedStrategy() {
  // 先查询特定代币的收益
  const specificTokenData = await checkSpecificTokens();

  console.log('\n\n=== 测试优化策略（降低盈利误伤）===\n');

  // 获取所有代币数据
  const tokenReturns = {};
  const tokenCreationTimes = {};

  for (const exp of experiments) {
    const { data: sellTrades } = await supabase
      .from('trades')
      .select('token_address, metadata')
      .eq('experiment_id', exp.id)
      .eq('trade_direction', 'sell')
      .not('metadata->>profitPercent', 'is', null);

    for (const sellTrade of sellTrades || []) {
      tokenReturns[sellTrade.token_address] = sellTrade.metadata?.profitPercent || 0;
    }

    const { data: tokens } = await supabase
      .from('experiment_tokens')
      .select('token_address, created_at')
      .eq('experiment_id', exp.id);

    for (const token of tokens || []) {
      tokenCreationTimes[token.token_address] = new Date(token.created_at).getTime() / 1000;
    }
  }

  // 收集所有代币信号
  const allTokens = [];

  for (const exp of experiments) {
    const { data: buySignals } = await supabase
      .from('strategy_signals')
      .select('*')
      .eq('experiment_id', exp.id)
      .eq('action', 'buy')
      .order('created_at', { ascending: false });

    const executedSignals = buySignals.filter(s => s.metadata?.execution_status === 'executed');

    const seenAddresses = new Set();
    for (const signal of executedSignals) {
      if (!seenAddresses.has(signal.token_address)) {
        seenAddresses.add(signal.token_address);

        const profit = tokenReturns[signal.token_address];
        const signalCreatedAt = new Date(signal.created_at).getTime() / 1000;
        const tokenCreatedAt = tokenCreationTimes[signal.token_address];
        const preBuyCheckTime = signal.metadata?.preBuyCheckFactors?.earlyTradesCheckTime;
        const checkTime = preBuyCheckTime || signalCreatedAt;

        allTokens.push({
          tokenAddress: signal.token_address,
          symbol: signal.metadata?.symbol || signal.token_address.substring(0, 8),
          profitPercent: profit !== undefined ? profit : null,
          tokenCreatedAt,
          checkTime
        });
      }
    }
  }

  // 分析所有代币
  const results = [];

  for (let i = 0; i < allTokens.length; i++) {
    const token = allTokens[i];

    if ((i + 1) % 20 === 0) {
      console.log(`进度: ${i + 1}/${allTokens.length}`);
    }

    const analysis = await analyzeWithHybridStrategy(
      token.tokenAddress,
      token.checkTime,
      token.tokenCreatedAt
    );

    if (analysis && !analysis.error && analysis.whaleCount > 0) {
      results.push({
        ...token,
        analysis
      });
    }

    await new Promise(resolve => setTimeout(resolve, 50));
  }

  console.log(`\n成功分析 ${results.length} 个代币\n`);

  const allProfit = results.filter(r => r.profitPercent > 0);
  const allLoss = results.filter(r => r.profitPercent !== null && r.profitPercent <= 0);

  console.log(`盈利代币: ${allProfit.length}个`);
  console.log(`亏损代币: ${allLoss.length}个`);

  // 测试更严格的条件（降低盈利误伤）
  console.log('\n=== 测试优化策略（降低盈利误伤）===\n');

  const conditions = [
    { name: 'earlyWhaleSellRatio > 0.7', test: r => r.analysis.earlyWhaleSellRatio > 0.7 },
    { name: 'earlyWhaleSellRatio > 0.8', test: r => r.analysis.earlyWhaleSellRatio > 0.8 },
    { name: 'earlyWhaleSellRatio > 0.9', test: r => r.analysis.earlyWhaleSellRatio > 0.9 },
    { name: 'earlyWhaleHoldRatio < 0.2', test: r => r.analysis.earlyWhaleHoldRatio < 0.2 },
    { name: 'earlyWhaleHoldRatio < 0.25', test: r => r.analysis.earlyWhaleHoldRatio < 0.25 },
    {
      name: '组合: earlyWhaleHoldRatio < 0.2 && earlyWhaleSellRatio > 0.6',
      test: r => r.analysis.earlyWhaleHoldRatio < 0.2 && r.analysis.earlyWhaleSellRatio > 0.6
    },
    {
      name: '组合: earlyWhaleHoldRatio < 0.25 && earlyWhaleSellRatio > 0.7',
      test: r => r.analysis.earlyWhaleHoldRatio < 0.25 && r.analysis.earlyWhaleSellRatio > 0.7
    },
    {
      name: '组合: earlyWhaleHoldRatio < 0.3 && earlyWhaleSellRatio > 0.8',
      test: r => r.analysis.earlyWhaleHoldRatio < 0.3 && r.analysis.earlyWhaleSellRatio > 0.8
    },
  ];

  for (const condition of conditions) {
    const filtered = results.filter(condition.test);
    const filteredProfit = filtered.filter(r => r.profitPercent > 0);
    const filteredLoss = filtered.filter(r => r.profitPercent <= 0);

    const lossRecall = allLoss.length > 0 ? filteredLoss.length / allLoss.length : 0;
    const profitFPR = allProfit.length > 0 ? filteredProfit.length / allProfit.length : 0;
    const f1 = (lossRecall + (1 - profitFPR)) > 0 ? 2 * lossRecall * (1 - profitFPR) / (lossRecall + (1 - profitFPR)) : 0;

    console.log(`\n${condition.name}:`);
    console.log(`  过滤数量: ${filtered.length}/${results.length}`);
    console.log(`  亏损召回: ${(lossRecall * 100).toFixed(1)}% (${filteredLoss.length}/${allLoss.length})`);
    console.log(`  盈利误伤: ${(profitFPR * 100).toFixed(1)}% (${filteredProfit.length}/${allProfit.length})`);
    console.log(`  F1分数: ${f1.toFixed(3)}`);
  }

  // 检查用户指定的代币是否能被召回
  console.log('\n=== 检查用户指定代币的召回情况 ===\n');

  const bestCondition = conditions.find(c => c.name === '组合: earlyWhaleHoldRatio < 0.25 && earlyWhaleSellRatio > 0.7');

  for (const tokenInfo of specificTokenData) {
    const result = results.find(r => r.tokenAddress === tokenInfo.tokenAddress);

    if (result) {
      const isFiltered = bestCondition.test(result);
      const profitStr = tokenInfo.profit !== null
        ? (tokenInfo.profit > 0 ? `+${tokenInfo.profit.toFixed(1)}%` : `${tokenInfo.profit.toFixed(1)}%`)
        : 'N/A';

      console.log(`${tokenInfo.symbol}: ${profitStr}`);
      console.log(`  大户数: ${result.analysis.whaleCount}, 持有率: ${(result.analysis.earlyWhaleHoldRatio * 100).toFixed(0)}%, 卖出率: ${(result.analysis.earlyWhaleSellRatio * 100).toFixed(0)}%`);
      console.log(`  是否召回: ${isFiltered ? '✓ 是（过滤）' : '✗ 否（通过）'}`);
      console.log('');
    } else {
      console.log(`${tokenInfo.symbol}: 无大户数据或分析失败`);
      console.log('');
    }
  }
}

testOptimizedStrategy().catch(console.error);
