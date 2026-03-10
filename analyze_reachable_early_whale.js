/**
 * 只分析能回溯到代币创建时间的代币
 * 确保早期定义的准确性
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
 * 使用真正的最早交易时间分析早期大户
 */
async function analyzeEarlyWhaleWithFullHistory(tokenAddress, checkTime) {
  // 获取所有交易历史
  const innerPair = `${tokenAddress}_fo`;
  const pairId = `${innerPair}-bsc`;

  try {
    const allTrades = [];
    let currentToTime = checkTime;

    // 获取所有历史交易（不限制起始时间）
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
      return { error: 'no_trades' };
    }

    // 使用真正的最早交易时间作为基准
    const earliestTime = uniqueTrades[0].time;
    const windowStart = earliestTime;

    // 检查90秒窗口是否能覆盖到代币创建
    const windowEnd = windowStart + 90;
    const canReachTokenCreation = checkTime >= windowEnd;

    // 定义早期：前30笔交易（或前20%）
    const earlyTradeCount = Math.min(30, Math.floor(uniqueTrades.length * 0.2));
    const earlyTradeEndTime = uniqueTrades[earlyTradeCount - 1]?.time || windowStart;

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
      const absTime = trade.time;
      const relTime = absTime - windowStart;

      const isBuy = fromToken && baseCurrencies.includes(fromToken);
      const isSell = toToken && baseCurrencies.includes(toToken);

      if (isBuy) {
        const price = fromUsd / toAmount;
        walletData.buyTrades.push({
          absTime,
          relTime,
          amount: fromUsd,
          tokens: toAmount,
          price
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
        const price = toUsd / fromAmount;
        walletData.sellTrades.push({
          absTime,
          relTime,
          amount: toUsd,
          tokens: fromAmount,
          price
        });

        if (walletData.firstSellTime === null || relTime < walletData.firstSellTime) {
          walletData.firstSellTime = relTime;
        }

        walletData.totalSellAmount += toUsd;
        walletData.totalSellTokens += fromAmount;
        walletData.sellCount++;
      }
    }

    // 定义真正的早期大户（基于绝对时间，从前30笔交易入场）
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
        earliestTime,
        canReachTokenCreation,
        earlyTradeEndTime,
        whaleCount: 0,
        whales: []
      };
    }

    // 计算大户指标
    for (const whale of whales) {
      const avgBuyPrice = whale.totalBuyAmount / whale.totalBuyTokens;

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

      // 是否全部卖出（>90%）
      whale.isFullySold = sellRatio > 0.9;

      // 是否只买不卖
      whale.isHolding = whale.sellTrades.length === 0;
    }

    // 计算统计指标
    const holdingWhales = whales.filter(w => w.isHolding);
    const sellingWhales = whales.filter(w => w.sellTrades.length > 0);
    const quickSellers = whales.filter(w => w.isQuickSell);
    const mostlySoldWhales = whales.filter(w => w.isMostlySold);
    const fullySoldWhales = whales.filter(w => w.isFullySold);

    const earlyWhaleHoldRatio = whales.length > 0 ? holdingWhales.length / whales.length : 0;
    const earlyWhaleSellRatio = whales.length > 0
      ? sellingWhales.reduce((sum, w) => sum + w.sellRatio, 0) / whales.length
      : 0;
    const earlyWhaleQuickSellCount = quickSellers.length;
    const earlyWhaleMostlySoldCount = mostlySoldWhales.length;
    const earlyWhaleFullySoldCount = fullySoldWhales.length;

    // 计算大户集中度
    const sortedByAmount = [...whales].sort((a, b) => b.totalBuyAmount - a.totalBuyAmount);
    const top3BuyAmount = sortedByAmount.slice(0, 3).reduce((sum, w) => sum + w.totalBuyAmount, 0);
    const totalWhaleBuyAmount = whales.reduce((sum, w) => sum + w.totalBuyAmount, 0);
    const whaleConcentration = totalWhaleBuyAmount > 0 ? top3BuyAmount / totalWhaleBuyAmount : 0;

    // 计算平均入场位置
    const avgEntryPosition = whales.reduce((sum, w) => sum + w.buyTradePosition, 0) / whales.length;

    // 分析大户买入的时间分布
    const entryTimes = whales.map(w => w.firstBuyTime);
    const avgEntryTime = entryTimes.reduce((a, b) => a + b, 0) / entryTimes.length;
    const maxEntryTime = Math.max(...entryTimes);

    return {
      totalTrades: uniqueTrades.length,
      earliestTime,
      canReachTokenCreation,
      earlyTradeCount,
      earlyTradeEndTime,
      whaleCount: whales.length,
      earlyWhaleHoldRatio,
      earlyWhaleSellRatio,
      earlyWhaleQuickSellCount,
      earlyWhaleMostlySoldCount,
      earlyWhaleFullySoldCount,
      whaleConcentration,
      avgEntryPosition,
      avgEntryTime,
      maxEntryTime,
      whales: whales.map(w => ({
        wallet: w.wallet.substring(0, 10),
        totalBuyAmount: w.totalBuyAmount.toFixed(0),
        buyTradePosition: w.buyTradePosition,
        firstBuyTime: w.firstBuyTime.toFixed(1),
        isQuickSell: w.isQuickSell,
        isMostlySold: w.isMostlySold,
        isFullySold: w.isFullySold,
        isHolding: w.isHolding,
        sellRatio: w.sellRatio.toFixed(2)
      }))
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function analyzeReachableTokens() {
  console.log('=== 分析能回溯到代币创建时间的代币 ===\n');

  // 获取所有代币的收益数据和创建时间
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

        // 计算信号时间与代币创建时间的差距
        const timeGap = checkTime - tokenCreatedAt;

        allTokens.push({
          tokenAddress: signal.token_address,
          symbol: signal.metadata?.symbol || signal.token_address.substring(0, 8),
          profitPercent: profit !== undefined ? profit : null,
          tokenCreatedAt,
          checkTime,
          timeGap,
          canReachCreation90: timeGap <= 90
        });
      }
    }
  }

  console.log(`总共 ${allTokens.length} 个代币\n`);

  // 统计回溯覆盖情况
  const canReach90 = allTokens.filter(t => t.canReachCreation90);
  const cannotReach90 = allTokens.filter(t => !t.canReachCreation90);

  console.log('=== 回溯覆盖统计 ===\n');
  console.log(`能回溯到创建时间（90秒内）: ${canReach90.length}个代币`);
  console.log(`不能回溯到创建时间: ${cannotReach90.length}个代币`);

  // 分析能回溯的代币的收益分布
  const profitCanReach = canReach90.filter(t => t.profitPercent > 0);
  const lossCanReach = canReach90.filter(t => t.profitPercent !== null && t.profitPercent <= 0);

  console.log('\n能回溯的代币收益分布:');
  console.log(`  盈利: ${profitCanReach.length}个`);
  console.log(`  亏损: ${lossCanReach.length}个`);

  // 分析不能回溯的代币的收益分布
  const profitCannotReach = cannotReach90.filter(t => t.profitPercent > 0);
  const lossCannotReach = cannotReach90.filter(t => t.profitPercent !== null && t.profitPercent <= 0);

  console.log('\n不能回溯的代币收益分布:');
  console.log(`  盈利: ${profitCannotReach.length}个`);
  console.log(`  亏损: ${lossCannotReach.length}个`);

  // 只分析能回溯到创建时间的代币
  console.log(`\n=== 深度分析能回溯的 ${canReach90.length} 个代币 ===\n`);

  const results = [];

  for (let i = 0; i < canReach90.length; i++) {
    const token = canReach90[i];

    console.log(`分析 ${token.symbol} (${i + 1}/${canReach90.length})...`);

    const analysis = await analyzeEarlyWhaleWithFullHistory(token.tokenAddress, token.checkTime);

    if (analysis && !analysis.error) {
      results.push({
        ...token,
        analysis
      });
    }

    await new Promise(resolve => setTimeout(resolve, 50));
  }

  console.log(`\n成功分析 ${results.length} 个代币\n`);

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

  console.log('\n=== 早期大户行为指标对比（基于真实早期数据）===\n');
  console.log('指标                    | 盈利代币 | 亏损代币');
  console.log('------------------------|---------|---------');
  console.log(`平均大户数量            | ${avg(profitTokens, 'whaleCount').toFixed(1)}      | ${avg(lossTokens, 'whaleCount').toFixed(1)}`);
  console.log(`大户持有率              | ${(avg(profitTokens, 'earlyWhaleHoldRatio') * 100).toFixed(1)}%    | ${(avg(lossTokens, 'earlyWhaleHoldRatio') * 100).toFixed(1)}%`);
  console.log(`大户卖出率              | ${(avg(profitTokens, 'earlyWhaleSellRatio') * 100).toFixed(1)}%    | ${(avg(lossTokens, 'earlyWhaleSellRatio') * 100).toFixed(1)}%`);
  console.log(`快速卖出大户数          | ${avg(profitTokens, 'earlyWhaleQuickSellCount').toFixed(1)}      | ${avg(lossTokens, 'earlyWhaleQuickSellCount').toFixed(1)}`);
  console.log(`大部分卖出大户数        | ${avg(profitTokens, 'earlyWhaleMostlySoldCount').toFixed(1)}      | ${avg(lossTokens, 'earlyWhaleMostlySoldCount').toFixed(1)}`);
  console.log(`完全卖出大户数          | ${avg(profitTokens, 'earlyWhaleFullySoldCount').toFixed(1)}      | ${avg(lossTokens, 'earlyWhaleFullySoldCount').toFixed(1)}`);
  console.log(`大户集中度              | ${(avg(profitTokens, 'whaleConcentration') * 100).toFixed(1)}%    | ${(avg(lossTokens, 'whaleConcentration') * 100).toFixed(1)}%`);
  console.log(`平均入场位置            | ${avg(profitTokens, 'avgEntryPosition').toFixed(0)}      | ${avg(lossTokens, 'avgEntryPosition').toFixed(0)}`);

  // 测试不同的过滤条件
  console.log('\n=== 测试过滤条件 ===\n');

  const conditions = [
    { name: 'earlyWhaleHoldRatio < 0.5', test: r => r.analysis.earlyWhaleHoldRatio < 0.5 },
    { name: 'earlyWhaleHoldRatio < 0.4', test: r => r.analysis.earlyWhaleHoldRatio < 0.4 },
    { name: 'earlyWhaleHoldRatio < 0.3', test: r => r.analysis.earlyWhaleHoldRatio < 0.3 },
    { name: 'earlyWhaleSellRatio > 0.3', test: r => r.analysis.earlyWhaleSellRatio > 0.3 },
    { name: 'earlyWhaleSellRatio > 0.5', test: r => r.analysis.earlyWhaleSellRatio > 0.5 },
    { name: 'earlyWhaleSellRatio > 0.7', test: r => r.analysis.earlyWhaleSellRatio > 0.7 },
    { name: 'earlyWhaleFullySoldCount >= 1', test: r => r.analysis.earlyWhaleFullySoldCount >= 1 },
    { name: 'earlyWhaleFullySoldCount >= 2', test: r => r.analysis.earlyWhaleFullySoldCount >= 2 },
    {
      name: '组合: earlyWhaleHoldRatio < 0.4 && earlyWhaleSellRatio > 0.3',
      test: r => r.analysis.earlyWhaleHoldRatio < 0.4 && r.analysis.earlyWhaleSellRatio > 0.3
    },
    {
      name: '组合: earlyWhaleHoldRatio < 0.5 && earlyWhaleSellRatio > 0.5',
      test: r => r.analysis.earlyWhaleHoldRatio < 0.5 && r.analysis.earlyWhaleSellRatio > 0.5
    },
    {
      name: '组合: earlyWhaleHoldRatio < 0.3 && earlyWhaleFullySoldCount >= 1',
      test: r => r.analysis.earlyWhaleHoldRatio < 0.3 && r.analysis.earlyWhaleFullySoldCount >= 1
    },
  ];

  for (const condition of conditions) {
    const filtered = results.filter(condition.test);
    const filteredProfit = filtered.filter(r => r.profitPercent > 0);
    const filteredLoss = filtered.filter(r => r.profitPercent <= 0);

    const lossRecall = lossTokens.length > 0 ? filteredLoss.length / lossTokens.length : 0;
    const profitFPR = profitTokens.length > 0 ? filteredProfit.length / profitTokens.length : 0;
    const f1 = (lossRecall + (1 - profitFPR)) > 0 ? 2 * lossRecall * (1 - profitFPR) / (lossRecall + (1 - profitFPR)) : 0;

    console.log(`\n${condition.name}:`);
    console.log(`  过滤数量: ${filtered.length}/${results.length}`);
    console.log(`  亏损召回: ${(lossRecall * 100).toFixed(1)}% (${filteredLoss.length}/${lossTokens.length})`);
    console.log(`  盈利误伤: ${(profitFPR * 100).toFixed(1)}% (${filteredProfit.length}/${profitTokens.length})`);
    console.log(`  F1分数: ${f1.toFixed(3)}`);
  }

  // 显示典型例子
  console.log('\n=== 典型例子 ===\n');

  console.log('【盈利代币 - 大户持有】');
  const holdingProfit = profitTokens
    .filter(r => r.analysis.earlyWhaleHoldRatio > 0.5)
    .sort((a, b) => b.analysis.earlyWhaleHoldRatio - a.analysis.earlyWhaleHoldRatio)
    .slice(0, 3);

  holdingProfit.forEach(r => {
    console.log(`  ${r.symbol}: +${r.profitPercent.toFixed(1)}%, ${r.analysis.whaleCount}大户, ${(r.analysis.earlyWhaleHoldRatio * 100).toFixed(0)}%持有, ${(r.analysis.earlyWhaleSellRatio * 100).toFixed(0)}%卖出`);
    r.analysis.whales.slice(0, 4).forEach(w => {
      const status = w.isHolding ? '持有' : (w.isFullySold ? '全卖' : '部分卖');
      console.log(`    - ${w.wallet}: $${w.totalBuyAmount}, 位置#${w.buyTradePosition}, ${status}, 卖出${(w.sellRatio * 100).toFixed(0)}%`);
    });
  });

  console.log('\n【亏损代币 - 大户卖出】');
  const sellingLoss = lossTokens
    .filter(r => r.analysis.earlyWhaleSellRatio > 0.5)
    .sort((a, b) => b.analysis.earlyWhaleSellRatio - a.analysis.earlyWhaleSellRatio)
    .slice(0, 3);

  sellingLoss.forEach(r => {
    console.log(`  ${r.symbol}: ${r.profitPercent.toFixed(1)}%, ${r.analysis.whaleCount}大户, ${(r.analysis.earlyWhaleHoldRatio * 100).toFixed(0)}%持有, ${(r.analysis.earlyWhaleSellRatio * 100).toFixed(0)}%卖出`);
    r.analysis.whales.slice(0, 4).forEach(w => {
      const status = w.isHolding ? '持有' : (w.isFullySold ? '全卖' : '部分卖');
      console.log(`    - ${w.wallet}: $${w.totalBuyAmount}, 位置#${w.buyTradePosition}, ${status}, 卖出${(w.sellRatio * 100).toFixed(0)}%`);
    });
  });

  // 总结建议
  console.log('\n=== 总结建议 ===\n');

  console.log('基于真实早期数据的策略建议：');
  console.log('');
  console.log('1. 数据可用性：');
  console.log(`   - 能回溯到创建时间（90秒内）: ${canReach90.length}个代币 (${(canReach90.length / allTokens.length * 100).toFixed(1)}%)`);
  console.log(`   - 不能回溯: ${cannotReach90.length}个代币 (${(cannotReach90.length / allTokens.length * 100).toFixed(1)}%)`);
  console.log('');
  console.log('2. 推荐策略：');
  console.log('   - 只对能回溯到创建时间的代币应用早期大户过滤');
  console.log('   - 其他代币使用其他因子或不应用此因子');
  console.log('');
  console.log('3. 推荐过滤条件（基于上述分析）：');
  console.log('   【保守策略】低误伤，适用于不愿错过好票');
  console.log('   - earlyWhaleFullySoldCount >= 2（至少2个大户完全卖出）');
  console.log('');
  console.log('   【平衡策略】召回和误伤平衡');
  console.log('   - earlyWhaleHoldRatio < 0.4 && earlyWhaleSellRatio > 0.3');
  console.log('');
  console.log('   【激进策略】高召回，会误伤更多好票');
  console.log('   - earlyWhaleHoldRatio < 0.5 && earlyWhaleSellRatio > 0.5');
}

analyzeReachableTokens().catch(console.error);
