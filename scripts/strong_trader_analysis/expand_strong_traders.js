/**
 * 扩展强势交易者数据集
 * 从多个虚拟交易实验中识别强势交易者，与现有列表合并
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
  minProfit: 30000,           // 最小盈利 $30,000
  minSellRatio: 0.8,          // 卖出/买入 >= 0.8
  minTrades: 500,             // 最少交易次数 500
  minTokens: 3                // 最少交易代币数 3
};

// 分析窗口
const WINDOW_SECONDS = 90;

async function findCandidateExperiments() {
  console.log('=== 步骤 1: 查找符合条件的虚拟交易实验 ===\n');

  // 获取所有实验
  const { data: experiments, error } = await supabase
    .from('experiments')
    .select('id, status, created_at, config')
    .in('status', ['stopped', 'completed'])
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('获取实验失败:', error);
    return [];
  }

  const candidates = [];

  for (const exp of experiments) {
    // 跳过回测实验
    if (exp.config?.backtest?.sourceExperimentId) {
      continue;
    }

    // 获取执行信号数量
    const { data: signals } = await supabase
      .from('strategy_signals')
      .select('id, token_address')
      .eq('experiment_id', exp.id)
      .eq('action', 'buy');

    if (!signals || signals.length === 0) continue;

    const executedSignals = signals.filter(s => s.metadata?.execution_status === 'executed');
    const uniqueTokens = new Set(executedSignals.map(s => s.token_address));

    // 筛选条件：10-200 个代币（放宽条件）
    if (uniqueTokens.size >= 10 && uniqueTokens.size <= 200) {
      candidates.push({
        id: exp.id,
        name: exp.config?.name || exp.id.slice(0, 8),
        signalCount: executedSignals.length,
        tokenCount: uniqueTokens.size,
        createdAt: exp.created_at
      });
    }
  }

  // 选择所有符合条件的实验（或最近 5 个）
  const selected = candidates.slice(0, 5);

  console.log(`找到 ${candidates.length} 个符合条件的实验`);
  console.log(`选择 ${selected.length} 个实验进行分析:\n`);

  selected.forEach((exp, idx) => {
    console.log(`${idx + 1}. ${exp.name}`);
    console.log(`   ID: ${exp.id}`);
    console.log(`   代币数: ${exp.tokenCount}`);
    console.log(`   信号数: ${exp.signalCount}`);
    console.log('');
  });

  return selected;
}

async function getExecutedSignals(experimentId, limit = 100) {
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy')
    .order('created_at', { ascending: true })
    .limit(limit);

  // 过滤已执行的信号，并去重
  const executed = signals?.filter(s => s.metadata?.execution_status === 'executed') || [];
  const uniqueSignals = new Map();

  for (const sig of executed) {
    if (!uniqueSignals.has(sig.token_address)) {
      uniqueSignals.set(sig.token_address, sig);
    }
  }

  return Array.from(uniqueSignals.values());
}

async function fetchTokenTrades(tokenAddress, pairAddress, signalTime) {
  const toTime = Math.floor(new Date(signalTime).getTime() / 1000);
  const fromTime = toTime - WINDOW_SECONDS;

  const trades = [];
  let offset = 0;
  const limit = 100;

  while (true) {
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

    // 如果返回的数据少于 limit，说明已经获取完毕
    if (batch.length < limit) break;

    // 安全限制：最多获取 5000 条交易
    if (trades.length >= 5000) break;
  }

  // 过滤时间窗口内的交易
  const filtered = trades.filter(t => t.time >= fromTime && t.time <= toTime);
  return filtered;
}

async function analyzeExperimentSignals(experiment) {
  console.log(`\n=== 分析实验: ${experiment.name} ===`);
  console.log(`目标信号数: ~${Math.min(100, experiment.tokenCount)}`);

  const signals = await getExecutedSignals(experiment.id, 100);
  console.log(`获取到 ${signals.length} 个唯一信号`);

  const walletStats = new Map(); // wallet_address -> stats
  let processedCount = 0;
  let errorCount = 0;

  for (const sig of signals) {
    try {
      // 从信号元数据中获取 pair 地址
      const pairAddress = sig.metadata?.pairAddress || sig.token_address + '-bsc';

      const trades = await fetchTokenTrades(sig.token_address, pairAddress, sig.created_at);

      if (trades.length === 0) {
        processedCount++;
        continue;
      }

      // 分析每个钱包的交易
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

        // 判断是买入还是卖出（基于 to_token 是否为目标代币）
        // 简化：假设 from_token 是 BNB/USDT，to_token 是目标代币
        const isBuy = trade.to_token?.toLowerCase() === sig.token_address?.toLowerCase();

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
    const totalAmount = stats.totalBuyAmount + stats.totalSellAmount;
    const netAmount = Math.abs(stats.totalBuyAmount - stats.totalSellAmount);
    const sellRatio = stats.totalBuyAmount > 0 ? stats.totalSellAmount / stats.totalBuyAmount : 0;
    const profit = stats.totalSellAmount - stats.totalBuyAmount;

    // 使用绝对值判断（可能是多头或空头）
    const absProfit = Math.abs(profit);

    // 判断是否为强势交易者
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
  console.log('========================================\n');

  // 1. 查找候选实验
  const experiments = await findCandidateExperiments();

  if (experiments.length === 0) {
    console.log('未找到符合条件的实验');
    return;
  }

  // 2. 分析每个实验
  const allWalletStats = new Map();

  for (const exp of experiments) {
    const walletStats = await analyzeExperimentSignals(exp);

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
      combined.experiments.add(exp.id);
    }
  }

  console.log('\n========================================');
  console.log('  统计汇总');
  console.log('========================================\n');

  console.log(`总涉及钱包数: ${allWalletStats.size}`);

  // 3. 识别强势交易者
  const strongTraders = identifyStrongTraders(allWalletStats);

  console.log(`\n识别到 ${strongTraders.length} 个强势交易者`);

  // 按盈利排序
  strongTraders.sort((a, b) => b.profit - a.profit);

  console.log('\nTop 20 强势交易者:');
  strongTraders.slice(0, 20).forEach((t, idx) => {
    console.log(`${idx + 1}. ${t.wallet.slice(0, 10)}...${t.wallet.slice(-6)}`);
    console.log(`   盈利: $${t.profit.toFixed(0)}, 交易: ${t.trades}, 代币: ${t.tokens}, 卖出比: ${t.sellRatio.toFixed(2)}`);
  });

  // 4. 与现有列表对比
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

  if (overlapTraders.length > 0) {
    console.log('\n重叠的强势交易者（验证）:');
    overlapTraders.slice(0, 10).forEach(t => {
      console.log(`  ${t.wallet.slice(0, 10)}...${t.wallet.slice(-6)}`);
    });
  }

  // 5. 输出结果
  const finalList = new Set([...existingTraders]);
  newTraders.forEach(t => finalList.add(t.wallet));

  console.log('\n========================================');
  console.log('  最终结果');
  console.log('========================================\n');

  console.log(`更新后强势交易者总数: ${finalList.size}`);
  console.log(`新增: ${newTraders.length}`);
  console.log(`保留: ${existingSet.size}`);

  // 输出需要更新的代码
  console.log('\n========================================');
  console.log('  更新代码');
  console.log('========================================\n');

  console.log('请在 STRONG_TRADERS.js 中更新:');
  console.log(`const STRONG_TRADERS_VERSION = 'v2';`);
  console.log(`const STRONG_TRADERS_SOURCE_EXPERIMENTS = [`);
  console.log(`  '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1', // 原始实验`);
  experiments.forEach(exp => {
    console.log(`  '${exp.id}', // ${exp.name}`);
  });
  console.log(`];`);
  console.log(`\nconst STRONG_TRADERS = new Set([`);
  Array.from(finalList).forEach(addr => {
    console.log(`  '${addr}',`);
  });
  console.log(`]);`);

  // 保存详细结果到文件
  const fs = require('fs');
  const resultPath = '/Users/nobody1/Desktop/Codes/richer-js/scripts/strong_trader_analysis/expanded_strong_traders.json';
  fs.writeFileSync(resultPath, JSON.stringify({
    version: 'v2',
    sourceExperiments: experiments.map(e => ({ id: e.id, name: e.name })),
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
    finalList: Array.from(finalList)
  }, null, 2));

  console.log(`\n详细结果已保存到: ${resultPath}`);
}

main().catch(console.error);
