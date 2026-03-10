/**
 * 检测"收割流动性"模式
 * 特征：早期低价获取大量筹码 → 等待价格上涨 → 逐步卖出收割散户 → 流动性枯竭
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
 * 检测"收割流动性"模式
 */
function detectHarvestPattern(trades, checkTime) {
  if (!trades || trades.length === 0) {
    return {
      hasHarvester: false,
      harvesters: [],
      liquidityDropAfterSell: 0,
      earlyWhaleSellRatio: 0,
      avgSellDelay: 0,
      sellPriceIncrease: 0
    };
  }

  try {
    // 先找到最早的交易时间作为基准
    const earliestTime = Math.min(...trades.map(t => t.time));
    const windowStart = earliestTime;

    // 1. 按钱包分组，详细分析每个钱包的交易
    const walletMap = new Map();

    trades.forEach(trade => {
      const wallet = trade.from_address?.toLowerCase();
      if (!wallet) return;

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
          avgBuyPrice: 0,
          avgSellPrice: 0
        });
      }

      const w = walletMap.get(wallet);
      const relTime = trade.time - windowStart;

      const fromToken = trade.from_token_symbol;
      const toToken = trade.to_token_symbol;

      // 判断是买入还是卖出
      // 买入：WBNB → TOKEN（from_token_symbol是WBNB或USDT等基础货币）
      // 卖出：TOKEN → WBNB（to_token_symbol是WBNB或USDT等基础货币）
      const baseCurrencies = ['WBNB', 'USDT', 'BUSD', 'USDC', 'ETH'];
      const isBuy = fromToken && baseCurrencies.includes(fromToken);
      const isSell = toToken && baseCurrencies.includes(toToken);

      if (isBuy) {
        // 买入
        w.buyTrades.push({ ...trade, relTime });
        w.totalBuyAmount += trade.from_usd || 0;
        w.totalBuyTokens += trade.to_amount || 0;
        if (w.firstBuyTime === null || relTime < w.firstBuyTime) {
          w.firstBuyTime = relTime;
        }
        if (w.lastBuyTime === null || relTime > w.lastBuyTime) {
          w.lastBuyTime = relTime;
        }
      } else if (isSell) {
        // 卖出
        w.sellTrades.push({ ...trade, relTime });
        w.totalSellAmount += trade.to_usd || 0;
        w.totalSellTokens += trade.from_amount || 0;
        if (w.firstSellTime === null || relTime < w.firstSellTime) {
          w.firstSellTime = relTime;
        }
        if (w.lastSellTime === null || relTime > w.lastSellTime) {
          w.lastSellTime = relTime;
        }
      }
      // 忽略既不是买入也不是卖出的交易（如添加流动性）
    });

    // 2. 计算每个钱包的平均买入和卖出价格
    walletMap.forEach(w => {
      if (w.totalBuyTokens > 0) {
        w.avgBuyPrice = w.totalBuyAmount / w.totalBuyTokens;
      }
      if (w.totalSellTokens > 0) {
        w.avgSellPrice = w.totalSellAmount / w.totalSellTokens;
      }
    });

    // 3. 检测"收割者"
    const harvesters = [];

    walletMap.forEach(w => {
      const sellRatio = w.totalBuyAmount > 0 ? w.totalSellAmount / w.totalBuyAmount : 0;

      // 收割者特征（更严格的定义）：
      // a) 前10秒入场（极早期，从第一笔交易开始计时）
      // b) 买入金额 > $300（大户）
      // c) 有卖出行为
      // d) 卖出价格 > 买入价格 * 2.0（价格上涨至少100%后开始卖）
      // e) 买入到卖出的时间 > 10秒（等待价格上涨）
      // f) 卖出比例 > 50%（卖出了大部分持仓）

      if (w.firstBuyTime !== null &&
          w.firstBuyTime < 10 &&
          w.totalBuyAmount > 300 &&
          w.sellTrades.length > 0 &&
          w.avgSellPrice > w.avgBuyPrice * 2.0 &&
          (w.firstSellTime - w.firstBuyTime) > 10 &&
          sellRatio > 0.5) {

        const holdTime = w.firstSellTime - w.firstBuyTime;
        const priceIncrease = (w.avgSellPrice - w.avgBuyPrice) / w.avgBuyPrice;
        const sellCount = w.sellTrades.length;

        harvesters.push({
          wallet: w.wallet.substring(0, 8),
          buyAmount: w.totalBuyAmount.toFixed(0),
          sellAmount: w.totalSellAmount.toFixed(0),
          profit: (w.totalSellAmount - w.totalBuyAmount).toFixed(0),
          profitPercent: (priceIncrease * 100).toFixed(1),
          firstBuyTime: w.firstBuyTime.toFixed(1),
          firstSellTime: w.firstSellTime.toFixed(1),
          holdTime: holdTime.toFixed(1),
          sellCount,
          sellRatio: (sellRatio * 100).toFixed(1),
          avgBuyPrice: w.avgBuyPrice.toFixed(6),
          avgSellPrice: w.avgSellPrice.toFixed(6)
        });
      }
    });

    // 4. 分析流动性变化
    // 计算每个5秒时间段的交易量
    const timeWindows = [];
    for (let t = 0; t < 90; t += 5) {
      const windowTrades = trades.filter(tr => {
        const relTime = tr.time - windowStart;
        return relTime >= t && relTime < t + 5;
      });
      const volume = windowTrades.reduce((sum, t) => sum + (t.from_usd || 0) + (t.to_usd || 0), 0);
      timeWindows.push({ start: t, volume, tradeCount: windowTrades.length });
    }

    // 找到第一个收割者开始卖出的时间点
    let firstHarvestSellTime = null;
    if (harvesters.length > 0) {
      const firstHarvester = walletMap.get(harvesters[0].wallet);
      if (firstHarvester) {
        firstHarvestSellTime = firstHarvester.firstSellTime;
      }
    }

    // 计算收割者卖出前后的平均交易量
    let liquidityDropAfterSell = 0;
    if (firstHarvestSellTime !== null) {
      const beforeVolume = timeWindows
        .filter(w => w.start < firstHarvestSellTime)
        .reduce((sum, w) => sum + w.volume, 0) / Math.max(1, timeWindows.filter(w => w.start < firstHarvestSellTime).length);

      const afterVolume = timeWindows
        .filter(w => w.start >= firstHarvestSellTime + 10)  // 卖出10秒后
        .reduce((sum, w) => sum + w.volume, 0) / Math.max(1, timeWindows.filter(w => w.start >= firstHarvestSellTime + 10).length);

      liquidityDropAfterSell = beforeVolume > 0 ? (afterVolume - beforeVolume) / beforeVolume : 0;
    }

    // 5. 计算早期大户的卖出比例
    let earlyWhaleSellRatio = 0;
    const earlyWhales = Array.from(walletMap.values()).filter(w =>
      w.firstBuyTime !== null && w.firstBuyTime < 15 && w.totalBuyAmount > 500
    );
    if (earlyWhales.length > 0) {
      const earlyWhaleSellAmount = earlyWhales.reduce((sum, w) => sum + w.totalSellAmount, 0);
      const earlyWhaleBuyAmount = earlyWhales.reduce((sum, w) => sum + w.totalBuyAmount, 0);
      earlyWhaleSellRatio = earlyWhaleBuyAmount > 0 ? earlyWhaleSellAmount / earlyWhaleBuyAmount : 0;
    }

    // 6. 平均卖出延迟
    let avgSellDelay = 0;
    const sellersWithProfit = Array.from(walletMap.values()).filter(w =>
      w.firstBuyTime !== null &&
      w.firstSellTime !== null &&
      w.totalSellAmount > w.totalBuyAmount * 1.3  // 卖出盈利>30%
    );
    if (sellersWithProfit.length > 0) {
      avgSellDelay = sellersWithProfit.reduce((sum, w) => sum + (w.firstSellTime - w.firstBuyTime), 0) / sellersWithProfit.length;
    }

    // 7. 平均价格上涨幅度（对盈利的卖出者）
    let avgSellPriceIncrease = 0;
    if (sellersWithProfit.length > 0) {
      avgSellPriceIncrease = sellersWithProfit.reduce((sum, w) => {
        const increase = w.avgBuyPrice > 0 ? (w.avgSellPrice - w.avgBuyPrice) / w.avgBuyPrice : 0;
        return sum + increase;
      }, 0) / sellersWithProfit.length;
    }

    return {
      hasHarvester: harvesters.length > 0,
      harvesters,
      harvesterCount: harvesters.length,
      liquidityDropAfterSell,
      earlyWhaleSellRatio,
      avgSellDelay,
      sellPriceIncrease: avgSellPriceIncrease,
      earlyWhaleCount: earlyWhales.length
    };
  } catch (error) {
    console.error('Error in detectHarvestPattern:', error.message);
    return {
      hasHarvester: false,
      harvesters: [],
      liquidityDropAfterSell: 0,
      earlyWhaleSellRatio: 0,
      avgSellDelay: 0,
      sellPriceIncrease: 0,
      earlyWhaleCount: 0
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

async function analyzeHarvestLiquidity() {
  console.log('=== 检测"收割流动性"模式 ===\n');
  console.log('特征：早期低价获取筹码 → 等待价格上涨 → 逐步卖出收割散户 → 流动性枯竭\n');

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
            checkTime,
            experimentId: exp.id
          });
        }
      }
    }

    console.log(`  完成，获取 ${executedSignals.length} 个信号`);
  }

  console.log(`\n总共: ${allTokens.length} 个代币\n`);

  // 计算收割因子
  const tokensWithHarvest = [];

  for (let i = 0; i < allTokens.length; i++) {
    const token = allTokens[i];

    const trades = await fetchTokenTrades(token.tokenAddress, token.checkTime);

    if (trades && trades.length > 0) {
      const harvest = detectHarvestPattern(trades, token.checkTime);
      tokensWithHarvest.push({
        ...token,
        tradesCount: trades.length,
        ...harvest
      });
    }

    if ((i + 1) % 10 === 0) {
      console.log(`进度: ${i + 1}/${allTokens.length}`);
    }

    await new Promise(resolve => setTimeout(resolve, 50));
  }

  console.log(`\n有效数据: ${tokensWithHarvest.length} 个代币\n`);

  // 分类
  const lossTokens = tokensWithHarvest.filter(t => t.profitPercent !== null && t.profitPercent <= 0);
  const profitTokens = tokensWithHarvest.filter(t => t.profitPercent !== null && t.profitPercent > 0);

  console.log('【数据分布】');
  console.log(`总代币数: ${tokensWithHarvest.length}`);
  console.log(`  亏损代币: ${lossTokens.length}`);
  console.log(`  盈利代币: ${profitTokens.length}\n`);

  // 对比分析
  console.log('=== 对比分析：亏损代币 vs 盈利代币 ===\n');

  const avg = (arr, fn) => arr.length > 0 ? arr.reduce((sum, t) => sum + fn(t), 0) / arr.length : 0;

  console.log('指标                          | 亏损代币平均 | 盈利代币平均 | 差异');
  console.log('------------------------------|-------------|-------------|------');
  console.log(`收割者数量                    | ${avg(lossTokens, t => t.harvesterCount).toFixed(1)}          | ${avg(profitTokens, t => t.harvesterCount).toFixed(1)}          | ${(avg(lossTokens, t => t.harvesterCount) - avg(profitTokens, t => t.harvesterCount)).toFixed(1)}`);
  console.log(`有收割者的比例                | ${(lossTokens.filter(t => t.hasHarvester).length / lossTokens.length * 100).toFixed(1)}%        | ${(profitTokens.filter(t => t.hasHarvester).length / profitTokens.length * 100).toFixed(1)}%        | ${((lossTokens.filter(t => t.hasHarvester).length / lossTokens.length) - (profitTokens.filter(t => t.hasHarvester).length / profitTokens.length) * 100).toFixed(1)}%`);
  console.log(`收割后流动性下降              | ${(avg(lossTokens.filter(t => t.hasHarvester), t => t.liquidityDropAfterSell) * 100).toFixed(1)}%        | ${(avg(profitTokens.filter(t => t.hasHarvester), t => t.liquidityDropAfterSell) * 100).toFixed(1)}%        | ${((avg(lossTokens.filter(t => t.hasHarvester), t => t.liquidityDropAfterSell) - avg(profitTokens.filter(t => t.hasHarvester), t => t.liquidityDropAfterSell)) * 100).toFixed(1)}%`);
  console.log(`早期大户卖出比例              | ${(avg(lossTokens, t => t.earlyWhaleSellRatio) * 100).toFixed(1)}%        | ${(avg(profitTokens, t => t.earlyWhaleSellRatio) * 100).toFixed(1)}%        | ${((avg(lossTokens, t => t.earlyWhaleSellRatio) - avg(profitTokens, t => t.earlyWhaleSellRatio)) * 100).toFixed(1)}%`);
  console.log(`平均卖出延迟                  | ${avg(lossTokens, t => t.avgSellDelay).toFixed(1)}s      | ${avg(profitTokens, t => t.avgSellDelay).toFixed(1)}s      | ${(avg(lossTokens, t => t.avgSellDelay) - avg(profitTokens, t => t.avgSellDelay)).toFixed(1)}s`);
  console.log(`卖出时价格上涨幅度            | ${(avg(lossTokens, t => t.sellPriceIncrease) * 100).toFixed(1)}%        | ${(avg(profitTokens, t => t.sellPriceIncrease) * 100).toFixed(1)}%        | ${((avg(lossTokens, t => t.sellPriceIncrease) - avg(profitTokens, t => t.sellPriceIncrease)) * 100).toFixed(1)}%`);
  console.log(`早期大户数量                  | ${avg(lossTokens, t => t.earlyWhaleCount).toFixed(1)}          | ${avg(profitTokens, t => t.earlyWhaleCount).toFixed(1)}          | ${(avg(lossTokens, t => t.earlyWhaleCount) - avg(profitTokens, t => t.earlyWhaleCount)).toFixed(1)}`);

  // 测试不同条件
  console.log('\n=== 测试不同条件 ===\n');

  const conditions = [
    {
      name: '有收割者',
      desc: 'hasHarvester == true',
      test: t => t.hasHarvester
    },
    {
      name: '收割者>=2',
      desc: 'harvesterCount >= 2',
      test: t => t.harvesterCount >= 2
    },
    {
      name: '收割者>=3',
      desc: 'harvesterCount >= 3',
      test: t => t.harvesterCount >= 3
    },
    {
      name: '流动性下降>30%',
      desc: 'liquidityDropAfterSell < -0.3',
      test: t => t.liquidityDropAfterSell < -0.3
    },
    {
      name: '卖出比例>50%',
      desc: 'earlyWhaleSellRatio > 0.5',
      test: t => t.earlyWhaleSellRatio > 0.5
    },
    {
      name: '组合: 有收割者 AND 流动性下降>20%',
      desc: 'hasHarvester AND liquidityDrop < -0.2',
      test: t => t.hasHarvester && t.liquidityDropAfterSell < -0.2
    },
    {
      name: '组合: 收割者>=2 AND 流动性下降>20%',
      desc: 'harvesters >= 2 AND liquidityDrop < -0.2',
      test: t => t.harvesterCount >= 2 && t.liquidityDropAfterSell < -0.2
    }
  ];

  console.log('条件                                      | 亏损召回 | 盈利误伤 | F1分数 | 净避免收益');
  console.log('------------------------------------------|---------|---------|--------|----------');

  conditions.forEach(condition => {
    const lossRejected = lossTokens.filter(condition.test);
    const lossRecall = lossTokens.length > 0 ? lossRejected.length / lossTokens.length : 0;

    const profitRejected = profitTokens.filter(condition.test);
    const profitPrecision = profitTokens.length > 0 ? 1 - (profitRejected.length / profitTokens.length) : 1;

    const f1 = (lossRecall + profitPrecision > 0) ? (2 * lossRecall * profitPrecision) / (lossRecall + profitPrecision) : 0;

    const avoidedLoss = lossRejected.reduce((sum, t) => sum + t.profitPercent, 0);
    const missedProfit = profitRejected.reduce((sum, t) => sum + t.profitPercent, 0);
    const netAvoided = avoidedLoss - missedProfit;

    console.log(`${condition.desc.padEnd(40)} | ${(lossRecall * 100).toFixed(1).padStart(7)}% | ${profitRejected.length}/${profitTokens.length} | ${f1.toFixed(3)} | ${netAvoided > 0 ? '+' : ''}${netAvoided.toFixed(1)}%`);
  });

  // 显示典型的收割代币
  console.log('\n=== 典型的"收割流动性"代币 ===\n');

  const withHarvesters = tokensWithHarvest.filter(t => t.hasHarvester);

  console.log('【亏损代币中的收割者】');
  console.log('代币        | 收益率  | 收割者 | 流动性下降 | 卖出比例 | 详细信息');
  console.log('------------|---------|--------|-----------|---------|----------');

  lossTokens.filter(t => t.hasHarvester).sort((a, b) => a.profitPercent - b.profitPercent).slice(0, 10).forEach(t => {
    const harvesterInfo = t.harvesters.map(h => `${h.wallet}:+$${h.profit}`).join('; ');
    console.log(`${t.symbol.substring(0, 11).padEnd(11)} | ${t.profitPercent.toFixed(1).padStart(6)}% | ${t.harvesterCount.toString().padStart(6)} | ${(t.liquidityDropAfterSell * 100).toFixed(0).padStart(6)}% | ${(t.earlyWhaleSellRatio * 100).toFixed(0).padStart(6)}% | ${harvesterInfo.substring(0, 50)}`);
  });

  console.log('\n【盈利代币中的收割者（误伤）】');
  console.log('代币        | 收益率  | 收割者 | 流动性下降 | 卖出比例 | 详细信息');
  console.log('------------|---------|--------|-----------|---------|----------');

  const profitWithHarvesters = profitTokens.filter(t => t.hasHarvester);
  if (profitWithHarvesters.length > 0) {
    profitWithHarvesters.sort((a, b) => b.profitPercent - a.profitPercent).slice(0, 10).forEach(t => {
      const harvesterInfo = t.harvesters.map(h => `${h.wallet}:+$${h.profit}`).join('; ');
      console.log(`${t.symbol.substring(0, 11).padEnd(11)} | +${t.profitPercent.toFixed(1).padStart(5)}% | ${t.harvesterCount.toString().padStart(6)} | ${(t.liquidityDropAfterSell * 100).toFixed(0).padStart(6)}% | ${(t.earlyWhaleSellRatio * 100).toFixed(0).padStart(6)}% | ${harvesterInfo.substring(0, 50)}`);
    });
  } else {
    console.log('✓ 无盈利代币被误伤！');
  }

  // 显示详细的收割者信息
  console.log('\n=== 典型收割者详细信息 ===\n');

  const worstLossWithHarvester = lossTokens.filter(t => t.hasHarvester).sort((a, b) => a.profitPercent - b.profitPercent)[0];
  if (worstLossWithHarvester) {
    console.log(`【${worstLossWithHarvester.symbol}】收益率: ${worstLossWithHarvester.profitPercent.toFixed(1)}%`);
    console.log(`收割者数量: ${worstLossWithHarvester.harvesterCount}个`);
    console.log('');
    console.log('收割者详情:');
    console.log('钱包    | 买入金额 | 卖出金额 | 利润 | 涨幅 | 买入时间 | 卖出时间 | 持仓时间 | 卖出次数 | 卖出占比');
    console.log('--------|---------|---------|------|------|---------|---------|---------|---------|---------');
    worstLossWithHarvester.harvesters.forEach(h => {
      console.log(`${h.wallet.padEnd(7)} | $${h.buyAmount.padStart(7)} | $${h.sellAmount.padStart(7)} | $${h.profit.padStart(6)} | ${h.profitPercent.padStart(5)}% | ${h.firstBuyTime.padStart(7)}s | ${h.firstSellTime.padStart(7)}s | ${h.holdTime.padStart(7)}s | ${h.sellCount.toString().padStart(7)} | ${h.sellRatio.padStart(6)}%`);
    });
  }

  // 推荐因子
  console.log('\n=== 推荐的新因子 ===\n');

  console.log('因子名称: walletHarvestCount（收割者数量）');
  console.log('定义: 前10秒入场、买入>$300、价格上涨>100%后卖出>50%持仓的钱包数');
  console.log('推荐阈值: >= 1');
  console.log('说明: 捕获"极低价买入→等待翻倍→大量卖出"的操盘手\n');

  console.log('因子名称: walletLiquidityDropAfterSell（收割后流动性下降）');
  console.log('定义: (收割者卖出后的平均交易量 - 卖出前的平均交易量) / 卖出前的平均交易量');
  console.log('推荐阈值: < -0.3 (下降超过30%)');
  console.log('说明: 流动性大幅下降说明被"杀鸡取卵"\n');

  console.log('因子名称: walletEarlyWhaleSellRatio（早期大户卖出比例）');
  console.log('定义: 早期大户的卖出金额 / 早期大户的买入金额');
  console.log('推荐阈值: > 0.5 (超过50%被卖出)');
  console.log('说明: 早期大户大量卖出说明在收割流动性\n');

  const bestCondition = conditions.find(c => c.name === '有收割者');
  if (bestCondition) {
    const lossRejected = lossTokens.filter(bestCondition.test);
    const profitRejected = profitTokens.filter(bestCondition.test);

    console.log('推荐使用条件: hasHarvester == true');
    console.log(`  - 召回率: ~${(lossRejected.length / lossTokens.length * 100).toFixed(1)}%`);
    console.log(`  - 误伤率: ~${(profitRejected.length / profitTokens.length * 100).toFixed(1)}%`);
  }
}

analyzeHarvestLiquidity().catch(console.error);
