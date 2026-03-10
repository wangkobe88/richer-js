/**
 * 深度分析：钱包进入时机和交易模式
 * 识别"聪明钱包"和"跟单钱包"的特征
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
  '0xd8d4ddeb91987a121422567260a88230dbb34444'
];

const profitableTokens = [
  '0x16aeb87aeb78e4cf7987f16e910c285d77354444',  // +147.8%
  '0xa9fe96fd5230a135ada220523032b3e1a67d4444',  // +96.2%
  '0xd7a23f95c6698c44c7b861408f0d7b47acc74444'   // +20.3%
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
 * 深度分析钱包行为
 */
function analyzeWalletBehavior(trades, checkTime) {
  if (!trades || trades.length === 0) return null;

  const windowStart = checkTime - 90;

  // 按钱包分组
  const walletMap = new Map();
  trades.forEach(trade => {
    const wallet = trade.from_address?.toLowerCase();
    if (!wallet) return;

    if (!walletMap.has(wallet)) {
      walletMap.set(wallet, {
        wallet,
        trades: [],
        firstTime: trade.time,
        lastTime: trade.time,
        totalBuyAmount: 0,
        totalSellAmount: 0,
        tradeCount: 0
      });
    }

    const w = walletMap.get(wallet);
    w.trades.push(trade);
    w.totalBuyAmount += trade.from_usd || 0;
    w.totalSellAmount += trade.to_usd || 0;
    w.tradeCount++;
    w.lastTime = Math.max(w.lastTime, trade.time);
  });

  const wallets = Array.from(walletMap.values());

  // 按首笔交易时间排序
  wallets.sort((a, b) => a.firstTime - b.firstTime);

  // 分析钱包类型
  const walletTypes = {
    earlyWhales: [],      // 早期大额钱包（前15秒，金额>$500）
    earlyFollowers: [],   // 早期跟单钱包（前15秒，金额<$100）
    lateComers: [],       // 后期入场钱包（30秒后）
    repeaters: [],        // 重复交易钱包（>2笔交易）
    flippers: []          // 快速翻转钱包（买入后很快卖出）
  };

  wallets.forEach(w => {
    const entryTime = w.firstTime - windowStart;
    const avgTradeSize = w.totalBuyAmount / w.tradeCount;

    // 早期大额钱包
    if (entryTime < 15 && w.totalBuyAmount > 500) {
      walletTypes.earlyWhales.push(w);
    }

    // 早期跟单钱包
    if (entryTime < 15 && w.totalBuyAmount < 100 && w.totalBuyAmount > 0) {
      walletTypes.earlyFollowers.push(w);
    }

    // 后期入场钱包
    if (entryTime >= 30) {
      walletTypes.lateComers.push(w);
    }

    // 重复交易钱包
    if (w.tradeCount > 2) {
      walletTypes.repeaters.push(w);
    }

    // 快速翻转钱包（在10秒内完成买卖）
    const hasQuickFlip = w.trades.some((t, i) => {
      if (i > 0) {
        const prevTrade = w.trades[i - 1];
        return (t.time - prevTrade.time) < 10 &&
               ((t.to_usd > 0 && prevTrade.from_usd > 0) ||
                (t.from_usd > 0 && prevTrade.to_usd > 0));
      }
      return false;
    });
    if (hasQuickFlip) {
      walletTypes.flippers.push(w);
    }
  });

  // 计算早期集中度
  const earlyWallets = wallets.filter(w => (w.firstTime - windowStart) < 15);
  const earlyTotalBuy = earlyWallets.reduce((sum, w) => sum + w.totalBuyAmount, 0);
  const earlyMaxBuy = earlyWallets.length > 0 ? Math.max(...earlyWallets.map(w => w.totalBuyAmount)) : 0;
  const earlyConcentration = earlyTotalBuy > 0 ? earlyMaxBuy / earlyTotalBuy : 0;

  // 计算后期爆发度（30秒后的钱包数 vs 前30秒的钱包数）
  const lateWallets = wallets.filter(w => (w.firstTime - windowStart) >= 30);
  const first30Wallets = wallets.filter(w => (w.firstTime - windowStart) < 30);
  const lateExplosionRatio = first30Wallets.length > 0 ? lateWallets.length / first30Wallets.length : lateWallets.length;

  // 计算钱包进入曲线斜率（钱包含量增长的加速度）
  const entryCurve = [];
  for (let t = 0; t < 90; t += 10) {
    const count = wallets.filter(w => {
      const entryTime = w.firstTime - windowStart;
      return entryTime >= t && entryTime < t + 10;
    }).length;
    entryCurve.push({ time: t, count });
  }

  // 计算曲线斜率变化
  const slopeChanges = [];
  for (let i = 1; i < entryCurve.length; i++) {
    slopeChanges.push(entryCurve[i].count - entryCurve[i - 1].count);
  }

  // 检测"突然加速"模式（某10秒区间内钱包数突然增加）
  const maxSlopeChange = Math.max(...slopeChanges);
  const accelerationSecond = slopeChanges.indexOf(maxSlopeChange) * 10 + 10;
  const hasSuddenAcceleration = maxSlopeChange > 5 && accelerationSecond >= 20;

  return {
    totalWallets: wallets.length,
    walletTypes: {
      earlyWhales: walletTypes.earlyWhales.length,
      earlyWhalesAmount: walletTypes.earlyWhales.reduce((sum, w) => sum + w.totalBuyAmount, 0),
      earlyFollowers: walletTypes.earlyFollowers.length,
      lateComers: walletTypes.lateComers.length,
      repeaters: walletTypes.repeaters.length,
      flippers: walletTypes.flippers.length
    },
    earlyConcentration,
    lateExplosionRatio,
    entryCurve,
    slopeChanges,
    maxSlopeChange,
    accelerationSecond,
    hasSuddenAcceleration
  };
}

