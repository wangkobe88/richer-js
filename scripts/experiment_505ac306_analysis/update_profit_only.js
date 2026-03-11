/**
 * 只更新收益率数据 - 使用正确的 FIFO 计算
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const DATA_DIR = '/Users/nobody1/Desktop/Codes/richer-js/scripts/experiment_505ac306_analysis';
const EXPERIMENT_ID = '505ac306-97fc-43d6-b027-00b909469b81';

// 加载已保存的数据
const tokenEarlyParticipants = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'token_early_participants.json'), 'utf8'));
const walletData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wallet_data.json'), 'utf8'));
const analysisResults = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'analysis_results.json'), 'utf8'));

// HTTP 工具
function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ success: false, error: e.message, raw: data });
        }
      });
    }).on('error', reject);
  });
}

// 缓存交易数据
let tradesCache = null;

async function getAllTrades() {
  if (tradesCache) return tradesCache;

  console.log('[获取交易数据...]');
  const response = await get(`http://localhost:3010/api/experiment/${EXPERIMENT_ID}/trades?limit=10000`);

  if (response.success && response.trades) {
    tradesCache = response.trades;
    console.log(`  ✓ 获取到 ${response.trades.length} 条交易记录`);
    return response.trades;
  }

  console.log('  ✗ 获取交易数据失败');
  return [];
}

async function getTokenProfitPercent(tokenAddress) {
  const trades = await getAllTrades();

  // 获取该代币的所有成功交易，按时间排序
  const tokenTrades = trades
    .filter(t => t.token_address === tokenAddress && (t.status === 'success' || t.trade_status === 'success'))
    .sort((a, b) => new Date(a.created_at || a.executed_at) - new Date(b.created_at || b.executed_at));

  if (tokenTrades.length === 0) {
    return null;
  }

  // FIFO 队列跟踪买入成本
  const buyQueue = [];
  let totalBNBSpent = 0;
  let totalBNBReceived = 0;

  tokenTrades.forEach(trade => {
    const direction = trade.trade_direction || trade.direction || trade.action;
    const isBuy = direction === 'buy' || direction === 'BUY';

    if (isBuy) {
      const inputAmount = parseFloat(trade.input_amount || 0);
      const outputAmount = parseFloat(trade.output_amount || 0);

      if (outputAmount > 0) {
        buyQueue.push({ amount: outputAmount, cost: inputAmount });
        totalBNBSpent += inputAmount;
      }
    } else {
      const inputAmount = parseFloat(trade.input_amount || 0);
      const outputAmount = parseFloat(trade.output_amount || 0);

      let remainingToSell = inputAmount;
      let costOfSold = 0;

      while (remainingToSell > 0 && buyQueue.length > 0) {
        const oldestBuy = buyQueue[0];
        const sellAmount = Math.min(remainingToSell, oldestBuy.amount);
        const unitCost = oldestBuy.cost / oldestBuy.amount;
        costOfSold += unitCost * sellAmount;
        remainingToSell -= sellAmount;
        oldestBuy.amount -= sellAmount;
        oldestBuy.cost -= unitCost * sellAmount;

        if (oldestBuy.amount <= 0.00000001) {
          buyQueue.shift();
        }
      }

      totalBNBReceived += outputAmount;
    }
  });

  let remainingCost = 0;
  buyQueue.forEach(buy => {
    remainingCost += buy.cost;
  });

  const totalCost = totalBNBSpent || 1;
  const totalValue = totalBNBReceived + remainingCost;
  const returnRate = ((totalValue - totalCost) / totalCost) * 100;

  return returnRate;
}

// 主分析
async function main() {
  console.log('='.repeat(60));
  console.log('更新收益率数据');
  console.log('='.repeat(60));

  console.log(`\n[步骤1] 获取收益率数据...`);

  const tokenProfitMap = {};
  let count = 0;
  let total = Object.keys(tokenEarlyParticipants).length;

  for (const tokenAddress of Object.keys(tokenEarlyParticipants)) {
    count++;
    process.stdout.write(`\r  处理: ${count}/${total}`);

    const profitPercent = await getTokenProfitPercent(tokenAddress);
    if (profitPercent !== null) {
      tokenProfitMap[tokenAddress] = profitPercent;
    }
  }

  console.log(`\r  ✓ 完成: ${Object.keys(tokenProfitMap).length}个代币有收益数据`);

  // 更新 analysis_results.json 中的 profit_percent
  console.log('\n[步骤2] 更新分析结果...');

  let updatedCount = 0;
  analysisResults.token_analysis.forEach(token => {
    if (tokenProfitMap[token.token_address] !== undefined) {
      token.profit_percent = tokenProfitMap[token.token_address];

      // 更新 return_category
      const profitPercent = tokenProfitMap[token.token_address];
      if (profitPercent > 20) token.return_category = '大涨';
      else if (profitPercent > 0) token.return_category = '小涨';
      else if (profitPercent > -20) token.return_category = '小跌';
      else token.return_category = '大跌';

      updatedCount++;
    }
  });

  analysisResults.analyzed_tokens = updatedCount;

  // 重新计算相关性
  console.log('\n[步骤3] 重新计算相关性...');

  const tokensWithProfit = analysisResults.token_analysis.filter(t => t.profit_percent !== null);

  const categories = ['🏆 巨鲸', '💎 聪明钱老鸟', '🤖 疑似机器人', '🎲 高频交易者', '🌟 新星玩家', '🦅 老鸟赢家', '💰 大户', '🐟 散户', '🐟 普通玩家'];
  const correlations = {};

  categories.forEach(cat => {
    const validData = tokensWithProfit.filter(t => t.category_counts[cat] > 0);

    if (validData.length >= 3) {
      const xValues = validData.map(t => t.category_counts[cat] / t.participant_count);
      const yValues = validData.map(t => t.profit_percent);

      // 计算皮尔逊相关系数
      const n = xValues.length;
      const sumX = xValues.reduce((a, b) => a + b, 0);
      const sumY = yValues.reduce((a, b) => a + b, 0);
      const sumXY = xValues.map((x, i) => x * yValues[i]).reduce((a, b) => a + b, 0);
      const sumX2 = xValues.map(x => x * x).reduce((a, b) => a + b, 0);
      const sumY2 = yValues.map(y => y * y).reduce((a, b) => a + b, 0);

      const numerator = sumXY - (sumX * sumY / n);
      const denominator = Math.sqrt((sumX2 - sumX * sumX / n) * (sumY2 - sumY * sumY / n));

      const correlation = denominator !== 0 ? numerator / denominator : 0;
      correlations[cat] = {
        correlation: correlation.toFixed(3),
        count: validData.length
      };
    } else {
      correlations[cat] = {
        correlation: '0.000',
        count: validData.length
      };
    }
  });

  analysisResults.correlations = correlations;

  // 分组对比
  console.log('\n[步骤4] 重新计算分组对比...');

  const groupComparison = {
    smartMoneyHigh: [],
    smartMoneyZero: [],
    botHigh: [],
    botLow: [],
    retailHigh: [],
    retailLow: []
  };

  tokensWithProfit.forEach(t => {
    if (t.participant_count === 0) return;

    const counts = t.category_counts;
    const smartRatio = (counts['💎 聪明钱老鸟'] || 0) / t.participant_count;
    const botRatio = (counts['🤖 疑似机器人'] || 0) / t.participant_count;
    const retailRatio = ((counts['🐟 散户'] || 0) + (counts['🐟 普通玩家'] || 0)) / t.participant_count;

    if (smartRatio > 0.02) groupComparison.smartMoneyHigh.push(t.profit_percent);
    if (smartRatio === 0) groupComparison.smartMoneyZero.push(t.profit_percent);
    if (botRatio > 0.02) groupComparison.botHigh.push(t.profit_percent);
    if (botRatio === 0) groupComparison.botLow.push(t.profit_percent);
    if (retailRatio > 0.3) groupComparison.retailHigh.push(t.profit_percent);
    else groupComparison.retailLow.push(t.profit_percent);
  });

  const avg = arr => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  analysisResults.group_comparison = {
    smart_money_high_vs_zero: {
      high: { count: groupComparison.smartMoneyHigh.length, avg_profit: avg(groupComparison.smartMoneyHigh) },
      zero: { count: groupComparison.smartMoneyZero.length, avg_profit: avg(groupComparison.smartMoneyZero) }
    },
    bot_high_vs_low: {
      high: { count: groupComparison.botHigh.length, avg_profit: avg(groupComparison.botHigh) },
      low: { count: groupComparison.botLow.length, avg_profit: avg(groupComparison.botLow) }
    },
    retail_high_vs_low: {
      high: { count: groupComparison.retailHigh.length, avg_profit: avg(groupComparison.retailHigh) },
      low: { count: groupComparison.retailLow.length, avg_profit: avg(groupComparison.retailLow) }
    }
  };

  // 保存结果
  fs.writeFileSync(
    path.join(DATA_DIR, 'analysis_results.json'),
    JSON.stringify(analysisResults, null, 2)
  );

  // 输出结果
  console.log('\n' + '='.repeat(60));
  console.log('[分析结果]');
  console.log('='.repeat(60));

  console.log('\n[数据概览]');
  console.log(`总代币数: ${total}`);
  console.log(`有涨跌数据: ${tokensWithProfit.length}`);

  console.log('\n[相关性分析]');
  console.log('类别'.padEnd(22) + '相关系数'.padEnd(10) + '样本数');
  console.log('-'.repeat(50));

  Object.entries(correlations).forEach(([cat, data]) => {
    const direction = parseFloat(data.correlation) > 0 ? '+' : '';
    console.log(`${cat.padEnd(22)} ${direction}${data.correlation.padEnd(10)} ${data.count}个`);
  });

  console.log('\n[分组对比]');
  console.log('聪明钱对比:');
  console.log(`  >2%: ${groupComparison.smartMoneyHigh.length}个, 平均涨跌: ${avg(groupComparison.smartMoneyHigh).toFixed(1)}%`);
  console.log(`  =0%: ${groupComparison.smartMoneyZero.length}个, 平均涨跌: ${avg(groupComparison.smartMoneyZero).toFixed(1)}%`);

  console.log('\n机器人对比:');
  console.log(`  >2%: ${groupComparison.botHigh.length}个, 平均涨跌: ${avg(groupComparison.botHigh).toFixed(1)}%`);
  console.log(`  =0%: ${groupComparison.botLow.length}个, 平均涨跌: ${avg(groupComparison.botLow).toFixed(1)}%`);

  console.log('\n散户对比:');
  console.log(`  >30%: ${groupComparison.retailHigh.length}个, 平均涨跌: ${avg(groupComparison.retailHigh).toFixed(1)}%`);
  console.log(`  ≤30%: ${groupComparison.retailLow.length}个, 平均涨跌: ${avg(groupComparison.retailLow).toFixed(1)}%`);

  console.log('\n✅ 更新完成!');
  console.log(`数据保存在: ${DATA_DIR}/analysis_results.json`);
}

main().catch(console.error);
