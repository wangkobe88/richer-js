/**
 * 完整分析流程
 * 1. 过滤出已执行的57个买入信号代币
 * 2. 获取钱包分类数据
 * 3. 计算收益率
 * 4. 构建分类规则
 */

require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });
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

// 加载分类系统
const system = JSON.parse(fs.readFileSync(path.join('/Users/nobody1/Desktop/Codes/richer-js/scripts/early-participants-analysis', 'classification_system.json'), 'utf8'));

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

// 缓存
let tradesCache = null;
let walletDataCache = null;

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

// 获取钱包数据
async function getWalletData(walletAddresses) {
  if (walletDataCache) return walletDataCache;

  console.log(`\n[获取钱包数据] 总数: ${walletAddresses.length}`);

  const walletData = [];
  const batchSize = 50;

  for (let i = 0; i < walletAddresses.length; i += batchSize) {
    const batch = walletAddresses.slice(i, i + batchSize);
    const response = await get(`http://localhost:3010/api/wallets/batch?addresses=${batch.join(',')}`);

    if (response.success && response.wallets) {
      walletData.push(...response.wallets);
    }

    process.stdout.write(`\r  进度: ${Math.min(i + batchSize, walletAddresses.length)}/${walletAddresses.length}`);
  }

  console.log(`\n  ✓ 完成: ${walletData.length} 个钱包`);
  walletDataCache = walletData;
  return walletData;
}

// 主分析
async function main() {
  console.log('='.repeat(100));
  console.log('完整分析: 早期参与者构成 vs 代币收益');
  console.log('='.repeat(100));

  // 加载早期参与者数据
  const tokenEarlyParticipants = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'token_early_participants_all.json'), 'utf8'));

  // 获取已执行的买入信号，过滤出57个代币
  console.log('\n[步骤1] 获取已执行的买入信号...');
  const signalsResponse = await get(`http://localhost:3010/api/experiment/${EXPERIMENT_ID}/signals?signalType=BUY&executed=true&limit=1000`);

  if (!signalsResponse.success) {
    throw new Error(`获取信号失败: ${signalsResponse.error}`);
  }

  const executedSignals = signalsResponse.signals || [];
  console.log(`  ✓ 获取到 ${executedSignals.length} 个已执行的买入信号`);

  // 提取唯一代币地址
  const executedTokenAddresses = new Set(executedSignals.map(s => s.token_address));
  console.log(`  ✓ 唯一代币数: ${executedTokenAddresses.size}`);

  // 过滤出这57个代币的早期参与者数据
  const filteredTokenData = {};
  const allWallets = new Set();

  for (const [tokenAddress, data] of Object.entries(tokenEarlyParticipants)) {
    if (executedTokenAddresses.has(tokenAddress)) {
      filteredTokenData[tokenAddress] = data;
      data.participants.forEach(w => allWallets.add(w));
    }
  }

  console.log(`  ✓ 匹配到早期参与者数据的代币: ${Object.keys(filteredTokenData).length} 个`);
  console.log(`  ✓ 唯一钱包数: ${allWallets.size}`);

  // 获取钱包数据
  const walletData = await getWalletData(Array.from(allWallets));

  // 建立钱包地址 -> 分类映射
  const walletClassification = {};
  walletData.forEach(w => {
    const classification = classifyWallet(w, system);
    walletClassification[w.address] = classification;
  });

  // 获取收益率并分析
  console.log('\n[步骤2] 获取收益率并分析...');

  const tokenAnalysis = [];
  const tokens = Object.entries(filteredTokenData);
  const categories = ['🏆 巨鲸', '💎 聪明钱老鸟', '🤖 疑似机器人', '🎲 高频交易者', '🌟 新星玩家', '🦅 老鸟赢家', '💰 大户', '🐟 散户', '🐟 普通玩家'];

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
  console.log('[分析结果]');
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
    total_tokens: Object.keys(filteredTokenData).length,
    analyzed_tokens: tokensWithProfit.length,
    correlations,
    token_analysis: tokenAnalysis
  };

  fs.writeFileSync(
    path.join(DATA_DIR, 'final_analysis_results.json'),
    JSON.stringify(result, null, 2)
  );

  console.log('\n✅ 分析完成!');
  console.log(`数据保存在: ${DATA_DIR}/final_analysis_results.json`);
}

main().catch(console.error);
