/**
 * 可视化聚簇时间序列
 * 观察大簇是更早还是更晚
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
      const clusterTrades = clusterIndices.map(idx => trades[idx]);
      clusters.push({
        size: clusterSize,
        trades: clusterTrades,
        startTime: clusterTrades[0].time,
        endTime: clusterTrades[clusterTrades.length - 1].time,
        startBlock: clusterTrades[0].block_number,
        endBlock: clusterTrades[clusterTrades.length - 1].block_number
      });
      clusterStartIdx = i;
    }
  }

  return clusters;
}

/**
 * 获取代币的交易数据
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

/**
 * 可视化聚簇时间序列
 */
function visualizeClusters(symbol, trades, clusters, checkTime) {
  if (trades.length === 0 || clusters.length === 0) {
    return '';
  }

  const windowStart = checkTime - 90;
  const windowEnd = checkTime;

  // 将90秒窗口分为18个5秒段
  const segmentSize = 5;
  const numSegments = 18;

  // 初始化时间线
  const timeline = Array(numSegments).fill(0);

  // 计算每个簇在哪些时间段
  clusters.forEach(cluster => {
    const relStart = cluster.startTime - windowStart;
    const relEnd = cluster.endTime - windowStart;

    const startSegment = Math.floor(Math.max(0, relStart) / segmentSize);
    const endSegment = Math.floor(Math.min(numSegments - 1, relEnd / segmentSize));

    for (let i = startSegment; i <= endSegment; i++) {
      timeline[i] += cluster.size;
    }
  });

  // 找出最大的簇
  const sortedClusters = [...clusters].sort((a, b) => b.size - a.size);
  const maxClusterSize = sortedClusters[0]?.size || 0;
  const top3Clusters = sortedClusters.slice(0, 3);

  // 构建可视化字符串
  let lines = [];
  lines.push(`\n【${symbol}聚簇时间序列】`);
  lines.push(`交易总数: ${trades.length}, 簇数: ${clusters.length}, 最大簇: ${maxClusterSize}`);
  lines.push(``);
  lines.push(`时间轴 (每段${segmentSize}秒, 从左到右时间递增):`);
  lines.push(``);

  // 时间线可视化
  const maxTradesInSegment = Math.max(...timeline);
  const scaleFactor = maxTradesInSegment > 0 ? 50 / maxTradesInSegment : 1;

  // 第一行：时间标记
  let timeMarkers = '时间  ';
  for (let i = 0; i < numSegments; i++) {
    const seconds = i * segmentSize;
    timeMarkers += `${seconds.toString().padStart(2)}s `;
  }
  lines.push(timeMarkers);
  lines.push('');

  // 第二行：交易量柱状图
  let volumeBar = '交易量 ';
  for (let i = 0; i < numSegments; i++) {
    const barLength = Math.round(timeline[i] * scaleFactor);
    const bar = '█'.repeat(barLength) || '·';
    volumeBar += `${bar.padEnd(3)} `;
  }
  lines.push(volumeBar);
  lines.push('');

  // 第三行：簇标记
  let clusterMarkers = '簇标记 ';
  for (let i = 0; i < numSegments; i++) {
    const segmentCenter = (i + 0.5) * segmentSize;
    let marker = '';

    // 检查这个时间段被哪些簇覆盖
    const coveringClusters = clusters.filter(cluster => {
      const relStart = cluster.startTime - windowStart;
      const relEnd = cluster.endTime - windowStart;
      return relStart <= segmentCenter && segmentCenter <= relEnd;
    });

    // 只标记最大的簇
    const maxInSegment = coveringClusters.sort((a, b) => b.size - a.size)[0];
    if (maxInSegment && maxInSegment.size === maxClusterSize) {
      marker = '■'; // 最大簇
    } else if (maxInSegment && maxInSegment.size >= maxClusterSize * 0.5) {
      marker = '▵'; // 大簇
    } else if (coveringClusters.length > 0) {
      marker = '·'; // 小簇
    } else {
      marker = ' '; // 空闲
    }

    clusterMarkers += `${marker} `;
  }
  lines.push(clusterMarkers);

  // 第四行：相对时间位置
  lines.push('');
  lines.push('【前3大簇详情】');

  top3Clusters.forEach((cluster, idx) => {
    const relStart = cluster.startTime - windowStart;
    const relEnd = cluster.endTime - windowStart;
    const position = ((relStart + relEnd) / 2 / 90 * 100).toFixed(0);

    lines.push(`  #${idx + 1}: ${cluster.size}笔, 位置: ${position}% (${relStart.toFixed(0)}-${relEnd.toFixed(0)}s), 区块: ${cluster.startBlock}-${cluster.endBlock}`);
  });

  lines.push('');
  lines.push(`  → 购买信号位置: 100% (checkTime)`);

  return lines.join('\n');
}

