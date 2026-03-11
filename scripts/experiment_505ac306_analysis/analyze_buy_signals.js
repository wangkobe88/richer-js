/**
 * 实验 505ac306 买入信号早期参与者分类与涨跌预测分析
 *
 * 目标：分析买入信号前90秒的参与者构成，预测代币涨跌
 */

// 加载环境变量
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const http = require('http');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = '/Users/nobody1/Desktop/Codes/richer-js/scripts/experiment_505ac306_analysis';
const EXPERIMENT_ID = '505ac306-97fc-43d6-b027-00b909469b81';

// 确保输出目录存在
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// ==================== HTTP 工具函数 ====================

function post(url, data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const req = http.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== 步骤1: 获取买入信号 ====================

async function getBuySignals() {
  console.log('\n[步骤1] 获取买入信号...');

  const response = await get(`http://localhost:3010/api/experiment/${EXPERIMENT_ID}/signals?signalType=BUY&executed=true&limit=1000`);

  if (!response.success) {
    throw new Error(`获取信号失败: ${response.error}`);
  }

  const signals = response.signals || [];
  console.log(`  获取到 ${signals.length} 个买入信号`);

  // 保存原始数据
  fs.writeFileSync(path.join(OUTPUT_DIR, 'buy_signals.json'), JSON.stringify(signals, null, 2));

  return signals;
}

// ==================== 步骤2: 获取代币的 innerPair ====================

async function getTokenInfo(tokenAddress) {
  const response = await get(`http://localhost:3010/api/experiment/${EXPERIMENT_ID}/tokens?limit=1000`);

  if (!response.success) {
    throw new Error(`获取代币失败: ${response.error}`);
  }

  const token = response.tokens?.find(t => t.token_address === tokenAddress);

  if (!token) {
    console.log(`  ⚠️  未找到代币 ${tokenAddress.slice(0, 10)}... 的信息`);
    return null;
  }

  // 提取 innerPair
  const innerPair = token.raw_api_data?.main_pair || `${tokenAddress}_fo`;

  return {
    tokenAddress,
    tokenSymbol: token.token_symbol,
    innerPair,
    chain: token.blockchain || 'bsc',
    creatorAddress: token.creator_address,
    rawApiData: token.raw_api_data
  };
}

// ==================== 步骤3: 获取早期交易（买入前90秒）====================

async function getEarlyTradesBeforeBuy(tokenInfo, executedAt) {
  const { AveTxAPI } = require('/Users/nobody1/Desktop/Codes/richer-js/src/core/ave-api');
  const config = require('/Users/nobody1/Desktop/Codes/richer-js/config/default.json');

  const txApi = new AveTxAPI(
    config.ave?.apiUrl || 'https://prod.ave-api.com',
    config.ave?.timeout || 30000,
    process.env.AVE_API_KEY
  );

  const pairId = `${tokenInfo.innerPair}-${tokenInfo.chain}`;
  const checkTime = Math.floor(new Date(executedAt).getTime() / 1000);
  const targetFromTime = checkTime - 90;  // 固定回溯90秒
  let currentToTime = checkTime;

  const allTrades = [];
  let loopCount = 0;
  const maxLoops = 10; // 最多10次（可覆盖3000笔交易）

  // 调试前3个代币的详细信息
  const shouldDebug = !getEarlyTradesBeforeBuy.debugCount || getEarlyTradesBeforeBuy.debugCount < 3;

  try {
    if (shouldDebug && getEarlyTradesBeforeBuy.debugCount !== undefined) {
      getEarlyTradesBeforeBuy.debugCount++;
    } else if (shouldDebug) {
      getEarlyTradesBeforeBuy.debugCount = 1;
    }

    while (loopCount < maxLoops) {
      loopCount++;

      const trades = await txApi.getSwapTransactions(pairId, 300, targetFromTime, currentToTime, 'asc');

      if (shouldDebug && getEarlyTradesBeforeBuy.debugCount <= 3) {
        console.log(`\n    [API调用${loopCount}] pairId=${pairId}`);
        console.log(`    fromTime=${targetFromTime}, toTime=${currentToTime}`);
        console.log(`    返回${trades.length}条交易`);
        if (trades.length > 0) {
          console.log(`    最早时间: ${trades[0].time}, 最晚时间: ${trades[trades.length-1].time}`);
        }
      }

      if (trades.length === 0) break;

      allTrades.push(...trades);

      const batchFirstTime = trades[0].time;

      // 如果已经覆盖到目标起始时间，结束
      if (batchFirstTime <= targetFromTime) {
        break;
      }

      // 如果返回了300条，可能还有更早的数据
      if (trades.length === 300) {
        currentToTime = batchFirstTime - 1;
      } else {
        break;
      }
    }

    // 去重
    const seen = new Set();
    const uniqueTrades = [];
    for (const trade of allTrades) {
      const key = trade.tx_id || `${trade.time}_${trade.from_address}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueTrades.push(trade);
      }
    }

    // 按时间排序
    uniqueTrades.sort((a, b) => a.time - b.time);

    // 调试输出
    if (uniqueTrades.length > 0) {
      const actualSpan = uniqueTrades.length > 0
        ? (uniqueTrades[uniqueTrades.length - 1].time - uniqueTrades[0].time).toFixed(1)
        : 0;
      console.log(`\n  📊 ${tokenInfo.tokenSymbol}: ${uniqueTrades.length}条交易 (跨度: ${actualSpan}秒)`);
    }

    return uniqueTrades;

  } catch (error) {
    // 只在第一次输出错误详情，避免刷屏
    if (!getEarlyTradesBeforeBuy.errorLogged) {
      console.log(`  ⚠️  获取交易失败示例: ${error.message} (pairId: ${pairId})`);
      getEarlyTradesBeforeBuy.errorLogged = true;
    }
    return [];
  }
}

// ==================== 步骤4: 钱包去重 ====================

function deduplicateWallets(allTrades) {
  const walletSet = new Set();

  allTrades.forEach(({ trades }) => {
    trades.forEach(trade => {
      if (trade.from_address) walletSet.add(trade.from_address.toLowerCase());
      if (trade.to_address) walletSet.add(trade.to_address.toLowerCase());
    });
  });

  return Array.from(walletSet);
}

// ==================== 步骤5: 批量查询钱包数据 ====================

async function fetchWalletData(wallets) {
  console.log(`\n[步骤5] 查询 ${wallets.length} 个钱包数据...`);

  const walletData = [];
  let processed = 0;
  let errors = 0;

  for (const wallet of wallets) {
    try {
      const response = await post('http://localhost:3010/api/wallet/query', {
        walletAddress: wallet,
        chain: 'bsc'
      });

      if (response.success && response.data) {
        const info = response.data.walletInfo;
        const now = Math.floor(Date.now() / 1000);
        const walletAgeTimestamp = info.wallet_age || 0;
        const walletAgeDays = walletAgeTimestamp > 0 ? Math.floor((now - walletAgeTimestamp) / 86400) : 0;

        const tokens = response.data.tokens || [];
        let profitableTokens = 0, losingTokens = 0;
        tokens.forEach(t => {
          if (t.total_profit > 0) profitableTokens++;
          else if (t.total_profit < 0) losingTokens++;
        });

        walletData.push({
          address: wallet,
          total_balance: info.total_balance || 0,
          total_trades: (info.total_purchase || 0) + (info.total_sold || 0),
          wallet_age_days: walletAgeDays,
          total_tokens: tokens.length,
          profitable_tokens: profitableTokens,
          losing_tokens: losingTokens
        });

        processed++;
      }

      await sleep(1000); // 避免限流

      if (processed % 50 === 0) {
        console.log(`  进度: ${processed}/${wallets.length}`);
      }

    } catch (error) {
      errors++;
    }
  }

  console.log(`  完成: ${processed}/${wallets.length} (失败: ${errors})`);

  return walletData;
}

// ==================== 步骤6: 加载分类系统并分类钱包 ====================

function loadClassificationSystem() {
  const systemPath = '/Users/nobody1/Desktop/Codes/richer-js/scripts/early-participants-analysis/classification_system.json';
  return JSON.parse(fs.readFileSync(systemPath, 'utf8'));
}

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

  // 检查组合分类
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

  return {
    basic: { balance: balanceCat?.name, trading: tradingCat?.name, age: ageCat?.name, profitability: profitCat?.name },
    combo
  };
}

// ==================== 步骤7: 获取代币涨跌数据 ====================

// 缓存所有交易数据，避免重复获取
let ALL_TRADES_CACHE = null;

async function getAllTrades() {
  if (ALL_TRADES_CACHE) return ALL_TRADES_CACHE;

  const response = await get(`http://localhost:3010/api/experiment/${EXPERIMENT_ID}/trades?limit=10000`);

  if (response.success && response.trades) {
    ALL_TRADES_CACHE = response.trades;
    return response.trades;
  }

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
  const buyQueue = []; // { amount, cost, price }
  let totalBNBSpent = 0;
  let totalBNBReceived = 0;

  tokenTrades.forEach(trade => {
    const direction = trade.trade_direction || trade.direction || trade.action;
    const isBuy = direction === 'buy' || direction === 'BUY';

    if (isBuy) {
      // 买入：记录到队列
      const inputAmount = parseFloat(trade.input_amount || 0); // BNB 花费
      const outputAmount = parseFloat(trade.output_amount || 0); // 代币数量
      const unitPrice = parseFloat(trade.unit_price || 0);

      if (outputAmount > 0) {
        buyQueue.push({
          amount: outputAmount,
          cost: inputAmount,
          price: unitPrice
        });
        totalBNBSpent += inputAmount;
      }
    } else {
      // 卖出：FIFO 匹配
      const inputAmount = parseFloat(trade.input_amount || 0); // 代币数量
      const outputAmount = parseFloat(trade.output_amount || 0); // BNB 收到
      const unitPrice = parseFloat(trade.unit_price || 0);

      let remainingToSell = inputAmount;
      let costOfSold = 0;

      while (remainingToSell > 0 && buyQueue.length > 0) {
        const oldestBuy = buyQueue[0];
        const sellAmount = Math.min(remainingToSell, oldestBuy.amount);

        // 计算本次卖出的成本
        const unitCost = oldestBuy.cost / oldestBuy.amount;
        costOfSold += unitCost * sellAmount;
        remainingToSell -= sellAmount;

        // 更新队列中的剩余数量和成本
        oldestBuy.amount -= sellAmount;
        oldestBuy.cost -= unitCost * sellAmount;

        if (oldestBuy.amount <= 0.00000001) {
          buyQueue.shift(); // 移除已完全匹配的买入
        }
      }

      totalBNBReceived += outputAmount;
    }
  });

  // 计算剩余持仓
  let remainingCost = 0;
  buyQueue.forEach(buy => {
    remainingCost += buy.cost;
  });

  // 计算收益率
  const totalCost = totalBNBSpent || 1; // 避免除零
  const totalValue = totalBNBReceived + remainingCost; // 剩余部分按成本价计算
  const returnRate = ((totalValue - totalCost) / totalCost) * 100;

  return returnRate;
}

// ==================== 主分析函数 ====================

async function main() {
  console.log('='.repeat(80));
  console.log(`实验 ${EXPERIMENT_ID} 买入信号早期参与者分析`);
  console.log('='.repeat(80));

  const startTime = Date.now();

  try {
    // 步骤1: 获取买入信号
    const signals = await getBuySignals();
    console.log(`  ✓ 买入信号: ${signals.length}个`);

    // 过滤需要分析的信号
    const validSignals = signals.filter(s => s.executed && s.metadata);
    console.log(`  ✓ 有效信号: ${validSignals.length}个`);

    // 步骤2-4: 对每个信号获取早期交易并收集钱包
    console.log('\n[步骤2-4] 获取早期交易并收集钱包...');

    const tokenEarlyParticipants = {};
    const allWallets = new Set();

    // 只调试前3个信号
    let debugCount = 0;

    for (let i = 0; i < validSignals.length; i++) {
      const signal = validSignals[i];
      const tokenAddress = signal.token_address;
      // 使用 metadata.timestamp 作为 checkTime（策略评估时间/K线时间），而不是 executed_at（信号执行时间）
      const signalTimestamp = signal.metadata?.timestamp || signal.created_at;

      process.stdout.write(`\r  处理中: ${i + 1}/${validSignals.length} (${((i + 1) / validSignals.length * 100).toFixed(1)}%)`);

      // 获取代币信息
      const tokenInfo = await getTokenInfo(tokenAddress);
      if (!tokenInfo) continue;

      // 调试输出前3个
      if (debugCount < 3) {
        const checkTime = Math.floor(new Date(signalTimestamp).getTime() / 1000);
        console.log(`\n  [调试${debugCount + 1}] ${tokenInfo.tokenSymbol}: pairId=${tokenInfo.innerPair}-${tokenInfo.chain}, time=${signalTimestamp}, checkTime=${checkTime}`);
        debugCount++;
      }

      // 获取早期交易
      const trades = await getEarlyTradesBeforeBuy(tokenInfo, signalTimestamp);

      // 提取钱包
      const wallets = new Set();
      trades.forEach(trade => {
        if (trade.from_address) wallets.add(trade.from_address.toLowerCase());
        if (trade.to_address) wallets.add(trade.to_address.toLowerCase());
      });

      // 添加到全局钱包集合
      wallets.forEach(w => allWallets.add(w));

      tokenEarlyParticipants[tokenAddress] = {
        token_address: tokenAddress,
        token_symbol: tokenInfo.tokenSymbol,
        signal_timestamp: signalTimestamp,
        executed_at: signal.executed_at,
        inner_pair: tokenInfo.innerPair,
        participant_count: wallets.size,
        participants: Array.from(wallets),
        trade_count: trades.length
      };
    }

    console.log(`\r  ✓ 完成: 处理 ${validSignals.length} 个信号`);
    console.log(`  ✓ 唯一钱包数: ${allWallets.size}`);

    // 保存早期参与者数据
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'token_early_participants.json'),
      JSON.stringify(tokenEarlyParticipants, null, 2)
    );

    // 步骤5: 查询钱包数据
    const walletList = Array.from(allWallets);
    const walletData = await fetchWalletData(walletList);

    // 保存钱包数据
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'wallet_data.json'),
      JSON.stringify(walletData, null, 2)
    );

    // 步骤6: 加载分类系统
    console.log('\n[步骤6] 加载分类系统...');
    const system = loadClassificationSystem();

    // 建立钱包地址 -> 分类映射
    const walletClassification = {};
    walletData.forEach(w => {
      const classification = classifyWallet(w, system);
      walletClassification[w.address] = classification;
    });

    // 步骤7: 构建代币-钱包分类矩阵
    console.log('\n[步骤7] 构建代币-参与者分类矩阵...');

    const tokenAnalysis = [];

    for (const [tokenAddress, data] of Object.entries(tokenEarlyParticipants)) {
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

      // 获取涨跌数据
      const profitPercent = await getTokenProfitPercent(tokenAddress);
      let returnCategory = 'unknown';
      if (profitPercent !== null) {
        if (profitPercent > 20) returnCategory = '大涨';
        else if (profitPercent > 0) returnCategory = '小涨';
        else if (profitPercent > -20) returnCategory = '小跌';
        else returnCategory = '大跌';
      }

      tokenAnalysis.push({
        token_address: tokenAddress,
        token_symbol: data.token_symbol,
        executed_at: data.executed_at,
        profit_percent: profitPercent,
        return_category: returnCategory,
        participant_count: data.participant_count,
        category_counts: categoryCounts
      });
    }

    // 保存分析结果
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'token_analysis.json'),
      JSON.stringify(tokenAnalysis, null, 2)
    );

    // 步骤8: 预测能力分析
    console.log('\n[步骤8] 预测能力分析...');

    // 相关性分析
    const categories = ['🏆 巨鲸', '💎 聪明钱老鸟', '🤖 疑似机器人', '🎲 高频交易者', '🌟 新星玩家', '🦅 老鸟赢家', '💰 大户', '🐟 散户', '🐟 普通玩家'];

    const correlations = {};
    categories.forEach(cat => {
      const dataPoints = tokenAnalysis.filter(t => t.profit_percent !== null);
      if (dataPoints.length < 5) {
        correlations[cat] = { count: 0, correlation: null, note: '数据不足' };
        return;
      }

      const xValues = [];
      const yValues = [];

      dataPoints.forEach(t => {
        const ratio = t.category_counts[cat] ? t.category_counts[cat] / t.participant_count : 0;
        xValues.push(ratio);
        yValues.push(t.profit_percent || 0);
      });

      // 计算相关系数
      const n = xValues.length;
      const sumX = xValues.reduce((a, b) => a + b, 0);
      const sumY = yValues.reduce((a, b) => a + b, 0);
      const sumXY = xValues.reduce((sum, x, i) => sum + x * yValues[i], 0);
      const sumX2 = xValues.reduce((sum, x) => sum + x * x, 0);
      const sumY2 = yValues.reduce((sum, y) => sum + y * y, 0);

      const numerator = n * sumXY - sumX * sumY;
      const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

      const correlation = denominator > 0 ? numerator / denominator : 0;

      correlations[cat] = {
        count: n,
        correlation: correlation.toFixed(3)
      };
    });

    // 分组对比分析
    const groupComparison = {
      smartMoneyHigh: [],
      smartMoneyZero: [],
      botHigh: [],
      botLow: [],
      retailHigh: [],
      retailLow: []
    };

    tokenAnalysis.forEach(t => {
      if (t.profit_percent === null || t.participant_count === 0) return;

      const counts = t.category_counts || {};
      const smartRatio = (counts['💎 聪明钱老鸟'] || 0) / t.participant_count;
      const botRatio = (counts['🤖 疑似机器人'] || 0) / t.participant_count;
      const retailRatio = ((counts['🐟 散户'] || 0) + (counts['🐟 普通玩家'] || 0)) / t.participant_count;

      if (smartRatio > 0.02) groupComparison.smartMoneyHigh.push(t.profit_percent);
      if (smartRatio === 0) groupComparison.smartMoneyZero.push(t.profit_percent);
      if (botRatio > 0.02) groupComparison.botHigh.push(t.profit_percent);
      if (botRatio === 0) groupComparison.botLow.push(t.profit_percent);
      if (retailRatio > 0.3) groupComparison.retailHigh.push(t.profit_percent);
      if (retailRatio <= 0.3) groupComparison.retailLow.push(t.profit_percent);
    });

    // 计算分组平均值
    const avg = arr => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    // 保存分析结果
    const analysisResults = {
      experiment_id: EXPERIMENT_ID,
      analysis_date: new Date().toISOString(),

      // 信号统计
      signals: {
        total: validSignals.length,
        analyzed: tokenAnalysis.length
      },

      // 钱包统计
      wallets: {
        total_unique: walletList.length,
        successfully_queried: walletData.length
      },

      // 相关性分析
      correlations,

      // 分组对比
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
        }
      },

      // 详细数据
      token_analysis: tokenAnalysis
    };

    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'analysis_results.json'),
      JSON.stringify(analysisResults, null, 2)
    );

    // 打印结果
    console.log('\n' + '='.repeat(80));
    console.log('[分析结果]');
    console.log('='.repeat(80));

    console.log('\n[相关性分析]');
    console.log('类别'.padEnd(22) + '相关系数'.padEnd(10) + '样本数');
    console.log('-'.repeat(50));
    Object.entries(correlations).forEach(([cat, data]) => {
      if (data.count > 0) {
        const direction = parseFloat(data.correlation) > 0 ? '+' : '';
        console.log(`${cat.padEnd(22)} ${direction}${data.correlation.padEnd(10)} ${data.count}个`);
      }
    });

    console.log('\n[分组对比]');
    console.log('聪明钱对比:');
    console.log(`  >2%: ${groupComparison.smartMoneyHigh.length}个, 平均涨跌: ${avg(groupComparison.smartMoneyHigh).toFixed(1)}%`);
    console.log(`  =0%: ${groupComparison.smartMoneyZero.length}个, 平均涨跌: ${avg(groupComparison.smartMoneyZero).toFixed(1)}%`);

    console.log('\n机器人对比:');
    console.log(`  >2%: ${groupComparison.botHigh.length}个, 平均涨跌: ${avg(groupComparison.botHigh).toFixed(1)}%`);
    console.log(`  =0%: ${groupComparison.botLow.length}个, 平均涨跌: ${avg(groupComparison.botLow).toFixed(1)}%`);

    console.log('\n[代币示例]');
    const sortedTokens = tokenAnalysis
      .filter(t => t.profit_percent !== null)
      .sort((a, b) => b.profit_percent - a.profit_percent);

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

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    console.log(`\n✅ 分析完成! 用时: ${elapsed}秒`);
    console.log(`\n数据保存在: ${OUTPUT_DIR}/`);

  } catch (error) {
    console.error('\n❌ 分析失败:', error.message);
    console.error(error.stack);
  }
}

main().catch(console.error);
