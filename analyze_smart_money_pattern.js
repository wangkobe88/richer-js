/**
 * 深度分析：聪明钱包+跟单钱包的拉砸模式
 * 分析这些未被过滤的拉砸代币的特征
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

// 这些是拉砸代币但未被过滤的代币
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

async function getSignalForToken(tokenAddress) {
  // 从两个实验中查找信号
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
 * 分析钱包行为模式
 */
function analyzeWalletBehavior(trades, checkTime) {
  if (!trades || trades.length === 0) return null;

  const windowStart = checkTime - 90;

  // 按钱包分组交易
  const walletTrades = {};
  trades.forEach(trade => {
    const wallet = trade.from_address?.toLowerCase();
    if (!wallet) return;

    if (!walletTrades[wallet]) {
      walletTrades[wallet] = [];
    }
    walletTrades[wallet].push(trade);
  });

  // 计算每个钱包的特征
  const walletFeatures = [];
  for (const [wallet, wTrades] of Object.entries(walletTrades)) {
    const firstTrade = wTrades[0];
    const lastTrade = wTrades[wTrades.length - 1];

    const totalBuyAmount = wTrades.reduce((sum, t) => sum + (t.from_usd || 0), 0);
    const totalSellAmount = wTrades.reduce((sum, t) => sum + (t.to_usd || 0), 0);

    walletFeatures.push({
      wallet,
      tradeCount: wTrades.length,
      firstTime: firstTrade.time,
      lastTime: lastTrade.time,
      duration: lastTrade.time - firstTrade.time,
      totalBuyAmount,
      totalSellAmount,
      isNetBuyer: totalBuyAmount > totalSellAmount,
      netAmount: totalBuyAmount - totalSellAmount,
      entryTime: firstTrade.time - windowStart,  // 入场时间（相对窗口开始）
      avgTradeSize: totalBuyAmount / wTrades.length
    });
  }

  // 按入场时间排序
  walletFeatures.sort((a, b) => a.entryTime - b.entryTime);

  // 分析时间分段：早期（0-10秒）、中期（10-30秒）、晚期（30-90秒）
  const periods = {
    early: { wallets: [], totalBuyAmount: 0, walletCount: 0 },    // 0-10秒
    mid: { wallets: [], totalBuyAmount: 0, walletCount: 0 },      // 10-30秒
    late: { wallets: [], totalBuyAmount: 0, walletCount: 0 }      // 30-90秒
  };

  walletFeatures.forEach(wf => {
    if (wf.entryTime < 10) {
      periods.early.wallets.push(wf);
      periods.early.totalBuyAmount += wf.totalBuyAmount;
      periods.early.walletCount++;
    } else if (wf.entryTime < 30) {
      periods.mid.wallets.push(wf);
      periods.mid.totalBuyAmount += wf.totalBuyAmount;
      periods.mid.walletCount++;
    } else {
      periods.late.wallets.push(wf);
      periods.late.totalBuyAmount += wf.totalBuyAmount;
      periods.late.walletCount++;
    }
  });

  // 计算早期钱包的集中度
  const earlyWalletConcentration = periods.early.walletCount > 0
    ? periods.early.wallets[0].totalBuyAmount / periods.early.totalBuyAmount
    : 0;

  // 计算早期vs晚期的金额比
  const earlyVsLateRatio = periods.late.totalBuyAmount > 0
    ? periods.early.totalBuyAmount / periods.late.totalBuyAmount
    : periods.early.totalBuyAmount;

  // 检测是否有"超级早期钱包"（前5秒入场，且金额较大）
  const superEarlyWallets = periods.early.wallets.filter(w => w.entryTime < 5 && w.totalBuyAmount > 100);
  const superEarlyConcentration = superEarlyWallets.length > 0
    ? superEarlyWallets.reduce((sum, w) => sum + w.totalBuyAmount, 0) / (trades.reduce((sum, t) => sum + (t.from_usd || 0), 0) || 1)
    : 0;

  return {
    totalWallets: walletFeatures.length,
    periods: {
      early: { count: periods.early.walletCount, buyAmount: periods.early.totalBuyAmount },
      mid: { count: periods.mid.walletCount, buyAmount: periods.mid.totalBuyAmount },
      late: { count: periods.late.walletCount, buyAmount: periods.late.totalBuyAmount }
    },
    earlyWalletConcentration,
    earlyVsLateRatio,
    superEarlyWallets: superEarlyWallets.length,
    superEarlyConcentration,
    topWallets: walletFeatures.slice(0, 5)
  };
}

