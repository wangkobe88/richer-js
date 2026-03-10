/**
 * 深度分析大户持仓行为
 * 重点：大户是持有还是卖出？卖出时机如何？
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
 * 分析代币中的大户持仓行为
 */
function analyzeWhaleHoldingBehavior(trades, checkTime) {
  if (!trades || trades.length === 0) {
    return {
      earlyWhales: [],
      earlyWhaleCount: 0,
      earlyWhaleHoldRatio: 0,  // 持仓比例（未卖出的金额占比）
      earlyWhaleAvgHoldTime: 0,  // 平均持仓时间
      earlyWhaleQuickSellCount: 0,  // 快速卖出数（30秒内）
      earlyWhaleLateSellCount: 0,   // 晚期卖出数（60秒后）
      earlyWhaleSellRatio: 0,       // 卖出比例（已卖出金额占比）
      priceAtFirstSell: 0,           // 第一次卖出时的价格涨幅
      whaleConcentration: 0         // 大户集中度（前3大户的持仓占比）
    };
  }

  try {
    // 找到最早的交易时间作为基准
    const earliestTime = Math.min(...trades.map(t => t.time));
    const windowStart = earliestTime;

    // 定义"前期交易"：前30笔交易（或前20%）
    const earlyTradeCount = Math.min(30, Math.floor(trades.length * 0.2));
    const earlyTradeEndTime = trades[earlyTradeCount - 1]?.time || windowStart;

    const baseCurrencies = ['WBNB', 'USDT', 'BUSD', 'USDC', 'ETH'];

    // 按钱包分组
    const walletMap = new Map();

    trades.forEach(trade => {
      const wallet = trade.wallet_address?.toLowerCase();
      if (!wallet) return;

      const fromToken = trade.from_token_symbol;
      const toToken = trade.to_token_symbol;
      const isBuy = fromToken && baseCurrencies.includes(fromToken);
      const isSell = toToken && baseCurrencies.includes(toToken);
      const relTime = trade.time - windowStart;

      if (!walletMap.has(wallet)) {
        walletMap.set(wallet, {
          wallet,
          buyTrades: [],
          sellTrades: [],
          totalBuyAmount: 0,
          totalSellAmount: 0,
          totalBuyTokens: 0,
          totalSellTokens: 0,
          firstBuyTime: null,
          lastBuyTime: null,
          firstSellTime: null,
          lastSellTime: null,
          buyCount: 0,
          sellCount: 0
        });
      }

      const w = walletMap.get(wallet);

      if (isBuy) {
        w.buyTrades.push({ relTime, amount: trade.from_usd, time: trade.time });
        w.totalBuyAmount += trade.from_usd || 0;
        w.totalBuyTokens += trade.to_amount || 0;
        w.buyCount++;
        if (w.firstBuyTime === null || relTime < w.firstBuyTime) {
          w.firstBuyTime = relTime;
        }
        if (w.lastBuyTime === null || relTime > w.lastBuyTime) {
          w.lastBuyTime = relTime;
        }
      } else if (isSell) {
        w.sellTrades.push({ relTime, amount: trade.to_usd, time: trade.time });
        w.totalSellAmount += trade.to_usd || 0;
        w.totalSellTokens += trade.from_amount || 0;
        w.sellCount++;
        if (w.firstSellTime === null || relTime < w.firstSellTime) {
          w.firstSellTime = relTime;
        }
        if (w.lastSellTime === null || relTime > w.lastSellTime) {
          w.lastSellTime = relTime;
        }
      }
    });

    // 找出极早期大户（前30笔交易中买入>$200）
    const earlyWhales = Array.from(walletMap.values()).filter(w => {
      if (w.firstBuyTime === null || w.totalBuyAmount <= 200) return false;
      const firstTradeTime = trades.find(t => t.tx_id === (w.buyTrades[0]?.tx_id))?.time || windowStart;
      return firstTradeTime <= earlyTradeEndTime;
    });

    if (earlyWhales.length === 0) {
      return {
        earlyWhales: [],
        earlyWhaleCount: 0,
        earlyWhaleHoldRatio: 0,
        earlyWhaleAvgHoldTime: 0,
        earlyWhaleQuickSellCount: 0,
        earlyWhaleLateSellCount: 0,
        earlyWhaleSellRatio: 0,
        priceAtFirstSell: 0,
        whaleConcentration: 0
      };
    }

    // 计算大户的总买入金额
    const totalWhaleBuyAmount = earlyWhales.reduce((sum, w) => sum + w.totalBuyAmount, 0);

    // 计算大户集中度（前3大户的持仓占比）
    const top3Whales = earlyWhales
      .sort((a, b) => b.totalBuyAmount - a.totalBuyAmount)
      .slice(0, 3);
    const top3WhaleBuyAmount = top3Whales.reduce((sum, w) => sum + w.totalBuyAmount, 0);
    const whaleConcentration = totalWhaleBuyAmount > 0 ? top3WhaleBuyAmount / totalWhaleBuyAmount : 0;

    // 分析每个大户的持仓行为
    const whaleDetails = earlyWhales.map(w => {
      const hasSold = w.totalSellAmount > 0;
      const holdTime = hasSold ? (w.firstSellTime - w.firstBuyTime) : null;
      const holdTimeCategory = !hasSold ? '未卖出' :
        holdTime < 30 ? '快速卖出(<30s)' :
        holdTime < 60 ? '中期卖出(30-60s)' :
        '长期持有(>60s)';

      const sellRatio = w.totalBuyAmount > 0 ? w.totalSellAmount / w.totalBuyAmount : 0;

      // 计算第一次卖出时的价格涨幅
      let priceIncreaseAtFirstSell = null;
      if (hasSold && w.buyTrades.length > 0) {
        const buyTrade = w.buyTrades[0];
        const sellTrade = w.sellTrades[0];
        const buyPrice = buyTrade.amount / buyTrade.time; // 临时计算
        const sellPrice = sellTrade.amount / sellTrade.time;
        // 这里简化处理，实际应该用token价格
        priceIncreaseAtFirstSell = 0; // 需要更复杂的计算
      }

      return {
        wallet: w.wallet.substring(0, 10),
        buyAmount: w.totalBuyAmount.toFixed(0),
        sellAmount: w.totalSellAmount.toFixed(0),
        profit: (w.totalSellAmount - w.totalBuyAmount).toFixed(0),
        profitPercent: w.totalBuyAmount > 0 ? ((w.totalSellAmount - w.totalBuyAmount) / w.totalBuyAmount * 100).toFixed(1) : 'N/A',
        buyCount: w.buyCount,
        sellCount: w.sellCount,
        hasSold,
        holdTime: hasSold ? holdTime.toFixed(1) : null,
        holdTimeCategory,
        sellRatio: (sellRatio * 100).toFixed(1),
        isQuickSell: hasSold && holdTime < 30,
        isLateSell: hasSold && holdTime >= 60
      };
    });

    // 统计指标
    const earlyWhaleHoldRatio = earlyWhales.filter(w => w.totalSellAmount === 0).length / earlyWhales.length;
    const earlyWhaleQuickSellCount = earlyWhales.filter(w => w.totalSellAmount > 0 && (w.firstSellTime - w.firstBuyTime) < 30).length;
    const earlyWhaleLateSellCount = earlyWhales.filter(w => w.totalSellAmount > 0 && (w.firstSellTime - w.firstBuyTime) >= 60).length;

    const totalBuy = earlyWhales.reduce((sum, w) => sum + w.totalBuyAmount, 0);
    const totalSell = earlyWhales.reduce((sum, w) => sum + w.totalSellAmount, 0);
    const earlyWhaleSellRatio = totalBuy > 0 ? totalSell / totalBuy : 0;

    const soldWhales = earlyWhales.filter(w => w.totalSellAmount > 0);
    const earlyWhaleAvgHoldTime = soldWhales.length > 0
      ? soldWhales.reduce((sum, w) => sum + (w.firstSellTime - w.firstBuyTime), 0) / soldWhales.length
      : 0;

    // 计算第一次卖出时的时间点
    const allFirstSellTimes = earlyWhales
      .filter(w => w.totalSellAmount > 0)
      .map(w => w.firstSellTime);

    const earliestSellTime = allFirstSellTimes.length > 0 ? Math.min(...allFirstSellTimes) : null;

    // 计算第一次卖出时的价格涨幅（基于整体交易）
    let priceAtFirstSell = 0;
    if (earliestSellTime !== null) {
      // 计算卖出前的平均买入价格和卖出时的平均卖出价格
      const beforeSellTrades = trades.filter(t => {
        const fromToken = t.from_token_symbol;
        const isBuy = fromToken && baseCurrencies.includes(fromToken);
        const relTime = t.time - windowStart;
        return isBuy && relTime < earliestSellTime;
      });

      const afterSellTrades = trades.filter(t => {
        const toToken = t.to_token_symbol;
        const isSell = toToken && baseCurrencies.includes(toToken);
        const relTime = t.time - windowStart;
        return isSell && relTime >= earliestSellTime && relTime < earliestSellTime + 5;
      });

      // 简化计算：使用买卖金额比例作为价格变化 proxy
      const beforeBuyVolume = beforeSellTrades.reduce((sum, t) => sum + (t.from_usd || 0), 0);
      const afterSellVolume = afterSellTrades.reduce((sum, t) => sum + (t.to_usd || 0), 0);
      priceAtFirstSell = beforeBuyVolume > 0 ? (afterSellVolume - beforeBuyVolume) / beforeBuyVolume : 0;
    }

    return {
      earlyWhales: whaleDetails,
      earlyWhaleCount: earlyWhales.length,
      earlyWhaleHoldRatio,
      earlyWhaleAvgHoldTime,
      earlyWhaleQuickSellCount,
      earlyWhaleLateSellCount,
      earlyWhaleSellRatio,
      priceAtFirstSell,
      whaleConcentration,
      totalWhaleBuyAmount
    };
  } catch (error) {
    console.error('Error in analyzeWhaleHoldingBehavior:', error.message);
    return {
      earlyWhales: [],
      earlyWhaleCount: 0,
      earlyWhaleHoldRatio: 0,
      earlyWhaleAvgHoldTime: 0,
      earlyWhaleQuickSellCount: 0,
      earlyWhaleLateSellCount: 0,
      earlyWhaleSellRatio: 0,
      priceAtFirstSell: 0,
      whaleConcentration: 0
    };
  }
}

