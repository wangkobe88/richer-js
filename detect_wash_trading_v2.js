/**
 * 检测洗单/刷单模式 v2
 * 更严格的条件：
 * 1. 频繁同时买卖（交易次数 >= 3）
 * 2. 买卖金额高度对等（差异 < 5%）
 * 3. 或者：买卖对等 + 高比例小额交易（小额占比 > 70%）
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
  // 获取信号数据
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

  // 获取交易数据
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

  // 按钱包统计买卖金额
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

  // 检测洗单特征（更严格的条件）
  let washTradeWallets = 0;
  let washTradeTotalAmount = 0;
  let washTradeLowValueCount = 0;
  let washTradeTradeCount = 0;

  for (const [wallet, stats] of Object.entries(walletStats)) {
    // 洗单特征1：频繁同时买卖（>=3笔），且买卖金额高度对等（差异<5%）
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

    // 洗单特征2：买卖对等 + 高比例小额交易（小额占比 > 70%）
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
    // 洗单钱包特征
    washTradeWallets,
    washTradeWalletRatio: Object.keys(walletStats).length > 0 ? washTradeWallets / Object.keys(walletStats).length : 0,
    washTradeAmount: washTradeTotalAmount,
    washTradeAmountRatio: totalBuyAmount > 0 ? washTradeTotalAmount / totalBuyAmount : 0,
    washTradeTradeCount,
    washTradeTradeCountRatio: totalTradeCount > 0 ? washTradeTradeCount / totalTradeCount : 0,
    washTradeLowValueCount,
    washTradeLowValueRatio: washTradeTradeCount > 0 ? washTradeLowValueCount / washTradeTradeCount : 0,
    // 总体统计
    totalWallets: Object.keys(walletStats).length,
    totalTradeCount,
    totalBuyAmount
  };
}

async function main() {
  const tokens = [
    { address: '0x281f05868b5ba9e55869541a117ebb661f474444', experiment: '6b17ff18-002d-4ce0-a745-b8e02676abd4', name: '宝贝龙虾' },
    { address: '0xf3372a3dbc824f0b0044ca77209559514b294444', experiment: '6b17ff18-002d-4ce0-a745-b8e02676abd4', name: 'GLUBSCHIS' },
    { address: '0x16aeb87aeb78e4cf7987f16e910c285d77354444', experiment: '6b17ff18-002d-4ce0-a745-b8e02676abd4', name: 'AGENTGDP' },
  ];

  console.log('=== 洗单/刷单检测因子分析 v2 ===\n');

  const results = [];
  for (const token of tokens) {
    const result = await analyzeWashTradingFactors(token.address, token.experiment);
    if (result) {
      result.symbol = token.name;
      results.push(result);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('代币名称    | 洗单钱包 | 洗单钱包占比 | 洗单金额占比 | 洗单交易占比 | 小额交易占比');
  console.log('-----------|---------|-------------|-------------|-------------|-----------');

  results.forEach(r => {
    console.log(`${r.symbol.padEnd(10)} | ${r.washTradeWallets.toString().padStart(7)} | ${(r.washTradeWalletRatio * 100).toFixed(1).padStart(10)}% | ${(r.washTradeAmountRatio * 100).toFixed(1).padStart(10)}% | ${(r.washTradeTradeCountRatio * 100).toFixed(1).padStart(10)}% | ${(r.washTradeLowValueRatio * 100).toFixed(1).padStart(8)}%`);
  });

  // 测试阈值
  console.log('\n【测试不同阈值】\n');

  const pumpTokens = results.filter(r => r.symbol === '宝贝龙虾' || r.symbol === 'GLUBSCHIS');
  const normalTokens = results.filter(r => r.symbol === 'AGENTGDP');

  const testCases = [
    { name: '洗单钱包 >= 2', condition: r => r.washTradeWallets >= 2 },
    { name: '洗单钱包占比 >= 5%', condition: r => r.washTradeWalletRatio >= 0.05 },
    { name: '洗单金额占比 >= 10%', condition: r => r.washTradeAmountRatio >= 0.10 },
    { name: '洗单交易占比 >= 10%', condition: r => r.washTradeTradeCountRatio >= 0.10 },
    { name: '组合: 洗单钱包 >= 2 && 金额占比 >= 5%', condition: r => r.washTradeWallets >= 2 && r.washTradeAmountRatio >= 0.05 },
  ];

  console.log('条件名称                                    | 拉盘拦截 | 正常误伤');
  console.log('------------------------------------------|---------|--------');

  testCases.forEach(tc => {
    const pumpRejected = pumpTokens.filter(tc.condition).length;
    const normalRejected = normalTokens.filter(tc.condition).length;
    console.log(`${tc.name.padEnd(42)} | ${pumpRejected}/${pumpTokens.length} | ${normalRejected}/${normalTokens.length}`);
  });
}

main().catch(console.error);
