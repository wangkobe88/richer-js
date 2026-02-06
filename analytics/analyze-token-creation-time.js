#!/usr/bin/env node
/**
 * 分析代币创建时间与收益率的关系
 * 研究收益率高/低代币在创建时间上的特征差异
 */

require('dotenv').config({ path: '../config/.env' });
const { createClient } = require('@supabase/supabase-js');
const { ExperimentDataService } = require('../src/web/services/ExperimentDataService');

const EXPERIMENT_ID = '004ac5ac-4589-47da-a332-44c76141b1b5';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function main() {
  console.log(`\n=== 分析实验 ${EXPERIMENT_ID} ===`);
  console.log(`\n目标: 分析代币创建时间与收益率的关系\n`);

  // 1. 获取实验基本信息
  const { data: experiment } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', EXPERIMENT_ID)
    .single();

  console.log('实验名称:', experiment.experiment_name);
  console.log('实验状态:', experiment.status);
  console.log('开始时间:', experiment.started_at);
  console.log('停止时间:', experiment.stopped_at);
  console.log('');

  // 2. 获取代币数据（包含创建时间）
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', EXPERIMENT_ID);

  console.log(`总代币数: ${tokens.length}\n`);

  // 3. 获取交易数据
  const dataService = new ExperimentDataService();
  const trades = await dataService.getTrades(EXPERIMENT_ID, { limit: 10000 });

  console.log(`总交易数: ${trades.length}\n`);

  // 4. 提取代币创建时间
  const tokensWithCreationTime = tokens.map(token => {
    const raw = token.raw_api_data;
    let createdAt = null;
    let pairCreatedAt = null;

    // 从 raw_api_data 提取创建时间（注意：time 可能是秒级时间戳）
    if (raw) {
      createdAt = raw.time || raw.created_at || raw.createdAt || null;
      pairCreatedAt = raw.pair_created_at || raw.pairCreatedAt || null;
    }

    // 判断是否是秒级时间戳（10位数字）还是毫秒级（13位数字）
    const parseTimestamp = (ts) => {
      if (!ts) return null;
      // 如果是数字且小于 2^40（约等于 1970 年后的秒数），说明是秒级时间戳
      const numTs = typeof ts === 'number' ? ts : parseInt(ts);
      if (!isNaN(numTs)) {
        // 秒级时间戳约 10 位，毫秒级约 13 位
        if (numTs < 10000000000000) {
          return new Date(numTs * 1000);
        }
        return new Date(numTs);
      }
      return new Date(ts);
    };

    return {
      address: token.token_address,
      symbol: token.token_symbol,
      status: token.status,
      discoveredAt: token.discovered_at ? new Date(token.discovered_at) : null,
      createdAt: createdAt ? parseTimestamp(createdAt) : null,
      pairCreatedAt: pairCreatedAt ? parseTimestamp(pairCreatedAt) : null,
      rawCreatedAt: createdAt,
      rawPairCreatedAt: pairCreatedAt
    };
  }).filter(t => t.createdAt !== null);

  console.log(`有创建时间的代币数: ${tokensWithCreationTime.length}\n`);

  // 5. 计算每个代币的收益率
  const tokenPnL = calculateTokensPnL(trades);
  console.log(`有交易数据的代币数: ${tokenPnL.length}\n`);

  // 6. 合并创建时间和收益率数据
  const tokensWithAllData = tokenPnL.map(pnl => {
    const tokenInfo = tokensWithCreationTime.find(t => t.address === pnl.tokenAddress);
    if (!tokenInfo) return null;

    return {
      ...pnl,
      createdAt: tokenInfo.createdAt,
      pairCreatedAt: tokenInfo.pairCreatedAt,
      discoveredAt: tokenInfo.discoveredAt
    };
  }).filter(t => t !== null);

  console.log(`有完整数据的代币数: ${tokensWithAllData.length}\n`);

  // 7. 分析创建时间与收益率的关系
  analyzeCreationTimeVsReturn(tokensWithAllData, experiment);

  // 8. 按收益率分组分析
  analyzeByReturnGroups(tokensWithAllData, experiment);

  // 9. 分析代币年龄分布
  analyzeTokenAgeDistribution(tokensWithAllData, experiment);

  // 10. 输出详细数据
  outputDetailedData(tokensWithAllData);

  // 11. 分析北京时间分布
  analyzeBeijingTimeDistribution(tokensWithAllData, experiment);

  // 12. 按时间段分析收益率
  analyzeReturnByTimePeriod(tokensWithAllData);
}

