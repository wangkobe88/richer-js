#!/usr/bin/env node
/**
 * 分析实验收益 - 研究正负收益代币的特征差异
 * 目标: 找出可以过滤负收益代币的策略条件
 */

require('dotenv').config({ path: '../config/.env' });
const { ExperimentDataService } = require('../src/web/services/ExperimentDataService');
const { ExperimentTimeSeriesService } = require('../src/web/services/ExperimentTimeSeriesService');

const EXPERIMENT_ID = '004ac5ac-4589-47da-a332-44c76141b1b5';

async function main() {
  const dataService = new ExperimentDataService();
  const timeSeriesService = new ExperimentTimeSeriesService();

  console.log(`\n=== 分析实验 ${EXPERIMENT_ID} ===\n`);

  // 1. 获取所有数据
  console.log('正在获取数据...');
  const [trades, signals, tokens] = await Promise.all([
    dataService.getTrades(EXPERIMENT_ID, { limit: 10000 }),
    dataService.getSignals(EXPERIMENT_ID, { limit: 10000 }),
    dataService.getTokens(EXPERIMENT_ID, { limit: 10000 })
  ]);

  console.log(`交易数: ${trades.length}`);
  console.log(`信号数: ${signals.length}`);
  console.log(`代币数: ${tokens.length}\n`);

  // 2. 计算每个代币的收益率
  const tokenPnL = calculateTokensPnL(trades);
  console.log(`\n=== 代币收益统计 ===`);
  console.log(`总代币数: ${tokenPnL.length}`);
  console.log(`盈利代币: ${tokenPnL.filter(t => t.returnRate > 0).length}`);
  console.log(`亏损代币: ${tokenPnL.filter(t => t.returnRate < 0).length}`);
  console.log(`盈亏平衡: ${tokenPnL.filter(t => t.returnRate === 0).length}`);

  // 3. 打印所有代币收益
  console.log(`\n=== 所有代币收益明细 ===`);
  tokenPnL.sort((a, b) => b.returnRate - a.returnRate);
  tokenPnL.forEach(t => {
    const icon = t.returnRate > 0 ? '✅' : t.returnRate < 0 ? '❌' : '➖';
    console.log(`${icon} ${t.symbol.padEnd(15)} 收益率: ${(t.returnRate > 0 ? '+' : '')}${t.returnRate.toFixed(2)}%, 盈亏: ${(t.realizedPnL > 0 ? '+' : '')}${t.realizedPnL.toFixed(4)} BNB, 买入次数: ${t.buyCount}, 卖出次数: ${t.sellCount}`);
  });

  // 4. 分析正负收益代币的信号特征差异
  console.log(`\n=== 分析信号特征差异 ===`);
  await analyzeSignalDifferences(signals, tokenPnL, timeSeriesService);

  // 5. 分析买入时的价格因子
  console.log(`\n=== 分析买入时的因子特征 ===`);
  await analyzeBuyFactorDifferences(signals, tokenPnL, timeSeriesService);

  // 6. 尝试找出过滤条件
  console.log(`\n=== 寻找过滤条件 ===`);
  await findFilterConditions(signals, tokenPnL, timeSeriesService);
}

/**
 * 计算所有代币的收益
 */
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

/**
 * 计算单个代币的收益（FIFO）
 */
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

  // 计算剩余持仓
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

/**
 * 分析正负收益代币的信号特征差异
 */
async function analyzeSignalDifferences(signals, tokenPnL, timeSeriesService) {
  // 创建收益率映射
  const pnlMap = {};
  tokenPnL.forEach(t => pnlMap[t.tokenAddress] = t.returnRate);

  // 按代币分组买入信号
  const buySignalsByToken = {};
  signals.filter(s => s.signalType === 'BUY' || s.action === 'buy').forEach(signal => {
    const addr = signal.tokenAddress;
    if (!buySignalsByToken[addr]) {
      buySignalsByToken[addr] = [];
    }
    buySignalsByToken[addr].push(signal);
  });

  // 统计正负收益代币的买入信号特征
  const profitTokens = [];
  const lossTokens = [];

  Object.entries(buySignalsByToken).forEach(([tokenAddr, tokenSignals]) => {
    const returnRate = pnlMap[tokenAddr];
    if (returnRate === undefined) return;

    const firstBuySignal = tokenSignals[0];
    const data = {
      tokenAddress: tokenAddr,
      symbol: firstBuySignal.tokenSymbol,
      returnRate,
      signalCount: tokenSignals.length,
      firstSignal: firstBuySignal
    };

    if (returnRate > 0) {
      profitTokens.push(data);
    } else {
      lossTokens.push(data);
    }
  });

  console.log(`\n盈利代币买入信号特征:`);
  console.log(`  数量: ${profitTokens.length}`);
  analyzeSignalMetadata(profitTokens);

  console.log(`\n亏损代币买入信号特征:`);
  console.log(`  数量: ${lossTokens.length}`);
  analyzeSignalMetadata(lossTokens);
}

