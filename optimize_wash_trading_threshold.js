/**
 * 优化洗单检测阈值
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

async function analyzeWashTradingFactors(tokenAddress, experimentId) {
  const { data: signal } = await supabase
    .from('strategy_signals')
    .select('created_at, metadata')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .eq('action', 'buy')
    .single();

  if (!signal) return null;

  const factors = signal.metadata?.preBuyCheckFactors;
  const expectedFirstTime = factors?.earlyTradesExpectedFirstTime;
  const targetToTime = expectedFirstTime + 90;

  const innerPair = `${tokenAddress}_fo`;
  const pairId = `${innerPair}-bsc`;

  const allTrades = [];
  let currentToTime = targetToTime;

  for (let loop = 1; loop <= 10; loop++) {
    try {
      const trades = await txApi.getSwapTransactions(
        pairId, 300, expectedFirstTime, currentToTime, 'asc'
      );
      if (trades.length === 0) break;
      allTrades.push(...trades);
      if (trades[0].time <= expectedFirstTime || trades.length < 300) break;
      currentToTime = trades[0].time - 1;
    } catch (error) {
      break;
    }
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

  const walletStats = {};
  uniqueTrades.forEach(t => {
    const wallet = (t.from_address || '').toLowerCase();
    if (!wallet) return;

    if (!walletStats[wallet]) {
      walletStats[wallet] = {
        buyAmount: 0,
        sellAmount: 0,
        buyCount: 0,
        sellCount: 0,
        lowValueCount: 0,
        totalAmount: 0,
        tradeCount: 0
      };
    }

    const buyAmount = t.from_usd || 0;
    const sellAmount = t.to_usd || 0;
    const value = buyAmount || sellAmount;

    walletStats[wallet].buyAmount += buyAmount;
    walletStats[wallet].sellAmount += sellAmount;
    walletStats[wallet].buyCount += (buyAmount > 0 ? 1 : 0);
    walletStats[wallet].sellCount += (sellAmount > 0 ? 1 : 0);
    walletStats[wallet].lowValueCount += (value < 10 ? 1 : 0);
    walletStats[wallet].totalAmount += value;
    walletStats[wallet].tradeCount++;
  });

  let washTradeWallets = 0;
  let washTradeTotalAmount = 0;
  let washTradeLowValueCount = 0;
  let washTradeTradeCount = 0;

  for (const [wallet, stats] of Object.entries(walletStats)) {
    if (stats.tradeCount >= 3 && stats.buyCount > 0 && stats.sellCount > 0) {
      const ratio = stats.buyAmount / stats.sellAmount;
      const isHighlyBalanced = ratio >= 0.95 && ratio <= 1.05;

      if (isHighlyBalanced) {
        washTradeWallets++;
        washTradeTotalAmount += stats.totalAmount;
        washTradeLowValueCount += stats.lowValueCount;
        washTradeTradeCount += stats.tradeCount;
        continue;
      }
    }

    if (stats.tradeCount >= 2 && stats.buyCount > 0 && stats.sellCount > 0) {
      const ratio = stats.buyAmount / stats.sellAmount;
      const isBalanced = ratio >= 0.9 && ratio <= 1.1;
      const lowValueRatio = stats.lowValueCount / stats.tradeCount;

      if (isBalanced && lowValueRatio > 0.7) {
        washTradeWallets++;
        washTradeTotalAmount += stats.totalAmount;
        washTradeLowValueCount += stats.lowValueCount;
        washTradeTradeCount += stats.tradeCount;
      }
    }
  }

  const totalBuyAmount = Object.values(walletStats).reduce((sum, s) => sum + s.buyAmount, 0);
  const totalTradeCount = uniqueTrades.length;

  return {
    symbol: signal.metadata?.symbol || tokenAddress.substring(0, 8),
    washTradeWallets,
    washTradeWalletRatio: Object.keys(walletStats).length > 0 ? washTradeWallets / Object.keys(walletStats).length : 0,
    washTradeAmount: washTradeTotalAmount,
    washTradeAmountRatio: totalBuyAmount > 0 ? washTradeTotalAmount / totalBuyAmount : 0,
    washTradeTradeCount,
    washTradeTradeCountRatio: totalTradeCount > 0 ? washTradeTradeCount / totalTradeCount : 0,
    washTradeLowValueCount,
    washTradeLowValueRatio: washTradeTradeCount > 0 ? washTradeLowValueCount / washTradeTradeCount : 0,
    totalWallets: Object.keys(walletStats).length,
    totalTradeCount,
    totalBuyAmount
  };
}

async function main() {
  const pumpTokens = [
    { address: '0x281f05868b5ba9e55869541a117ebb661f474444', experiment: '6b17ff18-002d-4ce0-a745-b8e02676abd4', name: '宝贝龙虾' },
    { address: '0xf3372a3dbc824f0b0044ca77209559514b294444', experiment: '6b17ff18-002d-4ce0-a745-b8e02676abd4', name: 'GLUBSCHIS' },
    { address: '0xb9b1142a28fade5771b7ae076c96c3bee8beffff', experiment: '6b17ff18-002d-4ce0-a745-b8e02676abd4', name: '龙虾基金' },
    { address: '0xd8d4ddeb91987a121422567260a88230dbb34444', experiment: '6b17ff18-002d-4ce0-a745-b8e02676abd4', name: 'CTO' },
  ];

  const normalTokens = [
    { address: '0x16aeb87aeb78e4cf7987f16e910c285d77354444', experiment: '6b17ff18-002d-4ce0-a745-b8e02676abd4', name: 'AGENTGDP' },
    { address: '0x343aa540ca10b117a70e14f0bd592c860fb64444', experiment: '6b17ff18-002d-4ce0-a745-b8e02676abd4', name: '来宝' },
  ];

  console.log('=== 优化洗单检测阈值 ===\n');

  const pumpResults = [];
  for (const token of pumpTokens) {
    const result = await analyzeWashTradingFactors(token.address, token.experiment);
    if (result) {
      result.symbol = token.name;
      result.isPump = true;
      pumpResults.push(result);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const normalResults = [];
  for (const token of normalTokens) {
    const result = await analyzeWashTradingFactors(token.address, token.experiment);
    if (result) {
      result.symbol = token.name;
      result.isPump = false;
      normalResults.push(result);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const allResults = [...pumpResults, ...normalResults];

  console.log('代币名称    | 洗单交易占比 | 类型');
  console.log('-----------|-------------|------');
  allResults.forEach(r => {
    const type = r.isPump ? '拉盘' : '正常';
    console.log(`${r.symbol.padEnd(10)} | ${(r.washTradeTradeCountRatio * 100).toFixed(1).padStart(10)}% | ${type}`);
  });

  // 测试不同阈值
  console.log('\n【测试不同阈值】\n');

  const thresholds = [0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.60];

  console.log('洗单交易占比阈值 | 拉盘拦截 | 拉盘召回率 | 正常误伤 | F1分数');
  console.log('---------------|---------|----------|---------|-------');

  thresholds.forEach(t => {
    const pumpRejected = pumpResults.filter(r => r.washTradeTradeCountRatio >= t).length;
    const normalRejected = normalResults.filter(r => r.washTradeTradeCountRatio >= t).length;

    const pumpRecall = pumpRejected / pumpResults.length;
    const normalPrecision = 1 - (normalResults.length > 0 ? normalRejected / normalResults.length : 0);
    const f1 = pumpResults.length > 0 ? (2 * pumpRecall * normalPrecision) / (pumpRecall + normalPrecision) : 0;

    console.log(`${(t * 100).toFixed(0).padStart(13)}% | ${pumpRejected}/${pumpResults.length} | ${(pumpRecall * 100).toFixed(0).padStart(6)}% | ${normalRejected}/${normalResults.length} | ${f1.toFixed(3)}`);
  });

  // 推荐最优阈值
  console.log('\n【推荐阈值】\n');

  const bestThreshold = 0.40;
  const pumpRejected = pumpResults.filter(r => r.washTradeTradeCountRatio >= bestThreshold).length;
  const normalRejected = normalResults.filter(r => r.washTradeTradeCountRatio >= bestThreshold).length;

  console.log(`阈值: ${bestThreshold * 100}%`);
  console.log(`拉盘代币: ${pumpRejected}/${pumpResults.length} 被拦截`);
  console.log(`正常代币: ${normalRejected}/${normalResults.length} 被误伤`);

  if (normalRejected === 0 && pumpRejected > 0) {
    console.log(`\n→ 推荐使用阈值 ${bestThreshold * 100}%，不会误伤正常代币`);
  }
}

main().catch(console.error);
