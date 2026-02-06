#!/usr/bin/env node
/**
 * 测试组合过滤条件
 * 目标: 找出能最大化保留盈利代币同时过滤亏损代币的条件组合
 */

require('dotenv').config({ path: '../config/.env' });
const { ExperimentDataService } = require('../src/web/services/ExperimentDataService');
const { ExperimentTimeSeriesService } = require('../src/web/services/ExperimentTimeSeriesService');

const EXPERIMENT_ID = '004ac5ac-4589-47da-a332-44c76141b1b5';

async function main() {
  const dataService = new ExperimentDataService();
  const timeSeriesService = new ExperimentTimeSeriesService();

  console.log(`\n=== 测试组合过滤条件 ===\n`);

  // 获取数据
  const [trades, signals] = await Promise.all([
    dataService.getTrades(EXPERIMENT_ID, { limit: 10000 }),
    dataService.getSignals(EXPERIMENT_ID, { limit: 10000 })
  ]);

  // 计算每个代币的收益率
  const tokenPnL = calculateTokensPnL(trades);

  // 获取买入信号和时序数据
  const buySignals = signals.filter(s => s.signalType === 'BUY' || s.action === 'buy');

  const results = [];
  for (const token of tokenPnL) {
    const tokenSignals = buySignals.filter(s => s.tokenAddress === token.tokenAddress);
    const firstBuy = tokenSignals[0];
    if (!firstBuy) continue;

    // 获取时序数据
    const timeSeriesData = await timeSeriesService.getExperimentTimeSeries(
      EXPERIMENT_ID,
      token.tokenAddress,
      { limit: 200 }
    );

    if (timeSeriesData.length === 0) continue;

    // 找到买入时刻的数据
    const buyTime = new Date(firstBuy.createdAt || firstBuy.created_at);
    const buyData = timeSeriesData.find(d => {
      const dataTime = new Date(d.timestamp);
      return Math.abs(dataTime - buyTime) < 60000;
    });

    results.push({
      ...token,
      buyData: buyData || timeSeriesData[0],
      signalMeta: firstBuy.metadata || {}
    });
  }

  console.log(`有完整数据的代币: ${results.length}\n`);

  // 定义测试条件
  const conditions = [
    { name: 'riseSpeed < 80', filter: r => (r.buyData?.factor_values?.riseSpeed ?? 100) < 80 },
    { name: 'riseSpeed < 70', filter: r => (r.buyData?.factor_values?.riseSpeed ?? 100) < 70 },
    { name: 'riseSpeed < 60', filter: r => (r.buyData?.factor_values?.riseSpeed ?? 100) < 60 },
    { name: 'fdv < 12000', filter: r => (r.buyData?.factor_values?.fdv ?? 0) < 12000 },
    { name: 'fdv < 10000', filter: r => (r.buyData?.factor_values?.fdv ?? 0) < 10000 },
    { name: 'txVolumeU24h < 8000', filter: r => (r.buyData?.factor_values?.txVolumeU24h ?? 0) < 8000 },
    { name: 'txVolumeU24h < 5000', filter: r => (r.buyData?.factor_values?.txVolumeU24h ?? 0) < 5000 },
    { name: 'holders < 50', filter: r => (r.buyData?.factor_values?.holders ?? 0) < 50 },
    { name: 'holders < 40', filter: r => (r.buyData?.factor_values?.holders ?? 0) < 40 },
    { name: 'age > 0.5', filter: r => (r.buyData?.factor_values?.age ?? 0) > 0.5 },
    { name: 'age > 1.0', filter: r => (r.buyData?.factor_values?.age ?? 0) > 1.0 },
    { name: 'drawdownFromHighest > -2', filter: r => (r.buyData?.factor_values?.drawdownFromHighest ?? 0) > -2 },
  ];

  // 测试组合条件
  const combinations = [
    { name: 'riseSpeed < 80', filter: r => (r.buyData?.factor_values?.riseSpeed ?? 100) < 80 },
    { name: 'riseSpeed < 70', filter: r => (r.buyData?.factor_values?.riseSpeed ?? 100) < 70 },
    { name: 'riseSpeed < 80 && fdv < 12000', filter: r => (r.buyData?.factor_values?.riseSpeed ?? 100) < 80 && (r.buyData?.factor_values?.fdv ?? 0) < 12000 },
    { name: 'riseSpeed < 80 && fdv < 10000', filter: r => (r.buyData?.factor_values?.riseSpeed ?? 100) < 80 && (r.buyData?.factor_values?.fdv ?? 0) < 10000 },
    { name: 'riseSpeed < 70 && fdv < 12000', filter: r => (r.buyData?.factor_values?.riseSpeed ?? 100) < 70 && (r.buyData?.factor_values?.fdv ?? 0) < 12000 },
    { name: 'riseSpeed < 70 && fdv < 10000', filter: r => (r.buyData?.factor_values?.riseSpeed ?? 100) < 70 && (r.buyData?.factor_values?.fdv ?? 0) < 10000 },
    { name: 'riseSpeed < 80 && holders < 50', filter: r => (r.buyData?.factor_values?.riseSpeed ?? 100) < 80 && (r.buyData?.factor_values?.holders ?? 0) < 50 },
    { name: 'riseSpeed < 70 && holders < 50', filter: r => (r.buyData?.factor_values?.riseSpeed ?? 100) < 70 && (r.buyData?.factor_values?.holders ?? 0) < 50 },
    { name: 'riseSpeed < 60 && holders < 50', filter: r => (r.buyData?.factor_values?.riseSpeed ?? 100) < 60 && (r.buyData?.factor_values?.holders ?? 0) < 50 },
    { name: 'riseSpeed < 80 && txVolumeU24h < 8000', filter: r => (r.buyData?.factor_values?.riseSpeed ?? 100) < 80 && (r.buyData?.factor_values?.txVolumeU24h ?? 0) < 8000 },
    { name: 'riseSpeed < 70 && txVolumeU24h < 8000', filter: r => (r.buyData?.factor_values?.riseSpeed ?? 100) < 70 && (r.buyData?.factor_values?.txVolumeU24h ?? 0) < 8000 },
    { name: 'riseSpeed < 60 && txVolumeU24h < 5000', filter: r => (r.buyData?.factor_values?.riseSpeed ?? 100) < 60 && (r.buyData?.factor_values?.txVolumeU24h ?? 0) < 5000 },
    { name: 'fdv < 10000 && holders < 40', filter: r => (r.buyData?.factor_values?.fdv ?? 0) < 10000 && (r.buyData?.factor_values?.holders ?? 0) < 40 },
    { name: 'age > 1.0 && riseSpeed < 80', filter: r => (r.buyData?.factor_values?.age ?? 0) > 1.0 && (r.buyData?.factor_values?.riseSpeed ?? 100) < 80 },
    { name: 'age > 0.5 && riseSpeed < 70', filter: r => (r.buyData?.factor_values?.age ?? 0) > 0.5 && (r.buyData?.factor_values?.riseSpeed ?? 100) < 70 },
  ];

  // 单条件测试
  console.log('=== 单条件测试 ===');
  conditions.forEach(cond => {
    const passed = results.filter(cond.filter);
    const profitPassed = passed.filter(r => r.returnRate > 0);
    const lossPassed = passed.filter(r => r.returnRate < 0);
    const profitFiltered = results.filter(r => r.returnRate > 0 && !cond.filter(r));
    const lossFiltered = results.filter(r => r.returnRate < 0 && !cond.filter(r));

    console.log(`\n${cond.name}:`);
    console.log(`  通过数量: ${passed.length}/${results.length}`);
    console.log(`  盈利通过: ${profitPassed.length}/${results.filter(r => r.returnRate > 0).length} (${(profitPassed.length / Math.max(1, results.filter(r => r.returnRate > 0).length) * 100).toFixed(1)}%)`);
    console.log(`  亏损通过: ${lossPassed.length}/${results.filter(r => r.returnRate < 0).length} (${(lossPassed.length / Math.max(1, results.filter(r => r.returnRate < 0).length) * 100).toFixed(1)}%)`);
    console.log(`  过滤亏损: ${lossFiltered.length}/${results.filter(r => r.returnRate < 0).length} (${(lossFiltered.length / Math.max(1, results.filter(r => r.returnRate < 0).length) * 100).toFixed(1)}%)`);

    // 计算通过后的平均收益率
    if (passed.length > 0) {
      const avgReturn = passed.reduce((sum, r) => sum + r.returnRate, 0) / passed.length;
      console.log(`  通过后平均收益率: ${avgReturn.toFixed(2)}%`);
    }
  });

  // 组合条件测试
  console.log(`\n\n=== 组合条件测试 ===`);
  const bestCombos = [];

  combinations.forEach(cond => {
    const passed = results.filter(cond.filter);
    const profitPassed = passed.filter(r => r.returnRate > 0);
    const lossPassed = passed.filter(r => r.returnRate < 0);
    const profitFiltered = results.filter(r => r.returnRate > 0 && !cond.filter(r));
    const lossFiltered = results.filter(r => r.returnRate < 0 && !cond.filter(r));

    const totalProfit = results.filter(r => r.returnRate > 0).length;
    const totalLoss = results.filter(r => r.returnRate < 0).length;

    const profitKeepRate = profitPassed.length / totalProfit;
    const lossFilterRate = lossFiltered.length / totalLoss;
    const avgReturn = passed.length > 0 ? passed.reduce((sum, r) => sum + r.returnRate, 0) / passed.length : 0;

    bestCombos.push({
      name: cond.name,
      passed: passed.length,
      profitKeepRate,
      lossFilterRate,
      avgReturn,
      profitPassed: profitPassed.length,
      lossFiltered: lossFiltered.length
    });

    console.log(`\n${cond.name}:`);
    console.log(`  通过: ${passed.length}/${results.length}`);
    console.log(`  保留盈利: ${profitPassed.length}/${totalProfit} (${(profitKeepRate * 100).toFixed(1)}%)`);
    console.log(`  过滤亏损: ${lossFiltered.length}/${totalLoss} (${(lossFilterRate * 100).toFixed(1)}%)`);
    console.log(`  平均收益率: ${avgReturn.toFixed(2)}%`);
  });

  // 找出最佳组合
  console.log(`\n\n=== 最佳组合（兼顾保留盈利和过滤亏损）===`);
  bestCombos.sort((a, b) => {
    // 综合评分：保留盈利率 - 损失亏损率
    const scoreA = a.profitKeepRate - (1 - a.lossFilterRate);
    const scoreB = b.profitKeepRate - (1 - b.lossFilterRate);
    return scoreB - scoreA;
  });

  bestCombos.slice(0, 5).forEach((combo, i) => {
    const score = combo.profitKeepRate - (1 - combo.lossFilterRate);
    console.log(`${i + 1}. ${combo.name}`);
    console.log(`   保留盈利: ${(combo.profitKeepRate * 100).toFixed(1)}%, 过滤亏损: ${(combo.lossFilterRate * 100).toFixed(1)}%`);
    console.log(`   综合得分: ${score.toFixed(3)}, 平均收益: ${combo.avgReturn.toFixed(2)}%`);
  });

  // 打印被过滤掉的代币详情
  console.log(`\n\n=== 使用最佳条件过滤的代币详情 ===`);
  const bestCombo = bestCombos[0];
  const bestFilter = combinations.find(c => c.name === bestCombo.name);

  if (bestFilter) {
    const passed = results.filter(bestFilter.filter);
    const filtered = results.filter(r => !bestFilter.filter(r));

    console.log(`\n条件: ${bestCombo.name}`);
    console.log(`\n通过条件的代币 (${passed.length}个):`);
    passed.forEach(r => {
      const icon = r.returnRate > 0 ? '✅' : '❌';
      const riseSpeed = r.buyData?.factor_values?.riseSpeed ?? 'N/A';
      const fdv = r.buyData?.factor_values?.fdv ?? 'N/A';
      console.log(`  ${icon} ${r.symbol.padEnd(15)} 收益: ${(r.returnRate > 0 ? '+' : '')}${r.returnRate.toFixed(2)}%, riseSpeed: ${typeof riseSpeed === 'number' ? riseSpeed.toFixed(2) : riseSpeed}, fdv: ${typeof fdv === 'number' ? fdv.toFixed(0) : fdv}`);
    });

    console.log(`\n被过滤的代币 (${filtered.length}个):`);
    filtered.forEach(r => {
      const icon = r.returnRate > 0 ? '✅' : '❌';
      const riseSpeed = r.buyData?.factor_values?.riseSpeed ?? 'N/A';
      const fdv = r.buyData?.factor_values?.fdv ?? 'N/A';
      console.log(`  ${icon} ${r.symbol.padEnd(15)} 收益: ${(r.returnRate > 0 ? '+' : '')}${r.returnRate.toFixed(2)}%, riseSpeed: ${typeof riseSpeed === 'number' ? riseSpeed.toFixed(2) : riseSpeed}, fdv: ${typeof fdv === 'number' ? fdv.toFixed(0) : fdv}`);
    });
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
  let buyCount = 0;
  let sellCount = 0;

  sortedTrades.forEach(trade => {
    const direction = trade.tradeDirection || trade.direction;
    const isBuy = direction === 'buy';

    if (isBuy) {
      const inputAmount = parseFloat(trade.inputAmount || trade.input_amount);
      const outputAmount = parseFloat(trade.outputAmount || trade.output_amount);

      buyQueue.push({
        amount: outputAmount,
        cost: inputAmount
      });
      totalBNBSpent += inputAmount;
      buyCount++;
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
      sellCount++;
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
    remainingCost,
    buyCount,
    sellCount
  };
}

main().catch(console.error);