function analyzeSignalMetadata(tokens) {
  if (tokens.length === 0) {
    console.log('  无数据');
    return;
  }

  // 提取所有元数据
  const metadatas = tokens.map(t => t.firstSignal.metadata || {}).filter(m => Object.keys(m).length > 0);

  if (metadatas.length === 0) {
    console.log('  无元数据');
    return;
  }

  // 统计各字段的分布
  const fields = {};
  metadatas.forEach(m => {
    Object.keys(m).forEach(key => {
      if (!fields[key]) fields[key] = [];
      if (m[key] !== null && m[key] !== undefined) {
        fields[key].push(m[key]);
      }
    });
  });

  console.log(`  买入信号元数据字段:`);
  Object.entries(fields).forEach(([key, values]) => {
    if (values.length > 0) {
      const nums = values.filter(v => typeof v === 'number');
      if (nums.length > 0) {
        const min = Math.min(...nums);
        const max = Math.max(...nums);
        const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
        console.log(`    ${key}: min=${min.toFixed(4)}, max=${max.toFixed(4)}, avg=${avg.toFixed(4)}, count=${nums.length}`);
      } else {
        console.log(`    ${key}: ${values[0]} (非数值, count=${values.length})`);
      }
    }
  });
}

/**
 * 分析买入时的因子特征差异
 */
async function analyzeBuyFactorDifferences(signals, tokenPnL, timeSeriesService) {
  const pnlMap = {};
  tokenPnL.forEach(t => pnlMap[t.tokenAddress] = t.returnRate);

  // 获取买入信号及其时序数据
  const buySignals = signals.filter(s => s.signalType === 'BUY' || s.action === 'buy');

  console.log(`\n获取时序数据进行分析...`);

  // 按代币分组
  const tokensWithData = [];
  const tokenAddresses = [...new Set(buySignals.map(s => s.tokenAddress))];

  for (const tokenAddress of tokenAddresses.slice(0, 20)) { // 限制分析数量
    const tokenSignals = buySignals.filter(s => s.tokenAddress === tokenAddress);
    const firstBuy = tokenSignals[0];

    if (!firstBuy) continue;

    // 获取时序数据
    const timeSeriesData = await timeSeriesService.getExperimentTimeSeries(
      EXPERIMENT_ID,
      tokenAddress,
      { limit: 100 }
    );

    if (timeSeriesData.length === 0) continue;

    // 找到买入时刻的数据
    const buyTime = new Date(firstBuy.createdAt || firstBuy.created_at);
    const buyData = timeSeriesData.find(d => {
      const dataTime = new Date(d.timestamp);
      return Math.abs(dataTime - buyTime) < 60000; // 1分钟内
    });

    tokensWithData.push({
      tokenAddress,
      symbol: firstBuy.tokenSymbol,
      returnRate: pnlMap[tokenAddress],
      buyTime,
      buyData: buyData || timeSeriesData[0],
      timeSeriesData
    });
  }

  // 分组统计
  const profitData = tokensWithData.filter(t => t.returnRate > 0);
  const lossData = tokensWithData.filter(t => t.returnRate < 0);

  console.log(`\n盈利代币买入时因子特征 (count=${profitData.length}):`);
  if (profitData.length > 0) {
    analyzeFactors(profitData);
  }

  console.log(`\n亏损代币买入时因子特征 (count=${lossData.length}):`);
  if (lossData.length > 0) {
    analyzeFactors(lossData);
  }
}

function analyzeFactors(tokens) {
  // 收集所有因子值
  const factorValues = {};

  tokens.forEach(t => {
    if (t.buyData && t.buyData.factor_values) {
      Object.entries(t.buyData.factor_values).forEach(([key, value]) => {
        if (typeof value === 'number') {
          if (!factorValues[key]) factorValues[key] = [];
          factorValues[key].push(value);
        }
      });
    }
  });

  // 统计每个因子
  Object.entries(factorValues).forEach(([factorName, values]) => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const median = values.sort((a, b) => a - b)[Math.floor(values.length / 2)];

    console.log(`  ${factorName}:`);
    console.log(`    最小值: ${min.toFixed(4)}`);
    console.log(`    最大值: ${max.toFixed(4)}`);
    console.log(`    平均值: ${avg.toFixed(4)}`);
    console.log(`    中位数: ${median.toFixed(4)}`);
  });
}

/**
 * 寻找过滤条件
 */