/**
 * 检测"聪明钱包+跟单钱包"模式
 */
function detectSmartMoneyPattern(walletBehavior, trades) {
  if (!walletBehavior) return null;

  const patterns = [];

  // 模式1: 超级早期集中入场（聪明钱包）+ 后续分散跟单
  if (walletBehavior.superEarlyWallets >= 1 && walletBehavior.superEarlyConcentration > 0.3) {
    patterns.push({
      type: '超级早期集中入场',
      description: `${walletBehavior.superEarlyWallets}个钱包在前5秒入场，占比${(walletBehavior.superEarlyConcentration * 100).toFixed(1)}%`,
      severity: 'high'
    });
  }

  // 模式2: 早期金额远大于晚期（拉高后出货）
  if (walletBehavior.earlyVsLateRatio > 2) {
    patterns.push({
      type: '早期主导模式',
      description: `早期买入金额是晚期的${walletBehavior.earlyVsLateRatio.toFixed(1)}倍`,
      severity: 'medium'
    });
  }

  // 模式3: 早期钱包集中度极高（可能是1-2个大户控制）
  if (walletBehavior.earlyWalletConcentration > 0.7) {
    patterns.push({
      type: '早期高度集中',
      description: `最大早期钱包占比${(walletBehavior.earlyWalletConcentration * 100).toFixed(1)}%`,
      severity: 'high'
    });
  }

  // 模式4: 钱包数少但交易量大（少数大户操控）
  const totalBuyAmount = trades.reduce((sum, t) => sum + (t.from_usd || 0), 0);
  const avgWalletBuyAmount = walletBehavior.totalWallets > 0 ? totalBuyAmount / walletBehavior.totalWallets : 0;

  if (walletBehavior.totalWallets < 10 && avgWalletBuyAmount > 500) {
    patterns.push({
      type: '少数大户操控',
      description: `${walletBehavior.totalWallets}个钱包，平均${avgWalletBuyAmount.toFixed(0)}美元`,
      severity: 'medium'
    });
  }

  return patterns;
}