async function analyzeClusterTiming() {
  const experiments = [
    '6b17ff18-002d-4ce0-a745-b8e02676abd4',
    '1dde2be5-2f4e-49fb-9520-cb032e9ef759'
  ];

  console.log('=== 聚簇时间序列分析 ===\n');

  // 收集所有代币数据
  const allTokens = [];

  for (const expId of experiments) {
    const { data: buySignals } = await supabase
      .from('strategy_signals')
      .select('token_address, metadata')
      .eq('experiment_id', expId)
      .eq('action', 'buy')
      .order('created_at', { ascending: false });

    const executedSignals = buySignals.filter(s => s.metadata?.execution_status === 'executed');

    for (const signal of executedSignals) {
      const factors = signal.metadata?.preBuyCheckFactors;
      if (!factors || !factors.earlyTradesCheckTime) continue;

      allTokens.push({
        symbol: signal.metadata?.symbol || signal.token_address.substring(0, 8),
        tokenAddress: signal.token_address,
        checkTime: factors.earlyTradesCheckTime
      });

      await new Promise(resolve => setTimeout(resolve, 50));
    }

    console.log(`实验 ${expId.substring(0, 8)}... 获取 ${executedSignals.length} 个信号`);
  }

  console.log(`\n总共: ${allTokens.length} 个代币\n`);

  // 计算所有代币的聚簇（阈值=5）
  const clusterThreshold = 5;

  for (let i = 0; i < allTokens.length; i++) {
    const token = allTokens[i];
    const trades = await fetchTokenTrades(token.tokenAddress, token.checkTime);

    if (!trades || trades.length === 0) continue;

    const clusters = detectClustersByBlock(trades, clusterThreshold);
    const sortedClusters = [...clusters].sort((a, b) => b.size - a.size);

    // 计算最大簇的位置
    const maxCluster = sortedClusters[0];
    if (maxCluster) {
      const maxCenter = (maxCluster.startTime + maxCluster.endTime) / 2;
      const maxRelativePos = (maxCenter - (token.checkTime - 90)) / 90 * 100;
      maxCluster.relativePos = maxRelativePos;
    }

    token.trades = trades;
    token.clusters = clusters;
    token.sortedClusters = sortedClusters;
    token.maxCluster = maxCluster;

    if ((i + 1) % 10 === 0) {
      console.log(`进度: ${i + 1}/${allTokens.length}`);
    }

    await new Promise(resolve => setTimeout(resolve, 50));
  }

  // 过滤有效的代币
  const validTokens = allTokens.filter(t => t.clusters && t.clusters.length > 0);
  console.log(`\n有效数据: ${validTokens.length} 个代币\n`);

  // 按最大簇的大小排序
  validTokens.sort((a, b) => (b.maxCluster?.size || 0) - (a.maxCluster?.size || 0));

  // 分析最大簇的位置分布
  console.log('【最大簇位置分布分析】\n');

  const positionBuckets = {
    '0-20% (靠近开始)': { count: 0, tokens: [] },
    '20-40%': { count: 0, tokens: [] },
    '40-60% (中间)': { count: 0, tokens: [] },
    '60-80%': { count: 0, tokens: [] },
    '80-100% (靠近购买信号)': { count: 0, tokens: [] }
  };

  validTokens.forEach(token => {
    const pos = token.maxCluster?.relativePos || 0;
    if (pos < 20) {
      positionBuckets['0-20% (靠近开始)'].count++;
      positionBuckets['0-20% (靠近开始)'].tokens.push(token.symbol);
    } else if (pos < 40) {
      positionBuckets['20-40%'].count++;
      positionBuckets['20-40%'].tokens.push(token.symbol);
    } else if (pos < 60) {
      positionBuckets['40-60% (中间)'].count++;
      positionBuckets['40-60% (中间)'].tokens.push(token.symbol);
    } else if (pos < 80) {
      positionBuckets['60-80%'].count++;
      positionBuckets['60-80%'].tokens.push(token.symbol);
    } else {
      positionBuckets['80-100% (靠近购买信号)'].count++;
      positionBuckets['80-100% (靠近购买信号)'].tokens.push(token.symbol);
    }
  });

  console.log('位置区间          | 数量 | 占比');
  console.log('------------------|------|------');

  Object.entries(positionBuckets).forEach(([key, value]) => {
    const percent = (value.count / validTokens.length * 100).toFixed(1);
    console.log(`${key.padEnd(17)} | ${value.count.toString().padStart(4)} | ${percent.padStart(5)}%`);
  });

  // 统计：最大簇在不同位置的代币的收益情况
  const { data: sellTrades } = await supabase
    .from('trades')
    .select('token_address, metadata')
    .eq('trade_direction', 'sell')
    .not('metadata->>profitPercent', 'is', null);

  const tokenReturns = {};
  for (const sellTrade of sellTrades || []) {
    tokenReturns[sellTrade.token_address] = sellTrade.metadata?.profitPercent || 0;
  }

  console.log('\n【最大簇位置与收益率关系】\n');

  const positionProfitStats = {
    '0-20%': { profitCount: 0, profitTotal: 0, lossCount: 0, lossTotal: 0 },
    '20-40%': { profitCount: 0, profitTotal: 0, lossCount: 0, lossTotal: 0 },
    '40-60%': { profitCount: 0, profitTotal: 0, lossCount: 0, lossTotal: 0 },
    '60-80%': { profitCount: 0, profitTotal: 0, lossCount: 0, lossTotal: 0 },
    '80-100%': { profitCount: 0, profitTotal: 0, lossCount: 0, lossTotal: 0 }
  };

  validTokens.forEach(token => {
    const profit = tokenReturns[token.tokenAddress];
    if (profit === undefined || profit === null) return;

    const pos = token.maxCluster?.relativePos || 0;
    let bucket = '';

    if (pos < 20) bucket = '0-20%';
    else if (pos < 40) bucket = '20-40%';
    else if (pos < 60) bucket = '40-60%';
    else if (pos < 80) bucket = '60-80%';
    else bucket = '80-100%';

    if (profit > 0) {
      positionProfitStats[bucket].profitCount++;
      positionProfitStats[bucket].profitTotal += profit;
    } else {
      positionProfitStats[bucket].lossCount++;
      positionProfitStats[bucket].lossTotal += profit;
    }
  });

  console.log('位置  | 盈利数 | 平均盈利 | 亏损数 | 平均亏损');
  console.log('------|--------|---------|--------|---------');

  Object.entries(positionProfitStats).forEach(([key, stats]) => {
    const avgProfit = stats.profitCount > 0 ? stats.profitTotal / stats.profitCount : 0;
    const avgLoss = stats.lossCount > 0 ? stats.lossTotal / stats.lossCount : 0;
    console.log(`${key.padEnd(5)} | ${stats.profitCount.toString().padStart(6)} | ${avgProfit.toFixed(1).padStart(7)}% | ${stats.lossCount.toString().padStart(6)} | ${avgLoss.toFixed(1).padStart(7)}%`);
  });

  // 显示一些典型案例
  console.log('\n【典型案例可视化】\n');

  // 选择几个不同位置的代币
  const exampleCases = [
    { pos: '0-20%', minIndex: 0, maxIndex: 1 },
    { pos: '40-60%', minIndex: 0, maxIndex: 2 },
    { pos: '80-100%', minIndex: 0, maxIndex: 1 }
  ];

  const shownSymbols = new Set();

  exampleCases.forEach(caseConfig => {
    const tokensInRange = validTokens.filter(t => {
      const pos = t.maxCluster?.relativePos || 0;
      if (caseConfig.pos === '0-20%') return pos < 20;
      if (caseConfig.pos === '40-60%') return pos >= 40 && pos < 60;
      if (caseConfig.pos === '80-100%') return pos >= 80;
      return false;
    });

    if (tokensInRange.length > 0) {
      // 选择第一个未显示的代币
      const token = tokensInRange.find(t => !shownSymbols.has(t.symbol));
      if (token) {
        shownSymbols.add(token.symbol);
        const profit = tokenReturns[token.tokenAddress];

        const visualization = visualizeClusters(
          `${token.symbol} (${profit ? '+' + profit.toFixed(1) : profit.toFixed(1)} + '%)`,
          token.trades,
          token.clusters,
          token.checkTime
        );

        console.log(visualization);
        console.log('');
      }
    }
  });
}

analyzeClusterTiming().catch(console.error);
