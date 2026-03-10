/**
 * 测试组合因子效果
 * 测试聚簇条件 + 翻转比例条件的组合
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

const pumpAndDumpTokens = [
  '0xb9b1142a28fade5771b7ae076c96c3bee8beffff',
  '0xf3372a3dbc824f0b0044ca77209559514b294444',
  '0x5850bbdd3fd65a4d7c23623ffc7c3f041d954444',
  '0x6df5fd6949f2527ee99ce7c979c00f2a5bd34444',
  '0xd8d4ddeb91987a121422567260a88230dbb34444',
  '0x9b58b98a1ea58d59ffaaa9f1d2e5fd4168444444',
  '0x71c06c7064c5aaf398f6f956d8146ad0e0e84444',
  '0xd3b4d55ef44da2fee0e78e478d2fe94751514444'
];

const profitableTokens = [
  '0x16aeb87aeb78e4cf7987f16e910c285d77354444',
  '0xa9fe96fd5230a135ada220523032b3e1a67d4444',
  '0xd7a23f95c6698c44c7b861408f0d7b47acc74444',
  '0x4d15d67fcf9bd0b109efa7fc1b150416cca04444',
  '0x30d31d28ee0a47e0d6bfae215b6cd3b72144444',
  '0xe98b13b31bea0e7d3b63748650893ed846c4444'
];

// 从两个实验中获取更多数据
const allExperiments = ['6b17ff18-002d-4ce0-a745-b8e02676abd4', '1dde2be5-2f4e-49fb-9520-cb032e9ef759'];

async function getAllTokensWithReturns() {
  const tokenReturns = {};

  // 获取所有交易的收益率
  for (const expId of allExperiments) {
    const { data: sellTrades } = await supabase
      .from('trades')
      .select('token_address, metadata')
      .eq('experiment_id', expId)
      .eq('trade_direction', 'sell')
      .not('metadata->>profitPercent', 'is', null);

    for (const sellTrade of sellTrades || []) {
      tokenReturns[sellTrade.token_address] = sellTrade.metadata?.profitPercent || 0;
    }
  }

  return tokenReturns;
}

async function getSignalForToken(tokenAddress) {
  for (const expId of allExperiments) {
    const { data } = await supabase
      .from('strategy_signals')
      .select('*')
      .eq('experiment_id', expId)
      .eq('token_address', tokenAddress)
      .eq('action', 'buy')
      .limit(1);

    if (data && data.length > 0) return data[0];
  }
  return null;
}

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

/**
 * 基于区块号的聚簇算法
 */
function detectClustersByBlock(trades, blockThreshold = 7) {
  if (!trades || trades.length === 0) return [];

  const clusters = [];
  let clusterStartIdx = 0;

  for (let i = 1; i <= trades.length; i++) {
    const blockGap = (i < trades.length && trades[i].block_number && trades[i - 1].block_number)
      ? trades[i].block_number - trades[i - 1].block_number
      : (blockThreshold + 1);

    if (i === trades.length || blockGap > blockThreshold) {
      const clusterSize = i - clusterStartIdx;
      const cluster = Array.from({ length: clusterSize }, (_, k) => clusterStartIdx + k);
      clusters.push(cluster);
      clusterStartIdx = i;
    }
  }

  return clusters;
}

/**
 * 计算聚簇因子
 */
function calculateClusterFactors(trades, clusters) {
  if (!trades || trades.length === 0 || clusters.length === 0) return null;

  const clusterSizes = clusters.map(c => c.length);
  const sortedSizes = [...clusterSizes].sort((a, b) => b - a);
  const totalTrades = trades.length;

  const avgClusterSize = clusterSizes.reduce((a, b) => a + b, 0) / clusters.length;
  const megaClusterThreshold = Math.max(5, Math.floor(avgClusterSize * 2));

  const megaClusters = clusterSizes.filter(s => s >= megaClusterThreshold);
  const megaClusterTradeCount = megaClusters.reduce((sum, s) => sum + s, 0);

  const top2ClusterRatio = sortedSizes.length >= 2
    ? (sortedSizes[0] + sortedSizes[1]) / totalTrades
    : sortedSizes[0] / totalTrades;

  return {
    totalClusters: clusters.length,
    top2ClusterRatio,
    megaClusterRatio: megaClusterTradeCount / totalTrades
  };
}

