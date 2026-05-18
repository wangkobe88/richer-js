#!/usr/bin/env node
/**
 * RSI 策略对比回测脚本
 *
 * 对比 6 组 RSI 策略在历史虚拟实验数据上的表现。
 * 纯内存计算，不写数据库，几秒出结果。
 *
 * 用法: node scripts/rsi-strategy-comparison.js
 */

const path = require('path');

// 加载环境变量
require('dotenv').config({ path: path.join(__dirname, '..', 'config', '.env') });

const { dbManager } = require('../src/services/dbManager');
const { RSIIndicator } = require('../src/indicators/RSIIndicator');
const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator');
const { buildFactorsFromTimeSeries } = require('../src/trading-engine/core/FactorBuilder');

// ============ 配置 ============

const SOURCE_EXPERIMENTS = [
  { id: '8dfee382-179b-49e1-9b99-839e3db9663a', name: '虚拟实验A' },
  { id: 'f57487fa-2c4c-4a6e-b1dc-e0dcebdf58f5', name: '虚拟实验B' },
];

const PRE_BUY_REF_EXPERIMENT = '2007c1f0-487a-4e5a-b8cc-6541d5cf7bf0';

// RSI 实例（与 VirtualTradingEngine/BacktestEngine 一致）
const rsiFast = new RSIIndicator({ period: 3, smoothingPeriod: 1, smoothingType: 'EMA', useLogPrices: true });
const rsiMedium = new RSIIndicator({ period: 7, smoothingPeriod: 2, smoothingType: 'EMA', useLogPrices: true });
const rsiSlow = new RSIIndicator({ period: 14, smoothingPeriod: 3, smoothingType: 'EMA', useLogPrices: true });

// 6 组策略定义
const STRATEGIES = [
  {
    name: 'Fast Only',
    buyCondition: 'rsiFast >= 60 AND earlyReturn >= 30 AND age >= 0.3',
    sellCondition: 'rsiFast < 40 AND profitPercent >= 5',
  },
  {
    name: 'Crossover',
    buyCondition: 'rsiFast >= 55 AND rsiCrossover == 1 AND earlyReturn >= 30',
    sellCondition: 'rsiCrossover == 0 AND rsiSlope < 0 AND profitPercent >= 3',
  },
  {
    name: 'Multi-Confirm',
    buyCondition: 'rsiFast >= 55 AND rsiMedium >= 50 AND rsiCrossover == 1 AND rsiSlope > 0 AND earlyReturn >= 30',
    sellCondition: 'rsiFast < 40 AND rsiCrossover == 0 AND rsiSlope < 0',
  },
  {
    name: 'Divergence Exit',
    buyCondition: 'rsiFast >= 55 AND rsiCrossover == 1 AND earlyReturn >= 30',
    sellCondition: 'rsiDivergence == -1 OR (rsiFast < 35 AND rsiCrossover == 0)',
  },
  {
    name: 'Trend Rider',
    buyCondition: 'rsiFast >= 50 AND rsiMedium >= 45 AND rsiCrossover == 1 AND earlyReturn >= 30',
    sellCondition: '(rsiFast < 35 AND rsiSlope < 0) OR drawdownFromHighestSinceLastBuy <= -15 OR profitPercent >= 80',
  },
  {
    name: 'Scalper',
    buyCondition: 'rsiFast >= 65 AND rsiCrossover == 1 AND earlyReturn >= 20 AND age >= 0.3',
    sellCondition: 'profitPercent >= 15 OR (rsiFast < 45 AND profitPercent >= 3) OR (holdDuration >= 120 AND profitPercent >= 3)',
  },
];

// ============ 数据加载 ============

// 每个代币最多取的数据点数（覆盖 ~2 分钟 @2s 间隔，足够 RSI 策略评估）
const MAX_POINTS_PER_TOKEN = 60;

