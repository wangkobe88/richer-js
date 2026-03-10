/**
 * 在两个实验的所有数据上测试新条件
 * 测试条件: walletClusterCount >= 3 && walletClusterTop2Ratio > 0.85
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
  { id: '6b17ff18-002d-4ce0-a745-b8e02676abd4', name: '实验1 (市场差)' },
  { id: '1dde2be5-2f4e-49fb-9520-cb032e9ef759', name: '实验2 (市场好)' }
];

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

async function testNewCondition() {
  console.log('=== 测试新条件：walletClusterCount >= 3 && walletClusterTop2Ratio > 0.85 ===\n');
  console.log('配置: 区块号聚簇，阈值=7\n');

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

    // 去重
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
            experimentId: exp.id,
            experimentName: exp.name
          });
        }
      }
    }

    console.log(`  完成，获取 ${executedSignals.length} 个信号`);
  }

  console.log(`\n总共: ${allTokens.length} 个代币`);

  // 计算因子
  const tokensWithFactors = [];

  for (let i = 0; i < allTokens.length; i++) {
    const token = allTokens[i];

    const trades = await fetchTokenTrades(token.tokenAddress, token.checkTime);

    if (trades && trades.length > 0) {
      const clusters = detectClustersByBlock(trades, 7);
      const factors = calculateClusterFactors(trades, clusters);

      if (factors && factors.totalClusters > 0) {
        tokensWithFactors.push({
          ...token,
          tradesCount: trades.length,
          clusterCount: factors.totalClusters,
          top2Ratio: factors.top2ClusterRatio,
          megaRatio: factors.megaClusterRatio,
          secondToFirstRatio: factors.secondToFirstRatio
        });
      }
    }

    if ((i + 1) % 10 === 0) {
      console.log(`进度: ${i + 1}/${allTokens.length}`);
    }

    await new Promise(resolve => setTimeout(resolve, 50));
  }

  console.log(`\n有效数据: ${tokensWithFactors.length} 个代币\n`);

  // 分类
  const lossTokens = tokensWithFactors.filter(t => t.profitPercent !== null && t.profitPercent <= 0);
  const profitTokens = tokensWithFactors.filter(t => t.profitPercent !== null && t.profitPercent > 0);

  // 按实验分组
  const exp1Tokens = tokensWithFactors.filter(t => t.experimentId === experiments[0].id);
  const exp1Loss = exp1Tokens.filter(t => t.profitPercent !== null && t.profitPercent <= 0);
  const exp1Profit = exp1Tokens.filter(t => t.profitPercent !== null && t.profitPercent > 0);

  const exp2Tokens = tokensWithFactors.filter(t => t.experimentId === experiments[1].id);
  const exp2Loss = exp2Tokens.filter(t => t.profitPercent !== null && t.profitPercent <= 0);
  const exp2Profit = exp2Tokens.filter(t => t.profitPercent !== null && t.profitPercent > 0);

  console.log('【数据分布】');
  console.log(`总代币数: ${tokensWithFactors.length}`);
  console.log(`  亏损代币: ${lossTokens.length}`);
  console.log(`  盈利代币: ${profitTokens.length}`);
  console.log(`\n${experiments[0].name}:`);
  console.log(`  亏损: ${exp1Loss.length}`);
  console.log(`  盈利: ${exp1Profit.length}`);
  console.log(`\n${experiments[1].name}:`);
  console.log(`  亏损: ${exp2Loss.length}`);
  console.log(`  盈利: ${exp2Profit.length}\n`);

  // 测试新条件
  const newCondition = t => t.clusterCount >= 3 && t.top2Ratio > 0.85;

  console.log('=== 测试新条件 ===\n');

  console.log('条件: walletClusterCount >= 3 && walletClusterTop2Ratio > 0.85\n');

  // 总体效果
  const lossRejected = lossTokens.filter(newCondition);
  const profitRejected = profitTokens.filter(newCondition);

  const lossRecall = lossTokens.length > 0 ? lossRejected.length / lossTokens.length : 0;
  const profitPrecision = profitTokens.length > 0 ? 1 - (profitRejected.length / profitTokens.length) : 1;
  const f1 = (lossRecall + profitPrecision > 0) ? (2 * lossRecall * profitPrecision) / (lossRecall + profitPrecision) : 0;

  console.log('【总体效果】');
  console.log(`  亏损召回: ${lossRejected.length}/${lossTokens.length} (${(lossRecall * 100).toFixed(1)}%)`);
  console.log(`  盈利误伤: ${profitRejected.length}/${profitTokens.length} (${(profitRejected.length / profitTokens.length * 100).toFixed(1)}%)`);
  console.log(`  F1分数: ${f1.toFixed(3)}\n`);

  // 分实验效果
  console.log('【分实验效果】');

  const exp1LossRejected = exp1Loss.filter(newCondition);
  const exp1ProfitRejected = exp1Profit.filter(newCondition);
  const exp1Recall = exp1Loss.length > 0 ? exp1LossRejected.length / exp1Loss.length : 0;

  const exp2LossRejected = exp2Loss.filter(newCondition);
  const exp2ProfitRejected = exp2Profit.filter(newCondition);
  const exp2Recall = exp2Loss.length > 0 ? exp2LossRejected.length / exp2Loss.length : 0;

  console.log(`${experiments[0].name}:`);
  console.log(`  亏损召回: ${exp1LossRejected.length}/${exp1Loss.length} (${(exp1Recall * 100).toFixed(1)}%)`);
  console.log(`  盈利误伤: ${exp1ProfitRejected.length}/${exp1Profit.length} (${(exp1ProfitRejected.length / exp1Profit.length * 100).toFixed(1)}%)`);

  console.log(`\n${experiments[1].name}:`);
  console.log(`  亏损召回: ${exp2LossRejected.length}/${exp2Loss.length} (${(exp2Recall * 100).toFixed(1)}%)`);
  console.log(`  盈利误伤: ${exp2ProfitRejected.length}/${exp2Profit.length} (${(exp2ProfitRejected.length / exp2Profit.length * 100).toFixed(1)}%)`);

  // 详细显示被拒绝的代币
  console.log('\n【被拒绝的亏损代币】');
  console.log('代币        | 实验 | 收益率 | 簇数 | Top2% | Mega%');
  console.log('------------|------|--------|------|-------|-------');

  lossRejected.sort((a, b) => a.profitPercent - b.profitPercent).forEach(token => {
    const expName = token.experimentId === experiments[0].id ? '实验1' : '实验2';
    console.log(`${token.symbol.substring(0, 11).padEnd(11)} | ${expName.padEnd(6)} | ${token.profitPercent.toFixed(1).padStart(6)}% | ${token.clusterCount.toString().padStart(4)} | ${(token.top2Ratio * 100).toFixed(1).padStart(5)}% | ${(token.megaRatio * 100).toFixed(1).padStart(5)}%`);
  });

  console.log('\n【被拒绝的盈利代币（误伤）】');
  console.log('代币        | 实验 | 收益率 | 簇数 | Top2% | Mega%');
  console.log('------------|------|--------|------|-------|-------');

  if (profitRejected.length > 0) {
    profitRejected.sort((a, b) => b.profitPercent - a.profitPercent).forEach(token => {
      const expName = token.experimentId === experiments[0].id ? '实验1' : '实验2';
      console.log(`${token.symbol.substring(0, 11).padEnd(11)} | ${expName.padEnd(6)} | +${token.profitPercent.toFixed(1).padStart(5)}% | ${token.clusterCount.toString().padStart(4)} | ${(token.top2Ratio * 100).toFixed(1).padStart(5)}% | ${(token.megaRatio * 100).toFixed(1).padStart(5)}%`);
    });
  } else {
    console.log('✓ 无误伤！');
  }

  // 对比其他条件
  console.log('\n=== 对比其他条件 ===\n');

  const conditions = [
    {
      name: '新条件: 簇数>=3 && Top2>0.85',
      test: t => t.clusterCount >= 3 && t.top2Ratio > 0.85
    },
    {
      name: '旧条件: 簇数>=4 && Top2>0.85',
      test: t => t.clusterCount >= 4 && t.top2Ratio > 0.85
    },
    {
      name: '保守: 簇数>=4 && Top2>0.90',
      test: t => t.clusterCount >= 4 && t.top2Ratio > 0.90
    },
    {
      name: '激进: 簇数>=3 && Top2>0.90',
      test: t => t.clusterCount >= 3 && t.top2Ratio > 0.90
    },
    {
      name: 'Mega>0.7',
      test: t => t.megaRatio > 0.7
    },
    {
      name: '组合: (簇数>=3 && Top2>0.85) OR Mega>0.7',
      test: t => (t.clusterCount >= 3 && t.top2Ratio > 0.85) || t.megaRatio > 0.7
    }
  ];

  console.log('条件                                | 总体召回 | 总体误伤 | F1分数 | 实验1召回 | 实验1误伤 | 实验2召回 | 实验2误伤');
  console.log('----------------------------------|---------|---------|---------|----------|----------|----------|----------');

  conditions.forEach(condition => {
    const totalLossRejected = lossTokens.filter(condition.test).length;
    const totalLossRecall = lossTokens.length > 0 ? totalLossRejected / lossTokens.length : 0;

    const totalProfitRejected = profitTokens.filter(condition.test).length;
    const totalProfitPrecision = profitTokens.length > 0 ? 1 - (totalProfitRejected / profitTokens.length) : 1;

    const f1 = (totalLossRecall + totalProfitPrecision > 0) ? (2 * totalLossRecall * totalProfitPrecision) / (totalLossRecall + totalProfitPrecision) : 0;

    const exp1LossRejected = exp1Loss.filter(condition.test).length;
    const exp1Recall = exp1Loss.length > 0 ? exp1LossRejected / exp1Loss.length : 0;
    const exp1ProfitRejected = exp1Profit.filter(condition.test).length;

    const exp2LossRejected = exp2Loss.filter(condition.test).length;
    const exp2Recall = exp2Loss.length > 0 ? exp2LossRejected / exp2Loss.length : 0;
    const exp2ProfitRejected = exp2Profit.filter(condition.test).length;

    console.log(`${condition.name.padEnd(33)} | ${(totalLossRecall * 100).toFixed(1).padStart(7)}% | ${totalProfitRejected}/${profitTokens.length} | ${f1.toFixed(3)} | ${(exp1Recall * 100).toFixed(1).padStart(8)}% | ${exp1ProfitRejected}/${exp1Profit.length} | ${(exp2Recall * 100).toFixed(1).padStart(8)}% | ${exp2ProfitRejected}/${exp2Profit.length}`);
  });
}

testNewCondition().catch(console.error);
