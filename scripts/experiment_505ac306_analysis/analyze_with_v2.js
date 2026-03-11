/**
 * 使用新的优化分类系统重新分析数据
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const DATA_DIR = '/Users/nobody1/Desktop/Codes/richer-js/scripts/experiment_505ac306_analysis';
const EXPERIMENT_ID = '505ac306-97fc-43d6-b027-00b909469b81';

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

// 加载新的分类系统
const system = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'classification_system_v2.json'), 'utf8'));

// 分类函数 - 返回单个类别
function classifyWallet(wallet, system) {
  const balanceCat = system.dimensions.balance.categories.find(c => {
    if (c.max !== undefined && c.min !== undefined)
      return wallet.total_balance >= c.min && wallet.total_balance < c.max;
    else if (c.max !== undefined) return wallet.total_balance < c.max;
    else return wallet.total_balance >= c.min;
  }) || system.dimensions.balance.categories[system.dimensions.balance.categories.length - 1];

  const tradingCat = system.dimensions.trading.categories.find(c => {
    if (c.max !== undefined && c.min !== undefined)
      return wallet.total_trades >= c.min && wallet.total_trades < c.max;
    else if (c.max !== undefined) return wallet.total_trades < c.max;
    else return wallet.total_trades >= c.min;
  }) || system.dimensions.trading.categories[system.dimensions.trading.categories.length - 1];

  const ageCat = system.dimensions.age.categories.find(c => {
    if (c.max !== undefined && c.min !== undefined)
      return wallet.wallet_age_days >= c.min && wallet.wallet_age_days < c.max;
    else if (c.max !== undefined) return wallet.wallet_age_days < c.max;
    else return wallet.wallet_age_days >= c.min;
  }) || system.dimensions.age.categories[system.dimensions.age.categories.length - 1];

  const profitRatio = wallet.total_tokens > 0 ? (wallet.profitable_tokens || 0) / wallet.total_tokens : 0;
  const profitCat = system.dimensions.profitability.categories.find(c => {
    if (c.max !== undefined && c.min !== undefined)
      return profitRatio >= c.min && profitRatio < c.max;
    else if (c.max !== undefined) return profitRatio < c.max;
    else return profitRatio >= c.min;
  }) || system.dimensions.profitability.categories[system.dimensions.profitability.categories.length - 1];

  // 按优先级查找匹配的组合类别
  const sortedCombos = [...system.combo_categories].sort((a, b) => a.priority - b.priority);

  for (const combo of sortedCombos) {
    if (combo.rules.length === 0) continue;

    const match = combo.rules.every(rule => {
      if (rule.dimension === 'balance') return balanceCat.name === rule.category;
      else if (rule.dimension === 'trading') return tradingCat.name === rule.category;
      else if (rule.dimension === 'age') return ageCat.name === rule.category;
      else if (rule.dimension === 'profitability') return profitCat.name === rule.category;
      return false;
    });

    if (match) {
      return combo.name;
    }
  }

  return '🐟 普通玩家';
}

// 缓存
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

  const tokenTrades = trades
    .filter(t => t.token_address === tokenAddress && (t.status === 'success' || t.trade_status === 'success'))
    .sort((a, b) => new Date(a.created_at || a.executed_at) - new Date(b.created_at || b.executed_at));

  if (tokenTrades.length === 0) {
    return null;
  }

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
  console.log('='.repeat(100));
  console.log('使用优化分类系统重新分析');
  console.log('='.repeat(100));

  // 加载数据
  const tokenEarlyParticipants = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'token_early_participants_all.json'), 'utf8'));
  const walletData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wallet_data.json'), 'utf8'));

  // 建立钱包地址 -> 分类映射
  const walletClassification = {};
  walletData.forEach(w => {
    walletClassification[w.address] = classifyWallet(w, system);
  });

  // 获取已执行的买入信号
  console.log('\n[步骤1] 过滤已执行的买入信号...');
  const signalsResponse = await get(`http://localhost:3010/api/experiment/${EXPERIMENT_ID}/signals?signalType=BUY&executed=true&limit=1000`);

  if (!signalsResponse.success) {
    throw new Error(`获取信号失败: ${signalsResponse.error}`);
  }

  const executedSignals = signalsResponse.signals || [];
  const executedTokenAddresses = new Set(executedSignals.map(s => s.token_address));
  console.log(`  ✓ 已执行信号: ${executedSignals.length} 个`);
  console.log(`  ✓ 唯一代币: ${executedTokenAddresses.size} 个`);

  // 过滤数据
  const filteredTokenData = {};
  for (const [tokenAddress, data] of Object.entries(tokenEarlyParticipants)) {
    if (executedTokenAddresses.has(tokenAddress)) {
      filteredTokenData[tokenAddress] = data;
    }
  }

  console.log(`  ✓ 匹配到早期参与者数据的代币: ${Object.keys(filteredTokenData).length} 个`);

  // 分析
  console.log('\n[步骤2] 获取收益率并分析...');

  const tokenAnalysis = [];
  const tokens = Object.entries(filteredTokenData);
  const categories = ['🏆 巨鲸', '💎 聪明钱', '🤖 疑似机器人', '🎲 高频玩家', '🌟 新星玩家', '🦅 老鸟赢家', '💰 大户', '🐟 散户', '🐟 普通玩家'];

  for (let i = 0; i < tokens.length; i++) {
    const [tokenAddress, data] = tokens[i];
    process.stdout.write(`\r  处理: ${i + 1}/${tokens.length}`);

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
      const classification = walletClassification[walletAddr] || '🐟 普通玩家';
      categoryCounts[classification] = (categoryCounts[classification] || 0) + 1;
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

  console.log(`\r  ✓ 完成: ${tokenAnalysis.length} 个代币`);

  // 过滤出有涨跌数据的代币
  const tokensWithProfit = tokenAnalysis.filter(t => t.profit_percent !== null);
  console.log(`  ✓ 有涨跌数据: ${tokensWithProfit.length} 个`);

  // 计算相关性
  console.log('\n[步骤3] 计算相关性...');

  const correlations = {};

  categories.forEach(cat => {
    const validData = tokensWithProfit.filter(t => t.category_counts[cat] > 0);

    if (validData.length >= 3) {
      const xValues = validData.map(t => t.category_counts[cat] / t.participant_count);
      const yValues = validData.map(t => t.profit_percent);

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

  // 输出结果
  console.log('\n' + '='.repeat(100));
  console.log('[分析结果 - 使用优化分类系统]');
  console.log('='.repeat(100));

  console.log('\n[数据概览]');
  console.log(`总代币数: ${Object.keys(filteredTokenData).length}`);
  console.log(`有涨跌数据: ${tokensWithProfit.length}`);

  console.log('\n[相关性分析]');
  console.log('类别'.padEnd(22) + '相关系数'.padEnd(10) + '样本数');
  console.log('-'.repeat(50));

  Object.entries(correlations).forEach(([cat, data]) => {
    const direction = parseFloat(data.correlation) > 0 ? '+' : '';
    console.log(`${cat.padEnd(22)} ${direction}${data.correlation.padEnd(10)} ${data.count}个`);
  });

  // 保存结果
  const result = {
    experiment_id: EXPERIMENT_ID,
    analysis_date: new Date().toISOString(),
    classification_system: "v2_optimized",
    total_tokens: Object.keys(filteredTokenData).length,
    analyzed_tokens: tokensWithProfit.length,
    correlations,
    token_analysis: tokenAnalysis
  };

  fs.writeFileSync(
    path.join(DATA_DIR, 'final_analysis_v2.json'),
    JSON.stringify(result, null, 2)
  );

  console.log('\n✅ 分析完成!');
  console.log(`数据保存在: ${DATA_DIR}/final_analysis_v2.json`);
}

main().catch(console.error);
