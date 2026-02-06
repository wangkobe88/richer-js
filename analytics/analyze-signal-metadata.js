#!/usr/bin/env node
/**
 * 直接分析买入信号的 metadata 因子数据
 */

require('dotenv').config({ path: '../config/.env' });
const { ExperimentDataService } = require('../src/web/services/ExperimentDataService');

const EXPERIMENT_ID = '004ac5ac-4589-47da-a332-44c76141b1b5';

async function main() {
  const dataService = new ExperimentDataService();

  console.log(`\n=== 分析买入信号的 metadata 因子 ===\n`);

  // 获取数据
  const [trades, signals] = await Promise.all([
    dataService.getTrades(EXPERIMENT_ID, { limit: 10000 }),
    dataService.getSignals(EXPERIMENT_ID, { limit: 10000 })
  ]);

  // 计算每个代币的收益率
  const tokenPnL = calculateTokensPnL(trades);

  console.log(`总代币数: ${tokenPnL.length}`);
  console.log(`盈利代币: ${tokenPnL.filter(t => t.returnRate > 0).length}`);
  console.log(`亏损代币: ${tokenPnL.filter(t => t.returnRate < 0).length}\n`);

  // 获取每个代币的第一个买入信号及其 metadata
  const buySignals = signals.filter(s => s.signalType === 'BUY' || s.action === 'buy');

  const results = tokenPnL.map(token => {
    const tokenBuySignals = buySignals.filter(s => s.tokenAddress === token.tokenAddress);
    const firstBuy = tokenBuySignals[0];

    if (!firstBuy) return null;

    return {
      ...token,
      metadata: firstBuy.metadata || {}
    };
  }).filter(r => r !== null);

  // 分组
  const profit = results.filter(r => r.returnRate > 0);
  const loss = results.filter(r => r.returnRate < 0);

  console.log(`有买入信号的代币: ${results.length} (盈利: ${profit.length}, 亏损: ${loss.length})\n`);

  // 分析 metadata 中的因子差异
  console.log(`=== 盈利代币买入信号因子特征 (count=${profit.length}) ===`);
  analyzeMetadata(profit);

  console.log(`\n=== 亏损代币买入信号因子特征 (count=${loss.length}) ===`);
  analyzeMetadata(loss);

  // 找出差异因子
  console.log(`\n=== 寻找过滤条件 ===`);
  findFilterConditions(results);

  // 测试组合条件
  console.log(`\n=== 测试组合条件 ===`);
  testCombinations(results);
}

function analyzeMetadata(tokens) {
  if (tokens.length === 0) {
    console.log('无数据');
    return;
  }

  // 提取所有元数据字段
  const fields = {};

  tokens.forEach(t => {
    const meta = t.metadata;
    Object.keys(meta).forEach(key => {
      if (!fields[key]) fields[key] = [];
      const value = meta[key];
      if (value !== null && value !== undefined && typeof value !== 'object') {
        fields[key].push(value);
      }
    });
  });

  // 统计数值字段
  Object.entries(fields).forEach(([key, values]) => {
    const nums = values.filter(v => typeof v === 'number');
    if (nums.length > 0 && nums.length >= tokens.length * 0.5) { // 至少一半有数据
      const min = Math.min(...nums);
      const max = Math.max(...nums);
      const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
      const median = [...nums].sort((a, b) => a - b)[Math.floor(nums.length / 2)];

      console.log(`  ${key}:`);
      console.log(`    min=${min.toFixed(4)}, max=${max.toFixed(4)}, avg=${avg.toFixed(4)}, median=${median.toFixed(4)}, count=${nums.length}`);
    }
  });
}

