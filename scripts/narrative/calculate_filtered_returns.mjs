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

/**
 * 获取实验的所有交易
 */
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

/**
 * FIFO盈亏计算
 */
function calculatePnL(trades, excludeTokens = new Set()) {
  const buyQueue = [];
  let totalSpent = 0;
  let totalReceived = 0;
  const tradePairs = [];

  const filteredTrades = trades.filter(t => !excludeTokens.has(t.token_address));
  const excludedTrades = trades.length - filteredTrades.length;

  filteredTrades.forEach(trade => {
    const isBuy = trade.trade_direction === 'buy';
    const inputAmount = parseFloat(trade.input_amount || 0);
    const outputAmount = parseFloat(trade.output_amount || 0);
    const price = parseFloat(trade.unit_price || 0);

    if (isBuy) {
      // 买入: input是BNB，output是代币
      if (outputAmount > 0) {
        buyQueue.push({
          amount: outputAmount,
          cost: inputAmount,
          price: price,
          timestamp: trade.executed_at
        });
        totalSpent += inputAmount;
      }
    } else {
      // 卖出: input是代币，output是BNB
      let remainingToSell = inputAmount;
      let pairCost = 0;
      let pairAmount = 0;

      while (remainingToSell > 0 && buyQueue.length > 0) {
        const oldestBuy = buyQueue[0];
        const sellAmount = Math.min(remainingToSell, oldestBuy.amount);
        const unitCost = oldestBuy.cost / oldestBuy.amount;

        pairCost += unitCost * sellAmount;
        pairAmount += sellAmount;

        remainingToSell -= sellAmount;
        oldestBuy.amount -= sellAmount;
        oldestBuy.cost -= unitCost * sellAmount;

        if (oldestBuy.amount <= 0.00000001) {
          buyQueue.shift();
        }
      }

      if (pairAmount > 0) {
        const pairPnL = outputAmount - pairCost;
        const pairReturnRate = (pairPnL / pairCost) * 100;

        tradePairs.push({
          buyPrice: buyQueue.length > 0 ? price : null,
          sellPrice: price,
          amount: pairAmount,
          cost: pairCost,
          revenue: outputAmount,
          pnl: pairPnL,
          returnRate: pairReturnRate
        });

        totalReceived += outputAmount;
      }
    }
  });

  const totalPnL = totalReceived - totalSpent;
  const totalReturnRate = totalSpent > 0 ? (totalPnL / totalSpent) * 100 : 0;

  const winTrades = tradePairs.filter(p => p.pnl > 0);
  const lossTrades = tradePairs.filter(p => p.pnl < 0);
  const winRate = tradePairs.length > 0 ? (winTrades.length / tradePairs.length) * 100 : 0;

  return {
    totalTrades: trades.length,
    filteredTrades: excludedTrades,
    effectiveTrades: filteredTrades.length,
    buyCount: filteredTrades.filter(t => t.trade_direction === 'buy').length / 2,
    sellCount: filteredTrades.filter(t => t.trade_direction === 'sell').length / 2,
    totalSpent,
    totalReceived,
    totalPnL,
    totalReturnRate,
    winRate,
    winTrades: winTrades.length,
    lossTrades: lossTrades.length,
    tradePairs
  };
}

/**
 * 主函数
 */