/**
 * 获取代币交易数据
 */
async function fetchTokenTrades(tokenAddress, checkTime) {
  const targetFromTime = checkTime - 90;
  const innerPair = `${tokenAddress}_fo`;
  const pairId = `${innerPair}-bsc`;

  try {
    const allTrades = [];
    let currentToTime = checkTime;

    for (let loop = 1; loop <= 10; loop++) {
      const trades = await txApi.getSwapTransactions(
        pairId, 300, targetFromTime, currentToTime, 'asc'
      );
      if (trades.length === 0) break;
      allTrades.push(...trades);
      if (trades[0].time <= targetFromTime || trades.length < 300) break;
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

    return uniqueTrades;
  } catch (error) {
    return null;
  }
}

async function analyzeWhaleHolding() {
  console.log('=== 深度分析：大户持仓行为 ===\n');
  console.log('重点关注：大户是持有还是卖出？卖出时机如何？\n');

  // 获取所有交易的收益率
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

  // 收集所有代币数据
  const allTokens = [];

  for (const exp of experiments) {
    console.log(`获取 ${exp.name} 的数据...`);

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
        const checkTime = signal.metadata?.preBuyCheckFactors?.earlyTradesCheckTime;

        if (checkTime) {
          allTokens.push({
            tokenAddress: signal.token_address,
            symbol: signal.metadata?.symbol || signal.token_address.substring(0, 8),
            profitPercent: profit !== undefined ? profit : null,
            checkTime
          });
        }
      }
    }

    console.log(`  完成，获取 ${executedSignals.length} 个信号`);
  }

  console.log(`\n总共: ${allTokens.length} 个代币\n`);

  // 计算大户持仓行为
  const tokensWithWhaleBehavior = [];

  for (let i = 0; i < allTokens.length; i++) {
    const token = allTokens[i];

    const trades = await fetchTokenTrades(token.tokenAddress, token.checkTime);

    if (trades && trades.length > 0) {
      const whaleBehavior = analyzeWhaleHoldingBehavior(trades, token.checkTime);
      tokensWithWhaleBehavior.push({
        ...token,
        tradesCount: trades.length,
        ...whaleBehavior
      });
    }

    if ((i + 1) % 10 === 0) {
      console.log(`进度: ${i + 1}/${allTokens.length}`);
    }

    await new Promise(resolve => setTimeout(resolve, 50));
  }

  console.log(`\n有效数据: ${tokensWithWhaleBehavior.length} 个代币\n`);

  // 分类
  const lossTokens = tokensWithWhaleBehavior.filter(t => t.profitPercent !== null && t.profitPercent <= 0);
  const profitTokens = tokensWithWhaleBehavior.filter(t => t.profitPercent !== null && t.profitPercent > 0);

  // 只分析有大户的代币
  const lossWithWhales = lossTokens.filter(t => t.earlyWhaleCount > 0);
  const profitWithWhales = profitTokens.filter(t => t.earlyWhaleCount > 0);

  console.log('【数据分布】');
  console.log(`总代币数: ${tokensWithWhaleBehavior.length}`);
  console.log(`  有大户的亏损代币: ${lossWithWhales.length}`);
  console.log(`  有大户的盈利代币: ${profitWithWhales.length}`);
  console.log(`  无大户的代币: ${tokensWithWhaleBehavior.length - lossWithWhales.length - profitWithWhales.length}\n`);

  // 对比分析
  console.log('=== 对比分析：大户持仓行为 ===\n');

  const avg = (arr, fn) => arr.length > 0 ? arr.reduce((sum, t) => sum + fn(t), 0) / arr.length : 0;

  console.log('指标                        | 亏损代币 | 盈利代币 | 差异');
  console.log('----------------------------|---------|---------|------');
  console.log(`大户数量                    | ${avg(lossWithWhales, t => t.earlyWhaleCount).toFixed(1)}      | ${avg(profitWithWhales, t => t.earlyWhaleCount).toFixed(1)}      | ${(avg(lossWithWhales, t => t.earlyWhaleCount) - avg(profitWithWhales, t => t.earlyWhaleCount)).toFixed(1)}`);
  console.log(`未卖出大户比例              | ${(avg(lossWithWhales, t => t.earlyWhaleHoldRatio) * 100).toFixed(1)}%      | ${(avg(profitWithWhales, t => t.earlyWhaleHoldRatio) * 100).toFixed(1)}%      | ${((avg(lossWithWhales, t => t.earlyWhaleHoldRatio) - avg(profitWithWhales, t => t.earlyWhaleHoldRatio)) * 100).toFixed(1)}%`);
  console.log(`平均持仓时间(秒)           | ${avg(lossWithWhales, t => t.earlyWhaleAvgHoldTime).toFixed(1)}      | ${avg(profitWithWhales, t => t.earlyWhaleAvgHoldTime).toFixed(1)}      | ${(avg(lossWithWhales, t => t.earlyWhaleAvgHoldTime) - avg(profitWithWhales, t => t.earlyWhaleAvgHoldTime)).toFixed(1)}`);
  console.log(`快速卖出大户数(<30s)       | ${avg(lossWithWhales, t => t.earlyWhaleQuickSellCount).toFixed(1)}      | ${avg(profitWithWhales, t => t.earlyWhaleQuickSellCount).toFixed(1)}      | ${(avg(lossWithWhales, t => t.earlyWhaleQuickSellCount) - avg(profitWithWhales, t => t.earlyWhaleQuickSellCount)).toFixed(1)}`);
  console.log(`晚期卖出大户数(>60s)       | ${avg(lossWithWhales, t => t.earlyWhaleLateSellCount).toFixed(1)}      | ${avg(profitWithWhales, t => t.earlyWhaleLateSellCount).toFixed(1)}      | ${(avg(lossWithWhales, t => t.earlyWhaleLateSellCount) - avg(profitWithWhales, t => t.earlyWhaleLateSellCount)).toFixed(1)}`);
  console.log(`大户卖出比例                | ${(avg(lossWithWhales, t => t.earlyWhaleSellRatio) * 100).toFixed(1)}%      | ${(avg(profitWithWhales, t => t.earlyWhaleSellRatio) * 100).toFixed(1)}%      | ${((avg(lossWithWhales, t => t.earlyWhaleSellRatio) - avg(profitWithWhales, t => t.earlyWhaleSellRatio)) * 100).toFixed(1)}%`);
  console.log(`第一次卖出时价格涨幅        | ${(avg(lossWithWhales, t => t.priceAtFirstSell) * 100).toFixed(1)}%      | ${(avg(profitWithWhales, t => t.priceAtFirstSell) * 100).toFixed(1)}%      | ${((avg(lossWithWhales, t => t.priceAtFirstSell) - avg(profitWithWhales, t => t.priceAtFirstSell)) * 100).toFixed(1)}%`);
  console.log(`大户集中度(前3占比)        | ${(avg(lossWithWhales, t => t.whaleConcentration) * 100).toFixed(1)}%      | ${(avg(profitWithWhales, t => t.whaleConcentration) * 100).toFixed(1)}%      | ${((avg(lossWithWhales, t => t.whaleConcentration) - avg(profitWithWhales, t => t.whaleConcentration)) * 100).toFixed(1)}%`);

  // 测试不同条件
  console.log('\n=== 测试不同过滤条件 ===\n');

  const conditions = [
    {
      name: '有快速卖出大户',
      desc: 'earlyWhaleQuickSellCount >= 1',
      test: t => t.earlyWhaleQuickSellCount >= 1
    },
    {
      name: '有≥2个快速卖出大户',
      desc: 'earlyWhaleQuickSellCount >= 2',
      test: t => t.earlyWhaleQuickSellCount >= 2
    },
    {
      name: '大户卖出比例>30%',
      desc: 'earlyWhaleSellRatio > 0.3',
      test: t => t.earlyWhaleSellRatio > 0.3
    },
    {
      name: '大户卖出比例>50%',
      desc: 'earlyWhaleSellRatio > 0.5',
      test: t => t.earlyWhaleSellRatio > 0.5
    },
    {
      name: '未卖出大户比例<30%',
      desc: 'earlyWhaleHoldRatio < 0.3',
      test: t => t.earlyWhaleHoldRatio < 0.3
    },
    {
      name: '大户集中度>60%',
      desc: 'whaleConcentration > 0.6',
      test: t => t.whaleConcentration > 0.6
    },
    {
      name: '组合: 快速卖出大户>=1 AND 集中度>60%',
      desc: 'earlyWhaleQuickSellCount >= 1 AND whaleConcentration > 0.6',
      test: t => t.earlyWhaleQuickSellCount >= 1 && t.whaleConcentration > 0.6
    },
    {
      name: '组合: 卖出比例>30% AND 集中度>60%',
      desc: 'earlyWhaleSellRatio > 0.3 AND whaleConcentration > 0.6',
      test: t => t.earlyWhaleSellRatio > 0.3 && t.whaleConcentration > 0.6
    },
    {
      name: '组合: 快速卖出>=2 OR 卖出比例>50%',
      desc: 'earlyWhaleQuickSellCount >= 2 OR earlyWhaleSellRatio > 0.5',
      test: t => t.earlyWhaleQuickSellCount >= 2 || t.earlyWhaleSellRatio > 0.5
    }
  ];

  console.log('条件                                          | 亏损召回 | 盈利误伤 | F1分数 | 净避免收益');
  console.log('----------------------------------------------|---------|---------|--------|----------');

  conditions.forEach(condition => {
    const rejectedLoss = lossTokens.filter(condition.test);
    const rejectedProfit = profitTokens.filter(condition.test);

    const lossRecall = lossTokens.length > 0 ? rejectedLoss.length / lossTokens.length : 0;
    const profitPrecision = profitTokens.length > 0 ? 1 - (rejectedProfit.length / profitTokens.length) : 1;

    const f1 = (lossRecall + profitPrecision > 0) ? (2 * lossRecall * profitPrecision) / (lossRecall + profitPrecision) : 0;

    const avoidedLoss = rejectedLoss.reduce((sum, t) => sum + t.profitPercent, 0);
    const missedProfit = rejectedProfit.reduce((sum, t) => sum + t.profitPercent, 0);
    const netAvoided = avoidedLoss - missedProfit;

    console.log(`${condition.desc.padEnd(44)} | ${(lossRecall * 100).toFixed(1).padStart(7)}% | ${rejectedProfit.length}/${profitTokens.length} | ${f1.toFixed(3)} | ${netAvoided > 0 ? '+' : ''}${netAvoided.toFixed(1)}%`);
  });

  // 显示典型案例
  console.log('\n=== 典型案例分析 ===\n');

  // 找出最佳条件
  let bestCondition = conditions[0];
  let bestF1 = 0;
  conditions.forEach(c => {
    const rejectedLoss = lossTokens.filter(c.test);
    const rejectedProfit = profitTokens.filter(c.test);
    const lossRecall = lossTokens.length > 0 ? rejectedLoss.length / lossTokens.length : 0;
    const profitPrecision = profitTokens.length > 0 ? 1 - (rejectedProfit.length / profitTokens.length) : 1;
    const f1 = (lossRecall + profitPrecision > 0) ? (2 * lossRecall * profitPrecision) / (lossRecall + profitPrecision) : 0;
    if (f1 > bestF1) {
      bestF1 = f1;
      bestCondition = c;
    }
  });

  const rejectedLoss = lossTokens.filter(bestCondition.test);
  const rejectedProfit = profitTokens.filter(bestCondition.test);

  console.log(`【最佳条件: ${bestCondition.desc}】`);
  console.log(`  亏损召回: ${rejectedLoss.length}/${lossTokens.length} (${(rejectedLoss.length / lossTokens.length * 100).toFixed(1)}%)`);
  console.log(`  盈利误伤: ${rejectedProfit.length}/${profitTokens.length} (${(rejectedProfit.length / profitTokens.length * 100).toFixed(1)}%)`);
  console.log(`  F1分数: ${bestF1.toFixed(3)}`);
  console.log(`  净避免收益: ${(rejectedLoss.reduce((sum, t) => sum + t.profitPercent, 0) - rejectedProfit.reduce((sum, t) => sum + t.profitPercent, 0)).toFixed(1)}%\n`);

  if (rejectedLoss.length > 0) {
    console.log('被过滤的亏损代币:');
    console.log('代币        | 收益率 | 大户数 | 未卖出比例 | 快速卖出 | 卖出比例 | 集中度 | 大户详情');
    console.log('------------|--------|-------|-----------|---------|---------|---------|---------');

    rejectedLoss.sort((a, b) => a.profitPercent - b.profitPercent).slice(0, 10).forEach(t => {
      const whaleInfo = t.earlyWhales.slice(0, 3).map(w => {
        const action = w.hasSold ? `${w.holdTimeCategory} sold${w.sellRatio}%` : '未卖出';
        return `${w.wallet}:$${w.buyAmount}(${action})`;
      }).join('; ');
      console.log(`${t.symbol.substring(0, 11).padEnd(11)} | ${t.profitPercent.toFixed(1).padStart(6)}% | ${t.earlyWhaleCount.toString().padStart(5)} | ${(t.earlyWhaleHoldRatio * 100).toFixed(0).padStart(7)}% | ${t.earlyWhaleQuickSellCount.toString().padStart(7)} | ${(t.earlyWhaleSellRatio * 100).toFixed(0).padStart(7)}% | ${(t.whaleConcentration * 100).toFixed(0).padStart(6)}% | ${whaleInfo.substring(0, 50)}`);
    });
  }

  if (rejectedProfit.length > 0) {
    console.log('\n被过滤的盈利代币（误伤）:');
    console.log('代币        | 收益率 | 大户数 | 未卖出比例 | 快速卖出 | 卖出比例 | 集中度 | 大户详情');
    console.log('------------|--------|-------|-----------|---------|---------|---------|---------');

    rejectedProfit.sort((a, b) => b.profitPercent - a.profitPercent).forEach(t => {
      const whaleInfo = t.earlyWhales.slice(0, 3).map(w => {
        const action = w.hasSold ? `${w.holdTimeCategory} sold${w.sellRatio}%` : '未卖出';
        return `${w.wallet}:$${w.buyAmount}(${action})`;
      }).join('; ');
      console.log(`${t.symbol.substring(0, 11).padEnd(11)} | +${t.profitPercent.toFixed(1).padStart(5)}% | ${t.earlyWhaleCount.toString().padStart(5)} | ${(t.earlyWhaleHoldRatio * 100).toFixed(0).padStart(7)}% | ${t.earlyWhaleQuickSellCount.toString().padStart(7)} | ${(t.earlyWhaleSellRatio * 100).toFixed(0).padStart(7)}% | ${(t.whaleConcentration * 100).toFixed(0).padStart(6)}% | ${whaleInfo.substring(0, 50)}`);
    });
  } else {
    console.log('\n✓ 无盈利代币被误伤！');
  }

  // 详细的大户行为分析
  console.log('\n=== 详细大户行为分析 ===\n');

  console.log('【典型亏损代币的大户行为】');

  const worstLoss = lossWithWhales.sort((a, b) => a.profitPercent - b.profitPercent)[0];
  if (worstLoss) {
    console.log(`代币: ${worstLoss.symbol} (${worstLoss.profitPercent.toFixed(1)}%)`);
    console.log(`大户数: ${worstLoss.earlyWhaleCount}, 大户集中度: ${(worstLoss.whaleConcentration * 100).toFixed(1)}%`);
    console.log('  钱包 | 买入金额 | 卖出金额 | 持仓时间 | 卖出类型');
    console.log('  -----|---------|---------|---------|---------');
    worstLoss.earlyWhales.forEach(w => {
      const holdTimeStr = w.hasSold ? `${w.holdTime}s` : '未卖出';
      const sellType = w.hasSold ? w.holdTimeCategory : '持有';
      console.log(`  ${w.wallet.padEnd(5)} | $${w.buyAmount.padStart(6)} | $${w.sellAmount.padStart(6)} | ${holdTimeStr.padStart(7)} | ${sellType}`);
    });
  }

  console.log('\n【典型盈利代币的大户行为】');

  const bestProfit = profitWithWhales.sort((a, b) => b.profitPercent - a.profitPercent)[0];
  if (bestProfit) {
    console.log(`代币: ${bestProfit.symbol} (${bestProfit.profitPercent.toFixed(1)}%)`);
    console.log(`大户数: ${bestProfit.earlyWhaleCount}, 大户集中度: ${(bestProfit.whaleConcentration * 100).toFixed(1)}%`);
    console.log('  钱包 | 买入金额 | 卖出金额 | 持仓时间 | 卖出类型');
    console.log('  -----|---------|---------|---------|---------');
    bestProfit.earlyWhales.forEach(w => {
      const holdTimeStr = w.hasSold ? `${w.holdTime}s` : '未卖出';
      const sellType = w.hasSold ? w.holdTimeCategory : '持有';
      console.log(`  ${w.wallet.padEnd(5)} | $${w.buyAmount.padStart(6)} | $${w.sellAmount.padStart(6)} | ${holdTimeStr.padStart(7)} | ${sellType}`);
    });
  }

  // 推荐因子
  console.log('\n=== 推荐的新因子 ===\n');

  console.log('因子名称: walletEarlyWhaleQuickSellCount（快速卖出大户数）');
  console.log('定义: 前30笔交易中的大户，持仓时间<30秒的钱包数');
  console.log('说明: 大户快速卖出可能是收割信号\n');

  console.log('因子名称: walletEarlyWhaleSellRatio（大户卖出比例）');
  console.log('定义: 大户的总卖出金额 / 大户的总买入金额');
  console.log('推荐阈值: > 0.5 (50%)');
  console.log('说明: 大户大量卖出说明在出货\n');

  console.log('因子名称: walletWhaleConcentration（大户集中度）');
  console.log('定义: 前3大户的买入金额占所有大户买入金额的比例');
  console.log('推荐阈值: > 0.6 (60%)');
  console.log('说明: 集中度过高可能是操控\n');

  console.log('建议使用组合条件: earlyWhaleQuickSellCount >= 2 OR earlyWhaleSellRatio > 0.5');
  console.log('  - 捕获"大户快速出货"或"大户大量卖出"的代币');
}

analyzeWhaleHolding().catch(console.error);
