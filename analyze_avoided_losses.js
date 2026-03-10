/**
 * 分析策略减少的损失 vs 误伤的收益（使用与comprehensive_test.js相同的逻辑）
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

async function analyzeAvoidedLosses() {
  const experiments = [
    '6b17ff18-002d-4ce0-a745-b8e02676abd4',
    '1dde2be5-2f4e-49fb-9520-cb032e9ef759'
  ];

  // 测试配置
  const blockThreshold = 7;
  const conditionName = '簇数>=4 && Top2Ratio > 0.85';
  const conditionTest = (factors) => factors && factors.totalClusters >= 4 && factors.top2ClusterRatio > 0.85;

  console.log('=== 策略效果分析 ===\n');
  console.log(`配置: 区块号阈值=${blockThreshold}`);
  console.log(`条件: ${conditionName}\n`);

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

      await new Promise(resolve => setTimeout(resolve, 50));
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

  // 计算因子
  const tokensWithFactors = tokensWithReturns.map(token => {
    const clusters = detectClustersByBlock(token.trades, blockThreshold);
    const factors = calculateClusterFactors(token.trades, clusters);
    return {
      ...token,
      factors,
      isFiltered: factors && conditionTest(factors)
    };
  }).filter(t => t.factors && t.factors.totalClusters > 0);

  // 分类
  const lossFiltered = tokensWithFactors.filter(t => t.profitPercent <= 0 && t.isFiltered);
  const lossNotFiltered = tokensWithFactors.filter(t => t.profitPercent <= 0 && !t.isFiltered);
  const profitFiltered = tokensWithFactors.filter(t => t.profitPercent > 0 && t.isFiltered);
  const profitNotFiltered = tokensWithFactors.filter(t => t.profitPercent > 0 && !t.isFiltered);

  // 统计亏损代币
  console.log('【亏损代币分析】\n');
  console.log(`总亏损代币数: ${loss.length}\n`);

  console.log('成功过滤掉（避免损失）:');
  console.log(`  数量: ${lossFiltered.length}个`);
  console.log(`  占比: ${(lossFiltered.length / loss.length * 100).toFixed(1)}%\n`);

  if (lossFiltered.length > 0) {
    lossFiltered.sort((a, b) => a.profitPercent - b.profitPercent);
    console.log('  详细列表:');
    lossFiltered.forEach(token => {
      console.log(`    ${token.symbol}: ${token.profitPercent.toFixed(1)}% (簇数=${token.factors.totalClusters}, Top2=${(token.factors.top2ClusterRatio * 100).toFixed(1)}%)`);
    });
    console.log('');
  }

  const totalAvoidedLoss = lossFiltered.reduce((sum, t) => sum + Math.abs(t.profitPercent), 0);
  const avgAvoidedLoss = lossFiltered.length > 0 ? totalAvoidedLoss / lossFiltered.length : 0;

  console.log('未过滤掉（实际亏损）:');
  console.log(`  数量: ${lossNotFiltered.length}个`);
  console.log(`  占比: ${(lossNotFiltered.length / loss.length * 100).toFixed(1)}%\n`);

  const totalActualLoss = lossNotFiltered.reduce((sum, t) => sum + Math.abs(t.profitPercent), 0);

  // 统计盈利代币
  console.log('\n【盈利代币分析】\n');
  console.log(`总盈利代币数: ${profitable.length}\n`);

  console.log('误伤（被过滤掉的盈利代币）:');
  console.log(`  数量: ${profitFiltered.length}个`);
  console.log(`  占比: ${(profitFiltered.length / profitable.length * 100).toFixed(1)}%\n`);

  if (profitFiltered.length > 0) {
    profitFiltered.sort((a, b) => b.profitPercent - a.profitPercent);
    console.log('  详细列表:');
    profitFiltered.forEach(token => {
      console.log(`    ${token.symbol}: +${token.profitPercent.toFixed(1)}% (簇数=${token.factors.totalClusters}, Top2=${(token.factors.top2ClusterRatio * 100).toFixed(1)}%)`);
    });
    console.log('');
  }

  const totalMissedProfit = profitFiltered.reduce((sum, t) => sum + t.profitPercent, 0);
  const avgMissedProfit = profitFiltered.length > 0 ? totalMissedProfit / profitFiltered.length : 0;

  console.log('正常交易的盈利代币:');
  console.log(`  数量: ${profitNotFiltered.length}个`);
  console.log(`  占比: ${(profitNotFiltered.length / profitable.length * 100).toFixed(1)}%\n`);

  const totalActualProfit = profitNotFiltered.reduce((sum, t) => sum + t.profitPercent, 0);

  // 总体效果
  console.log('\n【策略总体效果】\n');

  console.log('减少的损失:');
  console.log(`  成功过滤: ${lossFiltered.length}个亏损代币`);
  console.log(`  避免损失总额: -${totalAvoidedLoss.toFixed(1)}%`);
  if (lossFiltered.length > 0) {
    console.log(`  平均每个避免: -${avgAvoidedLoss.toFixed(1)}%\n`);
  } else {
    console.log('');
  }

  console.log('错失的收益:');
  console.log(`  误伤数量: ${profitFiltered.length}个盈利代币`);
  console.log(`  错失收益总额: +${totalMissedProfit.toFixed(1)}%`);
  if (profitFiltered.length > 0) {
    console.log(`  平均每个错失: +${avgMissedProfit.toFixed(1)}%\n`);
  } else {
    console.log('');
  }

  const netEffect = totalAvoidedLoss - totalMissedProfit;
  console.log('直接净效果:');
  if (netEffect > 0) {
    console.log(`  ✓ 策略有效，净收益: +${netEffect.toFixed(1)}%`);
  } else {
    console.log(`  ✗ 策略亏损，净损失: ${netEffect.toFixed(1)}%`);
  }

  // 如果没有使用这个策略 vs 使用这个策略
  const noStrategyTotal = totalActualProfit + totalMissedProfit - totalActualLoss - totalAvoidedLoss;
  const withStrategyTotal = totalActualProfit - totalActualLoss;
  const improvement = withStrategyTotal - noStrategyTotal;

  console.log('\n【收益对比】\n');
  console.log(`不使用策略的总收益: ${noStrategyTotal.toFixed(1)}%`);
  console.log(`使用策略的总收益: ${withStrategyTotal.toFixed(1)}%`);
  console.log(`策略改善: ${improvement > 0 ? '+' : ''}${improvement.toFixed(1)}%`);
}

analyzeAvoidedLosses().catch(console.error);
