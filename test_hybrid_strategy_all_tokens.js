/**
 * 混合方案测试
 * 1. 能回溯到创建时间（<=120s）：使用真实早期数据
 * 2. 不能回溯：使用相对交易位置方法
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
 * 方法1：基于真实早期数据（能回溯到代币创建）
 */
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

    // 早期大户：前30笔交易入场，买入金额>$200
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

/**
 * 方法2：基于相对交易位置（无法回溯到代币创建）
 */
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

    // 早期定义：前30%交易
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

    // 早期大户：在观察窗口的前30%交易入场，买入金额>$200
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

/**
 * 混合方案：根据时间差距选择方法
 */
async function analyzeWithHybridStrategy(tokenAddress, checkTime, tokenCreatedAt) {
  const timeGap = checkTime - tokenCreatedAt;

  if (timeGap <= 120) {
    // 能回溯到代币创建，使用真实早期数据
    return await analyzeWithRealEarlyData(tokenAddress, checkTime);
  } else {
    // 不能回溯，使用相对交易位置
    return await analyzeWithRelativePosition(tokenAddress, checkTime);
  }
}

async function testHybridStrategy() {
  console.log('=== 混合方案测试 - 所有实验代币 ===\n');

  // 获取所有代币数据
  const tokenReturns = {};
  const tokenCreationTimes = {};

  for (const exp of experiments) {
    // 获取收益
    const { data: sellTrades } = await supabase
      .from('trades')
      .select('token_address, metadata')
      .eq('experiment_id', exp.id)
      .eq('trade_direction', 'sell')
      .not('metadata->>profitPercent', 'is', null);

    for (const sellTrade of sellTrades || []) {
      tokenReturns[sellTrade.token_address] = sellTrade.metadata?.profitPercent || 0;
    }

    // 获取代币创建时间
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

        const timeGap = checkTime - tokenCreatedAt;

        allTokens.push({
          tokenAddress: signal.token_address,
          symbol: signal.metadata?.symbol || signal.token_address.substring(0, 8),
          profitPercent: profit !== undefined ? profit : null,
          tokenCreatedAt,
          checkTime,
          timeGap,
          method: timeGap <= 120 ? 'real_early' : 'relative'
        });
      }
    }
  }

  console.log(`总共 ${allTokens.length} 个代币\n`);

  // 方法分布统计
  const realEarlyCount = allTokens.filter(t => t.method === 'real_early').length;
  const relativeCount = allTokens.filter(t => t.method === 'relative').length;

  console.log('=== 方法分布 ===\n');
  console.log(`真实早期数据（<=120s）: ${realEarlyCount}个 (${(realEarlyCount / allTokens.length * 100).toFixed(1)}%)`);
  console.log(`相对交易位置（>120s）: ${relativeCount}个 (${(relativeCount / allTokens.length * 100).toFixed(1)}%)`);

  // 分析每个代币
  const results = [];

  for (let i = 0; i < allTokens.length; i++) {
    const token = allTokens[i];

    if ((i + 1) % 10 === 0) {
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

  console.log(`\n成功分析 ${results.length} 个代币（有大户数据）\n`);

  // 按方法分组统计
  const realEarlyResults = results.filter(r => r.analysis.method === 'real_early');
  const relativeResults = results.filter(r => r.analysis.method === 'relative');

  console.log('=== 各方法的代币分布 ===\n');
  console.log(`真实早期数据: ${realEarlyResults.length}个代币`);
  console.log(`相对交易位置: ${relativeResults.length}个代币`);

  // 按收益和方法分类
  const profitRealEarly = realEarlyResults.filter(r => r.profitPercent > 0);
  const lossRealEarly = realEarlyResults.filter(r => r.profitPercent !== null && r.profitPercent <= 0);
  const profitRelative = relativeResults.filter(r => r.profitPercent > 0);
  const lossRelative = relativeResults.filter(r => r.profitPercent !== null && r.profitPercent <= 0);

  console.log('\n=== 各方法的收益分布 ===\n');
  console.log('真实早期数据:');
  console.log(`  盈利: ${profitRealEarly.length}个, 亏损: ${lossRealEarly.length}个`);
  console.log('相对交易位置:');
  console.log(`  盈利: ${profitRelative.length}个, 亏损: ${lossRelative.length}个`);

  // 总体统计
  const allProfit = results.filter(r => r.profitPercent > 0);
  const allLoss = results.filter(r => r.profitPercent !== null && r.profitPercent <= 0);

  // 计算平均值
  const avg = (arr, key) => arr.length > 0
    ? arr.reduce((sum, r) => sum + r.analysis[key], 0) / arr.length
    : 0;

  console.log('\n=== 早期大户行为指标对比（所有代币）===\n');
  console.log('指标                    | 盈利代币 | 亏损代币');
  console.log('------------------------|---------|---------');
  console.log(`平均大户数量            | ${avg(allProfit, 'whaleCount').toFixed(1)}      | ${avg(allLoss, 'whaleCount').toFixed(1)}`);
  console.log(`大户持有率              | ${(avg(allProfit, 'earlyWhaleHoldRatio') * 100).toFixed(1)}%    | ${(avg(allLoss, 'earlyWhaleHoldRatio') * 100).toFixed(1)}%`);
  console.log(`大户卖出率              | ${(avg(allProfit, 'earlyWhaleSellRatio') * 100).toFixed(1)}%    | ${(avg(allLoss, 'earlyWhaleSellRatio') * 100).toFixed(1)}%`);

  // 测试不同的过滤条件
  console.log('\n=== 测试过滤条件（混合方案）===\n');

  const conditions = [
    { name: 'earlyWhaleHoldRatio < 0.3', test: r => r.analysis.earlyWhaleHoldRatio < 0.3 },
    { name: 'earlyWhaleHoldRatio < 0.4', test: r => r.analysis.earlyWhaleHoldRatio < 0.4 },
    { name: 'earlyWhaleHoldRatio < 0.5', test: r => r.analysis.earlyWhaleHoldRatio < 0.5 },
    { name: 'earlyWhaleSellRatio > 0.3', test: r => r.analysis.earlyWhaleSellRatio > 0.3 },
    { name: 'earlyWhaleSellRatio > 0.4', test: r => r.analysis.earlyWhaleSellRatio > 0.4 },
    { name: 'earlyWhaleSellRatio > 0.5', test: r => r.analysis.earlyWhaleSellRatio > 0.5 },
    {
      name: '组合: earlyWhaleHoldRatio < 0.4 && earlyWhaleSellRatio > 0.3',
      test: r => r.analysis.earlyWhaleHoldRatio < 0.4 && r.analysis.earlyWhaleSellRatio > 0.3
    },
    {
      name: '组合: earlyWhaleHoldRatio < 0.5 && earlyWhaleSellRatio > 0.4',
      test: r => r.analysis.earlyWhaleHoldRatio < 0.5 && r.analysis.earlyWhaleSellRatio > 0.4
    },
    {
      name: '组合: earlyWhaleHoldRatio < 0.4 && earlyWhaleSellRatio > 0.5',
      test: r => r.analysis.earlyWhaleHoldRatio < 0.4 && r.analysis.earlyWhaleSellRatio > 0.5
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

  // 按方法分别展示效果
  console.log('\n=== 各方法分别效果 ===\n');

  console.log('【真实早期数据方法】');
  if (realEarlyResults.length > 0) {
    const profitRE = realEarlyResults.filter(r => r.profitPercent > 0);
    const lossRE = realEarlyResults.filter(r => r.profitPercent !== null && r.profitPercent <= 0);

    console.log(`  盈利: ${profitRE.length}个, 亏损: ${lossRE.length}个`);
    console.log(`  大户持有率: 盈利 ${(avg(profitRE, 'earlyWhaleHoldRatio') * 100).toFixed(1)}% vs 亏损 ${(avg(lossRE, 'earlyWhaleHoldRatio') * 100).toFixed(1)}%`);
    console.log(`  大户卖出率: 盈利 ${(avg(profitRE, 'earlyWhaleSellRatio') * 100).toFixed(1)}% vs 亏损 ${(avg(lossRE, 'earlyWhaleSellRatio') * 100).toFixed(1)}%`);
  }

  console.log('\n【相对交易位置方法】');
  if (relativeResults.length > 0) {
    const profitRel = relativeResults.filter(r => r.profitPercent > 0);
    const lossRel = relativeResults.filter(r => r.profitPercent !== null && r.profitPercent <= 0);

    console.log(`  盈利: ${profitRel.length}个, 亏损: ${lossRel.length}个`);
    console.log(`  大户持有率: 盈利 ${(avg(profitRel, 'earlyWhaleHoldRatio') * 100).toFixed(1)}% vs 亏损 ${(avg(lossRel, 'earlyWhaleHoldRatio') * 100).toFixed(1)}%`);
    console.log(`  大户卖出率: 盈利 ${(avg(profitRel, 'earlyWhaleSellRatio') * 100).toFixed(1)}% vs 亏损 ${(avg(lossRel, 'earlyWhaleSellRatio') * 100).toFixed(1)}%`);
  }

  // 显示典型例子
  console.log('\n=== 典型例子 ===\n');

  console.log('【盈利代币 - 大户持有】（混合方案）');
  const holdingProfit = allProfit
    .filter(r => r.analysis.earlyWhaleHoldRatio > 0.5)
    .sort((a, b) => b.analysis.earlyWhaleHoldRatio - a.analysis.earlyWhaleHoldRatio)
    .slice(0, 5);

  holdingProfit.forEach(r => {
    console.log(`  ${r.symbol}: +${r.profitPercent.toFixed(1)}%, ${r.analysis.method}, ${r.analysis.whaleCount}大户, ${(r.analysis.earlyWhaleHoldRatio * 100).toFixed(0)}%持有`);
  });

  console.log('\n【亏损代币 - 大户卖出】（混合方案）');
  const sellingLoss = allLoss
    .filter(r => r.analysis.earlyWhaleSellRatio > 0.5)
    .sort((a, b) => b.analysis.earlyWhaleSellRatio - a.analysis.earlyWhaleSellRatio)
    .slice(0, 5);

  sellingLoss.forEach(r => {
    console.log(`  ${r.symbol}: ${r.profitPercent.toFixed(1)}%, ${r.analysis.method}, ${r.analysis.whaleCount}大户, ${(r.analysis.earlyWhaleSellRatio * 100).toFixed(0)}%卖出`);
  });

  // 最终推荐
  console.log('\n=== 最终推荐 ===\n');

  console.log('基于混合方案的测试结果，推荐过滤条件：');
  console.log('');
  console.log('【保守策略】- 低误伤');
  console.log('  earlyWhaleSellRatio > 0.5');
  console.log('  适用于不愿错过好票的场景');
  console.log('');
  console.log('【平衡策略】- 推荐');
  console.log('  earlyWhaleHoldRatio < 0.4 && earlyWhaleSellRatio > 0.3');
  console.log('  在召回和误伤之间取得平衡');
}

testHybridStrategy().catch(console.error);