async function loadTimeSeriesData(experimentId) {
  const supabase = dbManager.getClient();
  const PAGE_SIZE = 1000;
  // tokenKey -> 数据点数组（每个最多 MAX_POINTS_PER_TOKEN 个）
  const tokenDataMap = {};
  let page = 0;

  while (true) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error } = await supabase
      .from('experiment_time_series_data')
      .select('id, token_address, token_symbol, timestamp, loop_count, price_usd, factor_values, blockchain')
      .eq('experiment_id', experimentId)
      .order('timestamp', { ascending: true })
      .range(from, to);

    if (error) {
      console.error(`  数据加载错误 (page ${page}): ${error.message}`);
      break;
    }

    if (!data || data.length === 0) break;

    for (const row of data) {
      const key = `${row.token_address}-${row.blockchain || 'bsc'}`;
      if (!tokenDataMap[key]) tokenDataMap[key] = [];
      if (tokenDataMap[key].length < MAX_POINTS_PER_TOKEN) {
        tokenDataMap[key].push(row);
      }
    }

    // 检查是否所有已发现的代币都已有足够数据
    const tokenKeys = Object.keys(tokenDataMap);
    const allComplete = tokenKeys.length > 0 && tokenKeys.every(k => tokenDataMap[k].length >= MAX_POINTS_PER_TOKEN);

    if (allComplete || data.length < PAGE_SIZE) break;

    page++;
    if (page % 5 === 0) {
      const total = tokenKeys.reduce((s, k) => s + tokenDataMap[k].length, 0);
      const complete = tokenKeys.filter(k => tokenDataMap[k].length >= MAX_POINTS_PER_TOKEN).length;
      console.log(`  页 ${page}: ${tokenKeys.length} 代币, ${complete} 已满, ${total} 条数据`);
    }
  }

  // 展平为数组
  const allData = Object.values(tokenDataMap).flat();
  const uniqueTokens = Object.keys(tokenDataMap).length;
  console.log(`  加载完成: ${uniqueTokens} 个代币, ${allData.length} 条数据`);
  return allData;
}

async function loadExperimentConfig(experimentId) {
  const supabase = dbManager.getClient();
  const { data, error } = await supabase
    .from('experiments')
    .select('config')
    .eq('id', experimentId)
    .single();

  if (error) {
    console.error(`  加载实验配置失败: ${error.message}`);
    return null;
  }
  return data?.config || {};
}

// ============ RSI 因子计算 ============

function calculateRSIFactors(priceHistory, rsiHistoryCache) {
  const factors = {};

  if (priceHistory.length >= 4) {
    factors.rsiFast = rsiFast.calculate(priceHistory);
  }

  if (priceHistory.length >= 8) {
    factors.rsiMedium = rsiMedium.calculate(priceHistory);

    if (factors.rsiFast !== undefined) {
      factors.rsiCrossover = (factors.rsiFast > factors.rsiMedium) ? 1 : 0;
    }

    // 维护 rsiMedium 历史
    rsiHistoryCache.push(factors.rsiMedium);
    if (rsiHistoryCache.length > 20) {
      rsiHistoryCache.shift();
    }

    if (rsiHistoryCache.length >= 2) {
      factors.rsiSlope = rsiMedium.calculateSlope(rsiHistoryCache, 2);
    }
  }

  if (priceHistory.length >= 15) {
    factors.rsiSlow = rsiSlow.calculate(priceHistory);

    const rsiSeries = rsiMedium.calculateSeries(priceHistory);
    if (rsiSeries.length >= 5) {
      factors.rsiDivergence = rsiMedium.detectDivergence(priceHistory, rsiSeries, 5);
    }
  }

  return factors;
}

// ============ 策略回测引擎 ============

