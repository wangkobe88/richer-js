/**
 * 早期交易者特征分析 v2
 * 使用原始实验的信号数据
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { AveTxAPI } = require('../../src/core/ave-api');
const config = require('../../config/default.json');
require('dotenv').config({ path: '../../config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const txApi = new AveTxAPI(
  config.ave?.apiUrl || 'https://prod.ave-api.com',
  config.ava?.timeout || 30000,
  process.env.AVE_API_KEY
);

const DATA_DIR = path.join(__dirname, 'data');
const WALLET_DATA_FILE = path.join(DATA_DIR, 'wallet_data_valid.json');
const EXPERIMENT_ID = '015db965-0b33-4d98-88b1-386203886381';
const WINDOW_SECONDS = 90;

async function loadWalletData() {
  console.log('加载钱包数据...');
  const data = JSON.parse(fs.readFileSync(WALLET_DATA_FILE, 'utf8'));
  const walletMap = new Map();
  data.forEach(w => walletMap.set(w.address, w));
  console.log(`  加载了 ${walletMap.size} 个钱包`);
  return walletMap;
}

async function fetchEarlyTradesForToken(tokenAddress, pairAddress, checkTime) {
  const fromTime = checkTime - WINDOW_SECONDS;
  const allTrades = [];
  let currentToTime = checkTime;

  for (let i = 0; i < 10; i++) {
    try {
      const trades = await txApi.getSwapTransactions(
        `${pairAddress}-bsc`,
        300,
        fromTime,
        currentToTime,
        'asc'
      );

      if (!trades || trades.length === 0) break;
      allTrades.push(...trades);

      const batchFirstTime = trades[0].time;
      if (batchFirstTime <= fromTime) break;

      if (trades.length === 300) {
        currentToTime = batchFirstTime - 1;
      } else {
        break;
      }
    } catch (error) {
      break;
    }
  }

  // 去重并过滤时间窗口
  const seen = new Set();
  const unique = [];
  for (const trade of allTrades.sort((a, b) => a.time - b.time)) {
    if (trade.time >= fromTime && trade.time <= checkTime) {
      const key = trade.tx_id || `${trade.time}_${trade.from_address}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(trade);
      }
    }
  }
  return unique;
}

async function loadTokenReturns() {
  console.log('加载代币收益数据...');

  const { data: trades } = await supabase
    .from('trades')
    .select('token_address, token_symbol, trade_direction, input_amount, output_amount')
    .eq('experiment_id', EXPERIMENT_ID);

  const tokenStats = new Map();
  trades?.forEach(trade => {
    const addr = trade.token_address;
    if (!tokenStats.has(addr)) {
      tokenStats.set(addr, {
        symbol: trade.token_symbol,
        address: addr,
        buyCost: 0,
        sellRevenue: 0,
        buyCount: 0,
        sellCount: 0
      });
    }
    const stat = tokenStats.get(addr);
    if (trade.trade_direction === 'buy') {
      stat.buyCost += trade.input_amount || 0;
      stat.buyCount += 1;
    } else if (trade.trade_direction === 'sell') {
      stat.sellRevenue += trade.output_amount || 0;
      stat.sellCount += 1;
    }
  });

  const returns = [];
  for (const [addr, stat] of tokenStats) {
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

async function loadExperimentTokens() {
  console.log('加载实验代币数据...');

  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol, raw_api_data')
    .eq('experiment_id', EXPERIMENT_ID);

  const tokenPairMap = new Map();
  const tokenSignalMap = new Map();

  // 获取信号的时间戳
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, created_at')
    .eq('experiment_id', EXPERIMENT_ID)
    .eq('executed', true);

  signals?.forEach(s => {
    if (!tokenSignalMap.has(s.token_address)) {
      tokenSignalMap.set(s.token_address, new Date(s.created_at).getTime() / 1000);
    }
  });

  tokens?.forEach(t => {
    const mainPair = t.raw_api_data?.main_pair;
    if (mainPair) {
      tokenPairMap.set(t.token_address, {
        mainPair,
        symbol: t.token_symbol
      });
    }
  });

  console.log(`  加载了 ${tokenPairMap.size} 个代币的 pair 信息`);
  console.log(`  加载了 ${tokenSignalMap.size} 个代币的信号时间`);

  return { tokenPairMap, tokenSignalMap };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== 早期交易者特征分析 v2 ===\n');

  const walletMap = await loadWalletData();
  const returns = await loadTokenReturns();
  const { tokenPairMap, tokenSignalMap } = await loadExperimentTokens();

  console.log('\n获取早期交易数据...');

  const results = [];

  for (let i = 0; i < returns.length; i++) {
    const token = returns[i];
    const pairInfo = tokenPairMap.get(token.address);
    const checkTime = tokenSignalMap.get(token.address);

    if (!pairInfo || !checkTime) {
      continue;
    }

    process.stdout.write(`\r[${i+1}/${returns.length}] ${token.symbol}: 获取交易...`);

    try {
      const trades = await fetchEarlyTradesForToken(token.address, pairInfo.mainPair, checkTime);

      // 收集钱包
      const wallets = new Set();
      trades.forEach(t => {
        const addr = t.wallet_address || t.from_address;
        if (addr) wallets.add(addr.toLowerCase());
      });

      // 获取钱包数据
      let totalAge = 0, totalTrades = 0, totalProfit = 0;
      let totalWinRatio = 0, profitableCount = 0;
      let totalPurchase = 0, totalSold = 0, dataCount = 0;

      wallets.forEach(addr => {
        const w = walletMap.get(addr);
        if (w) {
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

      if (dataCount > 0) {
        const now = Date.now() / 1000;
        const avgAgeDays = (totalAge / dataCount) / 86400;

        results.push({
          ...token,
          walletCount: wallets.size,
          dataCount: dataCount,
          avgAgeDays: avgAgeDays,
          avgTrades: totalTrades / dataCount,
          avgProfit: totalProfit / dataCount,
          avgWinRatio: totalWinRatio / dataCount,
          profitableRatio: (profitableCount / dataCount) * 100,
          sellRatio: totalSold > 0 ? totalSold / (totalPurchase + totalSold) : 0,
          tradeCount: trades.length
        });
      }
    } catch (error) {
      // 跳过错误
    }

    await sleep(500);
  }

  console.log(`\r\n成功处理 ${results.length} 个代币`);

  if (results.length < 5) {
    console.log('样本量太小，无法进行有效分析');
    return;
  }

  // 分析
  results.sort((a, b) => b.returnRate - a.returnRate);

  const topThird = results.slice(0, Math.floor(results.length / 3));
  const bottomThird = results.slice(Math.floor(results.length * 2 / 3));

  console.log('\n=== 分析结果 ===\n');
  console.log(`总代币数: ${results.length}`);
  console.log(`高收益组: ${topThird.length}, 平均收益率 ${(topThird.reduce((s, r) => s + r.returnRate, 0) / topThird.length).toFixed(2)}%`);
  console.log(`低收益组: ${bottomThird.length}, 平均收益率 ${(bottomThird.reduce((s, r) => s + r.returnRate, 0) / bottomThird.length).toFixed(2)}%`);

  // 特征对比
  console.log('\n=== 特征对比 (高收益 vs 低收益) ===');

  const features = [
    { name: '平均钱包年龄(天)', key: 'avgAgeDays' },
    { name: '平均交易次数', key: 'avgTrades' },
    { name: '平均盈利(USD)', key: 'avgProfit' },
    { name: '盈利钱包占比(%)', key: 'profitableRatio' },
    { name: '卖出比例', key: 'sellRatio' },
    { name: '钱包数量', key: 'walletCount' }
  ];

  features.forEach(({ name, key }) => {
    const topAvg = topThird.reduce((s, r) => s + r[key], 0) / topThird.length;
    const bottomAvg = bottomThird.reduce((s, r) => s + r[key], 0) / bottomThird.length;
    const diff = topAvg - bottomAvg;
    console.log(`  ${name}: 高收益=${topAvg.toFixed(2)}, 低收益=${bottomAvg.toFixed(2)}, 差异=${diff.toFixed(2)}`);
  });

  // 保存结果
  const output = {
    experiment_id: EXPERIMENT_ID,
    results: results,
    top_third_avg_return: topThird.reduce((s, r) => s + r.returnRate, 0) / topThird.length,
    bottom_third_avg_return: bottomThird.reduce((s, r) => s + r.returnRate, 0) / bottomThird.length,
    generated_at: new Date().toISOString()
  };

  const outputFile = path.join(DATA_DIR, 'early_participant_features_v2.json');
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  console.log(`\n结果已保存到: ${outputFile}`);
}

main().catch(console.error);