/**
 * 计算所有代币的收益
 */
function calculateTokensPnL(trades) {
  const tokenTrades = {};
  const tokenAddresses = [...new Set(trades.map(t => t.token_address || t.tokenAddress))];

  tokenAddresses.forEach(tokenAddress => {
    const tokenTradeList = trades.filter(t =>
      (t.token_address || t.tokenAddress) === tokenAddress
    );
    const pnl = calculateTokenPnL(tokenTradeList);
    if (pnl && pnl.buyCount > 0) {
      tokenTrades[tokenAddress] = {
        tokenAddress,
        symbol: tokenTradeList[0]?.token_symbol || tokenTradeList[0]?.tokenSymbol || 'Unknown',
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
  let firstBuyTime = null;
  let lastSellTime = null;

  sortedTrades.forEach(trade => {
    const direction = trade.tradeDirection || trade.trade_direction || trade.direction;
    const isBuy = direction === 'buy';
    const tradeTime = new Date(trade.createdAt || trade.created_at || trade.executed_at);

    if (isBuy) {
      const inputAmount = parseFloat(trade.inputAmount || trade.input_amount);
      const outputAmount = parseFloat(trade.outputAmount || trade.output_amount);

      buyQueue.push({
        amount: outputAmount,
        cost: inputAmount
      });
      totalBNBSpent += inputAmount;
      buyCount++;
      if (!firstBuyTime) firstBuyTime = tradeTime;
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
      lastSellTime = tradeTime;
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
    sellCount,
    firstBuyTime,
    lastSellTime
  };
}

/**
 * 分析创建时间与收益率的关系
 */
function analyzeCreationTimeVsReturn(tokens, experiment) {
  console.log(`=== 创建时间与收益率关系分析 ===\n`);

  if (tokens.length === 0) {
    console.log('无有效数据\n');
    return;
  }

  // 计算代币年龄（买入时）
  const experimentStartTime = new Date(experiment.started_at);

  const tokensWithAge = tokens.map(t => {
    const ageAtBuy = t.firstBuyTime && t.createdAt
      ? (t.firstBuyTime - t.createdAt) / (1000 * 60) // 分钟
      : null;

    return {
      ...t,
      ageAtBuyMinutes: ageAtBuy,
      ageAtBuyHours: ageAtBuy ? ageAtBuy / 60 : null
    };
  }).filter(t => t.ageAtBuyMinutes !== null);

  console.log(`有年龄数据的代币数: ${tokensWithAge.length}\n`);

  // 按收益率分组
  const highReturn = tokensWithAge.filter(t => t.returnRate > 20); // 高收益 > 20%
  const mediumReturn = tokensWithAge.filter(t => t.returnRate >= 0 && t.returnRate <= 20);
  const lowReturn = tokensWithAge.filter(t => t.returnRate < 0); // 负收益

  console.log(`高收益代币 (>20%): ${highReturn.length}`);
  console.log(`中等收益代币 (0-20%): ${mediumReturn.length}`);
  console.log(`负收益代币: ${lowReturn.length}\n`);

  // 分析各组的年龄特征
  console.log('--- 代币年龄（买入时）分析 ---\n');

  if (highReturn.length > 0) {
    const ages = highReturn.map(t => t.ageAtBuyMinutes).filter(a => a !== null);
    console.log(`高收益代币年龄:`);
    console.log(`  最小值: ${Math.min(...ages).toFixed(1)} 分钟`);
    console.log(`  最大值: ${Math.max(...ages).toFixed(1)} 分钟`);
    console.log(`  平均值: ${(ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(1)} 分钟`);
    console.log(`  中位数: ${ages.sort((a, b) => a - b)[Math.floor(ages.length / 2)].toFixed(1)} 分钟\n`);
  }

  if (mediumReturn.length > 0) {
    const ages = mediumReturn.map(t => t.ageAtBuyMinutes).filter(a => a !== null);
    console.log(`中等收益代币年龄:`);
    console.log(`  最小值: ${Math.min(...ages).toFixed(1)} 分钟`);
    console.log(`  最大值: ${Math.max(...ages).toFixed(1)} 分钟`);
    console.log(`  平均值: ${(ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(1)} 分钟`);
    console.log(`  中位数: ${ages.sort((a, b) => a - b)[Math.floor(ages.length / 2)].toFixed(1)} 分钟\n`);
  }

  if (lowReturn.length > 0) {
    const ages = lowReturn.map(t => t.ageAtBuyMinutes).filter(a => a !== null);
    console.log(`负收益代币年龄:`);
    console.log(`  最小值: ${Math.min(...ages).toFixed(1)} 分钟`);
    console.log(`  最大值: ${Math.max(...ages).toFixed(1)} 分钟`);
    console.log(`  平均值: ${(ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(1)} 分钟`);
    console.log(`  中位数: ${ages.sort((a, b) => a - b)[Math.floor(ages.length / 2)].toFixed(1)} 分钟\n`);
  }

  // 寻找年龄阈值
  console.log('--- 年龄阈值分析 ---\n');

  // 尝试不同的年龄阈值
  const ageThresholds = [5, 10, 15, 20, 30, 45, 60, 90, 120];

  ageThresholds.forEach(threshold => {
    const youngTokens = tokensWithAge.filter(t => t.ageAtBuyMinutes <= threshold);
    const oldTokens = tokensWithAge.filter(t => t.ageAtBuyMinutes > threshold);

    if (youngTokens.length === 0 || oldTokens.length === 0) return;

    const youngProfit = youngTokens.filter(t => t.returnRate > 0).length;
    const youngLoss = youngTokens.filter(t => t.returnRate <= 0).length;
    const youngAvgReturn = youngTokens.reduce((a, b) => a + b.returnRate, 0) / youngTokens.length;

    const oldProfit = oldTokens.filter(t => t.returnRate > 0).length;
    const oldLoss = oldTokens.filter(t => t.returnRate <= 0).length;
    const oldAvgReturn = oldTokens.reduce((a, b) => a + b.returnRate, 0) / oldTokens.length;

    console.log(`阈值: ${threshold} 分钟`);
    console.log(`  年轻代币 (≤${threshold}分钟): ${youngTokens.length}个`);
    console.log(`    盈利率: ${(youngProfit / youngTokens.length * 100).toFixed(1)}%, 平均收益: ${youngAvgReturn.toFixed(2)}%`);
    console.log(`  老代币 (>${threshold}分钟): ${oldTokens.length}个`);
    console.log(`    盈利率: ${(oldProfit / oldTokens.length * 100).toFixed(1)}%, 平均收益: ${oldAvgReturn.toFixed(2)}%`);
    console.log('');
  });
}

/**
 * 按收益率分组分析
 */
function analyzeByReturnGroups(tokens, experiment) {
  console.log(`\n=== 按收益率分组详细分析 ===\n`);

  // 排序并分组
  const sortedTokens = [...tokens].sort((a, b) => b.returnRate - a.returnRate);

  const top20 = sortedTokens.slice(0, Math.max(1, Math.floor(sortedTokens.length * 0.2)));
  const bottom20 = sortedTokens.slice(Math.max(0, sortedTokens.length - Math.floor(sortedTokens.length * 0.2)));

  console.log(`--- 收益率前20%代币 (共${top20.length}个) ---`);
  top20.forEach(t => {
    const age = t.firstBuyTime && t.createdAt
      ? ((t.firstBuyTime - t.createdAt) / (1000 * 60)).toFixed(1)
      : 'N/A';
    console.log(`  ${t.symbol.padEnd(15)} 收益: ${t.returnRate.toFixed(2)}%, 年龄: ${age}分钟`);
  });

  console.log(`\n--- 收益率后20%代币 (共${bottom20.length}个) ---`);
  bottom20.reverse().forEach(t => {
    const age = t.firstBuyTime && t.createdAt
      ? ((t.firstBuyTime - t.createdAt) / (1000 * 60)).toFixed(1)
      : 'N/A';
    console.log(`  ${t.symbol.padEnd(15)} 收益: ${t.returnRate.toFixed(2)}%, 年龄: ${age}分钟`);
  });
  console.log('');
}

/**
 * 分析代币年龄分布
 */
function analyzeTokenAgeDistribution(tokens, experiment) {
  console.log(`\n=== 代币年龄分布统计 ===\n`);

  const experimentStartTime = new Date(experiment.started_at);

  const tokensWithAge = tokens
    .map(t => {
      const ageAtBuy = t.firstBuyTime && t.createdAt
        ? (t.firstBuyTime - t.createdAt) / (1000 * 60)
        : null;
      return {
        ...t,
        ageAtBuyMinutes: ageAtBuy
      };
    })
    .filter(t => t.ageAtBuyMinutes !== null);

  // 按时间段分组
  const ageBuckets = {
    '0-5分钟': tokensWithAge.filter(t => t.ageAtBuyMinutes <= 5),
    '5-15分钟': tokensWithAge.filter(t => t.ageAtBuyMinutes > 5 && t.ageAtBuyMinutes <= 15),
    '15-30分钟': tokensWithAge.filter(t => t.ageAtBuyMinutes > 15 && t.ageAtBuyMinutes <= 30),
    '30-60分钟': tokensWithAge.filter(t => t.ageAtBuyMinutes > 30 && t.ageAtBuyMinutes <= 60),
    '60-120分钟': tokensWithAge.filter(t => t.ageAtBuyMinutes > 60 && t.ageAtBuyMinutes <= 120),
    '>120分钟': tokensWithAge.filter(t => t.ageAtBuyMinutes > 120)
  };

  console.log('年龄区间分布:\n');
  Object.entries(ageBuckets).forEach(([bucket, bucketTokens]) => {
    if (bucketTokens.length === 0) return;

    const profitCount = bucketTokens.filter(t => t.returnRate > 0).length;
    const avgReturn = bucketTokens.reduce((a, b) => a + b.returnRate, 0) / bucketTokens.length;
    const maxReturn = Math.max(...bucketTokens.map(t => t.returnRate));
    const minReturn = Math.min(...bucketTokens.map(t => t.returnRate));

    console.log(`${bucket}: ${bucketTokens.length}个代币`);
    console.log(`  盈利: ${profitCount}个 (${(profitCount / bucketTokens.length * 100).toFixed(1)}%)`);
    console.log(`  平均收益: ${avgReturn.toFixed(2)}%`);
    console.log(`  最高收益: ${maxReturn.toFixed(2)}%`);
    console.log(`  最低收益: ${minReturn.toFixed(2)}%\n`);
  });
}

/**
 * 输出详细数据
 */
function outputDetailedData(tokens) {
  console.log(`\n=== 所有代币详细数据 ===\n`);

  const sortedTokens = [...tokens].sort((a, b) => b.returnRate - a.returnRate);

  const table = sortedTokens.map(t => {
    const age = t.firstBuyTime && t.createdAt
      ? ((t.firstBuyTime - t.createdAt) / (1000 * 60)).toFixed(1)
      : 'N/A';

    return {
      代币: t.symbol,
      地址: t.tokenAddress.slice(0, 8) + '...',
      收益率: `${t.returnRate.toFixed(2)}%`,
      年龄: `${age}分钟`,
      买入次数: t.buyCount,
      卖出次数: t.sellCount,
      创建时间: t.createdAt ? t.createdAt.toISOString() : 'N/A',
      首次买入: t.firstBuyTime ? t.firstBuyTime.toISOString() : 'N/A'
    };
  });

  console.table(table);
}

/**
 * 分析北京时间分布
 */
function analyzeBeijingTimeDistribution(tokens, experiment) {
  console.log(`\n=== 代币创建时间分布（北京时间） ===\n`);

  if (tokens.length === 0) {
    console.log('无有效数据\n');
    return;
  }

  // 转换为北京时间 (UTC+8)
  const tokensWithBeijingTime = tokens.map(t => {
    if (!t.createdAt) return null;

    // 转换为北京时间
    const beijingTime = new Date(t.createdAt.getTime() + 8 * 60 * 60 * 1000);
    const hour = beijingTime.getHours();
    const dateStr = beijingTime.toISOString().slice(0, 10);
    const timeStr = `${String(hour).padStart(2, '0')}:00`;

    return {
      ...t,
      beijingTime,
      beijingHour: hour,
      beijingDate: dateStr,
      beijingTimeStr: timeStr
    };
  }).filter(t => t !== null);

  console.log(`北京时间范围: ${tokensWithBeijingTime[0].beijingTime.toISOString().slice(0, 10)} ~ ${tokensWithBeijingTime[tokensWithBeijingTime.length - 1].beijingTime.toISOString().slice(0, 10)}\n`);

  // 按小时统计
  const hourStats = {};
  for (let h = 0; h < 24; h++) {
    hourStats[h] = [];
  }

  tokensWithBeijingTime.forEach(t => {
    hourStats[t.beijingHour].push(t);
  });

  console.log('--- 按小时统计代币创建数量 ---\n');
  console.log('北京时间 | 代币数 | 盈利率 | 平均收益 | 代币列表');
  console.log(''.padEnd(80, '-'));

  for (let h = 0; h < 24; h++) {
    const hourTokens = hourStats[h];
    if (hourTokens.length === 0) continue;

    const profitCount = hourTokens.filter(t => t.returnRate > 0).length;
    const avgReturn = hourTokens.reduce((a, b) => a + b.returnRate, 0) / hourTokens.length;
    const symbols = hourTokens.map(t => t.symbol).join(', ');

    console.log(
      `${String(h).padStart(2, '0')}:00-${String(h).padStart(2, '0')}:59 | ` +
      `${String(hourTokens.length).padStart(3)}个 | ` +
      `${(profitCount / hourTokens.length * 100).toFixed(0).padStart(3)}% | ` +
      `${avgReturn.toFixed(2).padStart(6)}% | ` +
      symbols
    );
  }

  // 按时间段分组统计
  console.log(`\n--- 按时间段分组统计 ---\n`);

  const timePeriods = {
    '凌晨 (00:00-05:59)': tokensWithBeijingTime.filter(t => t.beijingHour >= 0 && t.beijingHour < 6),
    '早晨 (06:00-08:59)': tokensWithBeijingTime.filter(t => t.beijingHour >= 6 && t.beijingHour < 9),
    '上午 (09:00-11:59)': tokensWithBeijingTime.filter(t => t.beijingHour >= 9 && t.beijingHour < 12),
    '中午 (12:00-13:59)': tokensWithBeijingTime.filter(t => t.beijingHour >= 12 && t.beijingHour < 14),
    '下午 (14:00-17:59)': tokensWithBeijingTime.filter(t => t.beijingHour >= 14 && t.beijingHour < 18),
    '晚上 (18:00-21:59)': tokensWithBeijingTime.filter(t => t.beijingHour >= 18 && t.beijingHour < 22),
    '深夜 (22:00-23:59)': tokensWithBeijingTime.filter(t => t.beijingHour >= 22 && t.beijingHour < 24)
  };

  console.log('时间段 | 代币数 | 盈利数 | 盈利率 | 平均收益 | 最高收益 | 最低收益');
  console.log(''.padEnd(80, '-'));

  Object.entries(timePeriods).forEach(([period, periodTokens]) => {
    if (periodTokens.length === 0) return;

    const profitCount = periodTokens.filter(t => t.returnRate > 0).length;
    const avgReturn = periodTokens.reduce((a, b) => a + b.returnRate, 0) / periodTokens.length;
    const maxReturn = Math.max(...periodTokens.map(t => t.returnRate));
    const minReturn = Math.min(...periodTokens.map(t => t.returnRate));

    console.log(
      `${period.padEnd(20)} | ` +
      `${String(periodTokens.length).padStart(2)}个 | ` +
      `${String(profitCount).padStart(2)}个 | ` +
      `${(profitCount / periodTokens.length * 100).toFixed(0).padStart(3)}% | ` +
      `${avgReturn.toFixed(2).padStart(6)}% | ` +
      `${maxReturn.toFixed(2).padStart(6)}% | ` +
      `${minReturn.toFixed(2).padStart(6)}%`
    );
  });

  console.log('');

  // 按白天/晚上统计
  console.log('--- 白天 vs 晚上 ---\n');

  const dayTime = tokensWithBeijingTime.filter(t => t.beijingHour >= 6 && t.beijingHour < 18); // 6:00-18:00
  const nightTime = tokensWithBeijingTime.filter(t => t.beijingHour >= 18 || t.beijingHour < 6); // 18:00-6:00

  console.log(`白天 (06:00-18:00): ${dayTime.length}个代币`);
  if (dayTime.length > 0) {
    const dayProfit = dayTime.filter(t => t.returnRate > 0).length;
    const dayAvgReturn = dayTime.reduce((a, b) => a + b.returnRate, 0) / dayTime.length;
    console.log(`  盈利: ${dayProfit}个 (${(dayProfit / dayTime.length * 100).toFixed(1)}%)`);
    console.log(`  平均收益: ${dayAvgReturn.toFixed(2)}%`);
  }

  console.log(`\n晚上 (18:00-06:00): ${nightTime.length}个代币`);
  if (nightTime.length > 0) {
    const nightProfit = nightTime.filter(t => t.returnRate > 0).length;
    const nightAvgReturn = nightTime.reduce((a, b) => a + b.returnRate, 0) / nightTime.length;
    console.log(`  盈利: ${nightProfit}个 (${(nightProfit / nightTime.length * 100).toFixed(1)}%)`);
    console.log(`  平均收益: ${nightAvgReturn.toFixed(2)}%`);
  }

  console.log('');
}

/**
 * 按时间段分析收益率
 */
function analyzeReturnByTimePeriod(tokens) {
  console.log(`\n=== 按时间段详细分析 ===\n`);

  if (tokens.length === 0) {
    console.log('无有效数据\n');
    return;
  }

  // 转换为北京时间
  const tokensWithBeijingTime = tokens.map(t => {
    if (!t.createdAt) return null;

    const beijingTime = new Date(t.createdAt.getTime() + 8 * 60 * 60 * 1000);
    const hour = beijingTime.getHours();

    return {
      ...t,
      beijingTime,
      beijingHour: hour
    };
  }).filter(t => t !== null);

  // 按时间段分组并详细展示
  const timePeriods = {
    '凌晨 (00-06点)': tokensWithBeijingTime.filter(t => t.beijingHour >= 0 && t.beijingHour < 6),
    '早晨 (06-09点)': tokensWithBeijingTime.filter(t => t.beijingHour >= 6 && t.beijingHour < 9),
    '上午 (09-12点)': tokensWithBeijingTime.filter(t => t.beijingHour >= 9 && t.beijingHour < 12),
    '下午 (12-18点)': tokensWithBeijingTime.filter(t => t.beijingHour >= 12 && t.beijingHour < 18),
    '晚上 (18-22点)': tokensWithBeijingTime.filter(t => t.beijingHour >= 18 && t.beijingHour < 22),
    '深夜 (22-24点)': tokensWithBeijingTime.filter(t => t.beijingHour >= 22)
  };

  Object.entries(timePeriods).forEach(([period, periodTokens]) => {
    if (periodTokens.length === 0) return;

    const sorted = [...periodTokens].sort((a, b) => b.returnRate - a.returnRate);

    console.log(`--- ${period} (${periodTokens.length}个代币) ---`);

    sorted.forEach(t => {
      const timeStr = `${String(t.beijingHour).padStart(2, '0')}:00`;
      console.log(
        `  ${t.symbol.padEnd(15)} ` +
        `创建: ${timeStr} ` +
        `收益: ${t.returnRate.toFixed(2).padStart(7)}% ` +
        `买入: ${t.buyCount}次 卖出: ${t.sellCount}次`
      );
    });

    console.log('');
  });
}

main().catch(console.error);
