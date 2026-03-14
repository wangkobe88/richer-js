/**
 * 早期交易者特征分析
 *
 * 研究早期交易者的各种特征与代币收益的关系：
 * - 钱包年龄
 * - 交易活跃度
 * - 盈利能力
 * - 买卖行为
 * - 资金规模
 * - 参与结构
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const DATA_DIR = path.join(__dirname, 'data');
const WALLET_DATA_FILE = path.join(DATA_DIR, 'wallet_data_valid.json');
const EARLY_TRADES_FILE = path.join(DATA_DIR, 'step2_early_trades_90s.json');

// 原始实验 ID
const EXPERIMENT_ID = '015db965-0b33-4d98-88b1-386203886381';

async function loadWalletData() {
  console.log('加载钱包数据...');
  const data = JSON.parse(fs.readFileSync(WALLET_DATA_FILE, 'utf8'));

  const walletMap = new Map();
  data.forEach(w => {
    walletMap.set(w.address, w);
  });

  console.log(`  加载了 ${walletMap.size} 个钱包`);
  return walletMap;
}

async function loadEarlyTrades() {
  console.log('加载早期交易数据...');
  const data = JSON.parse(fs.readFileSync(EARLY_TRADES_FILE, 'utf8'));

  console.log(`  加载了 ${data.results?.length || 0} 个代币的交易数据`);
  return data;
}

async function loadTokenReturns() {
  console.log('加载代币收益数据...');

  // 获取原始实验的所有交易
  const { data: trades } = await supabase
    .from('trades')
    .select('token_address, token_symbol, trade_direction, input_amount, output_amount')
    .eq('experiment_id', EXPERIMENT_ID);

  // 计算每个代币的收益
  const tokenReturns = new Map();
  trades?.forEach(trade => {
    const addr = trade.token_address;
    if (!tokenReturns.has(addr)) {
      tokenReturns.set(addr, {
        symbol: trade.token_symbol,
        address: addr,
        buyCost: 0,
        sellRevenue: 0,
        buyCount: 0,
        sellCount: 0
      });
    }
    const stat = tokenReturns.get(addr);
    if (trade.trade_direction === 'buy') {
      stat.buyCost += trade.input_amount || 0;
      stat.buyCount += 1;
    } else if (trade.trade_direction === 'sell') {
      stat.sellRevenue += trade.output_amount || 0;
      stat.sellCount += 1;
    }
  });

  // 计算收益率
  const returns = [];
  for (const [addr, stat] of tokenReturns) {
    if (stat.buyCost > 0) {
      const profit = stat.sellRevenue - stat.buyCost;
      const returnRate = (profit / stat.buyCost) * 100;
      returns.push({
        ...stat,
        profit,
        returnRate,
        isHolding: stat.sellCount === 0
      });
    }
  }

  console.log(`  加载了 ${returns.length} 个代币的收益数据`);
  return returns;
}

function calculateEarlyParticipantFeatures(earlyTrades, walletMap) {
  console.log('\n计算早期交易者特征...');

  const results = [];

  earlyTrades.results.forEach(tokenData => {
    const trades = tokenData.trades || [];
    if (trades.length === 0) return;

    // 收集所有钱包地址
    const wallets = new Set();
    trades.forEach(t => {
      const addr = t.wallet_address || t.from_address;
      if (addr) wallets.add(addr.toLowerCase());
    });

    // 获取这些钱包的数据
    const walletDataList = [];
    let totalAge = 0;
    let totalTrades = 0;
    let totalProfit = 0;
    let totalWinRatio = 0;
    let profitableCount = 0;
    let totalPurchase = 0;
    let totalSold = 0;
    let dataCount = 0;

    wallets.forEach(addr => {
      const w = walletMap.get(addr);
      if (w) {
        walletDataList.push(w);
        totalAge += w.wallet_age || 0;
        totalTrades += w.total_trades || 0;
        totalProfit += w.total_profit || 0;
        totalWinRatio += w.total_win_ratio || 0;
        totalPurchase += w.total_purchase || 0;
        totalSold += w.total_sold || 0;
        if (w.total_profit_ratio > 0) profitableCount++;
        dataCount++;
      }
    });

    if (dataCount === 0) return;

    // 计算各种特征
    const now = Date.now() / 1000;
    const avgAge = totalAge / dataCount;
    const avgAgeDays = avgAge / 86400; // 转换为天数
    const avgTrades = totalTrades / dataCount;
    const avgProfit = totalProfit / dataCount;
    const avgWinRatio = totalWinRatio / dataCount;
    const profitableRatio = (profitableCount / dataCount) * 100;
    const sellRatio = totalSold > 0 ? totalSold / (totalPurchase + totalSold) : 0;
    const buyOnlyCount = walletDataList.filter(w => (w.total_sold || 0) === 0).length;
    const sellOnlyCount = walletDataList.filter(w => (w.total_purchase || 0) === 0).length;
    const bothCount = dataCount - buyOnlyCount - sellOnlyCount;

    // 交易金额统计
    const buyAmounts = trades.filter(t => t.from_token_symbol === 'WBNB').map(t => t.from_amount || 0);
    const sellAmounts = trades.filter(t => t.to_token_symbol === 'WBNB').map(t => t.to_amount || 0);
    const allAmounts = [...buyAmounts, ...sellAmounts];
    const avgAmount = allAmounts.length > 0 ? allAmounts.reduce((a, b) => a + b, 0) / allAmounts.length : 0;
    const maxAmount = allAmounts.length > 0 ? Math.max(...allAmounts) : 0;
    const totalVolume = allAmounts.reduce((a, b) => a + b, 0);

    // 价格变化
    if (trades.length >= 2) {
      const firstPrice = trades[0].to_token_price_usd || trades[0].from_token_price_usd;
      const lastPrice = trades[trades.length - 1].to_token_price_usd || trades[trades.length - 1].from_token_price_usd;
      var priceChange = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice * 100) : 0;
    }

    results.push({
      tokenAddress: tokenData.token_address,
      tokenSymbol: tokenData.token_symbol,
      walletCount: wallets.size,
      dataCount: dataCount,

      // 钱包年龄
      avgAgeDays: avgAgeDays,
      oldWalletRatio: walletDataList.filter(w => (w.wallet_age || 0) < now - 30 * 86400).length / dataCount, // 30天以上为老钱包
      newWalletRatio: walletDataList.filter(w => (w.wallet_age || 0) > now - 7 * 86400).length / dataCount, // 7天以下为新钱包

      // 交易活跃度
      avgTrades: avgTrades,
      highActiveRatio: walletDataList.filter(w => (w.total_trades || 0) >= 500).length / dataCount,

      // 盈利能力
      avgProfit: avgProfit,
      avgWinRatio: avgWinRatio,
      profitableRatio: profitableRatio,
      highWinRatio: walletDataList.filter(w => (w.total_win_ratio || 0) >= 60).length / dataCount,

      // 买卖行为
      sellRatio: sellRatio,
      buyOnlyRatio: buyOnlyCount / dataCount,
      sellOnlyRatio: sellOnlyCount / dataCount,
      bothRatio: bothCount / dataCount,

      // 资金规模
      avgAmount: avgAmount,
      maxAmount: maxAmount,
      totalVolume: totalVolume,

      // 价格变化
      earlyPriceChange: priceChange || 0,

      // 原始数据
      tradeCount: trades.length
    });
  });

  console.log(`  计算了 ${results.length} 个代币的特征`);
  return results;
}

function analyzeFeatureCorrelation(features, returns) {
  console.log('\n=== 特征与收益相关性分析 ===\n');

  // 建立地址映射
  const returnMap = new Map();
  returns.forEach(r => {
    returnMap.set(r.address, r);
  });

  // 合并数据
  const combined = features.filter(f => returnMap.has(f.tokenAddress)).map(f => {
    const ret = returnMap.get(f.tokenAddress);
    return { ...f, returnRate: ret.returnRate, profit: ret.profit };
  });

  console.log(`有效数据: ${combined.length} 个代币`);

  // 按收益率分组
  combined.sort((a, b) => b.returnRate - a.returnRate);
  const topThird = combined.slice(0, Math.floor(combined.length / 3));
  const bottomThird = combined.slice(Math.floor(combined.length * 2 / 3));
  const middleThird = combined.slice(Math.floor(combined.length / 3), Math.floor(combined.length * 2 / 3));

  console.log(`\n分组:`);
  console.log(`  高收益组 (top 1/3): ${topThird.length} 个, 平均收益率 ${topThird.reduce((s, r) => s + r.returnRate, 0) / topThird.length.toFixed(2)}%`);
  console.log(`  中收益组 (middle 1/3): ${middleThird.length} 个, 平均收益率 ${middleThird.reduce((s, r) => s + r.returnRate, 0) / middleThird.length.toFixed(2)}%`);
  console.log(`  低收益组 (bottom 1/3): ${bottomThird.length} 个, 平均收益率 ${bottomThird.reduce((s, r) => s + r.returnRate, 0) / bottomThird.length.toFixed(2)}%`);

  // 分析每个特征
  const featureNames = [
    { name: '钱包年龄(天)', key: 'avgAgeDays', format: v => v.toFixed(0) },
    { name: '老钱包占比', key: 'oldWalletRatio', format: v => (v * 100).toFixed(1) + '%' },
    { name: '新钱包占比', key: 'newWalletRatio', format: v => (v * 100).toFixed(1) + '%' },
    { name: '平均交易次数', key: 'avgTrades', format: v => v.toFixed(0) },
    { name: '高活跃钱包占比', key: 'highActiveRatio', format: v => (v * 100).toFixed(1) + '%' },
    { name: '平均盈利(USD)', key: 'avgProfit', format: v => v.toFixed(0) },
    { name: '平均胜率(%)', key: 'avgWinRatio', format: v => v.toFixed(1) },
    { name: '盈利钱包占比', key: 'profitableRatio', format: v => v.toFixed(1) + '%' },
    { name: '高胜率钱包占比', key: 'highWinRatio', format: v => (v * 100).toFixed(1) + '%' },
    { name: '卖出比例', key: 'sellRatio', format: v => (v * 100).toFixed(1) + '%' },
    { name: '纯买入钱包占比', key: 'buyOnlyRatio', format: v => (v * 100).toFixed(1) + '%' },
    { name: '纯卖出钱包占比', key: 'sellOnlyRatio', format: v => (v * 100).toFixed(1) + '%' },
    { name: '买卖都做占比', key: 'bothRatio', format: v => (v * 100).toFixed(1) + '%' },
    { name: '平均交易金额(BNB)', key: 'avgAmount', format: v => v.toFixed(3) },
    { name: '最大交易金额(BNB)', key: 'maxAmount', format: v => v.toFixed(3) },
    { name: '总交易量(BNB)', key: 'totalVolume', format: v => v.toFixed(2) },
    { name: '早期价格变化(%)', key: 'earlyPriceChange', format: v => v.toFixed(2) },
    { name: '钱包数量', key: 'walletCount', format: v => v.toFixed(0) }
  ];

  console.log('\n' + '='.repeat(100));
  console.log('特征对比 (高收益组 vs 低收益组)');
  console.log('='.repeat(100));

  featureNames.forEach(({ name, key, format }) => {
    const topAvg = topThird.reduce((s, r) => s + r[key], 0) / topThird.length;
    const bottomAvg = bottomThird.reduce((s, r) => s + r[key], 0) / bottomThird.length;
    const diff = topAvg - bottomAvg;
    const diffPercent = bottomAvg !== 0 ? (diff / bottomAvg * 100) : 0;

    console.log(`\n${name}:`);
    console.log(`  高收益组: ${format(topAvg)}`);
    console.log(`  低收益组: ${format(bottomAvg)}`);
    console.log(`  差异: ${format(diff)} (${diffPercent > 0 ? '+' : ''}${diffPercent.toFixed(1)}%)`);
  });

  return { combined, topThird, bottomThird, middleThird };
}

function generateThresholdAnalysis(combined) {
  console.log('\n\n=== 阈值分析 ===\n');

  // 选择可能有预测价值的特征进行阈值分析
  const thresholdFeatures = [
    { name: '盈利钱包占比', key: 'profitableRatio', thresholds: [20, 30, 40, 50, 60, 70] },
    { name: '平均胜率', key: 'avgWinRatio', thresholds: [20, 30, 40, 50, 60] },
    { name: '老钱包占比', key: 'oldWalletRatio', thresholds: [0.1, 0.2, 0.3, 0.4, 0.5] },
    { name: '纯买入钱包占比', key: 'buyOnlyRatio', thresholds: [0.1, 0.2, 0.3, 0.4, 0.5] },
    { name: '平均交易次数', key: 'avgTrades', thresholds: [100, 200, 300, 500, 1000] }
  ];

  thresholdFeatures.forEach(({ name, key, thresholds }) => {
    console.log(`\n${name} (按 ${key}):`);
    console.log('  阈值    >=阈值数量  平均收益率  胜率');
    console.log('  ' + '-'.repeat(50));

    thresholds.forEach(th => {
      const filtered = combined.filter(r => r[key] >= th);
      if (filtered.length === 0) return;

      const avgReturn = filtered.reduce((s, r) => s + r.returnRate, 0) / filtered.length;
      const profitCount = filtered.filter(r => r.returnRate > 0).length;
      const winRate = (profitCount / filtered.length * 100);

      console.log(`  >= ${th.toString().padStart(4)}    ${filtered.length.toString().padStart(6)}    ${avgReturn.toFixed(2).padStart(6)}%    ${winRate.toFixed(1)}%`);
    });
  });
}

async function main() {
  console.log('=== 早期交易者特征分析 ===\n');

  // 1. 加载数据
  const walletMap = await loadWalletData();
  const earlyTrades = await loadEarlyTrades();
  const returns = await loadTokenReturns();

  // 2. 计算特征
  const features = calculateEarlyParticipantFeatures(earlyTrades, walletMap);

  // 3. 分析相关性
  const analysis = analyzeFeatureCorrelation(features, returns);

  // 4. 阈值分析
  generateThresholdAnalysis(analysis.combined);

  // 5. 保存结果
  const output = {
    experiment_id: EXPERIMENT_ID,
    total_tokens: analysis.combined.length,
    features: analysis.combined,
    top_third: analysis.topThird.map(t => ({ symbol: t.tokenSymbol, returnRate: t.returnRate })),
    bottom_third: analysis.bottomThird.map(t => ({ symbol: t.tokenSymbol, returnRate: t.returnRate })),
    generated_at: new Date().toISOString()
  };

  const outputFile = path.join(DATA_DIR, 'early_participant_features_analysis.json');
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  console.log(`\n\n结果已保存到: ${outputFile}`);
}

main().catch(console.error);
