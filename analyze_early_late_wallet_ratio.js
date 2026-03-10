/**
 * 扩大测试范围：分析早期/晚期钱包比指标
 * 测试两个实验中所有有交易的代币
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
 * 计算早期/晚期钱包比等指标
 */
function analyzeWalletPattern(trades, checkTime) {
  if (!trades || trades.length === 0) {
    return {
      totalWallets: 0,
      earlyWalletCount: 0,
      middleWalletCount: 0,
      lateWalletCount: 0,
      earlyToLateRatio: 0,
      earlyWalletRatio: 0,
      earlyWhalesCount: 0,
      earlyConcentration: 0
    };
  }

  try {
    const windowStart = checkTime - 90;

    // 按钱包分组
    const walletMap = new Map();

    trades.forEach(trade => {
      const wallet = trade.from_address?.toLowerCase();
      if (!wallet) return;

      if (!walletMap.has(wallet)) {
        walletMap.set(wallet, {
          wallet,
          entryTime: trade.time - windowStart,
          totalBuyAmount: 0,
          totalSellAmount: 0
        });
      }

      const w = walletMap.get(wallet);
      w.totalBuyAmount += trade.from_usd || 0;
      w.totalSellAmount += trade.to_usd || 0;
    });

    const wallets = Array.from(walletMap.values());

    // 按入场时间分类
    const earlyWallets = wallets.filter(w => w.entryTime < 15);      // 前15秒
    const middleWallets = wallets.filter(w => w.entryTime >= 15 && w.entryTime < 30);  // 15-30秒
    const lateWallets = wallets.filter(w => w.entryTime >= 30);      // 30秒后

    const earlyWalletCount = earlyWallets.length;
    const middleWalletCount = middleWallets.length;
    const lateWalletCount = lateWallets.length;
    const totalWallets = wallets.length;

    // 早期/晚期比
    const earlyToLateRatio = lateWalletCount > 0 ? earlyWalletCount / lateWalletCount : (earlyWalletCount > 0 ? earlyWalletCount : 0);

    // 早期钱包占比
    const earlyWalletRatio = totalWallets > 0 ? earlyWalletCount / totalWallets : 0;

    // 早期大户（前15秒且买入>$200）
    const earlyWhales = earlyWallets.filter(w => w.totalBuyAmount > 200);
    const earlyWhalesCount = earlyWhales.length;

    // 早期集中度（前3个早期钱包的买入金额占比）
    const top3EarlyWallets = earlyWallets
      .sort((a, b) => b.totalBuyAmount - a.totalBuyAmount)
      .slice(0, 3);

    const top3Amount = top3EarlyWallets.reduce((sum, w) => sum + w.totalBuyAmount, 0);
    const totalEarlyAmount = earlyWallets.reduce((sum, w) => sum + w.totalBuyAmount, 0);
    const earlyConcentration = totalEarlyAmount > 0 ? top3Amount / totalEarlyAmount : 0;

    return {
      totalWallets,
      earlyWalletCount,
      middleWalletCount,
      lateWalletCount,
      earlyToLateRatio,
      earlyWalletRatio,
      earlyWhalesCount,
      earlyConcentration
    };
  } catch (error) {
    console.error('Error in analyzeWalletPattern:', error.message);
    return {
      totalWallets: 0,
      earlyWalletCount: 0,
      middleWalletCount: 0,
      lateWalletCount: 0,
      earlyToLateRatio: 0,
      earlyWalletRatio: 0,
      earlyWhalesCount: 0,
      earlyConcentration: 0
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

async function analyzeEarlyLateRatio() {
  console.log('=== 扩大测试范围：早期/晚期钱包比分析 ===\n');

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

  console.log(`\n总共: ${allTokens.length} 个代币\n`);

  // 计算因子
  const tokensWithFactors = [];

  for (let i = 0; i < allTokens.length; i++) {
    const token = allTokens[i];

    const trades = await fetchTokenTrades(token.tokenAddress, token.checkTime);

    if (trades && trades.length > 0) {
      const factors = analyzeWalletPattern(trades, token.checkTime);
      tokensWithFactors.push({
        ...token,
        tradesCount: trades.length,
        ...factors
      });
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
  const unknownTokens = tokensWithFactors.filter(t => t.profitPercent === null);

  console.log('【数据分布】');
  console.log(`总代币数: ${tokensWithFactors.length}`);
  console.log(`  亏损代币: ${lossTokens.length}`);
  console.log(`  盈利代币: ${profitTokens.length}`);
  console.log(`  未知收益: ${unknownTokens.length}\n`);

  // 对比分析
  console.log('=== 对比分析：亏损代币 vs 盈利代币 ===\n');

  const avg = (arr, fn) => arr.length > 0 ? arr.reduce((sum, t) => sum + fn(t), 0) / arr.length : 0;

  console.log('指标                    | 亏损代币平均 | 盈利代币平均 | 差异');
  console.log('------------------------|-------------|-------------|------');
  console.log(`早期钱包数              | ${avg(lossTokens, t => t.earlyWalletCount).toFixed(1)}          | ${avg(profitTokens, t => t.earlyWalletCount).toFixed(1)}          | ${(avg(profitTokens, t => t.earlyWalletCount) - avg(lossTokens, t => t.earlyWalletCount)).toFixed(1)}`);
  console.log(`中期钱包数              | ${avg(lossTokens, t => t.middleWalletCount).toFixed(1)}          | ${avg(profitTokens, t => t.middleWalletCount).toFixed(1)}          | ${(avg(profitTokens, t => t.middleWalletCount) - avg(lossTokens, t => t.middleWalletCount)).toFixed(1)}`);
  console.log(`晚期钱包数              | ${avg(lossTokens, t => t.lateWalletCount).toFixed(1)}          | ${avg(profitTokens, t => t.lateWalletCount).toFixed(1)}          | ${(avg(profitTokens, t => t.lateWalletCount) - avg(lossTokens, t => t.lateWalletCount)).toFixed(1)}`);
  console.log(`早期/晚期比             | ${avg(lossTokens, t => t.earlyToLateRatio).toFixed(3)}       | ${avg(profitTokens, t => t.earlyToLateRatio).toFixed(3)}       | ${(avg(profitTokens, t => t.earlyToLateRatio) - avg(lossTokens, t => t.earlyToLateRatio)).toFixed(3)}`);
  console.log(`早期钱包占比            | ${(avg(lossTokens, t => t.earlyWalletRatio) * 100).toFixed(1)}%        | ${(avg(profitTokens, t => t.earlyWalletRatio) * 100).toFixed(1)}%        | ${((avg(profitTokens, t => t.earlyWalletRatio) - avg(lossTokens, t => t.earlyWalletRatio)) * 100).toFixed(1)}%`);
  console.log(`早期大户数              | ${avg(lossTokens, t => t.earlyWhalesCount).toFixed(1)}          | ${avg(profitTokens, t => t.earlyWhalesCount).toFixed(1)}          | ${(avg(profitTokens, t => t.earlyWhalesCount) - avg(lossTokens, t => t.earlyWhalesCount)).toFixed(1)}`);
  console.log(`早期集中度              | ${(avg(lossTokens, t => t.earlyConcentration) * 100).toFixed(1)}%        | ${(avg(profitTokens, t => t.earlyConcentration) * 100).toFixed(1)}%        | ${((avg(profitTokens, t => t.earlyConcentration) - avg(lossTokens, t => t.earlyConcentration)) * 100).toFixed(1)}%`);
  console.log(`总钱包数                | ${avg(lossTokens, t => t.totalWallets).toFixed(1)}          | ${avg(profitTokens, t => t.totalWallets).toFixed(1)}          | ${(avg(profitTokens, t => t.totalWallets) - avg(lossTokens, t => t.totalWallets)).toFixed(1)}`);

  // 测试不同条件
  console.log('\n=== 测试不同条件 ===\n');

  const conditions = [
    {
      name: 'earlyWalletCount < 2',
      desc: '早期钱包数 < 2',
      test: t => t.earlyWalletCount < 2
    },
    {
      name: 'earlyWalletCount < 3',
      desc: '早期钱包数 < 3',
      test: t => t.earlyWalletCount < 3
    },
    {
      name: 'earlyWalletCount < 4',
      desc: '早期钱包数 < 4',
      test: t => t.earlyWalletCount < 4
    },
    {
      name: 'earlyWalletCount < 5',
      desc: '早期钱包数 < 5',
      test: t => t.earlyWalletCount < 5
    },
    {
      name: 'earlyToLateRatio < 0.05',
      desc: '早期/晚期比 < 0.05',
      test: t => t.earlyToLateRatio < 0.05
    },
    {
      name: 'earlyToLateRatio < 0.1',
      desc: '早期/晚期比 < 0.1',
      test: t => t.earlyToLateRatio < 0.1
    },
    {
      name: 'earlyToLateRatio < 0.15',
      desc: '早期/晚期比 < 0.15',
      test: t => t.earlyToLateRatio < 0.15
    },
    {
      name: 'earlyWalletRatio < 0.1',
      desc: '早期钱包占比 < 10%',
      test: t => t.earlyWalletRatio < 0.1
    },
    {
      name: 'earlyWalletRatio < 0.15',
      desc: '早期钱包占比 < 15%',
      test: t => t.earlyWalletRatio < 0.15
    },
    {
      name: 'earlyWalletRatio < 0.2',
      desc: '早期钱包占比 < 20%',
      test: t => t.earlyWalletRatio < 0.2
    },
    {
      name: '组合: early<3 OR ratio<0.1',
      desc: '早期钱包<3 或 早期/晚期比<0.1',
      test: t => t.earlyWalletCount < 3 || t.earlyToLateRatio < 0.1
    },
    {
      name: '组合: early<2 OR ratio<0.05',
      desc: '早期钱包<2 或 早期/晚期比<0.05',
      test: t => t.earlyWalletCount < 2 || t.earlyToLateRatio < 0.05
    },
    {
      name: '组合: early<3 AND late>20',
      desc: '早期钱包<3 且 晚期钱包>20',
      test: t => t.earlyWalletCount < 3 && t.lateWalletCount > 20
    },
    {
      name: '组合: ratio<0.05 AND late>15',
      desc: '早期/晚期比<0.05 且 晚期钱包>15',
      test: t => t.earlyToLateRatio < 0.05 && t.lateWalletCount > 15
    }
  ];

  console.log('条件                              | 亏损召回 | 盈利误伤 | F1分数 | 净避免收益');
  console.log('----------------------------------|---------|---------|--------|----------');

  conditions.forEach(condition => {
    const lossRejected = lossTokens.filter(condition.test);
    const lossRecall = lossTokens.length > 0 ? lossRejected.length / lossTokens.length : 0;

    const profitRejected = profitTokens.filter(condition.test);
    const profitPrecision = profitTokens.length > 0 ? 1 - (profitRejected.length / profitTokens.length) : 1;

    const f1 = (lossRecall + profitPrecision > 0) ? (2 * lossRecall * profitPrecision) / (lossRecall + profitPrecision) : 0;

    // 计算净避免收益（避免的亏损 - 误伤的盈利）
    const avoidedLoss = lossRejected.reduce((sum, t) => sum + t.profitPercent, 0);
    const missedProfit = profitRejected.reduce((sum, t) => sum + t.profitPercent, 0);
    const netAvoided = avoidedLoss - missedProfit;

    console.log(`${condition.desc.padEnd(33)} | ${(lossRecall * 100).toFixed(1).padStart(7)}% | ${profitRejected.length}/${profitTokens.length} | ${f1.toFixed(3)} | ${netAvoided > 0 ? '+' : ''}${netAvoided.toFixed(1)}%`);
  });

  // 显示典型被拒绝的亏损代币
  console.log('\n=== 最佳条件详细分析 ===\n');

  const bestCondition = conditions.find(c => c.name === 'earlyWalletCount < 3');
  const lossRejected = lossTokens.filter(bestCondition.test);
  const profitRejected = profitTokens.filter(bestCondition.test);

  console.log(`【条件: ${bestCondition.desc}】`);
  console.log(`  亏损召回: ${lossRejected.length}/${lossTokens.length} (${(lossRejected.length / lossTokens.length * 100).toFixed(1)}%)`);
  console.log(`  盈利误伤: ${profitRejected.length}/${profitTokens.length} (${(profitRejected.length / profitTokens.length * 100).toFixed(1)}%)`);
  console.log(`  净避免收益: ${(lossRejected.reduce((sum, t) => sum + t.profitPercent, 0) - profitRejected.reduce((sum, t) => sum + t.profitPercent, 0)).toFixed(1)}%\n`);

  console.log('被拒绝的亏损代币（避免的损失）：');
  console.log('代币        | 收益率  | 早期 | 中期 | 晚期 | 早期/晚期 | 早期占比');
  console.log('------------|---------|------|------|------|----------|----------');
  lossRejected.sort((a, b) => a.profitPercent - b.profitPercent).slice(0, 10).forEach(t => {
    console.log(`${t.symbol.substring(0, 11).padEnd(11)} | ${t.profitPercent.toFixed(1).padStart(6)}% | ${t.earlyWalletCount.toString().padStart(4)} | ${t.middleWalletCount.toString().padStart(4)} | ${t.lateWalletCount.toString().padStart(4)} | ${t.earlyToLateRatio.toFixed(3).padStart(8)} | ${(t.earlyWalletRatio * 100).toFixed(1).padStart(6)}%`);
  });

  if (profitRejected.length > 0) {
    console.log('\n被拒绝的盈利代币（误伤）：');
    console.log('代币        | 收益率  | 早期 | 中期 | 晚期 | 早期/晚期 | 早期占比');
    console.log('------------|---------|------|------|------|----------|----------');
    profitRejected.sort((a, b) => b.profitPercent - a.profitPercent).forEach(t => {
      console.log(`${t.symbol.substring(0, 11).padEnd(11)} | +${t.profitPercent.toFixed(1).padStart(5)}% | ${t.earlyWalletCount.toString().padStart(4)} | ${t.middleWalletCount.toString().padStart(4)} | ${t.lateWalletCount.toString().padStart(4)} | ${t.earlyToLateRatio.toFixed(3).padStart(8)} | ${(t.earlyWalletRatio * 100).toFixed(1).padStart(6)}%`);
    });
  } else {
    console.log('\n✓ 无盈利代币误伤！');
  }

  // 未被拒绝的亏损代币（漏网之鱼）
  const lossMissed = lossTokens.filter(t => !bestCondition.test(t));
  if (lossMissed.length > 0) {
    console.log('\n未被拒绝的亏损代币（漏网之鱼）：');
    console.log('代币        | 收益率  | 早期 | 中期 | 晚期 | 早期/晚期 | 早期占比');
    console.log('------------|---------|------|------|------|----------|----------');
    lossMissed.sort((a, b) => a.profitPercent - b.profitPercent).slice(0, 10).forEach(t => {
      console.log(`${t.symbol.substring(0, 11).padEnd(11)} | ${t.profitPercent.toFixed(1).padStart(6)}% | ${t.earlyWalletCount.toString().padStart(4)} | ${t.middleWalletCount.toString().padStart(4)} | ${t.lateWalletCount.toString().padStart(4)} | ${t.earlyToLateRatio.toFixed(3).padStart(8)} | ${(t.earlyWalletRatio * 100).toFixed(1).padStart(6)}%`);
    });
  }

  // 推荐因子
  console.log('\n=== 推荐的新因子 ===\n');

  console.log('因子名称: walletEarlyWalletCount（早期钱包数量）');
  console.log('定义: 前15秒内入场的独立钱包地址数');
  console.log('推荐阈值: < 3');
  console.log('说明: 早期钱包数太少说明缺乏自然参与者\n');

  console.log('因子名称: walletEarlyToLateRatio（早期/晚期钱包比）');
  console.log('定义: (前15秒入场的钱包数) / (30秒后入场的钱包数)');
  console.log('推荐阈值: < 0.1');
  console.log('说明: 比值过低说明早期缺乏自然参与者，后期全是跟单散户\n');

  console.log('因子名称: walletEarlyWalletRatio（早期钱包占比）');
  console.log('定义: (前15秒入场的钱包数) / (总钱包数)');
  console.log('推荐阈值: < 0.15 (15%)');
  console.log('说明: 早期钱包占比过低说明交易不自然\n');

  console.log('推荐使用条件: walletEarlyWalletCount < 3');
  console.log('  - 召回率: ~' + (lossRejected.length / lossTokens.length * 100).toFixed(1) + '%');
  console.log('  - 误伤率: ~' + (profitRejected.length / profitTokens.length * 100).toFixed(1) + '%');
}

analyzeEarlyLateRatio().catch(console.error);
