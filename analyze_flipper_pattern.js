/**
 * 深度分析：快速翻转模式
 * 分析"聪明钱包买入+跟单钱包快速跟随"的拉砸模式
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
 * 深度分析快速翻转行为
 */
function analyzeFlipperPattern(trades, checkTime) {
  if (!trades || trades.length === 0) return null;

  const windowStart = checkTime - 90;

  // 按钱包分组，并按时间排序交易
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
    w.trades.push({ ...trade, relativeTime: trade.time - windowStart });
    w.totalBuyAmount += trade.from_usd || 0;
    w.totalSellAmount += trade.to_usd || 0;
    w.tradeCount++;
    w.lastTime = Math.max(w.lastTime, trade.time);
  });

  const wallets = Array.from(walletMap.values());

  // 检测快速翻转模式
  const flippers = [];
  const ultraFastFlippers = [];   // 超快翻转（5秒内）
  const earlyFlippers = [];        // 早期翻转（前30秒内）
  const lateFlippers = [];         // 晚期翻转（30秒后）

  wallets.forEach(w => {
    for (let i = 1; i < w.trades.length; i++) {
      const currTrade = w.trades[i];
      const prevTrade = w.trades[i - 1];
      const timeGap = currTrade.relativeTime - prevTrade.relativeTime;

      // 检测翻转（有买有卖）
      const isFlip = (currTrade.to_usd > 0 && prevTrade.from_usd > 0) ||
                    (currTrade.from_usd > 0 && prevTrade.to_usd > 0);

      if (isFlip && timeGap <= 10) {
        const flipper = {
          wallet: w.wallet,
          entryTime: prevTrade.relativeTime,
          flipTime: currTrade.relativeTime,
          timeGap,
          entryAmount: prevTrade.from_usd || prevTrade.to_usd,
          exitAmount: currTrade.to_usd || currTrade.from_usd,
          isEarly: currTrade.relativeTime < 30
        };

        flippers.push(flipper);

        if (timeGap <= 5) {
          ultraFastFlippers.push(flipper);
        }

        if (currTrade.relativeTime < 30) {
          earlyFlippers.push(flipper);
        } else {
          lateFlippers.push(flipper);
        }
      }
    }
  });

  // 计算翻转密度（每10秒的翻转次数）
  const flipDensity = [];
  for (let t = 0; t < 90; t += 10) {
    const count = flippers.filter(f => f.flipTime >= t && f.flipTime < t + 10).length;
    flipDensity.push({ time: t, count });
  }

  // 计算峰值翻转时间
  const maxFlipDensity = Math.max(...flipDensity.map(d => d.count));
  const peakFlipTime = flipDensity.find(d => d.count === maxFlipDensity)?.time || 0;

  // 计算翻转集中度（前30秒翻转占比）
  const earlyFlipCount = flippers.filter(f => f.flipTime < 30).length;
  const flipConcentration = flippers.length > 0 ? earlyFlipCount / flippers.length : 0;

  // 检测"翻转爆发"模式（某个10秒区间内翻转次数突然飙升）
  const avgFlipDensity = flipDensity.reduce((sum, d) => sum + d.count, 0) / flipDensity.length;
  const hasFlipExplosion = maxFlipDensity > avgFlipDensity * 2 && maxFlipDensity >= 3;

  return {
    totalWallets: wallets.length,
    flippers: flippers.length,
    ultraFastFlippers: ultraFastFlippers.length,
    earlyFlippers: earlyFlippers.length,
    lateFlippers: lateFlippers.length,
    flipperRatio: wallets.length > 0 ? flippers.length / wallets.length : 0,
    flipDensity,
    maxFlipDensity,
    peakFlipTime,
    flipConcentration,
    hasFlipExplosion,
    avgFlipTimeToFirst: flippers.length > 0
      ? flippers.reduce((sum, f) => sum + f.entryTime, 0) / flippers.length
      : 0
  };
}

