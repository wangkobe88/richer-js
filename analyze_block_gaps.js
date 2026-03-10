/**
 * 分析区块空洞指标
 * 定义: 区块空洞 = 相邻交易区块号差值 - 1
 * 例如: 区块10 -> 15，空洞 = 15-10-1 = 4
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
 * 计算区块空洞指标
 */
function calculateBlockGaps(trades) {
  if (!trades || trades.length === 0) return null;

  let totalGap = 0;
  let maxGap = 0;
  let gapCount = 0;
  let zeroGapCount = 0;  // 连续区块的数量

  for (let i = 1; i < trades.length; i++) {
    const prevBlock = trades[i - 1].block_number;
    const currBlock = trades[i].block_number;

    if (prevBlock && currBlock && currBlock > prevBlock) {
      const gap = currBlock - prevBlock - 1;  // 减1是因为相邻区块的空洞应该是0

      if (gap > 0) {
        totalGap += gap;
        gapCount++;
        maxGap = Math.max(maxGap, gap);
      } else {
        zeroGapCount++;  // gap = 0 表示连续区块
      }
    }
  }

  const totalTrades = trades.length;
  const totalSpan = totalTrades > 0 ? (trades[trades.length - 1].block_number - trades[0].block_number) : 0;
  const actualSpan = totalSpan > 0 ? totalSpan + 1 : 0;  // 实际跨越的区块数

  return {
    totalGap,           // 总空洞数
    maxGap,             // 最大单次空洞
    gapCount,           // 有空洞的次数
    zeroGapCount,       // 连续区块的次数
    totalTrades,        // 总交易数
    totalSpan,          // 区块跨度
    actualSpan,         // 实际跨越区块数
    // 归一化指标
    gapRatio: actualSpan > 0 ? totalGap / actualSpan : 0,           // 空洞占比
    continuityRatio: totalTrades > 1 ? zeroGapCount / (totalTrades - 1) : 0  // 连续性比例
  };
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

async function analyzeBlockGaps() {
  console.log('=== 分析区块空洞指标 ===\n');
  console.log('定义: 区块空洞 = 相邻交易区块号差值 - 1\n');

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
            experimentId: exp.id,
            experimentName: exp.name
          });
        }
      }
    }

    console.log(`  完成，获取 ${executedSignals.length} 个信号`);
  }

  console.log(`\n总共: ${allTokens.length} 个代币`);

  // 计算区块空洞指标
  const tokensWithGaps = [];

  for (let i = 0; i < allTokens.length; i++) {
    const token = allTokens[i];

    const trades = await fetchTokenTrades(token.tokenAddress, token.checkTime);

    if (trades && trades.length > 0) {
      const gapMetrics = calculateBlockGaps(trades);

      if (gapMetrics) {
        tokensWithGaps.push({
          ...token,
          tradesCount: trades.length,
          ...gapMetrics
        });
      }
    }

    if ((i + 1) % 10 === 0) {
      console.log(`进度: ${i + 1}/${allTokens.length}`);
    }

    await new Promise(resolve => setTimeout(resolve, 50));
  }

  console.log(`\n有效数据: ${tokensWithGaps.length} 个代币\n`);

  // 分类
  const lossTokens = tokensWithGaps.filter(t => t.profitPercent !== null && t.profitPercent <= 0);
  const profitTokens = tokensWithGaps.filter(t => t.profitPercent !== null && t.profitPercent > 0);

  console.log(`亏损代币: ${lossTokens.length}`);
  console.log(`盈利代币: ${profitTokens.length}\n`);

  // 分析空洞指标的分布
  console.log('【区块空洞指标分布分析】\n');

  const lossAvgGapRatio = lossTokens.reduce((sum, t) => sum + t.gapRatio, 0) / lossTokens.length;
  const profitAvgGapRatio = profitTokens.reduce((sum, t) => sum + t.gapRatio, 0) / profitTokens.length;

  const lossAvgContinuity = lossTokens.reduce((sum, t) => sum + t.continuityRatio, 0) / lossTokens.length;
  const profitAvgContinuity = profitTokens.reduce((sum, t) => sum + t.continuityRatio, 0) / profitTokens.length;

  console.log('指标          | 亏损代币平均 | 盈利代币平均 | 差异');
  console.log('--------------|-------------|-------------|------');
  console.log(`空洞占比 (gapRatio)     | ${(lossAvgGapRatio * 100).toFixed(1)}%      | ${(profitAvgGapRatio * 100).toFixed(1)}%      | ${(profitAvgGapRatio * 100 - lossAvgGapRatio * 100).toFixed(1)}%`);
  console.log(`连续性 (continuityRatio) | ${(lossAvgContinuity * 100).toFixed(1)}%      | ${(profitAvgContinuity * 100).toFixed(1)}%      | ${(profitAvgContinuity * 100 - lossAvgContinuity * 100).toFixed(1)}%`);

  // 测试不同的空洞阈值
  console.log('\n=== 测试不同空洞阈值 ===\n');

  const conditions = [
    {
      name: 'gapRatio > 0.3 (空洞>30%)',
      test: t => t.gapRatio > 0.3
    },
    {
      name: 'gapRatio > 0.4 (空洞>40%)',
      test: t => t.gapRatio > 0.4
    },
    {
      name: 'gapRatio > 0.5 (空洞>50%)',
      test: t => t.gapRatio > 0.5
    },
    {
      name: 'continuityRatio < 0.6 (连续<60%)',
      test: t => t.continuityRatio < 0.6
    },
    {
      name: 'continuityRatio < 0.5 (连续<50%)',
      test: t => t.continuityRatio < 0.5
    },
    {
      name: '组合: gapRatio>0.4 OR continuity<0.6',
      test: t => t.gapRatio > 0.4 || t.continuityRatio < 0.6
    }
  ];

  console.log('条件                                    | 亏损召回 | 盈利误伤 | F1分数');
  console.log('----------------------------------------|---------|---------|--------');

  conditions.forEach(condition => {
    const lossRejected = lossTokens.filter(condition.test).length;
    const lossRecall = lossTokens.length > 0 ? lossRejected / lossTokens.length : 0;

    const profitRejected = profitTokens.filter(condition.test).length;
    const profitPrecision = profitTokens.length > 0 ? 1 - (profitRejected / profitTokens.length) : 1;

    const f1 = (lossRecall + profitPrecision > 0) ? (2 * lossRecall * profitPrecision) / (lossRecall + profitPrecision) : 0;

    console.log(`${condition.name.padEnd(39)} | ${(lossRecall * 100).toFixed(1).padStart(7)}% | ${profitRejected}/${profitTokens.length} | ${f1.toFixed(3)}`);
  });

  // 显示典型例子
  console.log('\n【典型例子】\n');

  console.log('空洞最多的前5个亏损代币:');
  console.log('代币        | 收益率 | 交易数 | 总空洞 | 空洞占比 | 连续性');
  console.log('------------|--------|--------|--------|---------|--------');

  lossTokens.sort((a, b) => b.gapRatio - a.gapRatio).slice(0, 5).forEach(token => {
    console.log(`${token.symbol.substring(0, 11).padEnd(11)} | ${token.profitPercent.toFixed(1).padStart(6)}% | ${token.tradesCount.toString().padStart(6)} | ${token.totalGap.toString().padStart(6)} | ${(token.gapRatio * 100).toFixed(1).padStart(6)}% | ${(token.continuityRatio * 100).toFixed(1).padStart(6)}%`);
  });

  console.log('\n空洞最少的前5个盈利代币:');
  console.log('代币        | 收益率 | 交易数 | 总空洞 | 空洞占比 | 连续性');
  console.log('------------|--------|--------|--------|---------|--------');

  profitTokens.sort((a, b) => a.gapRatio - b.gapRatio).slice(0, 5).forEach(token => {
    console.log(`${token.symbol.substring(0, 11).padEnd(11)} | +${token.profitPercent.toFixed(1).padStart(5)}% | ${token.tradesCount.toString().padStart(6)} | ${token.totalGap.toString().padStart(6)} | ${(token.gapRatio * 100).toFixed(1).padStart(6)}% | ${(token.continuityRatio * 100).toFixed(1).padStart(6)}%`);
  });

  // 测试与聚簇条件的组合
  console.log('\n=== 测试与聚簇条件的组合 ===\n');

  console.log('条件                                          | 亏损召回 | 盈利误伤 | F1分数');
  console.log('----------------------------------------------|---------|---------|--------');

  const combinedConditions = [
    {
      name: '仅聚簇: 簇数>=3 && Top2>0.85',
      test: t => {
        // 需要计算聚簇因子
        return false;  // 暂时跳过
      }
    },
    {
      name: '仅空洞: gapRatio>0.4',
      test: t => t.gapRatio > 0.4
    },
    {
      name: '仅连续: continuity<0.6',
      test: t => t.continuityRatio < 0.6
    },
    {
      name: '聚簇 OR 空洞',
      test: t => t.gapRatio > 0.4 || t.continuityRatio < 0.6
    }
  ];

  // 测试组合条件
  const clusterCondition = t => {
    // 这里简化处理，实际需要重新计算聚簇因子
    // 暂时只测试空洞条件
    return false;
  };

  // 只测试空洞相关的组合
  const gapOnlyConditions = [
    {
      name: '仅空洞: gapRatio>0.4',
      test: t => t.gapRatio > 0.4
    },
    {
      name: '仅连续: continuity<0.6',
      test: t => t.continuityRatio < 0.6
    },
    {
      name: '组合: gapRatio>0.4 OR continuity<0.6',
      test: t => t.gapRatio > 0.4 || t.continuityRatio < 0.6
    },
    {
      name: '组合: gapRatio>0.4 AND continuity<0.6',
      test: t => t.gapRatio > 0.4 && t.continuityRatio < 0.6
    }
  ];

  gapOnlyConditions.forEach(condition => {
    const lossRejected = lossTokens.filter(condition.test).length;
    const lossRecall = lossTokens.length > 0 ? lossRejected / lossTokens.length : 0;

    const profitRejected = profitTokens.filter(condition.test).length;
    const profitPrecision = profitTokens.length > 0 ? 1 - (profitRejected / profitTokens.length) : 1;

    const f1 = (lossRecall + profitPrecision > 0) ? (2 * lossRecall * profitPrecision) / (lossRecall + profitPrecision) : 0;

    console.log(`${condition.name.padEnd(42)} | ${(lossRecall * 100).toFixed(1).padStart(7)}% | ${profitRejected}/${profitTokens.length} | ${f1.toFixed(3)}`);
  });

  // 推荐因子
  console.log('\n=== 推荐的新因子 ===\n');

  console.log('因子名称: walletBlockGapRatio（区块空洞占比）');
  console.log('定义: (总区块空洞数) / (实际跨越区块数)');
  console.log('推荐阈值: > 0.4 (40%)');
  console.log('');
  console.log('因子名称: walletBlockContinuity（区块连续性）');
  console.log('定义: (连续区块交易数) / (总交易数-1)');
  console.log('推荐阈值: < 0.6 (60%)');
  console.log('');
  console.log('说明:');
  console.log('- 空洞占比高 = 区块不连续，可能是刷单操控');
  console.log('- 连续性低 = 交易分散，不是自然的市场需求');
}

analyzeBlockGaps().catch(console.error);
