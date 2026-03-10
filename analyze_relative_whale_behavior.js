/**
 * 使用相对交易位置分析大户行为
 * 不依赖绝对时间，而是基于可观察到的交易数据
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

/**
 * 使用相对交易位置分析大户行为（模拟生产环境）
 */
async function analyzeWhaleBehaviorRelative(tokenAddress, signalTime) {
  // 模拟生产环境：只使用 signalTime - 90s 之后的数据
  const windowStart = signalTime - 90;

  const innerPair = `${tokenAddress}_fo`;
  const pairId = `${innerPair}-bsc`;

  try {
    const allTrades = [];
    let currentToTime = signalTime;

    for (let loop = 1; loop <= 10; loop++) {
      const trades = await txApi.getSwapTransactions(
        pairId, 300, windowStart, currentToTime, 'asc'
      );
      if (trades.length === 0) break;
      allTrades.push(...trades);
      if (trades[0].time <= windowStart || trades.length < 300) break;
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

    if (uniqueTrades.length < 10) {
      return null;
    }

    const baseCurrencies = ['WBNB', 'USDT', 'BUSD', 'USDC', 'ETH'];

    // 按钱包分类交易
    const walletMap = new Map();

    for (const trade of uniqueTrades) {
      const wallet = trade.wallet_address?.toLowerCase();
      if (!wallet) continue;

      if (!walletMap.has(wallet)) {
        walletMap.set(wallet, {
          wallet,
          firstBuyTime: null,
          lastBuyTime: null,
          totalBuyAmount: 0,
          totalBuyTokens: 0,
          buyCount: 0,
          sellTrades: [],
          firstSellTime: null,
          totalSellAmount: 0,
          totalSellTokens: 0,
          sellCount: 0,
          buyTrades: []
        });
      }

      const walletData = walletMap.get(wallet);
      const fromToken = trade.from_token_symbol;
      const toToken = trade.to_token_symbol;
      const fromAmount = trade.from_amount || 0;
      const toAmount = trade.to_amount || 0;
      const fromUsd = trade.from_usd || 0;
      const toUsd = trade.to_usd || 0;
      const relTime = trade.time - windowStart;

      const isBuy = fromToken && baseCurrencies.includes(fromToken);
      const isSell = toToken && baseCurrencies.includes(toToken);

      if (isBuy) {
        walletData.buyTrades.push({
          time: relTime,
          absTime: trade.time,
          amount: fromUsd,
          tokens: toAmount,
          price: fromUsd / toAmount
        });

        if (walletData.firstBuyTime === null || relTime < walletData.firstBuyTime) {
          walletData.firstBuyTime = relTime;
        }
        if (walletData.lastBuyTime === null || relTime > walletData.lastBuyTime) {
          walletData.lastBuyTime = relTime;
        }

        walletData.totalBuyAmount += fromUsd;
        walletData.totalBuyTokens += toAmount;
        walletData.buyCount++;
      }

      if (isSell) {
        const sellPrice = toUsd / fromAmount;

        walletData.sellTrades.push({
          time: relTime,
          absTime: trade.time,
          amount: toUsd,
          tokens: fromAmount,
          price: sellPrice
        });

        if (walletData.firstSellTime === null || relTime < walletData.firstSellTime) {
          walletData.firstSellTime = relTime;
        }

        walletData.totalSellAmount += toUsd;
        walletData.totalSellTokens += fromAmount;
        walletData.sellCount++;
      }
    }

    // 定义"相对早期大户"
    // 1. 在可观察交易的前30%入场
    // 2. 买入金额 > $200
    const earlyTradeThreshold = Math.min(30, Math.floor(uniqueTrades.length * 0.3));
    const earlyTradeEndTime = uniqueTrades[earlyTradeThreshold - 1]?.time - windowStart || 0;

    const whales = [];
    for (const [wallet, data] of walletMap) {
      if (data.firstBuyTime !== null &&
          data.totalBuyAmount > 200 &&
          data.firstBuyTime <= earlyTradeEndTime) {
        whales.push(data);
      }
    }

    if (whales.length === 0) {
      return {
        totalTrades: uniqueTrades.length,
        earlyTradeThreshold,
        earlyTradeEndTime,
        whaleCount: 0,
        whales: []
      };
    }

    // 计算大户的平均买入价格
    for (const whale of whales) {
      const avgBuyPrice = whale.totalBuyAmount / whale.totalBuyTokens;

      // 计算卖出价格
      let avgSellPrice = null;
      let sellRatio = 0;
      if (whale.sellTrades.length > 0) {
        const totalSellTokens = whale.sellTrades.reduce((sum, s) => sum + s.tokens, 0);
        avgSellPrice = whale.totalSellAmount / totalSellTokens;
        sellRatio = totalSellTokens / whale.totalBuyTokens;
      }

      whale.avgBuyPrice = avgBuyPrice;
      whale.avgSellPrice = avgSellPrice;
      whale.sellRatio = sellRatio;

      // 计算首次买入的相对位置
      const buyTradeIndex = uniqueTrades.findIndex(t =>
        t.wallet_address?.toLowerCase() === whale.wallet &&
        t.from_token_symbol &&
        baseCurrencies.includes(t.from_token_symbol)
      );
      whale.buyTradePosition = buyTradeIndex >= 0 ? buyTradeIndex + 1 : uniqueTrades.length;

      // 是否快速卖出（30秒内）
      whale.isQuickSell = whale.firstSellTime !== null &&
                         (whale.firstSellTime - whale.firstBuyTime) < 30;

      // 是否已经卖出大部分（>50%）
      whale.isMostlySold = sellRatio > 0.5;
    }

    // 计算统计指标
    const holdingWhales = whales.filter(w => w.sellTrades.length === 0);
    const sellingWhales = whales.filter(w => w.sellTrades.length > 0);
    const quickSellers = whales.filter(w => w.isQuickSell);
    const mostlySoldWhales = whales.filter(w => w.isMostlySold);

    const earlyWhaleHoldRatio = whales.length > 0 ? holdingWhales.length / whales.length : 0;
    const earlyWhaleSellRatio = whales.length > 0
      ? sellingWhales.reduce((sum, w) => sum + w.sellRatio, 0) / whales.length
      : 0;
    const earlyWhaleQuickSellCount = quickSellers.length;
    const earlyWhaleMostlySoldCount = mostlySoldWhales.length;

    // 计算大户集中度
    const sortedByAmount = [...whales].sort((a, b) => b.totalBuyAmount - a.totalBuyAmount);
    const top3BuyAmount = sortedByAmount.slice(0, 3).reduce((sum, w) => sum + w.totalBuyAmount, 0);
    const totalWhaleBuyAmount = whales.reduce((sum, w) => sum + w.totalBuyAmount, 0);
    const whaleConcentration = totalWhaleBuyAmount > 0 ? top3BuyAmount / totalWhaleBuyAmount : 0;

    // 计算平均入场位置
    const avgEntryPosition = whales.reduce((sum, w) => sum + w.buyTradePosition, 0) / whales.length;

    return {
      totalTrades: uniqueTrades.length,
      earlyTradeThreshold,
      earlyTradeEndTime,
      whaleCount: whales.length,
      earlyWhaleHoldRatio,
      earlyWhaleSellRatio,
      earlyWhaleQuickSellCount,
      earlyWhaleMostlySoldCount,
      whaleConcentration,
      avgEntryPosition,
      whales: whales.map(w => ({
        wallet: w.wallet.substring(0, 10),
        totalBuyAmount: w.totalBuyAmount.toFixed(0),
        buyTradePosition: w.buyTradePosition,
        isQuickSell: w.isQuickSell,
        isMostlySold: w.isMostlySold,
        sellRatio: w.sellRatio.toFixed(2)
      }))
    };
  } catch (error) {
    console.error(`  Error analyzing ${tokenAddress}:`, error.message);
    return null;
  }
}

async function analyzeAllTokens() {
  console.log('=== 使用相对交易位置分析大户行为 ===\n');

  // 获取所有代币的收益数据
  const tokenReturns = {};

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
  }

  // 收集所有代币
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
        const preBuyCheckTime = signal.metadata?.preBuyCheckFactors?.earlyTradesCheckTime;

        // 使用 preBuyCheckTime 作为信号时间（这是实际进行预检查的时间）
        const checkTime = preBuyCheckTime || signalCreatedAt;

        allTokens.push({
          tokenAddress: signal.token_address,
          symbol: signal.metadata?.symbol || signal.token_address.substring(0, 8),
          profitPercent: profit !== undefined ? profit : null,
          checkTime
        });
      }
    }
  }

  console.log(`总共 ${allTokens.length} 个代币\n`);

  // 分析每个代币
  const results = [];

  for (let i = 0; i < allTokens.length; i++) {
    const token = allTokens[i];

    console.log(`分析 ${token.symbol} (${i + 1}/${allTokens.length})...`);

    const analysis = await analyzeWhaleBehaviorRelative(token.tokenAddress, token.checkTime);

    if (analysis && analysis.whaleCount > 0) {
      results.push({
        ...token,
        analysis
      });
    }

    await new Promise(resolve => setTimeout(resolve, 50));
  }

  console.log(`\n有大户数据的代币: ${results.length}个\n`);

  // 分类统计
  const profitTokens = results.filter(r => r.profitPercent !== null && r.profitPercent > 0);
  const lossTokens = results.filter(r => r.profitPercent !== null && r.profitPercent <= 0);

  console.log('=== 分类统计 ===\n');
  console.log(`盈利代币: ${profitTokens.length}个`);
  console.log(`亏损代币: ${lossTokens.length}个`);

  // 计算平均值
  const avg = (arr, key) => arr.length > 0
    ? arr.reduce((sum, r) => sum + r.analysis[key], 0) / arr.length
    : 0;

  console.log('\n=== 大户行为指标对比 ===\n');
  console.log('指标                    | 盈利代币 | 亏损代币');
  console.log('------------------------|---------|---------');
  console.log(`平均大户数量            | ${avg(profitTokens, 'whaleCount').toFixed(1)}      | ${avg(lossTokens, 'whaleCount').toFixed(1)}`);
  console.log(`大户持有率              | ${(avg(profitTokens, 'earlyWhaleHoldRatio') * 100).toFixed(1)}%    | ${(avg(lossTokens, 'earlyWhaleHoldRatio') * 100).toFixed(1)}%`);
  console.log(`大户卖出率              | ${(avg(profitTokens, 'earlyWhaleSellRatio') * 100).toFixed(1)}%    | ${(avg(lossTokens, 'earlyWhaleSellRatio') * 100).toFixed(1)}%`);
  console.log(`快速卖出大户数          | ${avg(profitTokens, 'earlyWhaleQuickSellCount').toFixed(1)}      | ${avg(lossTokens, 'earlyWhaleQuickSellCount').toFixed(1)}`);
  console.log(`大部分卖出大户数        | ${avg(profitTokens, 'earlyWhaleMostlySoldCount').toFixed(1)}      | ${avg(lossTokens, 'earlyWhaleMostlySoldCount').toFixed(1)}`);
  console.log(`大户集中度              | ${(avg(profitTokens, 'whaleConcentration') * 100).toFixed(1)}%    | ${(avg(lossTokens, 'whaleConcentration') * 100).toFixed(1)}%`);
  console.log(`平均入场位置            | ${avg(profitTokens, 'avgEntryPosition').toFixed(0)}      | ${avg(lossTokens, 'avgEntryPosition').toFixed(0)}`);

  // 测试不同的过滤条件
  console.log('\n=== 测试过滤条件 ===\n');

  const conditions = [
    { name: 'earlyWhaleSellRatio > 0.3', test: r => r.analysis.earlyWhaleSellRatio > 0.3 },
    { name: 'earlyWhaleSellRatio > 0.4', test: r => r.analysis.earlyWhaleSellRatio > 0.4 },
    { name: 'earlyWhaleHoldRatio < 0.5', test: r => r.analysis.earlyWhaleHoldRatio < 0.5 },
    { name: 'earlyWhaleHoldRatio < 0.4', test: r => r.analysis.earlyWhaleHoldRatio < 0.4 },
    { name: 'whaleConcentration > 0.7', test: r => r.analysis.whaleConcentration > 0.7 },
    { name: 'earlyWhaleMostlySoldCount >= 2', test: r => r.analysis.earlyWhaleMostlySoldCount >= 2 },
    { name: 'earlyWhaleQuickSellCount >= 1', test: r => r.analysis.earlyWhaleQuickSellCount >= 1 },
    {
      name: '组合: earlyWhaleSellRatio > 0.3 && whaleConcentration > 0.6',
      test: r => r.analysis.earlyWhaleSellRatio > 0.3 && r.analysis.whaleConcentration > 0.6
    },
    {
      name: '组合: earlyWhaleHoldRatio < 0.4 && earlyWhaleSellRatio > 0.3',
      test: r => r.analysis.earlyWhaleHoldRatio < 0.4 && r.analysis.earlyWhaleSellRatio > 0.3
    }
  ];

  for (const condition of conditions) {
    const filtered = results.filter(condition.test);
    const filteredProfit = filtered.filter(r => r.profitPercent > 0);
    const filteredLoss = filtered.filter(r => r.profitPercent <= 0);

    const lossRecall = lossTokens.length > 0 ? filteredLoss.length / lossTokens.length : 0;
    const profitFPR = profitTokens.length > 0 ? filteredProfit.length / profitTokens.length : 0;
    const f1 = (lossRecall + profitFPR) > 0 ? 2 * lossRecall * (1 - profitFPR) / (lossRecall + (1 - profitFPR)) : 0;

    console.log(`\n${condition.name}:`);
    console.log(`  过滤数量: ${filtered.length}/${results.length}`);
    console.log(`  亏损召回: ${(lossRecall * 100).toFixed(1)}% (${filteredLoss.length}/${lossTokens.length})`);
    console.log(`  盈利误伤: ${(profitFPR * 100).toFixed(1)}% (${filteredProfit.length}/${profitTokens.length})`);
    console.log(`  F1分数: ${f1.toFixed(3)}`);
  }

  // 显示典型例子
  console.log('\n=== 典型例子 ===\n');

  console.log('盈利代币（大户持有）:');
  const holdingProfit = profitTokens
    .filter(r => r.analysis.earlyWhaleHoldRatio > 0.5)
    .sort((a, b) => b.analysis.earlyWhaleHoldRatio - a.analysis.earlyWhaleHoldRatio)
    .slice(0, 3);

  holdingProfit.forEach(r => {
    console.log(`  ${r.symbol}: +${r.profitPercent.toFixed(1)}%, ${r.analysis.whaleCount}大户, ${(r.analysis.earlyWhaleHoldRatio * 100).toFixed(0)}%持有, ${(r.analysis.earlyWhaleSellRatio * 100).toFixed(0)}%卖出`);
    r.analysis.whales.slice(0, 3).forEach(w => {
      console.log(`    - ${w.wallet}: $${w.totalBuyAmount}, 位置#${w.buyTradePosition}, ${w.isQuickSell ? '快卖' : '持有'}, 卖出${(w.sellRatio * 100).toFixed(0)}%`);
    });
  });

  console.log('\n亏损代币（大户卖出）:');
  const sellingLoss = lossTokens
    .filter(r => r.analysis.earlyWhaleSellRatio > 0.3)
    .sort((a, b) => b.analysis.earlyWhaleSellRatio - a.analysis.earlyWhaleSellRatio)
    .slice(0, 3);

  sellingLoss.forEach(r => {
    console.log(`  ${r.symbol}: ${r.profitPercent.toFixed(1)}%, ${r.analysis.whaleCount}大户, ${(r.analysis.earlyWhaleHoldRatio * 100).toFixed(0)}%持有, ${(r.analysis.earlyWhaleSellRatio * 100).toFixed(0)}%卖出`);
    r.analysis.whales.slice(0, 3).forEach(w => {
      console.log(`    - ${w.wallet}: $${w.totalBuyAmount}, 位置#${w.buyTradePosition}, ${w.isQuickSell ? '快卖' : '持有'}, 卖出${(w.sellRatio * 100).toFixed(0)}%`);
    });
  });
}

analyzeAllTokens().catch(console.error);