function runStrategyComparison(data, strategies) {
  // 按代币分组
  const tokenData = {};
  for (const row of data) {
    const key = `${row.token_address}-${row.blockchain || 'bsc'}`;
    if (!tokenData[key]) {
      tokenData[key] = {
        address: row.token_address,
        symbol: row.token_symbol,
        blockchain: row.blockchain || 'bsc',
        points: [],
      };
    }
    tokenData[key].points.push(row);
  }

  // 初始化每组策略的状态
  const strategyStates = strategies.map(() => ({
    trades: [],       // { buyPrice, sellPrice, buyTime, sellTime, profitPercent, symbol }
    positions: {},    // tokenKey -> { buyPrice, buyTime, highestPrice }
    tokenBought: new Set(), // 已买过的代币集合（每个代币只买一次）
  }));

  const evaluator = new ConditionEvaluator();

  // 遍历每个代币
  for (const [tokenKey, tokenInfo] of Object.entries(tokenData)) {
    const points = tokenInfo.points;

    // 为所有策略共享价格历史和 RSI 历史
    const priceHistory = [];
    const rsiHistoryCache = [];

    for (const point of points) {
      const priceUsd = parseFloat(point.price_usd) || 0;
      if (priceUsd <= 0) continue;

      priceHistory.push(priceUsd);

      const factorValues = point.factor_values || {};
      const now = new Date(point.timestamp).getTime();

      // 使用 FactorBuilder 构建基础因子
      const tokenState = {};
      const baseFactors = buildFactorsFromTimeSeries(factorValues, tokenState, priceUsd, now);

      // 计算 RSI 因子
      const rsiFactors = calculateRSIFactors(priceHistory, rsiHistoryCache);

      // 合并所有因子
      const allFactors = { ...baseFactors, ...rsiFactors };

      // 评估每组策略
      for (let i = 0; i < strategies.length; i++) {
        const strategy = strategies[i];
        const state = strategyStates[i];
        const pos = state.positions[tokenKey];

        if (!pos) {
          // 未持仓：评估买入
          try {
            const shouldBuy = evaluator.evaluate(strategy.buyCondition, allFactors);
            if (shouldBuy && !state.tokenBought.has(tokenKey)) {
              state.positions[tokenKey] = {
                buyPrice: priceUsd,
                buyTime: now,
                highestPrice: priceUsd,
              };
              state.tokenBought.add(tokenKey);
            }
          } catch (e) {
            // 条件中有未定义因子，跳过
          }
        } else {
          // 持仓中：更新最高价和因子
          if (priceUsd > pos.highestPrice) {
            pos.highestPrice = priceUsd;
          }

          // 添加持仓相关因子
          const holdDuration = (now - pos.buyTime) / 1000;
          const profitPercent = ((priceUsd - pos.buyPrice) / pos.buyPrice) * 100;
          const drawdownFromHighestSinceLastBuy = pos.highestPrice > 0
            ? ((priceUsd - pos.highestPrice) / pos.highestPrice) * 100
            : 0;

          allFactors.profitPercent = profitPercent;
          allFactors.holdDuration = holdDuration;
          allFactors.buyPrice = pos.buyPrice;
          allFactors.highestPriceSinceLastBuy = pos.highestPrice;
          allFactors.drawdownFromHighestSinceLastBuy = drawdownFromHighestSinceLastBuy;

          // 评估卖出
          try {
            const shouldSell = evaluator.evaluate(strategy.sellCondition, allFactors);
            if (shouldSell) {
              state.trades.push({
                symbol: tokenInfo.symbol,
                buyPrice: pos.buyPrice,
                sellPrice: priceUsd,
                buyTime: pos.buyTime,
                sellTime: now,
                profitPercent,
                holdDuration,
              });
              delete state.positions[tokenKey];
            }
          } catch (e) {
            // 条件中有未定义因子，跳过
          }
        }
      }
    }
  }

  // 汇总结果
  return strategyStates.map((state, i) => {
    const trades = state.trades;
    const totalTrades = trades.length;
    const winTrades = trades.filter(t => t.profitPercent > 0);
    const winRate = totalTrades > 0 ? (winTrades.length / totalTrades * 100) : 0;
    const totalProfit = trades.reduce((sum, t) => sum + t.profitPercent, 0);
    const avgProfit = totalTrades > 0 ? totalProfit / totalTrades : 0;
    const avgHoldDuration = totalTrades > 0
      ? trades.reduce((sum, t) => sum + t.holdDuration, 0) / totalTrades
      : 0;
    const maxLoss = trades.length > 0
      ? Math.min(...trades.map(t => t.profitPercent))
      : 0;
    const maxWin = trades.length > 0
      ? Math.max(...trades.map(t => t.profitPercent))
      : 0;

    // 未平仓数
    const openPositions = Object.keys(state.positions).length;

    return {
      name: strategies[i].name,
      totalTrades,
      winRate: winRate.toFixed(1),
      totalProfit: totalProfit.toFixed(1),
      avgProfit: avgProfit.toFixed(1),
      avgHoldDuration: avgHoldDuration.toFixed(0),
      maxLoss: maxLoss.toFixed(1),
      maxWin: maxWin.toFixed(1),
      openPositions,
      trades,
    };
  });
}

