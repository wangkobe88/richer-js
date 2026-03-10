/**
 * 全面分析"极早期大户"模式
 * 不是只看特定钱包，而是分析所有代币中的极早期大户行为
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
 * 分析代币中的极早期大户
 */
function analyzeEarlyWhalesInToken(trades, checkTime) {
  if (!trades || trades.length === 0) {
    return {
      hasEarlyWhale: false,
      earlyWhaleCount: 0,
      earlyWhaleAmount: 0,
      earlyWhaleRatio: 0,
      bringingVolumeWallets: 0,
      earlyWhaleSold: 0,
      earlyWhaleProfit: 0
    };
  }

  try {
    // 找到最早的交易时间作为基准
    const earliestTime = Math.min(...trades.map(t => t.time));
    const windowStart = earliestTime;

    // 定义"前期交易"：前30笔交易（或前20%，取较小值）
    const earlyTradeCount = Math.min(30, Math.floor(trades.length * 0.2));
    const earlyTradeEndTime = trades[earlyTradeCount - 1]?.time || (trades[trades.length - 1]?.time || windowStart);

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
          avgBuyPrice: 0,
          avgSellPrice: 0,
          buyCount: 0,
          sellCount: 0
        });
      }

      const w = walletMap.get(wallet);

      if (isBuy) {
        w.buyTrades.push({ relTime, amount: trade.from_usd });
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
        w.sellTrades.push({ relTime, amount: trade.to_usd });
        w.totalSellAmount += trade.to_usd || 0;
        w.totalSellTokens += trade.from_amount || 0;
        w.sellCount++;
        if (w.firstSellTime === null || relTime < w.firstSellTime) {
          w.firstSellTime = relTime;
        }
      }
    });

    // 计算平均价格
    walletMap.forEach(w => {
      if (w.totalBuyTokens > 0) {
        w.avgBuyPrice = w.totalBuyAmount / w.totalBuyTokens;
      }
      if (w.totalSellTokens > 0) {
        w.avgSellPrice = w.totalSellAmount / w.totalSellTokens;
      }
    });

    // 找出极早期大户
    // 定义：前30笔交易中买入，且买入金额>$200
    const earlyWhales = Array.from(walletMap.values()).filter(w => {
      if (w.firstBuyTime === null) return false;
      const firstTradeTime = trades.find(t => t.tx_id === (w.buyTrades[0]?.tx_id))?.time || windowStart;
      return firstTradeTime <= earlyTradeEndTime && w.totalBuyAmount > 200;
    });

    // 计算总买入金额
    const totalBuyAmount = Array.from(walletMap.values()).reduce((sum, w) => sum + w.totalBuyAmount, 0);

    // 极早期大户的买入金额占比
    const earlyWhaleAmount = earlyWhales.reduce((sum, w) => sum + w.totalBuyAmount, 0);
    const earlyWhaleRatio = totalBuyAmount > 0 ? earlyWhaleAmount / totalBuyAmount : 0;

    // 检测带单效果
    // 对于每个极早期大户，检查它买入后10秒内的交易量变化
    let bringingVolumeWallets = 0;
    earlyWhales.forEach(w => {
      const buyTime = w.firstBuyTime;
      const beforeBuyTrades = trades.filter(t => {
        const fromToken = t.from_token_symbol;
        const isBuy = fromToken && baseCurrencies.includes(fromToken);
        const relTime = t.time - windowStart;
        return isBuy && relTime < buyTime && relTime >= buyTime - 5;
      });

      const afterBuyTrades = trades.filter(t => {
        const fromToken = t.from_token_symbol;
        const isBuy = fromToken && baseCurrencies.includes(fromToken);
        const relTime = t.time - windowStart;
        return isBuy && relTime > buyTime && relTime <= buyTime + 10;
      });

      if (afterBuyTrades.length > beforeBuyTrades.length * 2) {
        bringingVolumeWallets++;
      }
    });

    // 检测极早期大户是否卖出
    const earlyWhaleSold = earlyWhales.filter(w => w.totalSellAmount > 0).length;

    // 计算极早期大户的利润
    let earlyWhaleProfit = 0;
    earlyWhales.forEach(w => {
      if (w.totalSellAmount > 0) {
        earlyWhaleProfit += (w.totalSellAmount - w.totalBuyAmount);
      }
    });

    return {
      hasEarlyWhale: earlyWhales.length > 0,
      earlyWhaleCount: earlyWhales.length,
      earlyWhaleAmount,
      earlyWhaleRatio,
      bringingVolumeWallets,
      earlyWhaleSold,
      earlyWhaleProfit,
      totalWallets: walletMap.size,
      earlyWhaleDetails: earlyWhales.map(w => ({
        wallet: w.wallet.substring(0, 10),
        buyAmount: w.totalBuyAmount.toFixed(0),
        sellAmount: w.totalSellAmount.toFixed(0),
        profit: (w.totalSellAmount - w.totalBuyAmount).toFixed(0),
        profitPercent: w.totalBuyAmount > 0 ? ((w.totalSellAmount - w.totalBuyAmount) / w.totalBuyAmount * 100).toFixed(1) : 'N/A',
        buyCount: w.buyCount,
        sellCount: w.sellCount
      }))
    };
  } catch (error) {
    console.error('Error in analyzeEarlyWhalesInToken:', error.message);
    return {
      hasEarlyWhale: false,
      earlyWhaleCount: 0,
      earlyWhaleAmount: 0,
      earlyWhaleRatio: 0,
      bringingVolumeWallets: 0,
      earlyWhaleSold: 0,
      earlyWhaleProfit: 0,
      totalWallets: 0,
      earlyWhaleDetails: []
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

async function analyzeEarlyWhalesComprehensive() {
  console.log('=== 全面分析：极早期大户模式 ===\n');
  console.log('定义：前30笔交易（或前20%）中买入金额>$200的钱包\n');

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

  // 计算极早期大户因子
  const tokensWithWhales = [];

  for (let i = 0; i < allTokens.length; i++) {
    const token = allTokens[i];

    const trades = await fetchTokenTrades(token.tokenAddress, token.checkTime);

    if (trades && trades.length > 0) {
      const whaleAnalysis = analyzeEarlyWhalesInToken(trades, token.checkTime);
      tokensWithWhales.push({
        ...token,
        tradesCount: trades.length,
        ...whaleAnalysis
      });
    }

    if ((i + 1) % 10 === 0) {
      console.log(`进度: ${i + 1}/${allTokens.length}`);
    }

    await new Promise(resolve => setTimeout(resolve, 50));
  }

  console.log(`\n有效数据: ${tokensWithWhales.length} 个代币\n`);

  // 分类
  const lossTokens = tokensWithWhales.filter(t => t.profitPercent !== null && t.profitPercent <= 0);
  const profitTokens = tokensWithWhales.filter(t => t.profitPercent !== null && t.profitPercent > 0);
  const unknownTokens = tokensWithWhales.filter(t => t.profitPercent === null);

  console.log('【数据分布】');
  console.log(`总代币数: ${tokensWithWhales.length}`);
  console.log(`  亏损代币: ${lossTokens.length}`);
  console.log(`  盈利代币: ${profitTokens.length}`);
  console.log(`  未知收益: ${unknownTokens.length}\n`);

  // 对比分析：有极早期大户 vs 无极早期大户
  console.log('=== 对比分析：有/无极早期大户 ===\n');

  const tokensWithEarlyWhale = tokensWithWhales.filter(t => t.hasEarlyWhale);
  const tokensWithoutEarlyWhale = tokensWithWhales.filter(t => !t.hasEarlyWhale);

  const avg = (arr, fn) => arr.length > 0 ? arr.reduce((sum, t) => sum + fn(t), 0) / arr.length : 0;

  console.log('代币类型 | 数量 | 平均收益 | 极早期大户数 | 大户买入占比 | 带单钱包数 | 大户卖出数');
  console.log('---------|------|---------|------------|------------|----------|----------');

  const withWhaleLoss = tokensWithEarlyWhale.filter(t => t.profitPercent !== null && t.profitPercent <= 0);
  const withWhaleProfit = tokensWithEarlyWhale.filter(t => t.profitPercent !== null && t.profitPercent > 0);

  const withoutWhaleLoss = tokensWithoutEarlyWhale.filter(t => t.profitPercent !== null && t.profitPercent <= 0);
  const withoutWhaleProfit = tokensWithoutEarlyWhale.filter(t => t.profitPercent !== null && t.profitPercent > 0);

  console.log(`有极早期大户的亏损 | ${withWhaleLoss.length} | ${avg(withWhaleLoss, t => t.profitPercent).toFixed(1)}% | ${avg(withWhaleLoss, t => t.earlyWhaleCount).toFixed(1)} | ${(avg(withWhaleLoss, t => t.earlyWhaleRatio) * 100).toFixed(1)}% | ${avg(withWhaleLoss, t => t.bringingVolumeWallets).toFixed(1)} | ${avg(withWhaleLoss, t => t.earlyWhaleSold).toFixed(1)}`);
  console.log(`有极早期大户的盈利 | ${withWhaleProfit.length} | ${avg(withWhaleProfit, t => t.profitPercent).toFixed(1)}% | ${avg(withWhaleProfit, t => t.earlyWhaleCount).toFixed(1)} | ${(avg(withWhaleProfit, t => t.earlyWhaleRatio) * 100).toFixed(1)}% | ${avg(withWhaleProfit, t => t.bringingVolumeWallets).toFixed(1)} | ${avg(withWhaleProfit, t => t.earlyWhaleSold).toFixed(1)}`);
  console.log(`无极早期大户的亏损 | ${withoutWhaleLoss.length} | ${avg(withoutWhaleLoss, t => t.profitPercent).toFixed(1)}% | - | - | - | -`);
  console.log(`无极早期大户的盈利 | ${withoutWhaleProfit.length} | ${avg(withoutWhaleProfit, t => t.profitPercent).toFixed(1)}% | - | - | - | -`);

  // 测试不同条件
  console.log('\n=== 测试不同过滤条件 ===\n');

  const conditions = [
    {
      name: '有极早期大户',
      desc: 'hasEarlyWhale == true',
      test: t => t.hasEarlyWhale
    },
    {
      name: '有≥2个极早期大户',
      desc: 'earlyWhaleCount >= 2',
      test: t => t.earlyWhaleCount >= 2
    },
    {
      name: '有≥3个极早期大户',
      desc: 'earlyWhaleCount >= 3',
      test: t => t.earlyWhaleCount >= 3
    },
    {
      name: '大户占比>30%',
      desc: 'earlyWhaleRatio > 0.3',
      test: t => t.earlyWhaleRatio > 0.3
    },
    {
      name: '大户占比>50%',
      desc: 'earlyWhaleRatio > 0.5',
      test: t => t.earlyWhaleRatio > 0.5
    },
    {
      name: '无带单效果',
      desc: 'hasEarlyWhale AND bringingVolumeWallets == 0',
      test: t => t.hasEarlyWhale && t.bringingVolumeWallets === 0
    },
    {
      name: '大户已卖出',
      desc: 'hasEarlyWhale AND earlyWhaleSold > 0',
      test: t => t.hasEarlyWhale && t.earlyWhaleSold > 0
    },
    {
      name: '组合: ≥2大户 且 无带单',
      desc: 'earlyWhaleCount >= 2 AND bringingVolumeWallets == 0',
      test: t => t.earlyWhaleCount >= 2 && t.bringingVolumeWallets === 0
    },
    {
      name: '组合: 有大户 且 占比>30%',
      desc: 'hasEarlyWhale AND earlyWhaleRatio > 0.3',
      test: t => t.hasEarlyWhale && t.earlyWhaleRatio > 0.3
    }
  ];

  console.log('条件                              | 亏损召回 | 盈利误伤 | 亏损过滤 | 盈利保留 | F1分数 | 净避免收益');
  console.log('----------------------------------|---------|---------|---------|---------|--------|----------');

  conditions.forEach(condition => {
    const rejectedLoss = lossTokens.filter(condition.test);
    const rejectedProfit = profitTokens.filter(condition.test);

    const lossRecall = lossTokens.length > 0 ? rejectedLoss.length / lossTokens.length : 0;
    const profitRejectRate = profitTokens.length > 0 ? rejectedProfit.length / profitTokens.length : 0;
    const profitPrecision = 1 - profitRejectRate;

    const f1 = (lossRecall + profitPrecision > 0) ? (2 * lossRecall * profitPrecision) / (lossRecall + profitPrecision) : 0;

    const avoidedLoss = rejectedLoss.reduce((sum, t) => sum + t.profitPercent, 0);
    const missedProfit = rejectedProfit.reduce((sum, t) => sum + t.profitPercent, 0);
    const netAvoided = avoidedLoss - missedProfit;

    const lossFiltered = lossTokens.length - rejectedLoss.length;
    const profitKept = profitTokens.length - rejectedProfit.length;

    console.log(`${condition.desc.padEnd(33)} | ${(lossRecall * 100).toFixed(1).padStart(7)}% | ${rejectedProfit.length}/${profitTokens.length} | ${lossFiltered} | ${profitKept} | ${f1.toFixed(3)} | ${netAvoided > 0 ? '+' : ''}${netAvoided.toFixed(1)}%`);
  });

  // 显示典型被过滤的亏损代币
  console.log('\n=== 典型案例分析 ===\n');

  const bestCondition = conditions.find(c => c.name === '无带单效果');
  if (bestCondition) {
    const rejectedLoss = lossTokens.filter(bestCondition.test);
    const rejectedProfit = profitTokens.filter(bestCondition.test);

    console.log(`【条件: ${bestCondition.desc}】`);
    console.log(`  亏损过滤: ${rejectedLoss.length}/${lossTokens.length} (${(rejectedLoss.length / lossTokens.length * 100).toFixed(1)}%)`);
    console.log(`  盈利保留: ${profitTokens.length - rejectedProfit.length}/${profitTokens.length} (${((profitTokens.length - rejectedProfit.length) / profitTokens.length * 100).toFixed(1)}%)`);
    console.log(`  净避免收益: ${(rejectedLoss.reduce((sum, t) => sum + t.profitPercent, 0) - rejectedProfit.reduce((sum, t) => sum + t.profitPercent, 0)).toFixed(1)}%\n`);

    if (rejectedLoss.length > 0) {
      console.log('被过滤的亏损代币（避免损失）：');
      console.log('代币        | 收益率 | 大户数 | 大户占比 | 带单钱包 | 大户卖出 | 大户详情');
      console.log('------------|--------|-------|---------|---------|---------|---------');

      rejectedLoss.sort((a, b) => a.profitPercent - b.profitPercent).slice(0, 10).forEach(t => {
        const whaleInfo = t.earlyWhaleDetails.slice(0, 3).map(w => `${w.wallet}:$${w.buyAmount}`).join('; ');
        console.log(`${t.symbol.substring(0, 11).padEnd(11)} | ${t.profitPercent.toFixed(1).padStart(6)}% | ${t.earlyWhaleCount.toString().padStart(5)} | ${(t.earlyWhaleRatio * 100).toFixed(0).padStart(6)}% | ${t.bringingVolumeWallets.toString().padStart(8)} | ${t.earlyWhaleSold.toString().padStart(7)} | ${whaleInfo.substring(0, 40)}`);
      });
    }

    if (rejectedProfit.length > 0) {
      console.log('\n被过滤的盈利代币（误伤）：');
      console.log('代币        | 收益率 | 大户数 | 大户占比 | 带单钱包 | 大户卖出 | 大户详情');
      console.log('------------|--------|-------|---------|---------|---------|---------');

      rejectedProfit.sort((a, b) => b.profitPercent - a.profitPercent).slice(0, 10).forEach(t => {
        const whaleInfo = t.earlyWhaleDetails.slice(0, 3).map(w => `${w.wallet}:$${w.buyAmount}`).join('; ');
        console.log(`${t.symbol.substring(0, 11).padEnd(11)} | +${t.profitPercent.toFixed(1).padStart(5)}% | ${t.earlyWhaleCount.toString().padStart(5)} | ${(t.earlyWhaleRatio * 100).toFixed(0).padStart(6)}% | ${t.bringingVolumeWallets.toString().padStart(8)} | ${t.earlyWhaleSold.toString().padStart(7)} | ${whaleInfo.substring(0, 40)}`);
      });
    } else {
      console.log('\n✓ 无盈利代币被误伤！');
    }
  }

  // 分析极早期大户的持仓行为
  console.log('\n=== 极早期大户的持仓行为分析 ===\n');

  const allEarlyWhales = tokensWithWhales.flatMap(t =>
    t.earlyWhaleDetails.map(w => ({
      ...w,
      tokenSymbol: t.symbol,
      tokenProfit: t.profitPercent
    }))
  );

  // 按买入金额排序
  allEarlyWhales.sort((a, b) => parseFloat(b.buyAmount) - parseFloat(a.buyAmount));

  console.log('前20个最大的极早期大户:');
  console.log('钱包 | 代币 | 收益率 | 买入金额 | 卖出金额 | 利润 | 买卖次数');
  console.log('-------|------|--------|---------|---------|------|---------');

  allEarlyWhales.slice(0, 20).forEach(w => {
    const profit = w.profit || 'N/A';
    const profitStr = profit !== 'N/A' ? `$${profit}` : 'N/A';
    console.log(`${w.wallet.padEnd(6)} | ${w.tokenSymbol.substring(0, 6)} | ${w.tokenProfit !== null ? w.tokenProfit.toFixed(1) + '%' : 'N/A'.padStart(5)} | $${w.buyAmount.padStart(6)} | $${w.sellAmount.padStart(6)} | ${profitStr.padStart(6)} | ${w.buyCount}/${w.sellCount}`);
  });

  // 推荐因子
  console.log('\n=== 推荐的新因子 ===\n');

  console.log('因子名称: walletEarlyWhaleInFirstTrades（前期交易中的大户数）');
  console.log('定义: 前30笔交易（或前20%）中买入金额>$200的钱包数');
  console.log('推荐阈值: >= 2');
  console.log('');

  console.log('因子名称: walletEarlyWhaleRatio（前期大户买入占比）');
  console.log('定义: 前期大户的总买入金额 / 总买入金额');
  console.log('推荐阈值: > 0.3 (30%)');
  console.log('');

  console.log('因子名称: walletBringingVolumeWallets（有带单效果的大户数）');
  console.log('定义: 前期大户中，买入后10秒内交易量翻倍的钱包数');
  console.log('说明: 值越高说明越有带单能力');
  console.log('');

  console.log('建议使用条件: bringingVolumeWallets == 0');
  console.log('  - 即：有极早期大户但都没有带单效果');
  console.log('  - 召回率: 需要根据上述分析结果确定');
  console.log('  - 说明: 捕获"有大户参与但无法带动市场"的代币');
}

analyzeEarlyWhalesComprehensive().catch(console.error);