async function main() {
  console.log('=== 叙事过滤收益率分析 ===\n');

  // 加载低质量代币列表
  const lowQualityTokens = new Set(
    JSON.parse(fs.readFileSync('../data/low_quality_tokens.json', 'utf-8'))
  );

  console.log(`低质量叙事代币数量: ${lowQualityTokens.size}`);
  console.log(`过滤地址: ${[...lowQualityTokens].slice(0, 3).join(', ')}...\n`);

  const results = {};

  for (const [shortId, expId] of Object.entries(experiments)) {
    console.log(`\n=== 实验 ${shortId} ===`);

    // 获取交易数据
    const trades = await getTrades(expId);
    console.log(`总交易数: ${trades.length}`);

    // 原始收益率
    const originalPnL = calculatePnL(trades, new Set());

    // 过滤后收益率
    const filteredPnL = calculatePnL(trades, lowQualityTokens);

    console.log(`\n原始:`);
    console.log(`  交易对数: ${originalPnL.buyCount}`);
    console.log(`  总花费: ${originalPnL.totalSpent.toFixed(4)} BNB`);
    console.log(`  总收回: ${originalPnL.totalReceived.toFixed(4)} BNB`);
    console.log(`  盈亏: ${originalPnL.totalPnL.toFixed(4)} BNB`);
    console.log(`  收益率: ${originalPnL.totalReturnRate.toFixed(2)}%`);
    console.log(`  胜率: ${originalPnL.winRate.toFixed(1)}%`);

    console.log(`\n过滤低质量叙事后:`);
    console.log(`  过滤交易: ${filteredPnL.filteredTrades} 笔`);
    console.log(`  交易对数: ${filteredPnL.buyCount}`);
    console.log(`  总花费: ${filteredPnL.totalSpent.toFixed(4)} BNB`);
    console.log(`  总收回: ${filteredPnL.totalReceived.toFixed(4)} BNB`);
    console.log(`  盈亏: ${filteredPnL.totalPnL.toFixed(4)} BNB`);
    console.log(`  收益率: ${filteredPnL.totalReturnRate.toFixed(2)}%`);
    console.log(`  胜率: ${filteredPnL.winRate.toFixed(1)}%`);

    const returnRateDiff = filteredPnL.totalReturnRate - originalPnL.totalReturnRate;
    const winRateDiff = filteredPnL.winRate - originalPnL.winRate;

    console.log(`\n变化:`);
    console.log(`  收益率: ${returnRateDiff >= 0 ? '+' : ''}${returnRateDiff.toFixed(2)}%`);
    console.log(`  胜率: ${winRateDiff >= 0 ? '+' : ''}${winRateDiff.toFixed(1)}%`);

    results[shortId] = {
      expId,
      original: originalPnL,
      filtered: filteredPnL,
      diff: {
        returnRate: returnRateDiff,
        winRate: winRateDiff
      }
    };
  }

  // 汇总分析
  console.log('\n\n=== 三个实验汇总 ===\n');

  const totalOriginal = {
    totalSpent: 0,
    totalReceived: 0,
    totalPnL: 0,
    winRate: 0,
    expCount: 0
  };

  const totalFiltered = {
    totalSpent: 0,
    totalReceived: 0,
    totalPnL: 0,
    winRate: 0,
    expCount: 0
  };

  for (const [shortId, data] of Object.entries(results)) {
    totalOriginal.totalSpent += data.original.totalSpent;
    totalOriginal.totalReceived += data.original.totalReceived;
    totalOriginal.totalPnL += data.original.totalPnL;
    totalOriginal.winRate += data.original.winRate;
    totalOriginal.expCount++;

    totalFiltered.totalSpent += data.filtered.totalSpent;
    totalFiltered.totalReceived += data.filtered.totalReceived;
    totalFiltered.totalPnL += data.filtered.totalPnL;
    totalFiltered.winRate += data.filtered.winRate;
    totalFiltered.expCount++;
  }

  totalOriginal.totalReturnRate = totalOriginal.totalSpent > 0
    ? (totalOriginal.totalPnL / totalOriginal.totalSpent) * 100
    : 0;
  totalFiltered.totalReturnRate = totalFiltered.totalSpent > 0
    ? (totalFiltered.totalPnL / totalFiltered.totalSpent) * 100
    : 0;

  console.log(`原始 (三个实验合计):`);
  console.log(`  总花费: ${totalOriginal.totalSpent.toFixed(4)} BNB`);
  console.log(`  总收回: ${totalOriginal.totalReceived.toFixed(4)} BNB`);
  console.log(`  盈亏: ${totalOriginal.totalPnL.toFixed(4)} BNB`);
  console.log(`  收益率: ${totalOriginal.totalReturnRate.toFixed(2)}%`);
  console.log(`  平均胜率: ${(totalOriginal.winRate / totalOriginal.expCount).toFixed(1)}%`);

  console.log(`\n过滤低质量叙事后 (三个实验合计):`);
  console.log(`  总花费: ${totalFiltered.totalSpent.toFixed(4)} BNB`);
  console.log(`  总收回: ${totalFiltered.totalReceived.toFixed(4)} BNB`);
  console.log(`  盈亏: ${totalFiltered.totalPnL.toFixed(4)} BNB`);
  console.log(`  收益率: ${totalFiltered.totalReturnRate.toFixed(2)}%`);
  console.log(`  平均胜率: ${(totalFiltered.winRate / totalFiltered.expCount).toFixed(1)}%`);

  const overallReturnDiff = totalFiltered.totalReturnRate - totalOriginal.totalReturnRate;
  const overallWinRateDiff = (totalFiltered.winRate / totalFiltered.expCount) - (totalOriginal.winRate / totalOriginal.expCount);

  console.log(`\n=== 总体变化 ===`);
  console.log(`  收益率变化: ${overallReturnDiff >= 0 ? '+' : ''}${overallReturnDiff.toFixed(2)}%`);
  console.log(`  胜率变化: ${overallWinRateDiff >= 0 ? '+' : ''}${overallWinRateDiff.toFixed(1)}%`);

  // 保存结果
  fs.writeFileSync(
    '../data/narrative_filter_returns.json',
    JSON.stringify({
      experiments: results,
      summary: {
        original: totalOriginal,
        filtered: totalFiltered,
        diff: {
          returnRate: overallReturnDiff,
          winRate: overallWinRateDiff
        }
      }
    }, null, 2)
  );

  console.log('\n结果已保存到 data/narrative_filter_returns.json');
}

main().catch(err => {
  console.error('错误:', err);
  process.exit(1);
});