function findFilterConditions(results) {
  const profit = results.filter(r => r.returnRate > 0);
  const loss = results.filter(r => r.returnRate < 0);

  // 收集所有数值字段
  const numericFields = new Set();
  results.forEach(r => {
    Object.entries(r.metadata).forEach(([key, value]) => {
      if (typeof value === 'number') {
        numericFields.add(key);
      }
    });
  });

  // 对每个字段找最优阈值
  const candidates = [];

  Array.from(numericFields).forEach(fieldName => {
    // 收集盈利和亏损的因子值
    const profitValues = profit
      .map(r => r.metadata[fieldName])
      .filter(v => typeof v === 'number');

    const lossValues = loss
      .map(r => r.metadata[fieldName])
      .filter(v => typeof v === 'number');

    if (profitValues.length === 0 || lossValues.length === 0) return;

    const profitMin = Math.min(...profitValues);
    const profitMax = Math.max(...profitValues);
    const profitAvg = profitValues.reduce((a, b) => a + b, 0) / profitValues.length;
    const profitMedian = [...profitValues].sort((a, b) => a - b)[Math.floor(profitValues.length / 2)];

    const lossMin = Math.min(...lossValues);
    const lossMax = Math.max(...lossValues);
    const lossAvg = lossValues.reduce((a, b) => a + b, 0) / lossValues.length;
    const lossMedian = [...lossValues].sort((a, b) => a - b)[Math.floor(lossValues.length / 2)];

    console.log(`\n${fieldName}:`);
    console.log(`  盈利: min=${profitMin.toFixed(4)}, max=${profitMax.toFixed(4)}, avg=${profitAvg.toFixed(4)}, median=${profitMedian.toFixed(4)}`);
    console.log(`  亏损: min=${lossMin.toFixed(4)}, max=${lossMax.toFixed(4)}, avg=${lossAvg.toFixed(4)}, median=${lossMedian.toFixed(4)}`);

    // 尝试找阈值
    // 使用中位数作为参考
    if (profitMedian > lossMax) {
      const threshold = profitMedian;
      const filteredLoss = loss.filter(r => (r.metadata[fieldName] || 0) < threshold).length;
      const keptProfit = profit.filter(r => (r.metadata[fieldName] || 0) >= threshold).length;

      console.log(`  🔍 建议阈值: >= ${threshold.toFixed(4)}`);
      console.log(`     可过滤 ${filteredLoss}/${loss.length} 亏损代币 (${(filteredLoss/loss.length*100).toFixed(1)}%)`);
      console.log(`     保留 ${keptProfit}/${profit.length} 盈利代币 (${(keptProfit/profit.length*100).toFixed(1)}%)`);

      candidates.push({
        field: fieldName,
        threshold,
        condition: '>=',
        filteredLoss: filteredLoss / loss.length,
        keptProfit: keptProfit / profit.length
      });
    } else if (lossMedian < profitMin) {
      const threshold = lossMedian;
      const filteredLoss = loss.filter(r => (r.metadata[fieldName] || 0) <= threshold).length;
      const keptProfit = profit.filter(r => (r.metadata[fieldName] || 0) > threshold).length;

      console.log(`  🔍 建议阈值: <= ${threshold.toFixed(4)}`);
      console.log(`     可过滤 ${filteredLoss}/${loss.length} 亏损代币 (${(filteredLoss/loss.length*100).toFixed(1)}%)`);
      console.log(`     保留 ${keptProfit}/${profit.length} 盈利代币 (${(keptProfit/profit.length*100).toFixed(1)}%)`);

      candidates.push({
        field: fieldName,
        threshold,
        condition: '<=',
        filteredLoss: filteredLoss / loss.length,
        keptProfit: keptProfit / profit.length
      });
    }
  });

  // 总结最佳候选
  if (candidates.length > 0) {
    console.log(`\n=== 单一因子过滤效果排名 ===`);
    candidates.sort((a, b) => b.filteredLoss - a.filteredLoss);

    candidates.slice(0, 10).forEach((c, i) => {
      console.log(`${i + 1}. ${c.field} ${c.condition} ${c.threshold.toFixed(4)}`);
      console.log(`   过滤亏损: ${(c.filteredLoss * 100).toFixed(1)}%, 保留盈利: ${(c.keptProfit * 100).toFixed(1)}%`);
    });
  }
}