async function analyzeFlipperPatternDetailed() {
  console.log('=== 深度分析：快速翻转模式 ===\n');

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

    const flipperPattern = analyzeFlipperPattern(trades, checkTime);

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
      flipperPattern
    });

    console.log(`  完成: ${symbol}, ${flipperPattern.flippers}个翻转钱包\n`);
  }

  // 输出详细对比
  console.log('\n=== 快速翻转模式对比 ===\n');

  console.log('类型 | 代币        | 收益率  | 翻转钱包 | 超快翻转 | 翻转比例 | 峰值密度 | 峰值秒 | 早期集中 | 翻转爆发 | 平均入场');
  console.log('-----|------------|---------|----------|----------|----------|----------|--------|----------|----------|----------');

  results.forEach(r => {
    const typeLabel = r.type === 'pump' ? '拉砸' : '盈利';
    const profit = r.profitPercent !== null ? r.profitPercent.toFixed(1) + '%' : 'N/A';
    const fp = r.flipperPattern;

    console.log(`${typeLabel.padEnd(4)} | ${r.symbol.substring(0, 11).padEnd(11)} | ${profit.padStart(7)} | ${fp.flippers.toString().padStart(8)} | ${fp.ultraFastFlippers.toString().padStart(8)} | ${(fp.flipperRatio * 100).toFixed(1).toString().padStart(7)}% | ${fp.maxFlipDensity.toString().padStart(6)} | ${fp.peakFlipTime.toString().padStart(6)} | ${(fp.flipConcentration * 100).toFixed(0).toString().padStart(7)}% | ${fp.hasFlipExplosion ? '是' : '否'} | ${fp.avgFlipTimeToFirst.toFixed(1).toString().padStart(8)}`);
  });

  // 统计分析
  console.log('\n=== 统计分析 ===\n');

  const pumpResults = results.filter(r => r.type === 'pump');
  const profitResults = results.filter(r => r.type === 'profit');

  const avg = (arr, fn) => arr.reduce((sum, r) => sum + fn(r), 0) / arr.length;

  console.log('【翻转钱包占比】');
  const pumpAvgFlipperRatio = avg(pumpResults, r => r.flipperPattern.flipperRatio);
  const profitAvgFlipperRatio = avg(profitResults, r => r.flipperPattern.flipperRatio);
  console.log(`拉砸代币: ${(pumpAvgFlipperRatio * 100).toFixed(1)}%`);
  console.log(`盈利代币: ${(profitAvgFlipperRatio * 100).toFixed(1)}%`);

  console.log('\n【翻转爆发模式】');
  const pumpExplosion = pumpResults.filter(r => r.flipperPattern.hasFlipExplosion).length;
  const profitExplosion = profitResults.filter(r => r.flipperPattern.hasFlipExplosion).length;
  console.log(`拉砸代币: ${pumpExplosion}/${pumpResults.length} (${(pumpExplosion / pumpResults.length * 100).toFixed(1)}%)`);
  console.log(`盈利代币: ${profitExplosion}/${profitResults.length} (${(profitExplosion / profitResults.length * 100).toFixed(1)}%)`);

  console.log('\n【平均入场时间】');
  const pumpAvgEntry = avg(pumpResults.filter(r => r.flipperPattern.flippers > 0), r => r.flipperPattern.avgFlipTimeToFirst);
  const profitAvgEntry = avg(profitResults.filter(r => r.flipperPattern.flippers > 0), r => r.flipperPattern.avgFlipTimeToFirst);
  console.log(`拉砸代币: ${pumpAvgEntry.toFixed(1)}秒`);
  console.log(`盈利代币: ${profitAvgEntry.toFixed(1)}秒`);

  // 寻找最佳阈值
  console.log('\n=== 寻找最佳翻转比例阈值 ===\n');

  const thresholds = [0.2, 0.3, 0.4, 0.5, 0.6];

  console.log('翻转比例阈值 | 拉砸识别 | 盈利误伤 | F1分数');
  console.log('-------------|----------|----------|--------');

  thresholds.forEach(threshold => {
    const pumpDetected = pumpResults.filter(r => r.flipperPattern.flipperRatio >= threshold).length;
    const profitDetected = profitResults.filter(r => r.flipperPattern.flipperRatio >= threshold).length;

    const recall = pumpDetected / pumpResults.length;
    const precision = pumpResults.length > 0
      ? pumpDetected / (pumpDetected + profitDetected)
      : 0;
    const f1 = recall + precision > 0 ? 2 * recall * precision / (recall + precision) : 0;

    console.log(`${threshold.toFixed(1)} | ${(recall * 100).toFixed(1)}% | ${(profitDetected / profitResults.length * 100).toFixed(1)}% | ${f1.toFixed(3)}`);
  });

  // 推荐因子
  console.log('\n=== 推荐的新因子 ===\n');

  console.log('因子名称: walletFlipperRatio（快速翻转钱包比例）');
  console.log('定义: 10秒内完成买卖的钱包数 / 总钱包数');
  console.log('推荐阈值: >= 0.4 (40%)');
  console.log('说明: 拉砸代币通常有大量跟单钱包在聪明钱包买入后快速跟随');
}

analyzeFlipperPatternDetailed().catch(console.error);