async function findFilterConditions(signals, tokenPnL, timeSeriesService) {
  const pnlMap = {};
  tokenPnL.forEach(t => pnlMap[t.tokenAddress] = t.returnRate);

  const buySignals = signals.filter(s => s.signalType === 'BUY' || s.action === 'buy');

  // 获取时序数据并分析
  const results = [];
  const tokenAddresses = [...new Set(buySignals.map(s => s.tokenAddress))];

  console.log(`正在分析 ${tokenAddresses.length} 个代币...`);

  for (const tokenAddress of tokenAddresses) {
    const tokenSignals = buySignals.filter(s => s.tokenAddress === tokenAddress);
    const firstBuy = tokenSignals[0];
    const returnRate = pnlMap[tokenAddress];

    if (returnRate === undefined) continue;

    // 获取时序数据
    const timeSeriesData = await timeSeriesService.getExperimentTimeSeries(
      EXPERIMENT_ID,
      tokenAddress,
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
      tokenAddress,
      symbol: firstBuy.tokenSymbol,
      returnRate,
      buyData: buyData || timeSeriesData[0],
      firstBuy: firstBuy
    });
  }

  // 分组
  const profit = results.filter(r => r.returnRate > 0);
  const loss = results.filter(r => r.returnRate < 0);

  console.log(`\n有完整数据的代币: ${results.length} (盈利: ${profit.length}, 亏损: ${loss.length})`);

  // 尝试找出阈值差异
  console.log(`\n=== 尝试找出因子阈值差异 ===`);

  // 获取所有因子名
  const allFactors = new Set();
  results.forEach(r => {
    if (r.buyData && r.buyData.factor_values) {
      Object.keys(r.buyData.factor_values).forEach(k => allFactors.add(k));
    }
  });

  // 对每个因子找最优阈值
  const candidates = [];

  Array.from(allFactors).forEach(factorName => {
    // 收集盈利和亏损的因子值
    const profitValues = profit
      .map(r => r.buyData?.factor_values?.[factorName])
      .filter(v => typeof v === 'number');

    const lossValues = loss
      .map(r => r.buyData?.factor_values?.[factorName])
      .filter(v => typeof v === 'number');

    if (profitValues.length === 0 || lossValues.length === 0) return;

    // 统计
    const profitMin = Math.min(...profitValues);
    const profitMax = Math.max(...profitValues);
    const profitAvg = profitValues.reduce((a, b) => a + b, 0) / profitValues.length;

    const lossMin = Math.min(...lossValues);
    const lossMax = Math.max(...lossValues);
    const lossAvg = lossValues.reduce((a, b) => a + b, 0) / lossValues.length;

    console.log(`\n${factorName}:`);
    console.log(`  盈利代币: min=${profitMin.toFixed(4)}, max=${profitMax.toFixed(4)}, avg=${profitAvg.toFixed(4)}`);
    console.log(`  亏损代币: min=${lossMin.toFixed(4)}, max=${lossMax.toFixed(4)}, avg=${lossAvg.toFixed(4)}`);

    // 尝试找阈值
    // 如果盈利的最小值 > 亏损的最大值，可以用 min 阈值
    if (profitMin > lossMax) {
      const threshold = profitMin;
      const filteredLoss = loss.filter(r =>
        (r.buyData?.factor_values?.[factorName] || 0) < threshold
      ).length;
      const keptProfit = profit.filter(r =>
        (r.buyData?.factor_values?.[factorName] || 0) >= threshold
      ).length;

      console.log(`  🔍 建议阈值: >= ${threshold.toFixed(4)}`);
      console.log(`     可过滤掉 ${filteredLoss}/${loss.length} 亏损代币`);
      console.log(`     保留 ${keptProfit}/${profit.length} 盈利代币`);

      candidates.push({
        factor: factorName,
        threshold,
        condition: '>=',
        filteredLoss: filteredLoss / loss.length,
        keptProfit: keptProfit / profit.length
      });
    }
    // 如果亏损的最大值 < 盈利的最小值，可以用 max 阈值
    else if (lossMax < profitMin) {
      const threshold = lossMax;
      const filteredLoss = loss.filter(r =>
        (r.buyData?.factor_values?.[factorName] || 0) <= threshold
      ).length;
      const keptProfit = profit.filter(r =>
        (r.buyData?.factor_values?.[factorName] || 0) > threshold
      ).length;

      console.log(`  🔍 建议阈值: <= ${threshold.toFixed(4)}`);
      console.log(`     可过滤掉 ${filteredLoss}/${loss.length} 亏损代币`);
      console.log(`     保留 ${keptProfit}/${profit.length} 盈利代币`);

      candidates.push({
        factor: factorName,
        threshold,
        condition: '<=',
        filteredLoss: filteredLoss / loss.length,
        keptProfit: keptProfit / profit.length
      });
    }
  });

  // 总结最佳候选
  if (candidates.length > 0) {
    console.log(`\n=== 推荐过滤条件 ===`);
    candidates.sort((a, b) => b.filteredLoss - a.filteredLoss);

    candidates.forEach((c, i) => {
      console.log(`${i + 1}. ${c.factor} ${c.condition} ${c.threshold.toFixed(4)}`);
      console.log(`   过滤亏损比例: ${(c.filteredLoss * 100).toFixed(1)}%`);
      console.log(`   保留盈利比例: ${(c.keptProfit * 100).toFixed(1)}%`);
    });
  } else {
    console.log(`\n未找到明显的单一因子阈值差异`);
    console.log(`建议尝试组合因子条件`);
  }
}

main().catch(console.error);
