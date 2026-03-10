/**
 * 深度分析：冷启动+后期爆发模式
 * 分析早期交易稀少，后期突然爆发的拉砸模式
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

// 拉砸代币
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

// 盈利代币（对照组）
const profitableTokens = [
  '0x16aeb87aeb78e4cf7987f16e910c285d77354444',
  '0xa9fe96fd5230a135ada220523032b3e1a67d4444',
  '0xd7a23f95c6698c44c7b861408f0d7b47acc74444'
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

    if (data && data.length > 0) {
      return data[0];
    }
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
 * 详细分析时间序列特征
 */
function analyzeTimeSeries(trades, checkTime) {
  if (!trades || trades.length === 0) return null;

  const windowStart = checkTime - 90;

  // 按秒分组统计
  const secondBuckets = {};
  for (let s = 0; s < 90; s++) {
    secondBuckets[s] = { count: 0, buyAmount: 0, wallets: new Set() };
  }

  trades.forEach(trade => {
    const relativeTime = trade.time - windowStart;
    const second = Math.floor(relativeTime);
    if (second >= 0 && second < 90) {
      secondBuckets[second].count++;
      secondBuckets[second].buyAmount += trade.from_usd || 0;
      if (trade.from_address) {
        secondBuckets[second].wallets.add(trade.from_address.toLowerCase());
      }
    }
  });

  // 计算关键时间段
  const periods = {
    ultraEarly: { start: 0, end: 5, count: 0, buyAmount: 0, uniqueWallets: new Set() },    // 0-5秒
    early: { start: 5, end: 15, count: 0, buyAmount: 0, uniqueWallets: new Set() },      // 5-15秒
    midEarly: { start: 15, end: 30, count: 0, buyAmount: 0, uniqueWallets: new Set() },  // 15-30秒
    mid: { start: 30, end: 60, count: 0, buyAmount: 0, uniqueWallets: new Set() },      // 30-60秒
    late: { start: 60, end: 90, count: 0, buyAmount: 0, uniqueWallets: new Set() }      // 60-90秒
  };

  for (let s = 0; s < 90; s++) {
    const bucket = secondBuckets[s];

    if (s < 5) {
      periods.ultraEarly.count += bucket.count;
      periods.ultraEarly.buyAmount += bucket.buyAmount;
      bucket.wallets.forEach(w => periods.ultraEarly.uniqueWallets.add(w));
    } else if (s < 15) {
      periods.early.count += bucket.count;
      periods.early.buyAmount += bucket.buyAmount;
      bucket.wallets.forEach(w => periods.early.uniqueWallets.add(w));
    } else if (s < 30) {
      periods.midEarly.count += bucket.count;
      periods.midEarly.buyAmount += bucket.buyAmount;
      bucket.wallets.forEach(w => periods.midEarly.uniqueWallets.add(w));
    } else if (s < 60) {
      periods.mid.count += bucket.count;
      periods.mid.buyAmount += bucket.buyAmount;
      bucket.wallets.forEach(w => periods.mid.uniqueWallets.add(w));
    } else {
      periods.late.count += bucket.count;
      periods.late.buyAmount += bucket.buyAmount;
      bucket.wallets.forEach(w => periods.late.uniqueWallets.add(w));
    }
  }

  const totalBuyAmount = Object.values(periods).reduce((sum, p) => sum + p.buyAmount, 0);

  // 计算关键指标
  const ultraEarlyRatio = totalBuyAmount > 0 ? periods.ultraEarly.buyAmount / totalBuyAmount : 0;
  const earlyRatio = totalBuyAmount > 0 ? periods.early.buyAmount / totalBuyAmount : 0;
  const midEarlyRatio = totalBuyAmount > 0 ? periods.midEarly.buyAmount / totalBuyAmount : 0;

  // 检测"冷启动"：前5秒几乎没有交易
  const isColdStart = ultraEarlyRatio < 0.01 && periods.ultraEarly.count < 5;

  // 检测"后期爆发"：15-30秒的交易量突然增大
  const isLateExplosion = midEarlyRatio > 0.3 && periods.midEarly.buyAmount > periods.early.buyAmount * 2;

  // 计算交易密度峰值时间
  let peakSecond = -1;
  let peakDensity = 0;
  for (let s = 0; s < 90; s++) {
    if (secondBuckets[s].count > peakDensity) {
      peakDensity = secondBuckets[s].count;
      peakSecond = s;
    }
  }

  // 计算首个非空秒
  let firstActiveSecond = -1;
  for (let s = 0; s < 90; s++) {
    if (secondBuckets[s].count > 0) {
      firstActiveSecond = s;
      break;
    }
  }

  return {
    totalBuyAmount,
    periods: {
      ultraEarly: { ...periods.ultraEarly, uniqueWallets: periods.ultraEarly.uniqueWallets.size, ratio: ultraEarlyRatio },
      early: { ...periods.early, uniqueWallets: periods.early.uniqueWallets.size, ratio: earlyRatio },
      midEarly: { ...periods.midEarly, uniqueWallets: periods.midEarly.uniqueWallets.size, ratio: midEarlyRatio },
      mid: { ...periods.mid, uniqueWallets: periods.mid.uniqueWallets.size },
      late: { ...periods.late, uniqueWallets: periods.late.uniqueWallets.size }
    },
    isColdStart,
    isLateExplosion,
    peakSecond,
    peakDensity,
    firstActiveSecond,
    coldStartRatio: ultraEarlyRatio
  };
}