// ============ 输出 ============

function printResults(results, sourceName) {
  console.log(`\n${'='.repeat(100)}`);
  console.log(`  RSI 策略对比 [源: ${sourceName}]`);
  console.log(`${'='.repeat(100)}`);

  // 表头
  const header = [
    '策略'.padEnd(16),
    '交易数'.padStart(6),
    '胜率'.padStart(7),
    '总收益%'.padStart(8),
    '平均收益%'.padStart(9),
    '最大赢%'.padStart(8),
    '最大亏%'.padStart(8),
    '平均持有(s)'.padStart(10),
    '未平仓'.padStart(6),
  ].join(' | ');
  console.log(header);
  console.log('-'.repeat(100));

  for (const r of results) {
    const row = [
      r.name.padEnd(16),
      String(r.totalTrades).padStart(6),
      (r.winRate + '%').padStart(7),
      (r.totalProfit > 0 ? '+' : '') + r.totalProfit.padStart(7),
      (r.avgProfit > 0 ? '+' : '') + r.avgProfit.padStart(8),
      ('+' + r.maxWin).padStart(8),
      r.maxLoss.padStart(8),
      r.avgHoldDuration.padStart(10),
      String(r.openPositions).padStart(6),
    ].join(' | ');
    console.log(row);
  }
  console.log('-'.repeat(100));
}

// ============ 主流程 ============

async function main() {
  console.log('RSI 策略对比回测');
  console.log(`策略数量: ${STRATEGIES.length}`);
  console.log(`源实验数量: ${SOURCE_EXPERIMENTS.length}`);

  // 加载 pre-buy check 参考配置
  console.log(`\n加载参考实验配置 [${PRE_BUY_REF_EXPERIMENT}]...`);
  const refConfig = await loadExperimentConfig(PRE_BUY_REF_EXPERIMENT);
  if (refConfig) {
    console.log('  preBuyCheck 配置:', JSON.stringify(refConfig.preBuyCheck || '未找到', null, 2));
    const strategies = refConfig.strategiesConfig?.buyStrategies || [];
    if (strategies.length > 0 && strategies[0].preBuyCheckCondition) {
      console.log('  preBuyCheckCondition:', strategies[0].preBuyCheckCondition);
    }
  } else {
    console.log('  ⚠️ 未找到参考实验配置，跳过 pre-buy check');
  }

  // 对每个源实验运行对比
  for (const source of SOURCE_EXPERIMENTS) {
    console.log(`\n${'#'.repeat(60)}`);
    console.log(`  加载源实验: ${source.name} [${source.id}]`);
    console.log(`${'#'.repeat(60)}`);

    const data = await loadTimeSeriesData(source.id);
    console.log(`  加载了 ${data.length} 条时序数据`);

    if (data.length === 0) {
      console.log('  ⚠️ 无数据，跳过');
      continue;
    }

    // 统计代币数
    const uniqueTokens = new Set(data.map(d => d.token_address));
    console.log(`  涉及 ${uniqueTokens.size} 个代币`);

    // 运行策略对比
    const results = runStrategyComparison(data, STRATEGIES);
    printResults(results, source.name);

    // 输出最佳策略详情
    const best = results.reduce((a, b) =>
      parseFloat(a.totalProfit) > parseFloat(b.totalProfit) ? a : b
    );
    if (best.totalTrades > 0) {
      console.log(`\n  📊 最佳策略: ${best.name} (总收益: ${best.totalProfit}%)`);
      console.log(`  前 10 笔交易详情:`);
      for (const t of best.trades.slice(0, 10)) {
        console.log(`    ${t.symbol}: 买入=${t.buyPrice.toExponential(3)} 卖出=${t.sellPrice.toExponential(3)} 收益=${t.profitPercent > 0 ? '+' : ''}${t.profitPercent.toFixed(1)}% 持有=${t.holdDuration.toFixed(0)}s`);
      }
    }
  }

  console.log('\n完成。');
  process.exit(0);
}

main().catch(err => {
  console.error('致命错误:', err);
  process.exit(1);
});
