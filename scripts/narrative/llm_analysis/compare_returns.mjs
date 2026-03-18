/**
 * 对比规则评分和LLM评分的投资收益
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../../../config/.env') });

const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const experiments = {
  '70fea05f': '70fea05f-2ed5-4b82-86d2-3dcddf27ab11',
  '7855de6d': '7855de6d-5f74-4884-a44e-3c2c2b351259',
  'e3c37811': 'e3c37811-f050-436e-b446-f51f6895bfb8'
};

async function getTrades(expId) {
  const { data } = await client
    .from('trades')
    .select('*')
    .eq('experiment_id', expId)
    .eq('success', true)
    .order('executed_at', { ascending: true });
  return data || [];
}

/**
 * FIFO PnL计算
 */
function calculatePnL(trades, excludeTokens = new Set()) {
  const buyQueue = [];
  let totalSpent = 0;
  let totalReceived = 0;

  const filteredTrades = trades.filter(t => !excludeTokens.has(t.token_address));

  const tokenPnLs = new Map();

  filteredTrades.forEach(trade => {
    const isBuy = trade.trade_direction === 'buy';
    const inputAmount = parseFloat(trade.input_amount || 0);
    const outputAmount = parseFloat(trade.output_amount || 0);

    if (isBuy) {
      if (outputAmount > 0) {
        buyQueue.push({ amount: outputAmount, cost: inputAmount });
        totalSpent += inputAmount;
      }
    } else {
      let remainingToSell = inputAmount;
      let pairCost = 0;

      while (remainingToSell > 0 && buyQueue.length > 0) {
        const oldestBuy = buyQueue[0];
        const sellAmount = Math.min(remainingToSell, oldestBuy.amount);
        const unitCost = oldestBuy.cost / oldestBuy.amount;

        pairCost += unitCost * sellAmount;
        remainingToSell -= sellAmount;
        oldestBuy.amount -= sellAmount;

        if (oldestBuy.amount <= 0.00000001) {
          buyQueue.shift();
        }
      }

      const pairRevenue = outputAmount;

      if (!tokenPnLs.has(trade.token_address)) {
        tokenPnLs.set(trade.token_address, { totalCost: 0, totalRevenue: 0, pairs: 0 });
      }
      const tokenStat = tokenPnLs.get(trade.token_address);
      tokenStat.totalCost += pairCost;
      tokenStat.totalRevenue += pairRevenue;
      tokenStat.pairs++;

      totalReceived += pairRevenue;
    }
  });

  let winningPairs = 0;
  let totalPairs = 0;

  tokenPnLs.forEach(stat => {
    totalPairs += stat.pairs;
    if (stat.totalRevenue > stat.totalCost) {
      winningPairs += stat.pairs;
    }
  });

  const winRate = totalPairs > 0 ? (winningPairs / totalPairs) * 100 : 0;

  const totalPnL = totalReceived - totalSpent;
  const totalReturnRate = totalSpent > 0 ? (totalPnL / totalSpent) * 100 : 0;

  return {
    totalTrades: trades.length,
    filteredTrades: trades.length - filteredTrades.length,
    effectiveTrades: filteredTrades.length,
    totalSpent,
    totalReceived,
    totalPnL,
    totalReturnRate,
    totalPairs,
    winningPairs,
    winRate
  };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('           规则评分 vs LLM评分 - 投资收益对比');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 加载LLM评分数据
  const llmDataPath = path.resolve(__dirname, '../data/llm_narrative_scores.json');
  let llmData = {};

  try {
    llmData = JSON.parse(fs.readFileSync(llmDataPath, 'utf-8'));
  } catch (error) {
    console.error('❌ 未找到LLM评分数据，请先运行 analyze_narratives_llm.mjs');
    process.exit(1);
  }

  // 加载规则评分数据
  const ruleDataPath = path.resolve(__dirname, '../data/combined_narrative_scores.json');
  const ruleData = JSON.parse(fs.readFileSync(ruleDataPath, 'utf-8'));

  // 收集低质量代币地址
  const ruleLowQuality = new Set();
  const llmLowQuality = new Set();

  for (const [expId, expData] of Object.entries(ruleData)) {
    for (const t of expData.tokens) {
      if (t.narrative_category === 'low') {
        ruleLowQuality.add(t.address);
      }
    }
  }

  for (const [expId, expData] of Object.entries(llmData)) {
    for (const t of expData.tokens) {
      // 只过滤low质量，unrated代币保留（不过滤也不计入统计）
      if (t.llmCategory === 'low') {
        llmLowQuality.add(t.address);
      }
    }
  }

  console.log(`规则低质量代币: ${ruleLowQuality.size}个`);
  console.log(`LLM低质量代币: ${llmLowQuality.size}个`);

  // 计算unrated代币数量
  let unratedCount = 0;
  for (const [expId, expData] of Object.entries(llmData)) {
    for (const t of expData.tokens) {
      if (t.llmCategory === 'unrated') {
        unratedCount++;
      }
    }
  }
  console.log(`LLM无评级代币: ${unratedCount}个 (不计入统计)\n`);

  // 计算各实验收益
  const results = {};

  for (const [shortId, expId] of Object.entries(experiments)) {
    const trades = await getTrades(expId);

    const original = calculatePnL(trades, new Set());
    const ruleFiltered = calculatePnL(trades, ruleLowQuality);
    const llmFiltered = calculatePnL(trades, llmLowQuality);

    results[shortId] = {
      expId,
      original,
      ruleFiltered,
      llmFiltered
    };
  }

  // 汇总
  const sumMetrics = (key, filterType) => {
    return Object.values(results).reduce((sum, r) => sum + r[filterType][key], 0);
  };

  const calculateAggregated = (filterType) => {
    const totalSpent = sumMetrics('totalSpent', filterType);
    const totalReceived = sumMetrics('totalReceived', filterType);
    const totalPnL = totalReceived - totalSpent;
    const totalReturnRate = totalSpent > 0 ? (totalPnL / totalSpent) * 100 : 0;
    const totalPairs = sumMetrics('totalPairs', filterType);
    const winningPairs = sumMetrics('winningPairs', filterType);
    const winRate = totalPairs > 0 ? (winningPairs / totalPairs) * 100 : 0;

    return { totalSpent, totalReceived, totalPnL, totalReturnRate, totalPairs, winningPairs, winRate };
  };

  const original = calculateAggregated('original');
  const ruleFiltered = calculateAggregated('ruleFiltered');
  const llmFiltered = calculateAggregated('llmFiltered');

  // 打印对比表
  console.log('┌──────────────────┬─────────────┬─────────────┬─────────────┐');
  console.log('│   评分方式       │   收益率    │   交易对    │    胜率     │');
  console.log('├──────────────────┼─────────────┼─────────────┼─────────────┤');

  console.log(`│ 原始（无过滤）   │ ${original.totalReturnRate.toFixed(5).padStart(9)}% │ ${String(original.totalPairs).padStart(9)} │ ${original.winRate.toFixed(4).padStart(9)}% │`);
  console.log(`│ 规则评分过滤     │ ${ruleFiltered.totalReturnRate.toFixed(5).padStart(9)}% │ ${String(ruleFiltered.totalPairs).padStart(9)} │ ${ruleFiltered.winRate.toFixed(4).padStart(9)}% │`);
  console.log(`│ LLM评分过滤      │ ${llmFiltered.totalReturnRate.toFixed(5).padStart(9)}% │ ${String(llmFiltered.totalPairs).padStart(9)} │ ${llmFiltered.winRate.toFixed(4).padStart(9)}% │`);

  console.log('└──────────────────┴─────────────┴─────────────┴─────────────┘');

  // 计算改进幅度
  const ruleImprovement = ruleFiltered.totalReturnRate - original.totalReturnRate;
  const llmImprovement = llmFiltered.totalReturnRate - original.totalReturnRate;

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                          结论');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`规则评分过滤: 收益率 ${ruleImprovement >= 0 ? '+' : ''}${ruleImprovement.toFixed(2)}%`);
  console.log(`LLM评分过滤:  收益率 ${llmImprovement >= 0 ? '+' : ''}${llmImprovement.toFixed(2)}%`);

  if (Math.abs(ruleImprovement - llmImprovement) < 1) {
    console.log('\n✅ 两种评分方法效果相当');
  } else if (llmImprovement > ruleImprovement) {
    console.log('\n🎯 LLM评分效果更好！');
  } else {
    console.log('\n🎯 规则评分效果更好！');
  }

  // 保存对比结果
  const outputPath = path.resolve(__dirname, '../data/scoring_comparison_v2.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    original,
    ruleFiltered,
    llmFiltered,
    ruleImprovement,
    llmImprovement,
    perExperiment: results
  }, null, 2));

  console.log(`\n💾 对比结果已保存: ${outputPath}`);
}

main().catch(console.error);