/**
 * 计算快速翻转钱包比例
 */
function calculateFlipperRatio(trades, checkTime) {
  if (!trades || trades.length === 0) return 0;

  const windowStart = checkTime - 90;
  const walletMap = new Map();

  trades.forEach(trade => {
    const wallet = trade.from_address?.toLowerCase();
    if (!wallet) return;

    if (!walletMap.has(wallet)) {
      walletMap.set(wallet, { trades: [] });
    }
    walletMap.get(wallet).trades.push({ ...trade, relativeTime: trade.time - windowStart });
  });

  let flipperCount = 0;
  const totalWallets = walletMap.size;

  walletMap.forEach(w => {
    for (let i = 1; i < w.trades.length; i++) {
      const currTrade = w.trades[i];
      const prevTrade = w.trades[i - 1];
      const timeGap = currTrade.relativeTime - prevTrade.relativeTime;

      const isFlip = (currTrade.to_usd > 0 && prevTrade.from_usd > 0) ||
                    (currTrade.from_usd > 0 && prevTrade.to_usd > 0);

      if (isFlip && timeGap <= 10) {
        flipperCount++;
        break;
      }
    }
  });

  return totalWallets > 0 ? flipperCount / totalWallets : 0;
}

async function testCombinedFactors() {
  console.log('=== 测试组合因子效果 ===\n');

  const tokenReturns = await getAllTokensWithReturns();

  // 获取所有代币数据
  const allTokens = [];

  for (const expId of allExperiments) {
    const { data: buySignals } = await supabase
      .from('strategy_signals')
      .select('*')
      .eq('experiment_id', expId)
      .eq('action', 'buy')
      .order('created_at', { ascending: false });

    const executedSignals = buySignals.filter(s => s.metadata?.execution_status === 'executed');

    // 去重
    const seenAddresses = new Set();
    for (const signal of executedSignals) {
      if (!seenAddresses.has(signal.token_address)) {
        seenAddresses.add(signal.token_address);

        const profit = tokenReturns[signal.token_address];
        if (profit !== undefined && profit !== null) {
          allTokens.push({
            tokenAddress: signal.token_address,
            symbol: signal.metadata?.symbol || signal.token_address.substring(0, 8),
            profitPercent: profit,
            checkTime: signal.metadata?.preBuyCheckFactors?.earlyTradesCheckTime
          });
        }
      }
    }
  }

  console.log(`总代币数: ${allTokens.length}`);
  console.log(`盈利代币: ${allTokens.filter(t => t.profitPercent > 0).length}`);
  console.log(`亏损代币: ${allTokens.filter(t => t.profitPercent <= 0).length}\n`);

  // 计算因子
  const tokensWithFactors = [];

  for (let i = 0; i < allTokens.length; i++) {
    const token = allTokens[i];

    if (!token.checkTime) continue;

    const trades = await fetchTokenTrades(token.tokenAddress, token.checkTime);
    if (!trades || trades.length === 0) continue;

    const clusters = detectClustersByBlock(trades, 7);
    const clusterFactors = calculateClusterFactors(trades, clusters);
    const flipperRatio = calculateFlipperRatio(trades, token.checkTime);

    tokensWithFactors.push({
      ...token,
      tradesCount: trades.length,
      clusterCount: clusterFactors?.totalClusters || 0,
      top2Ratio: clusterFactors?.top2ClusterRatio || 0,
      megaRatio: clusterFactors?.megaClusterRatio || 0,
      flipperRatio
    });

    if ((i + 1) % 10 === 0) {
      console.log(`进度: ${i + 1}/${allTokens.length}`);
    }

    await new Promise(resolve => setTimeout(resolve, 50));
  }

  console.log(`\n有效数据: ${tokensWithFactors.length} 个代币\n`);

  // 测试不同的条件组合
  console.log('=== 测试条件组合 ===\n');

  const conditions = [
    {
      name: '聚簇条件 (簇>=4 && Top2>0.85)',
      test: t => t.clusterCount >= 4 && t.top2Ratio > 0.85
    },
    {
      name: '翻转比例 (FlipperRatio>=0.6)',
      test: t => t.flipperRatio >= 0.6
    },
    {
      name: '聚簇 OR 翻转',
      test: t => (t.clusterCount >= 4 && t.top2Ratio > 0.85) || t.flipperRatio >= 0.6
    },
    {
      name: '聚簇 AND 翻转',
      test: t => (t.clusterCount >= 4 && t.top2Ratio > 0.85) && t.flipperRatio >= 0.6
    },
    {
      name: 'MegaRatio > 0.7',
      test: t => t.megaRatio > 0.7
    },
    {
      name: 'Mega OR 翻转',
      test: t => t.megaRatio > 0.7 || t.flipperRatio >= 0.6
    },
    {
      name: 'Mega OR 聚簇',
      test: t => t.megaRatio > 0.7 || (t.clusterCount >= 4 && t.top2Ratio > 0.85)
    },
    {
      name: '组合: 聚簇 OR Mega OR 翻转',
      test: t => (t.clusterCount >= 4 && t.top2Ratio > 0.85) || t.megaRatio > 0.7 || t.flipperRatio >= 0.6
    }
  ];

  const lossTokens = tokensWithFactors.filter(t => t.profitPercent <= 0);
  const profitTokens = tokensWithFactors.filter(t => t.profitPercent > 0);

  console.log('条件                              | 亏损召回 | 盈利误伤 | F1分数');
  console.log('----------------------------------|---------|---------|--------');

  conditions.forEach(condition => {
    const lossRejected = lossTokens.filter(condition.test).length;
    const lossRecall = lossTokens.length > 0 ? lossRejected / lossTokens.length : 0;

    const profitRejected = profitTokens.filter(condition.test).length;
    const profitPrecision = profitTokens.length > 0 ? 1 - (profitRejected / profitTokens.length) : 1;

    const f1 = (lossRecall + profitPrecision > 0) ? (2 * lossRecall * profitPrecision) / (lossRecall + profitPrecision) : 0;

    console.log(`${condition.name.padEnd(33)} | ${(lossRecall * 100).toFixed(1).padStart(7)}% | ${profitRejected}/${profitTokens.length} | ${f1.toFixed(3)}`);
  });

  // 显示被遗漏的亏损代币
  console.log('\n=== 被"聚簇 OR 翻转"遗漏的亏损代币 ===\n');

  const bestCondition = t => (t.clusterCount >= 4 && t.top2Ratio > 0.85) || t.flipperRatio >= 0.6;
  const missedLoss = lossTokens.filter(t => !bestCondition(t));

  if (missedLoss.length > 0) {
    console.log('代币        | 收益率 | 簇数 | Top2% | Mega% | 翻转%');
    console.log('------------|--------|------|-------|-------|-------');

    missedLoss.forEach(t => {
      console.log(`${t.symbol.substring(0, 11).padEnd(11)} | ${t.profitPercent.toFixed(1).padStart(6)}% | ${t.clusterCount.toString().padStart(4)} | ${(t.top2Ratio * 100).toFixed(1).padStart(5)}% | ${(t.megaRatio * 100).toFixed(1).padStart(5)}% | ${(t.flipperRatio * 100).toFixed(1).padStart(5)}%`);
    });
  } else {
    console.log('✓ 无遗漏！');
  }
}

testCombinedFactors().catch(console.error);
