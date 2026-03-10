/**
 * 深度分析"聪明钱包+跟单钱包"拉砸模式
 * 重点分析钱包进入时机、交易模式、持仓时间等特征
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

const missedPumpTokens = [
  '0xb9b1142a28fade5771b7ae076c96c3bee8beffff',
  '0xf3372a3dbc824f0b0044ca77209559514b294444',
  '0x5850bbdd3fd65a4d7c23623ffc7c3f041d954444',
  '0x6df5fd6949f2527ee99ce7c979c00f2a5bd34444',
  '0xd8d4ddeb91987a121422567260a88230dbb34444',
  '0x9b58b98a1ea58d59ffaaa9f1d2e5fd4168444444',
  '0x0x71c06c7064c5aaf398f6f956d8146ad0e0e84444',  // 修复前缀
  '0xd3b4d55ef44da2fee0e78e478d2fe94751514444'
];

// 盈利代币对照组
const profitableTokens = [
  '0x16aeb87aeb78e4cf7987f16e910c285d77354444',  // +147.8%
  '0xa9fe96fd5230a135ada220523032b3e1a67d4444',  // +96.2%
  '0xd7a23f95c6698c44c7b861408f0d7b47acc74444',   // +20.3%
  '0xbe4f098bf8e2790cd0ee613965d1af143cd24444',  // +55.0%
  '0x30d31d28ee0a47e0d6bfae215b6cd3b72144444'   // +57.9%
];

async function getSignalForToken(tokenAddress) {
  const experiments = ['6b17ff18-002d-4ce0-a745-b8e02676abd4', '1dde2be5-2f4e-49fb-9520-cb032e9ef759'];

  for (const expId of experiments) {
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
 * 深度分析钱包行为 - 寻找"聪明钱包+跟单钱包"模式
 */