function testCombinations(results) {
  const profit = results.filter(r => r.returnRate > 0);
  const loss = results.filter(r => r.returnRate < 0);

  // 测试各种组合条件
  const combinations = [
    { name: 'riseSpeed < 80', filter: r => (r.metadata.riseSpeed ?? 100) < 80 },
    { name: 'riseSpeed < 70', filter: r => (r.metadata.riseSpeed ?? 100) < 70 },
    { name: 'riseSpeed < 60', filter: r => (r.metadata.riseSpeed ?? 100) < 60 },
    { name: 'fdv < 12000', filter: r => (r.metadata.fdv ?? 0) < 12000 },
    { name: 'fdv < 10000', filter: r => (r.metadata.fdv ?? 0) < 10000 },
    { name: 'fdv < 8000', filter: r => (r.metadata.fdv ?? 0) < 8000 },
    { name: 'tvl < 10000', filter: r => (r.metadata.tvl ?? 0) < 10000 },
    { name: 'holders < 60', filter: r => (r.metadata.holders ?? 0) < 60 },
    { name: 'holders < 50', filter: r => (r.metadata.holders ?? 0) < 50 },
    { name: 'holders < 40', filter: r => (r.metadata.holders ?? 0) < 40 },
    { name: 'age > 0.5', filter: r => (r.metadata.age ?? 0) > 0.5 },
    { name: 'age > 1.0', filter: r => (r.metadata.age ?? 0) > 1.0 },
    { name: 'txVolumeU24h < 10000', filter: r => (r.metadata.txVolumeU24h ?? 0) < 10000 },
    { name: 'txVolumeU24h < 8000', filter: r => (r.metadata.txVolumeU24h ?? 0) < 8000 },
    { name: 'earlyReturn < 100', filter: r => (r.metadata.earlyReturn ?? 0) < 100 },
    { name: 'earlyReturn > 50', filter: r => (r.metadata.earlyReturn ?? 0) > 50 },
    // 组合条件
    { name: 'fdv < 10000 && holders < 50', filter: r => (r.metadata.fdv ?? 0) < 10000 && (r.metadata.holders ?? 0) < 50 },
    { name: 'fdv < 10000 && holders < 40', filter: r => (r.metadata.fdv ?? 0) < 10000 && (r.metadata.holders ?? 0) < 40 },
    { name: 'fdv < 8000 && holders < 50', filter: r => (r.metadata.fdv ?? 0) < 8000 && (r.metadata.holders ?? 0) < 50 },
    { name: 'riseSpeed < 80 && fdv < 10000', filter: r => (r.metadata.riseSpeed ?? 100) < 80 && (r.metadata.fdv ?? 0) < 10000 },
    { name: 'riseSpeed < 70 && fdv < 10000', filter: r => (r.metadata.riseSpeed ?? 100) < 70 && (r.metadata.fdv ?? 0) < 10000 },
    { name: 'riseSpeed < 60 && fdv < 12000', filter: r => (r.metadata.riseSpeed ?? 100) < 60 && (r.metadata.fdv ?? 0) < 12000 },
    { name: 'riseSpeed < 80 && holders < 50', filter: r => (r.metadata.riseSpeed ?? 100) < 80 && (r.metadata.holders ?? 0) < 50 },
    { name: 'riseSpeed < 70 && holders < 50', filter: r => (r.metadata.riseSpeed ?? 100) < 70 && (r.metadata.holders ?? 0) < 50 },
    { name: 'age > 0.5 && riseSpeed < 70', filter: r => (r.metadata.age ?? 0) > 0.5 && (r.metadata.riseSpeed ?? 100) < 70 },
    { name: 'age > 1.0 && riseSpeed < 80', filter: r => (r.metadata.age ?? 0) > 1.0 && (r.metadata.riseSpeed ?? 100) < 80 },
    { name: 'fdv < 10000 && riseSpeed < 80 && holders < 50', filter: r => (r.metadata.fdv ?? 0) < 10000 && (r.metadata.riseSpeed ?? 100) < 80 && (r.metadata.holders ?? 0) < 50 },
  ];

  const bestCombos = [];

  combinations.forEach(cond => {
    const passed = results.filter(cond.filter);
    const profitPassed = passed.filter(r => r.returnRate > 0);
    const lossPassed = passed.filter(r => r.returnRate < 0);
    const profitFiltered = profit.filter(r => !cond.filter(r));
    const lossFiltered = loss.filter(r => !cond.filter(r));

    const totalProfit = profit.length;
    const totalLoss = loss.length;

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
  });

  // 排序并输出
  console.log(`\n=== 组合条件效果排名 ===`);
  bestCombos.sort((a, b) => {
    const scoreA = a.profitKeepRate - (1 - a.lossFilterRate);
    const scoreB = b.profitKeepRate - (1 - b.lossFilterRate);
    return scoreB - scoreA;
  });

  bestCombos.slice(0, 15).forEach((combo, i) => {
    const score = combo.profitKeepRate - (1 - combo.lossFilterRate);
    console.log(`${i + 1}. ${combo.name}`);
    console.log(`   通过: ${combo.passed}, 保留盈利: ${(combo.profitKeepRate * 100).toFixed(1)}%, 过滤亏损: ${(combo.lossFilterRate * 100).toFixed(1)}%, 平均收益: ${combo.avgReturn.toFixed(2)}%`);
  });

  // 输出最佳条件的详细列表
  console.log(`\n=== 最佳条件详情: ${bestCombos[0].name} ===`);
  const bestCombo = bestCombos[0];
  const bestFilter = combinations.find(c => c.name === bestCombo.name);

  if (bestFilter) {
    const passed = results.filter(bestFilter.filter);
    const filtered = results.filter(r => !bestFilter.filter(r));

    console.log(`\n通过条件的代币 (${passed.length}个):`);
    passed.forEach(r => {
      const icon = r.returnRate > 0 ? '✅' : '❌';
      console.log(`  ${icon} ${r.symbol.padEnd(15)} 收益: ${(r.returnRate > 0 ? '+' : '')}${r.returnRate.toFixed(2)}%, fdv: ${(r.metadata.fdv ?? 0).toFixed(0)}, holders: ${r.metadata.holders ?? 0}, riseSpeed: ${(r.metadata.riseSpeed ?? 0).toFixed(2)}, age: ${(r.metadata.age ?? 0).toFixed(2)}`);
    });

    console.log(`\n被过滤的代币 (${filtered.length}个):`);
    filtered.forEach(r => {
      const icon = r.returnRate > 0 ? '✅' : '❌';
      console.log(`  ${icon} ${r.symbol.padEnd(15)} 收益: ${(r.returnRate > 0 ? '+' : '')}${r.returnRate.toFixed(2)}%, fdv: ${(r.metadata.fdv ?? 0).toFixed(0)}, holders: ${r.metadata.holders ?? 0}, riseSpeed: ${(r.metadata.riseSpeed ?? 0).toFixed(2)}, age: ${(r.metadata.age ?? 0).toFixed(2)}`);
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
