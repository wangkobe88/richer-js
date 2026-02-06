#!/usr/bin/env node
/**
 * 对比两个实验的效果
 * 原实验: 004ac5ac-4589-47da-a332-44c76141b1b5 (无fdv限制)
 * 回测实验: 5f8978ca-dd63-46ac-8878-a5bdd319805d (有fdv < 8000限制)
 */

require('dotenv').config({ path: '../config/.env' });
const { ExperimentDataService } = require('../src/web/services/ExperimentDataService');

const ORIGINAL_EXP = '004ac5ac-4589-47da-a332-44c76141b1b5';
const BACKTEST_EXP = '5f8978ca-dd63-46ac-8878-a5bdd319805d';

async function main() {
  const dataService = new ExperimentDataService();

  console.log(`\n=== 对比分析实验 ===\n`);
  console.log(`原实验: ${ORIGINAL_EXP}`);
  console.log(`回测实验: ${BACKTEST_EXP}\n`);

  // 获取两个实验的数据
  const [originalTrades, backtestTrades] = await Promise.all([
    dataService.getTrades(ORIGINAL_EXP, { limit: 10000 }),
    dataService.getTrades(BACKTEST_EXP, { limit: 10000 })
  ]);

  // 计算收益
  const originalPnL = calculateTokensPnL(originalTrades);
  const backtestPnL = calculateTokensPnL(backtestTrades);

  console.log(`=== 原实验（无fdv限制）===`);
  printStats(originalPnL);

  console.log(`\n=== 回测实验（fdv < 8000）===`);
  printStats(backtestPnL);

  // 分析被过滤掉的代币
  console.log(`\n=== 被fdv < 8000过滤掉的代币分析 ===`);

  // 获取原实验的信号
  const { dbManager } = require('../src/services/dbManager');
  const supabase = dbManager.getClient();

  const { data: originalSignals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', ORIGINAL_EXP);

  // 按代币分组买入信号
  const buySignals = originalSignals.filter(s => s.signalType === 'BUY' || s.action === 'buy');

  // 找出原实验中fdv >= 8000的代币
  const highFDVTokens = [];
  const tokenAddresses = [...new Set(buySignals.map(s => s.tokenAddress))];

  tokenAddresses.forEach(tokenAddr => {
    const tokenSignals = buySignals.filter(s => s.tokenAddress === tokenAddr);
    const firstBuy = tokenSignals[0];
    if (!firstBuy) return;

    const fdv = firstBuy.metadata?.fdv || 0;
    if (fdv >= 8000) {
      const pnl = originalPnL.find(p => p.tokenAddress === tokenAddr);
      if (pnl) {
        highFDVTokens.push({
          tokenAddress: tokenAddr,
          symbol: firstBuy.tokenSymbol,
          fdv,
          returnRate: pnl.returnRate,
          realizedPnL: pnl.realizedPnL
        });
      }
    }
  });

  highFDVTokens.sort((a, b) => b.returnRate - a.returnRate);

  console.log(`\n原实验中 fdv >= 8000 的代币 (${highFDVTokens.length}个):`);
  console.log(`这些代币被回测实验过滤掉了\n`);

  let profitCount = 0;
  let lossCount = 0;
  let totalProfit = 0;
  let totalLoss = 0;

  highFDVTokens.forEach(t => {
    const icon = t.returnRate > 0 ? '✅' : '❌';
    console.log(`${icon} ${t.symbol.padEnd(15)} fdv: ${t.fdv.toFixed(0)}, 收益: ${(t.returnRate > 0 ? '+' : '')}${t.returnRate.toFixed(2)}%, 盈亏: ${(t.realizedPnL > 0 ? '+' : '')}${t.realizedPnL.toFixed(4)} BNB`);

    if (t.returnRate > 0) {
      profitCount++;
      totalProfit += t.realizedPnL;
    } else {
      lossCount++;
      totalLoss += t.realizedPnL;
    }
  });

  console.log(`\n被过滤代币汇总:`);
  console.log(`  盈利代币: ${profitCount}个, 总盈利: +${totalProfit.toFixed(4)} BNB`);
  console.log(`  亏损代币: ${lossCount}个, 总亏损: ${totalLoss.toFixed(4)} BNB`);
  console.log(`  净盈亏: ${(totalProfit + totalLoss).toFixed(4)} BNB`);

  // 对比结果
  console.log(`\n=== 结论 ===`);
  console.log(`加上 fdv < 8000 限制后:`);
  console.log(`  - 过滤了 ${highFDVTokens.length} 个高FDV代币`);
  console.log(`  - 错过了 ${profitCount} 个盈利代币（总计 +${totalProfit.toFixed(4)} BNB）`);
  console.log(`  - 避开了 ${lossCount} 个亏损代币（总计 ${totalLoss.toFixed(4)} BNB）`);
  console.log(`  - 净损失: ${(totalProfit + totalLoss).toFixed(4)} BNB`);
}

function printStats(tokenPnL) {
  const profit = tokenPnL.filter(t => t.returnRate > 0);
  const loss = tokenPnL.filter(t => t.returnRate < 0);

  const totalProfit = profit.reduce((sum, t) => sum + t.realizedPnL, 0);
  const totalLoss = loss.reduce((sum, t) => sum + t.realizedPnL, 0);

  console.log(`  代币数: ${tokenPnL.length}`);
  console.log(`  盈利: ${profit.length}个, 总盈利: +${totalProfit.toFixed(4)} BNB`);
  console.log(`  亏损: ${loss.length}个, 总亏损: ${totalLoss.toFixed(4)} BNB`);
  console.log(`  净盈亏: ${(totalProfit + totalLoss).toFixed(4)} BNB`);

  if (tokenPnL.length > 0) {
    const avgReturn = tokenPnL.reduce((sum, t) => sum + t.returnRate, 0) / tokenPnL.length;
    console.log(`  平均收益率: ${avgReturn.toFixed(2)}%`);
  }
}

function calculateTokensPnL(trades) {
  const tokenTrades = {};
  const tokenAddresses = [...new Set(trades.map(t => t.tokenAddress))];

  tokenAddresses.forEach(tokenAddress => {
    const tokenTradeList = trades.filter(t => t.tokenAddress === tokenAddress);
    const pnl = calculateTokenPnL(tokenTradeList);
    if (pnl) {
      tokenTrades[tokenAddress] = {
        tokenAddress,
        symbol: tokenTradeList[0]?.tokenSymbol || 'Unknown',
        ...pnl
      };
    }
  });

  return Object.values(tokenTrades);
}

function calculateTokenPnL(tokenTrades) {
  const sortedTrades = [...tokenTrades].sort((a, b) =>
    new Date(a.createdAt || a.created_at) - new Date(b.createdAt || b.created_at)
  );

  const buyQueue = [];
  let totalRealizedPnL = 0;
  let totalBNBSpent = 0;
  let totalBNBReceived = 0;

  sortedTrades.forEach(trade => {
    const direction = trade.tradeDirection || trade.direction;
    const isBuy = direction === 'buy';

    if (isBuy) {
      const inputAmount = parseFloat(trade.inputAmount || trade.input_amount);
      const outputAmount = parseFloat(trade.outputAmount || trade.output_amount);
      buyQueue.push({ amount: outputAmount, cost: inputAmount });
      totalBNBSpent += inputAmount;
    } else {
      const inputAmount = parseFloat(trade.inputAmount || trade.input_amount);
      const outputAmount = parseFloat(trade.outputAmount || trade.output_amount);

      let remainingToSell = inputAmount;
      let costOfSold = 0;

      while (remainingToSell > 0 && buyQueue.length > 0) {
        const oldestBuy = buyQueue[0];
        const sellAmount = Math.min(remainingToSell, oldestBuy.amount);
        const unitCost = oldestBuy.cost / oldestBuy.amount;
        costOfSold += unitCost * sellAmount;
        remainingToSell -= sellAmount;
        oldestBuy.amount -= sellAmount;

        if (oldestBuy.amount <= 0.00000001) {
          buyQueue.shift();
        }
      }

      totalBNBReceived += outputAmount;
      totalRealizedPnL += (outputAmount - costOfSold);
    }
  });

  let remainingCost = 0;
  buyQueue.forEach(buy => {
    remainingCost += buy.cost;
  });

  const totalCost = totalBNBSpent || 1;
  const totalValue = totalBNBReceived + remainingCost;
  const returnRate = ((totalValue - totalCost) / totalCost) * 100;

  return {
    returnRate,
    realizedPnL: totalRealizedPnL,
    totalSpent: totalBNBSpent,
    totalReceived: totalBNBReceived,
    remainingCost
  };
}

main().catch(console.error);