function analyzeSmartWalletPatternCore(trades, checkTime) {
  if (!trades || trades.length === 0) {
    return null;
  }

  // 默认返回值
  const defaultResult = {
    totalWallets: 0,
    earlyWhales: 0,
    earlyWhalesAmount: 0,
    potentialCopyTraders: 0,
    earlyToLateRatio: 0,
    earlyConcentration: 0,
    smartMoneyQuickSellCount: 0,
    avgHoldTime: 0,
    shortHoldCount: 0,
    longHoldCount: 0,
    earlyVsLateAmount: 0,
    top3EarlyWallets: [],
    priceImpactAnalysis: [],
    entryBatches: []
  };

  try {
    const windowStart = checkTime - 90;

    // 1. 按钱包分组，详细分析每个钱包的行为
    const walletMap = new Map();

    trades.forEach(trade => {
      const wallet = trade.from_address?.toLowerCase();
      if (!wallet) return;

      if (!walletMap.has(wallet)) {
        walletMap.set(wallet, {
          wallet,
          trades: [],
          entryTime: trade.time - windowStart,
          exitTime: trade.time - windowStart,
          totalBuyAmount: 0,
          totalSellAmount: 0,
          firstBlock: trade.block_number,
          lastBlock: trade.block_number
        });
      }

      const w = walletMap.get(wallet);
      w.trades.push(trade);
      w.totalBuyAmount += trade.from_usd || 0;
      w.totalSellAmount += trade.to_usd || 0;
      w.lastTime = trade.time - windowStart;
      w.lastBlock = trade.block_number;
    });

    const wallets = Array.from(walletMap.values());

    if (wallets.length === 0) {
      return defaultResult;
    }

    // 2. 按入场时间排序
    wallets.sort((a, b) => a.entryTime - b.entryTime);

    // 3. 分析"聪明钱包"特征
    // 定义：早期入场（前15秒）、大额买入（>$200）、卖出后价格下跌
    const earlyWhales = wallets.filter(w =>
      w.entryTime < 15 &&
      w.totalBuyAmount > 200 &&
      w.totalSellAmount > 0  // 有卖出行为
    );

    // 4. 分析"跟单钱包"特征
    const potentialCopyTraders = [];

    if (earlyWhales.length > 0) {
      wallets.forEach(w => {
        if (w.entryTime >= 15) {
          for (const whale of earlyWhales) {
            const timeGap = w.entryTime - whale.entryTime;
            const whaleExitTime = whale.lastTime || whale.entryTime;

            if (timeGap >= 0 && timeGap <= 20 && w.totalBuyAmount < whale.totalBuyAmount * 0.5) {
              potentialCopyTraders.push({
                wallet: w.wallet,
                followWhale: whale.wallet,
                entryTimeGap: timeGap,
                whaleAmount: whale.totalBuyAmount,
                followerAmount: w.totalBuyAmount,
                didWhaleExitFirst: w.entryTime > whaleExitTime
              });
              break;
            }
          }
        }
      });
    }

    // 5. 分析价格走势（基于买卖比例）
    const priceImpactAnalysis = [];

    for (let t = 5; t <= 90; t += 5) {
      const windowTrades = trades.filter(tr => {
        const relTime = tr.time - windowStart;
        return relTime >= t - 5 && relTime < t;
      });

      if (windowTrades.length > 0) {
        const buyAmount = windowTrades.reduce((sum, t) => sum + (t.from_usd || 0), 0);
        const sellAmount = windowTrades.reduce((sum, t) => sum + (t.to_usd || 0), 0);
        const sellBuyRatio = buyAmount > 0 ? sellAmount / buyAmount : 0;

        priceImpactAnalysis.push({
          time: t,
          buyAmount,
          sellAmount,
          sellBuyRatio
        });
      }
    }

    // 6. 计算关键指标
    const earlyWalletCount = wallets.filter(w => w.entryTime < 15).length;
    const lateWalletCount = wallets.filter(w => w.entryTime >= 30).length;
    const earlyToLateRatio = lateWalletCount > 0 ? earlyWalletCount / lateWalletCount : earlyWalletCount;

    // 7. 计算聪明钱包的集中度（前3个早期钱包的买入金额占比）
    const top3EarlyWallets = wallets
      .filter(w => w.entryTime < 15)
      .sort((a, b) => b.totalBuyAmount - a.totalBuyAmount)
      .slice(0, 3);

    const top3Concentration = top3EarlyWallets.reduce((sum, w) => sum + w.totalBuyAmount, 0);
    const totalEarlyBuy = wallets.filter(w => w.entryTime < 15).reduce((sum, w) => sum + w.totalBuyAmount, 0);
    const earlyConcentration = totalEarlyBuy > 0 ? top3Concentration / totalEarlyBuy : 0;

    // 8. 检测"聪明钱包快速卖出"模式
    const smartMoneyQuickSellCount = earlyWhales.filter(w => {
      const holdTime = w.lastTime - w.entryTime;
      return holdTime < 30 && w.totalSellAmount > 0;
    }).length;

    // 9. 计算钱包持仓时间分布
    const holdTimes = wallets
      .filter(w => w.totalSellAmount > 0)
      .map(w => w.lastTime - w.entryTime);

    const avgHoldTime = holdTimes.length > 0
      ? holdTimes.reduce((sum, t) => sum + t, 0) / holdTimes.length
      : 0;

    const shortHoldCount = holdTimes.filter(t => t < 20).length;
    const longHoldCount = holdTimes.filter(t => t >= 60).length;

    // 10. 检测"分层入场"模式
    const entryBatches = [];

    for (let t = 0; t < 90; t += 15) {
      const walletsInWindow = wallets.filter(w => w.entryTime >= t && w.entryTime < t + 15);
      if (walletsInWindow.length > 0) {
        const avgAmount = walletsInWindow.reduce((sum, w) => sum + w.totalBuyAmount, 0) / walletsInWindow.length;
        entryBatches.push({
          start: t,
          end: t + 15,
          count: walletsInWindow.length,
          avgAmount
        });
      }
    }

    const earlyAvgAmount = entryBatches.slice(0, 2).reduce((sum, b) => sum + b.avgAmount, 0) / Math.min(entryBatches.length, 2);
    const lateAvgAmount = entryBatches.slice(3).reduce((sum, b) => sum + b.avgAmount, 0) / Math.max(entryBatches.length - 3, 1);
    const earlyVsLateAmount = lateAvgAmount > 0 ? earlyAvgAmount / lateAvgAmount : 0;

    return {
      totalWallets: wallets.length,
      earlyWhales: earlyWhales.length,
      earlyWhalesAmount: earlyWhales.reduce((sum, w) => sum + w.totalBuyAmount, 0),
      potentialCopyTraders: potentialCopyTraders.length,
      earlyToLateRatio,
      earlyConcentration,
      smartMoneyQuickSellCount,
      avgHoldTime,
      shortHoldCount,
      longHoldCount,
      earlyVsLateAmount,
      top3EarlyWallets: top3EarlyWallets.map(w => ({
        wallet: w.wallet.substring(0, 8),
        amount: w.totalBuyAmount.toFixed(0),
        entryTime: w.entryTime.toFixed(1),
        sellAmount: w.totalSellAmount.toFixed(0),
        holdTime: (w.lastTime - w.entryTime).toFixed(1)
      })),
      priceImpactAnalysis,
      entryBatches
    };
  } catch (error) {
    console.error('Error in analyzeSmartWalletPattern:', error.message);
    console.error(error.stack);
    return defaultResult;
  }
}

