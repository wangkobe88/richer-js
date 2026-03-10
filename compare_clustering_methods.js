/**
 * 对比时间戳聚簇 vs 区块号聚簇
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
 * 时间戳聚簇
 */
function detectClustersByTime(trades, timeThreshold) {
  if (!trades || trades.length === 0) return [];

  const clusters = [];
  let clusterStartIdx = 0;

  for (let i = 1; i <= trades.length; i++) {
    if (i === trades.length || !trades[i].time || !trades[i-1].time ||
        (trades[i].time - trades[i - 1].time) > timeThreshold) {
      const clusterSize = i - clusterStartIdx;
      const clusterIndices = Array.from({ length: clusterSize }, (_, k) => clusterStartIdx + k);
      clusters.push(clusterIndices);
      clusterStartIdx = i;
    }
  }

  return clusters;
}

/**
 * 区块号聚簇
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
    totalClusters: clusters.length,
    maxSize: sortedSizes[0] || 0,
    avgClusterSize,
    secondToFirstRatio,
    top2ClusterRatio,
    megaClusterRatio: megaClusterTradeCount / totalTrades
  };
}

async function compareClusteringMethods() {
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

  // 获取信号数据（使用已有的因子数据）
  const { data: buySignals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy');

  const executedSignals = buySignals.filter(s => s.metadata?.execution_status === 'executed');

  console.log('=== 对比时间戳聚簇 vs 区块号聚簇 ===\n');

  // 收集数据
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

      if (uniqueTrades.length > 0) {
        tokenDataMap.set(tokenAddress, {
          symbol: signal.metadata?.symbol || tokenAddress.substring(0, 8),
          trades: uniqueTrades,
          profitPercent: tokenReturns[tokenAddress] || null,
          existingFactors: factors // 使用已有的因子（基于时间戳）
        });
      }
    } catch (error) {
      // 忽略错误
    }

    await new Promise(resolve => setTimeout(resolve, 50));
  }

  console.log(`成功获取交易数据的代币: ${tokenDataMap.size}个\n`);

  // 准备结果数据
  const results = [];
  for (const [tokenAddress, data] of tokenDataMap) {
    if (data.profitPercent === null || data.trades.length === 0) continue;

    // 时间戳聚簇（2秒阈值）
    const timeClusters = detectClustersByTime(data.trades, 2);
    const timeFactors = calculateClusterFactors(data.trades, timeClusters);

    // 区块号聚簇（不同阈值）
    const block5Clusters = detectClustersByBlock(data.trades, 5);
    const block5Factors = calculateClusterFactors(data.trades, block5Clusters);

    const block10Clusters = detectClustersByBlock(data.trades, 10);
    const block10Factors = calculateClusterFactors(data.trades, block10Clusters);

    results.push({
      symbol: data.symbol,
      tokenAddress,
      profitPercent: data.profitPercent,
      tradesCount: data.trades.length,
      time: timeFactors,
      block5: block5Factors,
      block10: block10Factors,
      existing: data.existingFactors
    });
  }

  const profitable = results.filter(r => r.profitPercent > 0);
  const loss = results.filter(r => r.profitPercent <= 0);

  console.log(`盈利代币: ${profitable.length}个`);
  console.log(`亏损代币: ${loss.length}个\n`);

  // 测试不同条件
  console.log('【测试不同聚簇方法和条件】\n');

  const testConfigs = [
    {
      name: '时间戳(2秒) - Top2>0.90',
      getFactors: r => r.time,
      condition: f => f && f.top2ClusterRatio > 0.90
    },
    {
      name: '区块号(5) - Top2>0.90',
      getFactors: r => r.block5,
      condition: f => f && f.top2ClusterRatio > 0.90
    },
    {
      name: '区块号(10) - Top2>0.90',
      getFactors: r => r.block10,
      condition: f => f && f.top2ClusterRatio > 0.90
    },
    {
      name: '区块号(5) - 簇数>=4 && Top2>0.90',
      getFactors: r => r.block5,
      condition: f => f && f.totalClusters >= 4 && f.top2ClusterRatio > 0.90
    },
    {
      name: '区块号(10) - 簇数>=4 && Top2>0.90',
      getFactors: r => r.block10,
      condition: f => f && f.totalClusters >= 4 && f.top2ClusterRatio > 0.90
    },
  ];

  console.log('方法                              | 亏损召回 | 盈利误伤 | F1分数');
  console.log('----------------------------------|---------|---------|-------');

  testConfigs.forEach(config => {
    const lossRejected = loss.filter(r => {
      const f = config.getFactors(r);
      return f && config.condition(f);
    }).length;
    const lossRecall = loss.length > 0 ? lossRejected / loss.length : 0;

    const profitableRejected = profitable.filter(r => {
      const f = config.getFactors(r);
      return f && config.condition(f);
    }).length;

    const f1 = (lossRecall + (1 - profitableRejected / profitable.length) > 0) ?
      (2 * lossRecall * (1 - profitableRejected / profitable.length)) /
      (lossRecall + (1 - profitableRejected / profitable.length)) : 0;

    console.log(`${config.name.padEnd(33)} | ${(lossRecall * 100).toFixed(1).padStart(7)}% | ${profitableRejected}/${profitable.length} | ${f1.toFixed(3)}`);
  });

  // 详细对比
  console.log('\n【详细对比：几个关键代币】\n');

  const keyTokens = results.filter(r =>
    r.symbol === '宝贝龙虾' ||
    r.symbol === 'GLUBSCHIS' ||
    r.symbol === 'BINANCE'
  );

  if (keyTokens.length > 0) {
    console.log('代币      | 收益率 | 时间-簇数 | 时间-Top2 | 区块5-簇数 | 区块5-Top2 | 区块10-簇数 | 区块10-Top2');
    console.log('----------|--------|----------|-----------|------------|------------|-------------|-------------');

    keyTokens.forEach(t => {
      const timeClusters = t.time?.totalClusters || 0;
      const timeTop2 = ((t.time?.top2ClusterRatio || 0) * 100).toFixed(1);
      const block5Clusters = t.block5?.totalClusters || 0;
      const block5Top2 = ((t.block5?.top2ClusterRatio || 0) * 100).toFixed(1);
      const block10Clusters = t.block10?.totalClusters || 0;
      const block10Top2 = ((t.block10?.top2ClusterRatio || 0) * 100).toFixed(1);

      console.log(`${t.symbol.padEnd(9)} | ${t.profitPercent.toFixed(1).padStart(6)}% | ` +
        `${timeClusters.toString().padStart(8)} | ${timeTop2.padStart(8)}% | ` +
        `${block5Clusters.toString().padStart(10)} | ${block5Top2.padStart(10)}% | ` +
        `${block10Clusters.toString().padStart(11)} | ${block10Top2.padStart(11)}%`);
    });
  }

  // 找出区块号聚簇的优势案例
  console.log('\n【区块号聚簇能检测到但时间戳检测不到的案例】\n');

  const timeMissed = loss.filter(r => {
    const timeRejected = r.time && r.time.top2ClusterRatio > 0.90;
    const block10Rejected = r.block10 && r.block10.top2ClusterRatio > 0.90;
    return !timeRejected && block10Rejected;
  });

  if (timeMissed.length > 0) {
    console.log(`数量: ${timeMissed.length}个\n`);
    timeMissed.forEach(t => {
      console.log(`${t.symbol}: ${t.profitPercent.toFixed(1)}% (时间-Top2=${((t.time?.top2ClusterRatio || 0) * 100).toFixed(1)}%, 区块10-Top2=${((t.block10?.top2ClusterRatio || 0) * 100).toFixed(1)}%)`);
    });
  } else {
    console.log('无');
  }
}

compareClusteringMethods().catch(console.error);
