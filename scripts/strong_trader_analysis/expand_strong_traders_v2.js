/**
 * 扩展强势交易者数据集 - 直接使用指定的实验
 */

const { createClient } = require('@supabase/supabase-js');
const { AveTxAPI } = require('../../src/core/ave-api');
const config = require('../../config/default.json');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const txApi = new AveTxAPI(
  config.ave?.apiUrl || 'https://prod.ave-api.com',
  config.ave?.timeout || 30000,
  process.env.AVE_API_KEY
);

// 强势交易者定义阈值
const THRESHOLDS = {
  minProfit: 30000,
  minSellRatio: 0.8,
  minTrades: 500,
  minTokens: 3
};

// 分析窗口
const WINDOW_SECONDS = 90;

// 直接指定要分析的实验
const EXPERIMENT_IDS = [
  '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1', // 原始实验
  '431ffc1c-d0b5-47e2-990e-5f9ab5bf041d',
  '6b17ff18-6457-4bf0-9c71-a9b2fc03c368'
];

async function getExecutedSignalsWithPair(experimentId, limit = 100) {
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy')
    .order('created_at', { ascending: true })
    .limit(limit * 2);

  // 过滤已执行的信号，并去重
  const executed = signals?.filter(s => s.metadata?.execution_status === 'executed') || [];
  const uniqueSignals = new Map();

  for (const sig of executed) {
    if (!uniqueSignals.has(sig.token_address)) {
      uniqueSignals.set(sig.token_address, sig);
    }
  }

  const signalList = Array.from(uniqueSignals.values()).slice(0, limit);

  // 获取代币的 main_pair 信息
  const tokenAddresses = signalList.map(s => s.token_address);
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('token_address, raw_api_data')
    .eq('experiment_id', experimentId)
    .in('token_address', tokenAddresses);

  // 构建 main_pair 映射
  const pairMap = new Map();
  for (const token of tokens || []) {
    const mainPair = token.raw_api_data?.main_pair;
    if (mainPair) {
      pairMap.set(token.token_address, mainPair);
    }
  }

  // 为每个信号添加 main_pair
  return signalList.map(sig => ({
    ...sig,
    main_pair: pairMap.get(sig.token_address)
  }));
}

async function fetchTokenTrades(tokenAddress, pairAddress, signalTime) {
  const toTime = Math.floor(new Date(signalTime).getTime() / 1000);
  const fromTime = toTime - WINDOW_SECONDS;

  const trades = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    try {
      const batch = await txApi.getSwapTransactions(
        pairAddress,
        limit,
        fromTime,
        toTime,
        'asc',
        offset
      );

      if (batch.length === 0) break;

      trades.push(...batch);
      offset += limit;

      if (batch.length < limit) break;
      if (trades.length >= 5000) break;

    } catch (error) {
      // 如果获取失败，返回已有的数据
      break;
    }
  }

  const filtered = trades.filter(t => t.time >= fromTime && t.time <= toTime);
  return filtered;
}

async function analyzeExperimentSignals(experimentId, experimentName) {
  console.log(`\n=== 分析实验: ${experimentName} ===`);
  console.log(`ID: ${experimentId}`);

  const signals = await getExecutedSignalsWithPair(experimentId, 100);
  console.log(`获取到 ${signals.length} 个唯一信号`);

  const walletStats = new Map();
  let processedCount = 0;
  let errorCount = 0;

  for (const sig of signals) {
    try {
      // 使用 main_pair 构造 pair 地址
      if (!sig.main_pair) {
        processedCount++;
        continue;
      }

      const pairAddress = sig.main_pair + '-bsc';
      const trades = await fetchTokenTrades(sig.token_address, pairAddress, sig.created_at);

      if (trades.length === 0) {
        processedCount++;
        continue;
      }

      for (const trade of trades) {
        const wallet = trade.from_address?.toLowerCase();
        if (!wallet) continue;

        if (!walletStats.has(wallet)) {
          walletStats.set(wallet, {
            wallet,
            totalBuyAmount: 0,
            totalSellAmount: 0,
            totalTrades: 0,
            tokensTraded: new Set(),
            firstTrade: trade.time,
            lastTrade: trade.time
          });
        }

        const stats = walletStats.get(wallet);

        // 简化判断：基于金额方向
        // 如果 to_amount_usd 存在且较大，可能是卖出目标代币
        const isBuy = !trade.to_amount_usd || trade.to_amount_usd < trade.from_amount_usd;

        if (isBuy) {
          stats.totalBuyAmount += trade.from_amount_usd || 0;
        } else {
          stats.totalSellAmount += trade.to_amount_usd || trade.from_amount_usd || 0;
        }

        stats.totalTrades++;
        stats.tokensTraded.add(sig.token_address);
        stats.lastTrade = Math.max(stats.lastTrade, trade.time);
      }

      processedCount++;

      if (processedCount % 20 === 0) {
        console.log(`  已处理: ${processedCount}/${signals.length}`);
      }

    } catch (error) {
      errorCount++;
      if (errorCount <= 5) {
        console.error(`  处理信号 ${sig.token_symbol} 时出错:`, error.message);
      }
    }
  }

  console.log(`处理完成: ${processedCount} 个成功, ${errorCount} 个错误`);
  console.log(`涉及钱包数: ${walletStats.size}`);

  return walletStats;
}