async function analyzeSmartMoneyPattern() {
  console.log('=== 深度分析：聪明钱包+跟单钱包模式 ===\n');

  const results = [];

  for (let i = 0; i < pumpAndDumpTokens.length; i++) {
    const tokenAddress = pumpAndDumpTokens[i];
    console.log(`[${i + 1}/${pumpAndDumpTokens.length}] 分析代币 ${tokenAddress}...`);

    // 获取信号数据
    const signal = await getSignalForToken(tokenAddress);
    if (!signal) {
      console.log(`  警告: 未找到信号数据\n`);
      continue;
    }

    const factors = signal.metadata?.preBuyCheckFactors;
    const checkTime = factors?.earlyTradesCheckTime;
    const symbol = signal.metadata?.symbol || tokenAddress.substring(0, 8);

    if (!checkTime) {
      console.log(`  警告: 未找到checkTime\n`);
      continue;
    }

    // 获取交易数据
    const trades = await fetchTokenTrades(tokenAddress, checkTime);
    if (!trades || trades.length === 0) {
      console.log(`  警告: 未找到交易数据\n`);
      continue;
    }

    // 分析钱包行为
    const walletBehavior = analyzeWalletBehavior(trades, checkTime);

    // 检测模式
    const patterns = detectSmartMoneyPattern(walletBehavior, trades);

    // 获取收益率
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
      walletBehavior,
      patterns,
      existingFactors: {
        clusterCount: factors?.walletClusterCount,
        top2Ratio: factors?.walletClusterTop2Ratio,
        megaRatio: factors?.walletClusterMegaRatio
      }
    });

    console.log(`  完成: ${symbol}, ${trades.length}笔交易, ${patterns.length}个模式\n`);
  }

  // 输出分析结果
  console.log('\n=== 分析结果汇总 ===\n');

  console.log('代币        | 收益率 | 交易数 | 钱包数 | 早期钱包 | 早期金额 | 早期占比 | 晚期金额 | 早期/晚期 | 超早集中 | 检测到的模式');
  console.log('------------|--------|--------|--------|----------|----------|----------|----------|----------|----------|----------');

  results.forEach(r => {
    const profit = r.profitPercent !== null ? r.profitPercent.toFixed(1) + '%' : 'N/A';
    const earlyWallets = r.walletBehavior.periods.early.count;
    const earlyAmount = r.walletBehavior.periods.early.buyAmount.toFixed(0);
    const earlyRatio = (r.walletBehavior.periods.early.buyAmount / (r.walletBehavior.periods.early.buyAmount + r.walletBehavior.periods.mid.buyAmount + r.walletBehavior.periods.late.buyAmount) * 100).toFixed(1);
    const lateAmount = r.walletBehavior.periods.late.buyAmount.toFixed(0);
    const earlyVsLate = r.walletBehavior.earlyVsLateRatio.toFixed(1);
    const superEarly = (r.walletBehavior.superEarlyConcentration * 100).toFixed(1);
    const patternTypes = r.patterns.map(p => p.type).join(', ');

    console.log(`${r.symbol.substring(0, 11).padEnd(11)} | ${profit.padStart(6)} | ${r.tradesCount.toString().padStart(6)} | ${r.walletBehavior.totalWallets.toString().padStart(6)} | ${earlyWallets.toString().padStart(6)} | ${earlyAmount.padStart(6)} | ${earlyRatio.padStart(5)}% | ${lateAmount.padStart(6)} | ${earlyVsLate.padStart(8)} | ${superEarly.padStart(6)}% | ${patternTypes}`);
  });

  // 统计模式出现频率
  console.log('\n【模式出现频率】\n');

  const patternFrequency = {};
  results.forEach(r => {
    r.patterns.forEach(p => {
      if (!patternFrequency[p.type]) {
        patternFrequency[p.type] = 0;
      }
      patternFrequency[p.type]++;
    });
  });

  Object.entries(patternFrequency)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log(`${type}: ${count}个代币 (${(count / results.length * 100).toFixed(1)}%)`);
    });

  // 详细分析每个代币
  console.log('\n【详细分析 - 前5个代币】\n');

  results.slice(0, 5).forEach(r => {
    console.log(`\n【${r.symbol}】收益率: ${r.profitPercent !== null ? r.profitPercent.toFixed(1) + '%' : 'N/A'}`);
    console.log(`现有因子: 簇数=${r.existingFactors.clusterCount}, Top2=${((r.existingFactors.top2Ratio || 0) * 100).toFixed(1)}%, Mega=${((r.existingFactors.megaRatio || 0) * 100).toFixed(1)}%`);
    console.log('');
    console.log('时间段分析:');
    console.log(`  早期 (0-10秒):   ${r.walletBehavior.periods.early.count}个钱包, $${r.walletBehavior.periods.early.buyAmount.toFixed(0)}`);
    console.log(`  中期 (10-30秒):  ${r.walletBehavior.periods.mid.count}个钱包, $${r.walletBehavior.periods.mid.buyAmount.toFixed(0)}`);
    console.log(`  晚期 (30-90秒):  ${r.walletBehavior.periods.late.count}个钱包, $${r.walletBehavior.periods.late.buyAmount.toFixed(0)}`);
    console.log('');
    console.log('检测到的模式:');
    r.patterns.forEach(p => {
      console.log(`  - [${p.severity.toUpperCase()}] ${p.type}: ${p.description}`);
    });
  });
}

analyzeSmartMoneyPattern().catch(console.error);
