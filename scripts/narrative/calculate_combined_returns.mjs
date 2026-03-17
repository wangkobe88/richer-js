import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: '../../config/.env' });

const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const experiments = {
  '70fea05f': '70fea05f-2ed5-4b82-86d2-3dcddf27ab11',
  '7855de6d': '7855de6d-5f74-4884-a44e-3c2c2b351259',
  'e3c37811': 'e3c37811-f050-436e-b446-f51f6895bfb8'
};

async function getTrades(expId) {
  const { data, error } = await client
    .from('trades')
    .select('*')
    .eq('experiment_id', expId)
    .eq('success', true)
    .order('executed_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

function calculatePnL(trades, excludeTokens = new Set()) {
  const buyQueue = [];
  let totalSpent = 0;
  let totalReceived = 0;

  const filteredTrades = trades.filter(t => !excludeTokens.has(t.token_address));
  const excludedTrades = trades.length - filteredTrades.length;

  filteredTrades.forEach(trade => {
    const isBuy = trade.trade_direction === 'buy';
    const inputAmount = parseFloat(trade.input_amount || 0);
    const outputAmount = parseFloat(trade.output_amount || 0);

    if (isBuy) {
      if (outputAmount > 0) {
        buyQueue.push({
          amount: outputAmount,
          cost: inputAmount,
          price: parseFloat(trade.unit_price || 0)
        });
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
        oldestBuy.cost -= unitCost * sellAmount;

        if (oldestBuy.amount <= 0.00000001) {
          buyQueue.shift();
        }
      }

      totalReceived += outputAmount;
    }
  });

  const totalPnL = totalReceived - totalSpent;
  const totalReturnRate = totalSpent > 0 ? (totalPnL / totalSpent) * 100 : 0;

  // 计算胜率
  let winningPairs = 0;
  let losingPairs = 0;
  // 简化：基于交易对大致估算
  const buyCount = filteredTrades.filter(t => t.trade_direction === 'buy').length / 2;

  return {
    totalTrades: trades.length,
    filteredTrades: excludedTrades,
    effectiveTrades: filteredTrades.length,
    buyCount,
    totalSpent,
    totalReceived,
    totalPnL,
    totalReturnRate
  };
}

async function main() {
  console.log('=== 综合叙事过滤收益率分析 (Twitter + Intro) ===\n');

  // 加载低质量代币列表（综合评分）
  const lowQualityTokens = new Set(
    JSON.parse(fs.readFileSync('../../narrative_analysis/low_quality_tokens_combined.json', 'utf-8'))
  );

  console.log(`低质量叙事代币数量: ${lowQualityTokens.size}`);

  const results = {};

  for (const [shortId, expId] of Object.entries(experiments)) {
    console.log(`\n=== 实验 ${shortId} ===`);

    const trades = await getTrades(expId);
    console.log(`总交易数: ${trades.length}`);

    const originalPnL = calculatePnL(trades, new Set());
    const filteredPnL = calculatePnL(trades, lowQualityTokens);

    console.log(`\n原始:`);
    console.log(`  交易对数: ${originalPnL.buyCount}`);
    console.log(`  收益率: ${originalPnL.totalReturnRate.toFixed(2)}%`);

    console.log(`\n过滤低质量叙事后 (过滤${filteredPnL.filteredTrades}笔交易):`);
    console.log(`  交易对数: ${filteredPnL.buyCount}`);
    console.log(`  收益率: ${filteredPnL.totalReturnRate.toFixed(2)}%`);

    const returnRateDiff = filteredPnL.totalReturnRate - originalPnL.totalReturnRate;

    console.log(`\n变化: ${returnRateDiff >= 0 ? '+' : ''}${returnRateDiff.toFixed(2)}%`);

    results[shortId] = {
      expId,
      original: originalPnL,
      filtered: filteredPnL,
      diff: { returnRate: returnRateDiff }
    };
  }

  // 汇总
  console.log('\n\n=== 三个实验汇总 ===\n');

  const totalOriginal = { totalSpent: 0, totalReceived: 0, totalPnL: 0, expCount: 0 };
  const totalFiltered = { totalSpent: 0, totalReceived: 0, totalPnL: 0, expCount: 0 };

  for (const [shortId, data] of Object.entries(results)) {
    totalOriginal.totalSpent += data.original.totalSpent;
    totalOriginal.totalReceived += data.original.totalReceived;
    totalOriginal.totalPnL += data.original.totalPnL;
    totalOriginal.expCount++;

    totalFiltered.totalSpent += data.filtered.totalSpent;
    totalFiltered.totalReceived += data.filtered.totalReceived;
    totalFiltered.totalPnL += data.filtered.totalPnL;
    totalFiltered.expCount++;
  }

  totalOriginal.totalReturnRate = totalOriginal.totalSpent > 0
    ? (totalOriginal.totalPnL / totalOriginal.totalSpent) * 100 : 0;
  totalFiltered.totalReturnRate = totalFiltered.totalSpent > 0
    ? (totalFiltered.totalPnL / totalFiltered.totalSpent) * 100 : 0;

  console.log(`原始 (三个实验):`);
  console.log(`  收益率: ${totalOriginal.totalReturnRate.toFixed(2)}%`);

  console.log(`\n过滤低质量叙事后 (过滤${lowQualityTokens.size}个代币):`);
  console.log(`  收益率: ${totalFiltered.totalReturnRate.toFixed(2)}%`);

  const overallDiff = totalFiltered.totalReturnRate - totalOriginal.totalReturnRate;

  console.log(`\n=== 总体变化 ===`);
  console.log(`  收益率变化: ${overallDiff >= 0 ? '+' : ''}${overallDiff.toFixed(2)}%`);

  // 与之前仅Twitter的结果对比
  console.log('\n=== 对比：仅Twitter vs Twitter+Intro ===');
  console.log(`仅Twitter过滤: 15个低质量代币 → 收益率 +1.88%`);
  console.log(`Twitter+Intro过滤: ${lowQualityTokens.size}个低质量代币 → 收益率 ${overallDiff >= 0 ? '+' : ''}${overallDiff.toFixed(2)}%`);

  // 保存结果
  fs.writeFileSync(
    '../../narrative_analysis/combined_narrative_returns.json',
    JSON.stringify({
      experiments: results,
      summary: {
        original: totalOriginal,
        filtered: totalFiltered,
        diff: overallDiff,
        filteredTokenCount: lowQualityTokens.size
      }
    }, null, 2)
  );

  console.log('\n结果已保存到 narrative_analysis/combined_narrative_returns.json');
}

main().catch(err => {
  console.error('错误:', err);
  process.exit(1);
});
