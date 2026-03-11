/**
 * 使用已有数据重新分析 - 使用 trades 接口获取正确的收益率
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const DATA_DIR = '/Users/nobody1/Desktop/Codes/richer-js/scripts/experiment_505ac306_analysis';
const EXPERIMENT_ID = '505ac306-97fc-43d6-b027-00b909469b81';

// 加载分类系统
const system = JSON.parse(fs.readFileSync(path.join('/Users/nobody1/Desktop/Codes/richer-js/scripts/early-participants-analysis', 'classification_system.json'), 'utf8'));

// 加载已保存的早期参与者数据
const tokenEarlyParticipants = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'token_early_participants.json'), 'utf8'));

// 加载钱包数据
const walletData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wallet_data.json'), 'utf8'));

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
  // 使用 trades 接口 + FIFO 计算收益率
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
      const unitPrice = parseFloat(trade.unit_price || 0);

      if (outputAmount > 0) {
        buyQueue.push({ amount: outputAmount, cost: inputAmount, price: unitPrice });
        totalBNBSpent += inputAmount;
      }
    } else {
      const inputAmount = parseFloat(trade.input_amount || 0);
      const outputAmount = parseFloat(trade.output_amount || 0);
      const unitPrice = parseFloat(trade.unit_price || 0);

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

// 分类函数
function classifyWallet(wallet, system) {
  const balanceCat = system.dimensions.balance.categories.find(c => {
    if (c.max !== undefined && c.min !== undefined)
      return wallet.total_balance >= c.min && wallet.total_balance < c.max;
    else if (c.max !== undefined) return wallet.total_balance < c.max;
    else return wallet.total_balance >= c.min;
  });

  const tradingCat = system.dimensions.trading.categories.find(c => {
    if (c.max !== undefined && c.min !== undefined)
      return wallet.total_trades >= c.min && wallet.total_trades < c.max;
    else if (c.max !== undefined) return wallet.total_trades < c.max;
    else return wallet.total_trades >= c.min;
  });

  const ageCat = system.dimensions.age.categories.find(c => {
    if (c.max !== undefined && c.min !== undefined)
      return wallet.wallet_age_days >= c.min && wallet.wallet_age_days < c.max;
    else if (c.max !== undefined) return wallet.wallet_age_days < c.max;
    else return wallet.wallet_age_days >= c.min;
  });

  const profitRatio = wallet.total_tokens > 0 ? wallet.profitable_tokens / wallet.total_tokens : 0;
  const profitCat = system.dimensions.profitability.categories.find(c => {
    if (c.max !== undefined && c.min !== undefined)
      return profitRatio >= c.min && profitRatio < c.max;
    else if (c.max !== undefined) return profitRatio < c.max;
    else return profitRatio >= c.min;
  });

  const combo = [];
  system.combo_categories.forEach(comboCat => {
    const match = comboCat.rules.every(rule => {
      if (rule.dimension === 'balance') return balanceCat && balanceCat.name === rule.category;
      else if (rule.dimension === 'trading') return tradingCat && tradingCat.name === rule.category;
      else if (rule.dimension === 'age') return ageCat && ageCat.name === rule.category;
      else if (rule.dimension === 'profitability') return profitCat && profitCat.name === rule.category;
      return false;
    });
    if (match) combo.push(comboCat);
  });

  return { combo };
}

// 主分析
async function main() {
  console.log('='.repeat(140));
  console.log('重新分析 - 使用正确的收益率数据');
  console.log('='.repeat(140));

  // 建立钱包地址 -> 分类映射
  const walletClassification = {};
  walletData.forEach(w => {
    const classification = classifyWallet(w, system);
    walletClassification[w.address] = classification;
  });

  console.log(`\n[步骤1] 获取收益率数据...`);

  const tokenAnalysis = [];

  for (const [tokenAddress, data] of Object.entries(tokenEarlyParticipants)) {
    process.stdout.write(`\r  处理: ${tokenAnalysis.length + 1}/${Object.keys(tokenEarlyParticipants).length}`);

    // 获取收益率
    const profitPercent = await getTokenProfitPercent(tokenAddress);

    let returnCategory = 'unknown';
    if (profitPercent !== null) {
      if (profitPercent > 20) returnCategory = '大涨';
      else if (profitPercent > 0) returnCategory = '小涨';
      else if (profitPercent > -20) returnCategory = '小跌';
      else returnCategory = '大跌';
    }

    // 统计各类别数量
    const categoryCounts = {};
    data.participants.forEach(walletAddr => {
      const classification = walletClassification[walletAddr];
      if (classification && classification.combo.length > 0) {
        classification.combo.forEach(cat => {
          categoryCounts[cat.name] = (categoryCounts[cat.name] || 0) + 1;
        });
      } else {
        categoryCounts['🐟 普通玩家'] = (categoryCounts['🐟 普通玩家'] || 0) + 1;
      }
    });

    tokenAnalysis.push({
      token_address: tokenAddress,
      token_symbol: data.token_symbol,
      profit_percent: profitPercent,
      return_category: returnCategory,
      participant_count: data.participant_count,
      category_counts: categoryCounts
    });
  }

  console.log(`\r  ✓ 完成: ${tokenAnalysis.length}个代币`);

  // 过滤出有涨跌数据的代币
  const tokensWithProfit = tokenAnalysis.filter(t => t.profit_percent !== null);
  console.log(`  ✓ 有涨跌数据: ${tokensWithProfit.length}个`);

  // 计算相关性
  console.log('\n[步骤2] 计算相关性...');

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

  // 分组对比
  console.log('\n[步骤3] 分组对比...');

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

  // 输出结果
  console.log('\n' + '='.repeat(140));
  console.log('[分析结果]');
  console.log('='.repeat(140));

  console.log('\n[数据概览]');
  console.log(`总代币数: ${Object.keys(tokenEarlyParticipants).length}`);
  console.log(`有涨跌数据: ${tokensWithProfit.length}`);
  console.log(`钱包总数: ${walletData.length}`);

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

  console.log('\n[代币示例]');

  const sortedTokens = tokensWithProfit.sort((a, b) => b.profit_percent - a.profit_percent);

  console.log('\n涨幅前5:');
  sortedTokens.slice(0, 5).forEach((t, i) => {
    const smart = t.category_counts['💎 聪明钱老鸟'] || 0;
    const bot = t.category_counts['🤖 疑似机器人'] || 0;
    const retail = (t.category_counts['🐟 散户'] || 0) + (t.category_counts['🐟 普通玩家'] || 0);
    console.log(`  ${i + 1}. ${t.token_symbol} (${t.profit_percent.toFixed(1)}%) | 聪明钱:${smart} 机器人:${bot} 散户:${retail}/${t.participant_count}`);
  });

  console.log('\n跌幅前5:');
  sortedTokens.slice(-5).reverse().forEach((t, i) => {
    const smart = t.category_counts['💎 聪明钱老鸟'] || 0;
    const bot = t.category_counts['🤖 疑似机器人'] || 0;
    const retail = (t.category_counts['🐟 散户'] || 0) + (t.category_counts['🐟 普通玩家'] || 0);
    console.log(`  ${i + 1}. ${t.token_symbol} (${t.profit_percent.toFixed(1)}%) | 聪明钱:${smart} 机器人:${bot} 散户:${retail}/${t.participant_count}`);
  });

  // 保存结果
  const result = {
    experiment_id: EXPERIMENT_ID,
    analysis_date: new Date().toISOString(),
    total_tokens: Object.keys(tokenEarlyParticipants).length,
    analyzed_tokens: tokensWithProfit.length,
    correlations,
    group_comparison: {
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
      },
      token_analysis: tokenAnalysis
  };

  fs.writeFileSync(
    path.join(DATA_DIR, 'reanalysis_results.json'),
    JSON.stringify(result, null, 2)
  );

  console.log('\n✅ 分析完成!');
  console.log(`数据保存在: ${DATA_DIR}/reanalysis_results.json`);
}

main().catch(console.error);
