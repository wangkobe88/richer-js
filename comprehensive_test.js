/**
 * 综合测试：不同区块号阈值 + 两个实验数据融合
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

/**
 * 基于区块号的聚簇算法
 */
function detectClustersByBlock(trades, blockThreshold) {
  if (!trades || trades.length === 0) return [];

  const clusters = [];
  let clusterStartIdx = 0;

  for (let i = 1; i <= trades.length; i++) {
    const blockGap = (i < trades.length && trades[i].block_number && trades[i - 1].block_number)
      ? trades[i].block_number - trades[i - 1].block_number
      : (blockThreshold + 1);

    if (i === trades.length || blockGap > blockThreshold) {
      const clusterSize = i - clusterStartIdx;
      const clusterIndices = Array.from({ length: clusterSize }, (_, k) => clusterStartIdx + k);
      clusters.push(clusterIndices);
      clusterStartIdx = i;
    }
  }

  return clusters;
}

/**
 * 计算聚簇因子
 */
function calculateClusterFactors(trades, clusters) {
  if (!trades || trades.length === 0 || clusters.length === 0) {
    return null;
  }

  const clusterSizes = clusters.map(c => c.length);
  const sortedSizes = [...clusterSizes].sort((a, b) => b - a);
  const totalTrades = trades.length;

  const avgClusterSize = clusterSizes.reduce((a, b) => a + b, 0) / clusters.length;
  const megaClusterThreshold = Math.max(5, Math.floor(avgClusterSize * 2));

  const megaClusters = clusterSizes.filter(s => s >= megaClusterThreshold);
  const megaClusterTradeCount = megaClusters.reduce((sum, s) => sum + s, 0);

  const secondToFirstRatio = sortedSizes.length >= 2 ? sortedSizes[1] / sortedSizes[0] : 0;
  const top2ClusterRatio = sortedSizes.length >= 2
    ? (sortedSizes[0] + sortedSizes[1]) / totalTrades
    : sortedSizes[0] / totalTrades;

  return {
    totalClusters: clusters.length,
    maxSize: sortedSizes[0] || 0,
    avgClusterSize,
    megaClusterRatio: megaClusterTradeCount / totalTrades,
    secondToFirstRatio,
    top2ClusterRatio
  };
}

/**
 * 获取实验数据
 */
async function getExperimentData(experimentId) {
  // 获取收益率
  const { data: sellTrades } = await supabase
    .from('trades')
    .select('token_address, metadata')
    .eq('experiment_id', experimentId)
    .eq('trade_direction', 'sell')
    .not('metadata->>profitPercent', 'is', null);

  const tokenReturns = {};
  for (const sellTrade of sellTrades || []) {
    tokenReturns[sellTrade.token_address] = sellTrade.metadata?.profitPercent || 0;
  }

  // 获取信号
  const { data: buySignals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy')
    .order('created_at', { ascending: false });

  const executedSignals = buySignals.filter(s => s.metadata?.execution_status === 'executed');

  // 去重
  const uniqueTokens = [];
  const seenAddresses = new Set();
  for (const signal of executedSignals) {
    if (!seenAddresses.has(signal.token_address)) {
      seenAddresses.add(signal.token_address);
      uniqueTokens.push(signal);
    }
  }

  return {
    experimentId,
    tokens: uniqueTokens,
    tokenReturns
  };
}

/**
 * 获取代币的交易数据并计算因子
 */
async function fetchTokenFactors(tokenAddress, checkTime) {
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

    return uniqueTrades;
  } catch (error) {
    return null;
  }
}