async function analyzeWalletEntryPattern() {
  console.log('=== 深度分析：钱包进入时机和模式 ===\n');

  const allTokens = [
    ...pumpAndDumpTokens.map(t => ({ address: t, type: 'pump' })),
    ...profitableTokens.map(t => ({ address: t, type: 'profit' }))
  ];

  const results = [];

  for (let i = 0; i < allTokens.length; i++) {
    const { address: tokenAddress, type } = allTokens[i];
    const label = type === 'pump' ? '拉砸' : '盈利';

    console.log(`[${i + 1}/${allTokens.length}] 分析${label}代币 ${tokenAddress}...`);

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
      console.log(`  跳过\n`);
      continue;
    }

    const walletBehavior = analyzeWalletBehavior(trades, checkTime);

    const { data: sellTrade } = await supabase
      .from('trades')
      .select('metadata')
      .eq('token_address', tokenAddress)
      .eq('trade_direction', 'sell')
      .limit(1);

    const profitPercent = sellTrade?.[0]?.metadata?.profitPercent || null;

    results.push({
      symbol,
      type,
      profitPercent,
      tradesCount: trades.length,
      walletBehavior
    });

    console.log(`  完成: ${symbol}, ${walletBehavior.totalWallets}个钱包\n`);
  }

  // 输出对比
  console.log('\n=== 钱包行为对比 ===\n');

  console.log('类型 | 代币        | 收益率  | 总钱包 | 早期巨鲸 | 早期跟单 | 后期入场 | 重复交易 | 快速翻转 | 早期集中 | 后期爆发 | 突然加速 | 加速秒');
  console.log('-----|------------|---------|--------|----------|----------|----------|----------|----------|----------|----------|----------|--------');

  results.forEach(r => {
    const typeLabel = r.type === 'pump' ? '拉砸' : '盈利';
    const profit = r.profitPercent !== null ? r.profitPercent.toFixed(1) + '%' : 'N/A';
    const wb = r.walletBehavior;

    console.log(`${typeLabel.padEnd(4)} | ${r.symbol.substring(0, 11).padEnd(11)} | ${profit.padStart(7)} | ${wb.totalWallets.toString().padStart(6)} | ${wb.walletTypes.earlyWhales.toString().padStart(8)} | ${wb.walletTypes.earlyFollowers.toString().padStart(8)} | ${wb.walletTypes.lateComers.toString().padStart(8)} | ${wb.walletTypes.repeaters.toString().padStart(8)} | ${wb.walletTypes.flippers.toString().padStart(8)} | ${(wb.earlyConcentration * 100).toFixed(0).toString().padStart(7)}% | ${wb.lateExplosionRatio.toFixed(1).padStart(8)} | ${wb.hasSuddenAcceleration ? '是' : '否'} | ${wb.accelerationSecond}`);
  });

  // 统计分析
  console.log('\n=== 统计分析 ===\n');

  const pumpResults = results.filter(r => r.type === 'pump');
  const profitResults = results.filter(r => r.type === 'profit');

  const avg = (arr, fn) => arr.reduce((sum, r) => sum + fn(r), 0) / arr.length;

  console.log('【后期入场钱包占比】');
  const pumpAvgLate = avg(pumpResults, r => r.walletBehavior.walletTypes.lateComers / r.walletBehavior.totalWallets);
  const profitAvgLate = avg(profitResults, r => r.walletBehavior.walletTypes.lateComers / r.walletBehavior.totalWallets);
  console.log(`拉砸代币: ${(pumpAvgLate * 100).toFixed(1)}%`);
  console.log(`盈利代币: ${(profitAvgLate * 100).toFixed(1)}%`);

  console.log('\n【突然加速模式】');
  const pumpAccel = pumpResults.filter(r => r.walletBehavior.hasSuddenAcceleration).length;
  const profitAccel = profitResults.filter(r => r.walletBehavior.hasSuddenAcceleration).length;
  console.log(`拉砸代币: ${pumpAccel}/${pumpResults.length} (${(pumpAccel / pumpResults.length * 100).toFixed(1)}%)`);
  console.log(`盈利代币: ${profitAccel}/${profitResults.length} (${(profitAccel / profitResults.length * 100).toFixed(1)}%)`);

  console.log('\n【加速秒数】');
  const pumpAccelSecond = avg(pumpResults.filter(r => r.walletBehavior.maxSlopeChange > 0), r => r.walletBehavior.accelerationSecond);
  const profitAccelSecond = avg(profitResults.filter(r => r.walletBehavior.maxSlopeChange > 0), r => r.walletBehavior.accelerationSecond);
  console.log(`拉砸代币平均: ${pumpAccelSecond.toFixed(1)}秒`);
  console.log(`盈利代币平均: ${profitAccelSecond.toFixed(1)}秒`);

  // 推荐新因子
  console.log('\n=== 推荐的新因子 ===\n');

  console.log('因子1: lateWalletsRatio（后期入场钱包占比）');
  console.log('  定义: 30秒后首次入场钱包数 / 总钱包数');
  console.log(`  拉砸平均: ${(pumpAvgLate * 100).toFixed(1)}%, 盈利平均: ${(profitAvgLate * 100).toFixed(1)}%`);

  console.log('\n因子2: walletEntryAcceleration（钱包进入加速）');
  console.log('  定义: 在20+秒时钱包含量突然增加');
  console.log(`  拉砸检测率: ${(pumpAccel / pumpResults.length * 100).toFixed(1)}%, 盈利误伤率: ${(profitAccel / profitResults.length * 100).toFixed(1)}%`);
}

analyzeWalletEntryPattern().catch(console.error);
