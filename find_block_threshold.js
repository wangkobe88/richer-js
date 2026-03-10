/**
 * 寻找最佳区块号聚簇阈值
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
    if (i === trades.length || !trades[i].block_number || !trades[i-1].block_number ||
        (trades[i].block_number - trades[i - 1].block_number) > blockThreshold) {
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
    totalTrades,
    totalClusters: clusters.length,
    maxSize: sortedSizes[0] || 0,
    secondSize: sortedSizes[1] || 0,
    avgClusterSize,
    megaClusterTradeCount,
    megaClusterRatio: megaClusterTradeCount / totalTrades,
    secondToFirstRatio,
    top2ClusterRatio
  };
}

async function findOptimalBlockThreshold() {
  const experimentId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';

  // 获取有收益数据的代币
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

  // 获取信号数据
  const { data: buySignals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy');

  const executedSignals = buySignals.filter(s => s.metadata?.execution_status === 'executed');

  console.log('=== 寻找最佳区块号聚簇阈值 ===\n');
  console.log(`代币总数: ${executedSignals.length}\n`);

  // 测试不同的区块阈值
  const thresholds = [1, 2, 3, 5, 10];

  console.log('【区块号差值分布分析】\n');

  // 先分析一下区块号差值的分布
  const blockGaps = [];
  let totalTradesAnalyzed = 0;

  for (const signal of executedSignals.slice(0, 20)) { // 先分析前20个
    const factors = signal.metadata?.preBuyCheckFactors;
    if (!factors || !factors.earlyTradesExpectedFirstTime) continue;

    const checkTime = factors.earlyTradesCheckTime;
    const targetFromTime = checkTime - 90;
    const tokenAddress = signal.token_address;
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

      // 统计区块号差值
      for (let i = 1; i < uniqueTrades.length; i++) {
        const block1 = uniqueTrades[i - 1].block_number;
        const block2 = uniqueTrades[i].block_number;
        if (block1 && block2) {
          blockGaps.push(block2 - block1);
        }
      }

      totalTradesAnalyzed += uniqueTrades.length;
    } catch (error) {
      // 忽略错误
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(`分析的交易数: ${totalTradesAnalyzed}`);
  console.log(`区块号差值数量: ${blockGaps.length}\n`);

  // 统计差值分布
  const gapDistribution = {};
  blockGaps.forEach(gap => {
    gapDistribution[gap] = (gapDistribution[gap] || 0) + 1;
  });

  console.log('区块号差值分布:');
  console.log('差值 | 数量 | 占比');
  console.log('-----|------|------');
  const sortedGaps = Object.keys(gapDistribution).map(Number).sort((a, b) => a - b);
  sortedGaps.forEach(gap => {
    const count = gapDistribution[gap];
    const percent = (count / blockGaps.length * 100).toFixed(1);
    console.log(`${gap.toString().padStart(4)} | ${count.toString().padStart(4)} | ${percent.padStart(5)}%`);
  });

  // 计算分位数
  const sortedBlockGaps = [...blockGaps].sort((a, b) => a - b);
  const p50 = sortedBlockGaps[Math.floor(sortedBlockGaps.length * 0.5)];
  const p75 = sortedBlockGaps[Math.floor(sortedBlockGaps.length * 0.75)];
  const p90 = sortedBlockGaps[Math.floor(sortedBlockGaps.length * 0.9)];
  const p95 = sortedBlockGaps[Math.floor(sortedBlockGaps.length * 0.95)];

  console.log('\n区块号差值分位数:');
  console.log(`50% (中位数): ${p50}`);
  console.log(`75%: ${p75}`);
  console.log(`90%: ${p90}`);
  console.log(`95%: ${p95}`);

  // 现在测试不同阈值的聚簇效果
  console.log('\n【测试不同阈值的效果】\n');

  // 收集所有代币的数据（使用缓存避免重复请求）
  const tokenDataMap = new Map();

  for (const signal of executedSignals) {
    const factors = signal.metadata?.preBuyCheckFactors;
    if (!factors || !factors.earlyTradesExpectedFirstTime) continue;

    const tokenAddress = signal.token_address;
    const checkTime = factors.earlyTradesCheckTime;
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

      tokenDataMap.set(tokenAddress, {
        symbol: signal.metadata?.symbol || tokenAddress.substring(0, 8),
        trades: uniqueTrades,
        profitPercent: tokenReturns[tokenAddress] || null
      });
    } catch (error) {
      // 忽略错误
    }

    await new Promise(resolve => setTimeout(resolve, 50));
  }

  console.log(`成功获取交易数据的代币: ${tokenDataMap.size}个\n`);

  // 测试不同阈值
  console.log('阈值 | 平均簇数 | Top2>90%的代币 | 说明');
  console.log('-----|----------|---------------|------');

  for (const threshold of thresholds) {
    let totalClusters = 0;
    let top2HighCount = 0;
    const tokensWithClusters = [];

    for (const [tokenAddress, data] of tokenDataMap) {
      if (data.trades.length === 0) continue;

      const clusters = detectClustersByBlock(data.trades, threshold);
      const factors = calculateClusterFactors(data.trades, clusters);

      if (factors) {
        totalClusters += factors.totalClusters;
        tokensWithClusters.push({
          ...data,
          factors,
          tokenAddress
        });

        if (factors.top2ClusterRatio > 0.9) {
          top2HighCount++;
        }
      }
    }

    const avgClusters = tokensWithClusters.length > 0 ? totalClusters / tokensWithClusters.length : 0;

    let description = '';
    if (threshold === 1) {
      description = '严格：同一区块才算一簇';
    } else if (threshold >= 10) {
      description = '宽松：允许10个区块间隔';
    } else {
      description = '';
    }

    console.log(`${threshold.toString().padStart(4)} | ${avgClusters.toFixed(1).padStart(8)} | ${top2HighCount.toString().padStart(13)} | ${description}`);
  }

  // 详细测试每个阈值的分类效果
  console.log('\n【详细分析：各阈值的分类效果】\n');

  for (const threshold of [1, 2, 3, 5]) {
    console.log(`\n=== 阈值 = ${threshold} ===\n`);

    const profitable = [];
    const loss = [];

    for (const [tokenAddress, data] of tokenDataMap) {
      if (data.profitPercent === null) continue;

      const clusters = detectClustersByBlock(data.trades, threshold);
      const factors = calculateClusterFactors(data.trades, clusters);

      if (!factors || factors.totalClusters === 0) continue;

      const tokenResult = {
        symbol: data.symbol,
        tokenAddress,
        profitPercent: data.profitPercent,
        ...factors
      };

      if (data.profitPercent > 0) {
        profitable.push(tokenResult);
      } else {
        loss.push(tokenResult);
      }
    }

    // 测试条件：簇数>=4 && Top2Ratio > 0.90
    const condition = r => r.totalClusters >= 4 && r.top2ClusterRatio > 0.90;

    const lossRejected = loss.filter(condition).length;
    const lossRecall = loss.length > 0 ? lossRejected / loss.length : 0;
    const profitableRejected = profitable.filter(condition).length;

    console.log(`盈利代币: ${profitable.length}个`);
    console.log(`亏损代币: ${loss.length}个`);
    console.log(`条件: 簇数>=4 && Top2Ratio > 0.90`);
    console.log(`拒绝亏损: ${lossRejected}/${loss.length} (${(lossRecall * 100).toFixed(1)}%)`);
    console.log(`误伤盈利: ${profitableRejected}/${profitable.length}`);

    const f1 = (lossRecall + (1 - profitableRejected / profitable.length) > 0) ?
      (2 * lossRecall * (1 - profitableRejected / profitable.length)) /
      (lossRecall + (1 - profitableRejected / profitable.length)) : 0;

    console.log(`F1分数: ${f1.toFixed(3)}`);

    // 显示被拒绝的代币
    const rejected = [...profitable, ...loss].filter(condition);
    if (rejected.length > 0) {
      rejected.sort((a, b) => a.profitPercent - b.profitPercent);
      console.log(`\n被拒绝的代币 (${rejected.length}个):`);
      rejected.slice(0, 10).forEach(r => {
        const type = r.profitPercent > 0 ? '✓' : '✗';
        console.log(`  ${r.symbol.padEnd(11)} 簇数:${r.totalClusters} Top2:${(r.top2ClusterRatio * 100).toFixed(1)}% ${r.profitPercent.toFixed(1)}% ${type}`);
      });
    }
  }
}

findOptimalBlockThreshold().catch(console.error);