async function analyzeSmartWalletPattern() {
  console.log('=== 深度分析：聪明钱包+跟单钱包模式 ===\n');
  console.log('重点寻找: 早期大户入场 + 后续跟单 + 大户快速卖出导致价格崩盘\n');

  const results = [];

  // 分析拉砸代币
  for (let i = 0; i < missedPumpTokens.length; i++) {
    const tokenAddress = missedPumpTokens[i].replace('0x0x', '0x');
    console.log(`[${i + 1}/${missedPumpTokens.length}] 分析拉砸代币 ${tokenAddress}...`);

    const signal = await getSignalForToken(tokenAddress);
    if (!signal) {
      console.log(`  跳过: 未找到信号\n`);
      continue;
    }

    const factors = signal.metadata?.preBuyCheckFactors;
    const checkTime = factors?.earlyTradesCheckTime;
    const symbol = signal.metadata?.symbol || tokenAddress.substring(0, 8);

    if (!checkTime) {
      console.log(`  跳过: 未找到checkTime\n`);
      continue;
    }

    const trades = await fetchTokenTrades(tokenAddress, checkTime);
    if (!trades || trades.length === 0) {
      console.log(`  跳过: 未找到交易\n`);
      continue;
    }

    const smartWalletPattern = analyzeSmartWalletPatternCore(trades, checkTime);

    if (!smartWalletPattern) {
      console.log(`  跳过: 分析失败\n`);
      continue;
    }

    const { data: sellTrade } = await supabase
      .from('trades')
      .select('metadata')
      .eq('token_address', tokenAddress)
      .eq('trade_direction', 'sell')
      .limit(1);

    const profitPercent = sellTrade?.[0]?.metadata?.profitPercent || null;

    results.push({
      symbol,
      tokenAddress,
      profitPercent,
      tradesCount: trades.length,
      smartWalletPattern,
      existingFactors: {
        clusterCount: factors?.walletClusterCount,
        top2Ratio: factors?.walletClusterTop2Ratio,
        megaRatio: factors?.walletClusterMegaRatio
      }
    });

    console.log(`  完成: ${symbol}, ${trades.length}笔交易, 早期大户=${smartWalletPattern.earlyWhales}个, 跟单钱包=${smartWalletPattern.potentialCopyTraders}个\n`);
  }

  // 分析盈利代币作为对比
  console.log('\n【对比：盈利代币】\n');

  for (let i = 0; i < profitableTokens.length; i++) {
    const tokenAddress = profitableTokens[i];
    console.log(`[${i + 1}/${profitableTokens.length}] 分析盈利代币 ${tokenAddress}...`);

    const signal = await getSignalForToken(tokenAddress);
    if (!signal) {
      console.log(`  跳过\n`);
      continue;
    }

    const factors = signal.metadata?.preBuyCheckFactors;
    const checkTime = factors?.earlyTradesCheckTime;
    const symbol = signal.metadata?.symbol || tokenAddress.substring(0, 8);

    if (!checkTime) {
      console.log(`  跳过\n`);
      continue;
    }

    const trades = await fetchTokenTrades(tokenAddress, checkTime);
    if (!trades || trades.length === 0) {
      console.log(`  跳过: 未找到交易\n`);
      continue;
    }

    const smartWalletPattern = analyzeSmartWalletPatternCore(trades, checkTime);

    if (!smartWalletPattern) {
      console.log(`  跳过: 分析失败\n`);
      continue;
    }

    const { data: sellTrade } = await supabase
      .from('trades')
      .select('metadata')
      .eq('token_address', tokenAddress)
      .eq('trade_direction', 'sell')
      .limit(1);

    const profitPercent = sellTrade?.[0]?.metadata?.profitPercent || null;

    results.push({
      symbol,
      tokenAddress,
      profitPercent,
      tradesCount: trades.length,
      smartWalletPattern,
      existingFactors: {
        clusterCount: factors?.walletClusterCount,
        top2Ratio: factors?.walletClusterTop2Ratio,
        megaRatio: factors?.walletClusterMegaRatio
      },
      type: 'profit'
    });

    console.log(`  完成: ${symbol}, ${trades.length}笔交易\n`);
  }

  // 输出对比分析
  console.log('\n=== 对比分析：拉砸代币 vs 盈利代币 ===\n');

  console.log('类型 | 代币        | 收益率  | 早期大户 | 跟单钱包 | 早期/晚期 | 早期集中 | 快速卖出 | 平均持仓 | 大户vs散户');
  console.log('-----|------------|---------|----------|----------|----------|----------|----------|----------|----------');

  results.forEach(r => {
    if (!r.smartWalletPattern) return;

    const typeLabel = r.type === 'profit' ? '盈利' : '拉砸';
    const profit = r.profitPercent !== null ? r.profitPercent.toFixed(1) + '%' : 'N/A';
    const sp = r.smartWalletPattern;

    console.log(`${typeLabel.padEnd(4)} | ${r.symbol.substring(0, 11).padEnd(11)} | ${profit.padStart(7)} | ${sp.earlyWhales.toString().padStart(8)} | ${sp.potentialCopyTraders.toString().padStart(8)} | ${sp.earlyToLateRatio.toFixed(2).padStart(8)} | ${(sp.earlyConcentration * 100).toFixed(0).padStart(7)}% | ${sp.smartMoneyQuickSellCount.toString().padStart(8)} | ${sp.avgHoldTime.toFixed(1).padStart(8)} | ${sp.earlyVsLateAmount.toFixed(1).padStart(8)}`);
  });

  // 统计分析
  console.log('\n=== 统计分析 ===\n');

  const pumpResults = results.filter(r => r.type !== 'profit');
  const profitResults = results.filter(r => r.type === 'profit');

  const avg = (arr, fn) => arr.length > 0 ? arr.reduce((sum, r) => sum + fn(r), 0) / arr.length : 0;

  console.log('【早期大户数量】');
  console.log(`拉砸代币平均: ${avg(pumpResults, r => r.smartWalletPattern.earlyWhales).toFixed(1)}`);
  console.log(`盈利代币平均: ${avg(profitResults, r => r.smartWalletPattern.earlyWhales).toFixed(1)}`);

  console.log('\n【跟单钱包数量】');
  console.log(`拉砸代币平均: ${avg(pumpResults, r => r.smartWalletPattern.potentialCopyTraders).toFixed(1)}`);
  console.log(`盈利代币平均: ${avg(profitResults, r => r.smartWalletPattern.potentialCopyTraders).toFixed(1)}`);

  console.log('\n【早期/晚期钱包比】');
  console.log(`拉砸代币平均: ${avg(pumpResults, r => r.smartWalletPattern.earlyToLateRatio).toFixed(2)}`);
  console.log(`盈利代币平均: ${avg(profitResults, r => r.smartWalletPattern.earlyToLateRatio).toFixed(2)}`);

  console.log('\n【早期集中度（前3大户占比）】');
  console.log(`拉砸代币平均: ${(avg(pumpResults, r => r.smartWalletPattern.earlyConcentration) * 100).toFixed(1)}%`);
  console.log(`盈利代币平均: ${(avg(profitResults, r => r.smartWalletPattern.earlyConcentration) * 100).toFixed(1)}%`);

  console.log('\n【大户快速卖出数量】');
  console.log(`拉砸代币平均: ${avg(pumpResults, r => r.smartWalletPattern.smartMoneyQuickSellCount).toFixed(1)}`);
  console.log(`盈利代币平均: ${avg(profitResults, r => r.smartWalletPattern.smartMoneyQuickSellCount).toFixed(1)}`);

  console.log('\n【大户vs散户买入金额比】');
  console.log(`拉砸代币平均: ${avg(pumpResults, r => r.smartWalletPattern.earlyVsLateAmount).toFixed(2)}`);
  console.log(`盈利代币平均: ${avg(profitResults, r => r.smartWalletPattern.earlyVsLateAmount).toFixed(2)}`);

  // 详细分析典型拉砸代币
  console.log('\n=== 典型拉砸代币详细分析 ===\n');

  const worstPumpTokens = pumpResults
    .filter(r => r.profitPercent !== null && r.profitPercent < -20)
    .sort((a, b) => a.profitPercent - b.profitPercent)
    .slice(0, 3);

  worstPumpTokens.forEach(token => {
    console.log(`【${token.symbol}】收益率: ${token.profitPercent.toFixed(1)}%`);
    console.log(`现有因子: 簇数=${token.existingFactors.clusterCount}, Top2=${((token.existingFactors.top2Ratio || 0) * 100).toFixed(1)}%, Mega=${((token.existingFactors.megaRatio || 0) * 100).toFixed(1)}%`);
    console.log('');
    console.log('聪明钱包分析:');
    console.log(`  早期大户: ${token.smartWalletPattern.earlyWhales}个`);
    console.log(`  跟单钱包: ${token.smartWalletPattern.potentialCopyTraders}个`);
    console.log(`  早期/晚期比: ${token.smartWalletPattern.earlyToLateRatio.toFixed(2)}`);
    console.log(`  早期集中度: ${(token.smartWalletPattern.earlyConcentration * 100).toFixed(1)}%`);
    console.log(`  大户快速卖出: ${token.smartWalletPattern.smartMoneyQuickSellCount}个`);
    console.log(`  大户vs散户: ${token.smartWalletPattern.earlyVsLateAmount.toFixed(2)}`);

    // 显示前3个早期大户
    if (token.smartWalletPattern.top3EarlyWallets.length > 0) {
      console.log('');
      console.log('  前3个早期大户:');
      token.smartWalletPattern.top3EarlyWallets.forEach(w => {
        console.log(`    ${w.wallet}: $${w.amount}, ${w.entryTime}s入场, $${w.sellAmount}卖出, 持仓${w.holdTime}s`);
      });
    }
    console.log('');
  });

  // 寻找最佳区分指标
  console.log('\n=== 寻找最佳区分指标 ===\n');

  const metrics = [
    {
      name: '早期大户数量 >= 3',
      test: r => r.smartWalletPattern.earlyWhales >= 3
    },
    {
      name: '早期大户数量 >= 2',
      test: r => r.smartWalletPattern.earlyWhales >= 2
    },
    {
      name: '早期集中度 > 0.7',
      test: r => r.smartWalletPattern.earlyConcentration > 0.7
    },
    {
      name: '早期集中度 > 0.8',
      test: r => r.smartWalletPattern.earlyConcentration > 0.8
    },
    {
      name: '大户vs散户 > 3',
      test: r => r.smartWalletPattern.earlyVsLateAmount > 3
    },
    {
      name: '大户vs散户 > 5',
      test: r => r.smartWalletPattern.earlyVsLateAmount > 5
    },
    {
      name: '大户快速卖出 >= 2',
      test: r => r.smartWalletPattern.smartMoneyQuickSellCount >= 2
    },
    {
      name: '组合: 早期大户>=2 AND 集中度>0.7',
      test: r => r.smartWalletPattern.earlyWhales >= 2 && r.smartWalletPattern.earlyConcentration > 0.7
    }
  ];

  console.log('指标                                | 拉砸识别 | 盈利误伤 | F1分数');
  console.log('------------------------------------|----------|----------|--------');

  metrics.forEach(metric => {
    const pumpDetected = pumpResults.filter(metric.test).length;
    const profitDetected = profitResults.filter(metric.test).length;

    const recall = pumpResults.length > 0 ? pumpDetected / pumpResults.length : 0;
    const precision = pumpResults.length + profitResults.length > 0
      ? pumpDetected / (pumpDetected + profitDetected)
      : 0;

    const f1 = recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0;

    console.log(`${metric.name.padEnd(36)} | ${(recall * 100).toFixed(1).padStart(8)}% | ${profitDetected}/${profitResults.length} | ${f1.toFixed(3)}`);
  });

  console.log('\n=== 推荐的新因子 ===\n');
  console.log('基于分析结果，推荐以下新因子来检测"聪明钱包+跟单钱包"拉砸模式：');
  console.log('');
  console.log('1. walletEarlyWhaleCount（早期大户数量）');
  console.log('   定义: 前15秒入场且买入金额>$200的钱包数');
  console.log('   推荐阈值: >= 2');
  console.log('');
  console.log('2. walletEarlyConcentration（早期集中度）');
  console.log('   定义: 前3个早期钱包的买入金额占所有早期买入金额的比例');
  console.log('   推荐阈值: > 0.7');
  console.log('');
  console.log('3. walletEarlyVsLateRatio（大户vs散户买入比）');
  console.log('   定义: 前15秒平均买入金额 / 30秒后平均买入金额');
  console.log('   推荐阈值: > 3');
}

analyzeSmartWalletPattern().catch(console.error);