async function analyzeColdStartPattern() {
  console.log('=== 深度分析：冷启动+后期爆发模式 ===\n');

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

    const timeSeries = analyzeTimeSeries(trades, checkTime);

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
      type,
      profitPercent,
      tradesCount: trades.length,
      timeSeries,
      existingFactors: {
        clusterCount: factors?.walletClusterCount,
        top2Ratio: factors?.walletClusterTop2Ratio,
        megaRatio: factors?.walletClusterMegaRatio
      }
    });

    console.log(`  完成: ${symbol}, ${trades.length}笔, 前5秒占比=${(timeSeries.coldStartRatio * 100).toFixed(1)}%\n`);
  }

  // 输出对比分析
  console.log('\n=== 拉砸代币 vs 盈利代币对比 ===\n');

  console.log('类型 | 代币        | 收益率  | 前5秒 | 首活秒 | 5-15秒 | 15-30秒 | 峰值秒 | 模式');
  console.log('-----|------------|---------|-------|--------|--------|---------|--------|------');

  results.forEach(r => {
    const typeLabel = r.type === 'pump' ? '拉砸' : '盈利';
    const profit = r.profitPercent !== null ? r.profitPercent.toFixed(1) + '%' : 'N/A';
    const ultraEarly = (r.timeSeries.periods.ultraEarly.ratio * 100).toFixed(1) + '%';
    const firstActive = r.timeSeries.firstActiveSecond;
    const early = (r.timeSeries.periods.early.ratio * 100).toFixed(1) + '%';
    const midEarly = (r.timeSeries.periods.midEarly.ratio * 100).toFixed(1) + '%';
    const peak = r.timeSeries.peakSecond;

    let pattern = '';
    if (r.timeSeries.isColdStart) pattern += '冷启动';
    if (r.timeSeries.isLateExplosion) pattern += '后期爆发';

    console.log(`${typeLabel.padEnd(4)} | ${r.symbol.substring(0, 11).padEnd(11)} | ${profit.padStart(7)} | ${ultraEarly.padStart(5)} | ${firstActive.toString().padStart(6)} | ${early.padStart(6)} | ${midEarly.padStart(7)} | ${peak.toString().padStart(6)} | ${pattern}`);
  });

  // 统计分析
  console.log('\n=== 统计分析 ===\n');

  const pumpResults = results.filter(r => r.type === 'pump');
  const profitResults = results.filter(r => r.type === 'profit');

  console.log('【前5秒交易占比】');
  const pumpAvgUltraEarly = pumpResults.reduce((sum, r) => sum + r.timeSeries.coldStartRatio, 0) / pumpResults.length;
  const profitAvgUltraEarly = profitResults.reduce((sum, r) => sum + r.timeSeries.coldStartRatio, 0) / profitResults.length;
  console.log(`拉砸代币平均: ${(pumpAvgUltraEarly * 100).toFixed(2)}%`);
  console.log(`盈利代币平均: ${(profitAvgUltraEarly * 100).toFixed(2)}%`);

  console.log('\n【首个活跃秒数】');
  const pumpAvgFirstActive = pumpResults.reduce((sum, r) => sum + (r.timeSeries.firstActiveSecond >= 0 ? r.timeSeries.firstActiveSecond : 0), 0) / pumpResults.filter(r => r.timeSeries.firstActiveSecond >= 0).length;
  const profitAvgFirstActive = profitResults.reduce((sum, r) => sum + (r.timeSeries.firstActiveSecond >= 0 ? r.timeSeries.firstActiveSecond : 0), 0) / profitResults.filter(r => r.timeSeries.firstActiveSecond >= 0).length;
  console.log(`拉砸代币平均: ${pumpAvgFirstActive.toFixed(1)}秒`);
  console.log(`盈利代币平均: ${profitAvgFirstActive.toFixed(1)}秒`);

  console.log('\n【峰值交易秒数】');
  const pumpAvgPeak = pumpResults.reduce((sum, r) => sum + r.timeSeries.peakSecond, 0) / pumpResults.length;
  const profitAvgPeak = profitResults.reduce((sum, r) => sum + r.timeSeries.peakSecond, 0) / profitResults.length;
  console.log(`拉砸代币平均: ${pumpAvgPeak.toFixed(1)}秒`);
  console.log(`盈利代币平均: ${profitAvgPeak.toFixed(1)}秒`);

  // 冷启动检测效果
  console.log('\n【冷启动检测效果】');
  const pumpColdStartCount = pumpResults.filter(r => r.timeSeries.coldStartRatio < 0.01).length;
  const profitColdStartCount = profitResults.filter(r => r.timeSeries.coldStartRatio < 0.01).length;
  console.log(`拉砸代币中冷启动: ${pumpColdStartCount}/${pumpResults.length} (${(pumpColdStartCount / pumpResults.length * 100).toFixed(1)}%)`);
  console.log(`盈利代币中冷启动: ${profitColdStartCount}/${profitResults.length} (${(profitColdStartCount / profitResults.length * 100).toFixed(1)}%)`);

  // 推荐的冷启动阈值
  console.log('\n=== 推荐的新因子 ===\n');
  console.log('因子名称: earlyTradesColdStartRatio');
  console.log('定义: 前5秒的买入金额占90秒总买入金额的比例');
  console.log('推荐阈值: < 0.01 (1%)');
  console.log('检测效果:');
  console.log(`  - 拉砸代币识别率: ${(pumpColdStartCount / pumpResults.length * 100).toFixed(1)}%`);
  console.log(`  - 盈利代币误伤率: ${(profitColdStartCount / profitResults.length * 100).toFixed(1)}%`);
}

analyzeColdStartPattern().catch(console.error);