async function comprehensiveTest() {
  const experiments = [
    '6b17ff18-002d-4ce0-a745-b8e02676abd4',
    '1dde2be5-2f4e-49fb-9520-cb032e9ef759'
  ];

  console.log('=== 综合测试：区块号阈值优化 ===\n');

  // 收集所有代币数据
  const allTokens = [];

  for (const expId of experiments) {
    console.log(`获取实验 ${expId} 的数据...`);
    const { tokens, tokenReturns } = await getExperimentData(expId);

    for (const token of tokens) {
      const factors = token.metadata?.preBuyCheckFactors;
      if (!factors || !factors.earlyTradesCheckTime) continue;

      const checkTime = factors.earlyTradesCheckTime;
      const trades = await fetchTokenFactors(token.token_address, checkTime);

      if (trades && trades.length > 0) {
        allTokens.push({
          symbol: token.metadata?.symbol || token.token_address.substring(0, 8),
          tokenAddress: token.token_address,
          experimentId: expId,
          profitPercent: tokenReturns[token.token_address] || null,
          trades,
          checkTime
        });
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`  完成，获取 ${tokens.length} 个信号`);
  }

  console.log(`\n总共获取: ${allTokens.length} 个代币的交易数据`);

  // 过滤有收益数据的
  const tokensWithReturns = allTokens.filter(t => t.profitPercent !== null);
  console.log(`有收益数据: ${tokensWithReturns.length} 个\n`);

  const profitable = tokensWithReturns.filter(t => t.profitPercent > 0);
  const loss = tokensWithReturns.filter(t => t.profitPercent <= 0);

  console.log(`盈利代币: ${profitable.length} 个`);
  console.log(`亏损代币: ${loss.length} 个\n`);

  // 区分两个实验
  const exp1Tokens = tokensWithReturns.filter(t => t.experimentId === experiments[0]);
  const exp1Profitable = exp1Tokens.filter(t => t.profitPercent > 0);
  const exp1Loss = exp1Tokens.filter(t => t.profitPercent <= 0);

  const exp2Tokens = tokensWithReturns.filter(t => t.experimentId === experiments[1]);
  const exp2Profitable = exp2Tokens.filter(t => t.profitPercent > 0);
  const exp2Loss = exp2Tokens.filter(t => t.profitPercent <= 0);

  console.log(`【实验1 (${experiments[0].substring(0, 8)}...)】`);
  console.log(`  盈利: ${exp1Profitable.length}, 亏损: ${exp1Loss.length}`);

  console.log(`\n【实验2 (${experiments[1].substring(0, 8)}...)】`);
  console.log(`  盈利: ${exp2Profitable.length}, 亏损: ${exp2Loss.length}`);

  // 测试不同阈值
  console.log('\n\n==================================================');
  console.log('【测试不同区块号阈值】');
  console.log('==================================================\n');

  const blockThresholds = [1, 2, 3, 5, 7, 10, 15, 20];

  blockThresholds.forEach(threshold => {
    console.log(`\n##### 区块号阈值 = ${threshold} #####\n`);

    // 计算每个代币的因子
    const tokensWithFactors = tokensWithReturns.map(token => {
      const clusters = detectClustersByBlock(token.trades, threshold);
      const factors = calculateClusterFactors(token.trades, clusters);
      return {
        ...token,
        factors
      };
    }).filter(t => t.factors && t.factors.totalClusters > 0);

    // 测试条件
    const conditions = [
      {
        name: 'Top2Ratio > 0.85',
        test: r => r.factors.top2ClusterRatio > 0.85
      },
      {
        name: 'Top2Ratio > 0.90',
        test: r => r.factors.top2ClusterRatio > 0.90
      },
      {
        name: '簇数>=4 && Top2Ratio > 0.85',
        test: r => r.factors.totalClusters >= 4 && r.factors.top2ClusterRatio > 0.85
      },
      {
        name: '簇数>=4 && Top2Ratio > 0.90',
        test: r => r.factors.totalClusters >= 4 && r.factors.top2ClusterRatio > 0.90
      },
      {
        name: '簇数>=5 && Top2Ratio > 0.90',
        test: r => r.factors.totalClusters >= 5 && r.factors.top2ClusterRatio > 0.90
      },
      {
        name: '簇数>=6 && Top2Ratio > 0.90',
        test: r => r.factors.totalClusters >= 6 && r.factors.top2ClusterRatio > 0.90
      },
    ];

    console.log('条件                              | 总体召回 | 总体误伤 | F1分数 | 实验1召回 | 实验1误伤 | 实验2召回 | 实验2误伤');
    console.log('----------------------------------|---------|---------|---------|----------|----------|----------|----------');

    conditions.forEach(condition => {
      const totalLoss = tokensWithFactors.filter(r => r.profitPercent <= 0);
      const totalProfit = tokensWithFactors.filter(r => r.profitPercent > 0);

      const lossRejected = totalLoss.filter(condition.test).length;
      const lossRecall = totalLoss.length > 0 ? lossRejected / totalLoss.length : 0;

      const profitableRejected = totalProfit.filter(condition.test).length;
      const profitablePrecision = totalProfit.length > 0 ? 1 - (profitableRejected / totalProfit.length) : 1;

      const f1 = (lossRecall + profitablePrecision > 0) ? (2 * lossRecall * profitablePrecision) / (lossRecall + profitablePrecision) : 0;

      // 分实验统计
      const exp1LossRejected = exp1Loss.filter(t => {
        if (!t.trades || t.trades.length === 0) return false;
        const clusters = detectClustersByBlock(t.trades, threshold);
        const factors = calculateClusterFactors(t.trades, clusters);
        return factors && condition.test({ ...t, factors });
      }).length;

      const exp1Recall = exp1Loss.length > 0 ? exp1LossRejected / exp1Loss.length : 0;

      const exp1ProfitRejected = exp1Profitable.filter(t => {
        if (!t.trades || t.trades.length === 0) return false;
        const clusters = detectClustersByBlock(t.trades, threshold);
        const factors = calculateClusterFactors(t.trades, clusters);
        return factors && condition.test({ ...t, factors });
      }).length;

      const exp2LossRejected = exp2Loss.filter(t => {
        if (!t.trades || t.trades.length === 0) return false;
        const clusters = detectClustersByBlock(t.trades, threshold);
        const factors = calculateClusterFactors(t.trades, clusters);
        return factors && condition.test({ ...t, factors });
      }).length;

      const exp2Recall = exp2Loss.length > 0 ? exp2LossRejected / exp2Loss.length : 0;

      const exp2ProfitRejected = exp2Profitable.filter(t => {
        if (!t.trades || t.trades.length === 0) return false;
        const clusters = detectClustersByBlock(t.trades, threshold);
        const factors = calculateClusterFactors(t.trades, clusters);
        return factors && condition.test({ ...t, factors });
      }).length;

      console.log(`${condition.name.padEnd(33)} | ${(lossRecall * 100).toFixed(1).padStart(7)}% | ${profitableRejected}/${totalProfit.length} | ${f1.toFixed(3)} | ${(exp1Recall * 100).toFixed(1).padStart(8)}% | ${exp1ProfitRejected}/${exp1Profitable.length} | ${(exp2Recall * 100).toFixed(1).padStart(8)}% | ${exp2ProfitRejected}/${exp2Profitable.length}`);
    });
  });

  // 找出最优配置
  console.log('\n\n==================================================');
  console.log('【最优配置推荐】');
  console.log('==================================================\n');

  console.log('\n推荐基于以下原则：');
  console.log('1. 总体召回率尽可能高');
  console.log('2. 实验2（市场状态好）的误伤尽可能低');
  console.log('3. F1分数平衡');
}

comprehensiveTest().catch(console.error);