function identifyStrongTraders(walletStats) {
  const strongTraders = [];

  for (const [wallet, stats] of walletStats) {
    const sellRatio = stats.totalBuyAmount > 0 ? stats.totalSellAmount / stats.totalBuyAmount : 0;
    const profit = stats.totalSellAmount - stats.totalBuyAmount;
    const absProfit = Math.abs(profit);

    if (
      absProfit >= THRESHOLDS.minProfit &&
      sellRatio >= THRESHOLDS.minSellRatio &&
      stats.totalTrades >= THRESHOLDS.minTrades &&
      stats.tokensTraded.size >= THRESHOLDS.minTokens
    ) {
      strongTraders.push({
        wallet,
        profit: absProfit,
        sellRatio,
        trades: stats.totalTrades,
        tokens: stats.tokensTraded.size,
        buyAmount: stats.totalBuyAmount,
        sellAmount: stats.totalSellAmount
      });
    }
  }

  return strongTraders;
}

async function main() {
  console.log('========================================');
  console.log('  扩展强势交易者数据集');
  console.log('========================================');
  console.log(`\n将分析 ${EXPERIMENT_IDS.length} 个实验:\n`);
  EXPERIMENT_IDS.forEach((id, idx) => {
    console.log(`${idx + 1}. ${id}`);
  });

  const allWalletStats = new Map();
  const expNames = [];

  for (const expId of EXPERIMENT_IDS) {
    // 获取实验名称
    const { data: expData } = await supabase
      .from('experiments')
      .select('config')
      .eq('id', expId)
      .single();

    const expName = expData?.config?.name || expId.slice(0, 8);
    expNames.push({ id: expId, name: expName });

    const walletStats = await analyzeExperimentSignals(expId, expName);

    // 合并钱包统计
    for (const [wallet, stats] of walletStats) {
      if (!allWalletStats.has(wallet)) {
        allWalletStats.set(wallet, {
          wallet,
          totalBuyAmount: 0,
          totalSellAmount: 0,
          totalTrades: 0,
          tokensTraded: new Set(),
          experiments: new Set()
        });
      }

      const combined = allWalletStats.get(wallet);
      combined.totalBuyAmount += stats.totalBuyAmount;
      combined.totalSellAmount += stats.totalSellAmount;
      combined.totalTrades += stats.totalTrades;
      stats.tokensTraded.forEach(t => combined.tokensTraded.add(t));
      combined.experiments.add(expId);
    }
  }

  console.log('\n========================================');
  console.log('  统计汇总');
  console.log('========================================\n');

  console.log(`总涉及钱包数: ${allWalletStats.size}`);

  const strongTraders = identifyStrongTraders(allWalletStats);

  console.log(`\n识别到 ${strongTraders.length} 个强势交易者`);

  strongTraders.sort((a, b) => b.profit - a.profit);

  console.log('\nTop 20 强势交易者:');
  strongTraders.slice(0, 20).forEach((t, idx) => {
    console.log(`${idx + 1}. ${t.wallet.slice(0, 10)}...${t.wallet.slice(-6)}`);
    console.log(`   盈利: $${t.profit.toFixed(0)}, 交易: ${t.trades}, 代币: ${t.tokens}, 卖出比: ${t.sellRatio.toFixed(2)}`);
  });

  // 与现有列表对比
  const { STRONG_TRADERS: existingTraders } = require('../../src/trading-engine/pre-check/STRONG_TRADERS');
  const existingSet = new Set([...existingTraders].map(a => a.toLowerCase()));

  const newTraders = strongTraders.filter(t => !existingSet.has(t.wallet.toLowerCase()));
  const overlapTraders = strongTraders.filter(t => existingSet.has(t.wallet.toLowerCase()));

  console.log('\n========================================');
  console.log('  对比结果');
  console.log('========================================\n');

  console.log(`现有强势交易者: ${existingSet.size}`);
  console.log(`新识别总数: ${strongTraders.length}`);
  console.log(`与现有重叠: ${overlapTraders.length}`);
  console.log(`新增强势交易者: ${newTraders.length}`);

  const finalList = new Set([...existingTraders]);
  newTraders.forEach(t => finalList.add(t.wallet));

  console.log('\n========================================');
  console.log('  最终结果');
  console.log('========================================\n');

  console.log(`更新后强势交易者总数: ${finalList.size}`);
  console.log(`新增: ${newTraders.length}`);
  console.log(`保留: ${existingSet.size}`);

  // 输出代码
  console.log('\n========================================');
  console.log('  更新代码');
  console.log('========================================\n');

  console.log('请在 STRONG_TRADERS.js 中使用以下内容:\n');

  console.log(`const STRONG_TRADERS_VERSION = 'v2';`);
  console.log(`const STRONG_TRADERS_SOURCE_EXPERIMENTS = [`);
  console.log(`  '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1', // 原始实验`);
  expNames.forEach(exp => {
    if (exp.id !== '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1') {
      console.log(`  '${exp.id}', // ${exp.name}`);
    }
  });
  console.log(`];\n`);

  console.log(`const STRONG_TRADERS = new Set([`);
  const sortedList = Array.from(finalList).sort();
  sortedList.forEach(addr => {
    console.log(`  '${addr}',`);
  });
  console.log(`]);`);

  // 保存结果
  const fs = require('fs');
  const resultPath = '/Users/nobody1/Desktop/Codes/richer-js/scripts/strong_trader_analysis/expanded_strong_traders.json';
  fs.writeFileSync(resultPath, JSON.stringify({
    version: 'v2',
    sourceExperiments: expNames,
    existingCount: existingSet.size,
    newCount: newTraders.length,
    finalCount: finalList.size,
    overlapCount: overlapTraders.length,
    newTraders: newTraders.map(t => ({
      wallet: t.wallet,
      profit: t.profit,
      trades: t.trades,
      tokens: t.tokens,
      sellRatio: t.sellRatio
    })),
    overlapTraders: overlapTraders.map(t => ({
      wallet: t.wallet,
      profit: t.profit
    })),
    finalList: sortedList
  }, null, 2));

  console.log(`\n详细结果已保存到: ${resultPath}`);
}

main().catch(console.error);
