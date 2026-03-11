/**
 * 基于人工标注质量的分析 v3
 * 1. 更细致的分类系统
 * 2. 使用钱包余额作为权重
 */

require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });
const fs = require('fs');
const path = require('path');
const http = require('http');

const DATA_DIR = '/Users/nobody1/Desktop/Codes/richer-js/scripts/experiment_505ac306_analysis';
const EXPERIMENT_ID = '505ac306-97fc-43d6-b027-00b909469b81';
const SOURCE_EXPERIMENT_ID = '6b17ff18-002d-4ce0-a745-b8e02676abd4';

// 加载数据
const tokenEarlyParticipants = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'data/token_early_participants_all.json'), 'utf8'));
const walletDataComplete = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'data/wallet_data_complete.json'), 'utf8'));

// 构建钱包地址->余额映射
const walletBalanceMap = {};
walletDataComplete.forEach(w => {
  walletBalanceMap[w.address.toLowerCase()] = w.total_balance || 0;
});

console.log('钱包数据已加载，总钱包数:', Object.keys(walletBalanceMap).length);

// HTTP请求工具
function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ success: false, error: e.message });
        }
      });
    }).on('error', reject);
  });
}

// 获取代币收益和标注数据
async function getTokenReturnsAndLabels() {
  console.log('[获取交易数据...]');
  const tradesRes = await get(`http://localhost:3010/api/experiment/${EXPERIMENT_ID}/trades?limit=10000`);
  if (!tradesRes.success) {
    throw new Error('获取交易数据失败');
  }

  const trades = tradesRes.trades || [];
  console.log(`  ✓ 获取到 ${trades.length} 条交易记录`);

  const tokenAddresses = [...new Set(trades.map(t => t.token_address))];
  console.log(`  ✓ 共 ${tokenAddresses.length} 个代币`);

  // 获取标注数据
  console.log('[获取标注数据...]');
  const tokensRes = await get(`http://localhost:3010/api/experiment/${SOURCE_EXPERIMENT_ID}/tokens?limit=10000`);
  const labelsMap = new Map();
  if (tokensRes.success && tokensRes.tokens) {
    tokensRes.tokens.forEach(token => {
      if (token.human_judges && token.human_judges.category) {
        labelsMap.set(token.token_address.toLowerCase(), token.human_judges);
      }
    });
  }
  console.log(`  ✓ 获取到 ${labelsMap.size} 条标注数据`);

  // 计算每个代币的收益
  const tokenResults = tokenAddresses.map(tokenAddress => {
    const tokenTrades = trades
      .filter(t => t.token_address === tokenAddress && (t.status === 'success' || t.trade_status === 'success'))
      .sort((a, b) => new Date(a.created_at || a.executed_at) - new Date(b.created_at || b.executed_at));

    if (tokenTrades.length === 0) return null;

    // FIFO计算
    const buyQueue = [];
    let totalRealizedPnL = 0;
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
        totalRealizedPnL += (outputAmount - costOfSold);
      }
    });

    const totalCost = totalBNBSpent || 1;
    const returnRate = ((totalBNBReceived + (buyQueue.reduce((s, b) => s + b.cost, 0)) - totalCost) / totalCost) * 100;

    return {
      token_address: tokenAddress,
      token_symbol: tokenTrades[0]?.token_symbol || 'Unknown',
      return_rate: returnRate,
      label: labelsMap.get(tokenAddress.toLowerCase()) || null
    };
  }).filter(t => t !== null);

  return tokenResults;
}

// 更细致的分类系统 - 十分类
function percentiles(arr, ps) {
  const sorted = [...arr].sort((a, b) => a - b);
  const result = {};
  ps.forEach(p => {
    const idx = Math.floor((p / 100) * (sorted.length - 1));
    result[p] = sorted[idx];
  });
  return result;
}

const balanceValues = walletDataComplete.map(w => w.total_balance || 0).filter(v => v > 0);
const tradeValues = walletDataComplete.map(w => w.total_trades || 0).filter(v => v > 0);
const ageValues = walletDataComplete.map(w => w.wallet_age_days || 0).filter(v => v > 0);

const balanceP = percentiles(balanceValues, [0, 10, 25, 40, 50, 60, 75, 90, 95, 100]);
const tradeP = percentiles(tradeValues, [0, 20, 40, 60, 75, 80, 90, 95, 100]);
const ageP = percentiles(ageValues, [0, 20, 40, 60, 80, 100]);

// 更细致的分类系统
const detailedScheme = {
  version: "5.0",
  name: "细致十分类",
  description: "基于余额、交易、年龄的十分类系统",
  categories: [
    // 顶层巨鲸（余额Top 5%）
    {
      name: "🏆 顶层巨鲸",
      priority: 1,
      rules: [{ dimension: "balance", min: balanceP[95] }],
      description: `余额 > ${balanceP[95].toFixed(0)} BNB (Top 5%)`
    },
    // 大户（余额Top 5-10%）
    {
      name: "💰 大户",
      priority: 2,
      rules: [{ dimension: "balance", min: balanceP[90], max: balanceP[95] }],
      description: `余额 ${balanceP[90].toFixed(0)}-${balanceP[95].toFixed(0)} BNB (5-10%)`
    },
    // 中大户（余额Top 10-25%）
    {
      name: "💼 中大户",
      priority: 3,
      rules: [{ dimension: "balance", min: balanceP[75], max: balanceP[90] }],
      description: `余额 ${balanceP[75].toFixed(0)}-${balanceP[90].toFixed(0)} BNB (10-25%)`
    },
    // 高频交易者（交易Top 20%，余额不限）
    {
      name: "⚡ 高频交易者",
      priority: 4,
      rules: [{ dimension: "trades", min: tradeP[80] }],
      description: `交易数 > ${tradeP[80]} (Top 20%)`
    },
    // 新晋活跃玩家（年龄Bottom 20% + 交易Top 25%）
    {
      name: "🌟 新晋活跃",
      priority: 5,
      rules: [
        { dimension: "age", max: ageP[20] },
        { dimension: "trades", min: tradeP[75] }
      ],
      description: `新钱包(<${ageP[20]}天) + 高交易(>${tradeP[75]})`
    },
    // 老玩家（年龄Top 20%）
    {
      name: "👴 老玩家",
      priority: 6,
      rules: [{ dimension: "age", min: ageP[80] }],
      description: `老钱包(>${ageP[80]}天)`
    },
    // 中产玩家（余额Top 25-50%）
    {
      name: "👔 中产玩家",
      priority: 7,
      rules: [{ dimension: "balance", min: balanceP[50], max: balanceP[75] }],
      description: `余额 ${balanceP[50].toFixed(0)}-${balanceP[75].toFixed(0)} BNB (25-50%)`
    },
    // 小户活跃（余额Bottom 25-50% + 交易活跃）
    {
      name: "🐟 小户活跃",
      priority: 8,
      rules: [
        { dimension: "balance", min: balanceP[25], max: balanceP[50] },
        { dimension: "trades", min: tradeP[40] }
      ],
      description: `小余额+中交易`
    },
    // 小户（余额Bottom 25-50%）
    {
      name: "🐠 小户",
      priority: 9,
      rules: [{ dimension: "balance", min: balanceP[25], max: balanceP[50] }],
      description: `余额 ${balanceP[25].toFixed(0)}-${balanceP[50].toFixed(0)} BNB (25-50%)`
    },
    // 散户（余额Bottom 25%）
    {
      name: "🐟 散户",
      priority: 10,
      rules: [{ dimension: "balance", max: balanceP[25] }],
      description: `余额 < ${balanceP[25].toFixed(0)} BNB (Bottom 25%)`
    }
  ]
};

function classifyWallet(wallet, scheme) {
  const balance = wallet.total_balance || 0;
  const trades = wallet.total_trades || 0;
  const age = wallet.wallet_age_days || 0;

  const sortedCategories = [...scheme.categories].sort((a, b) => a.priority - b.priority);

  for (const category of sortedCategories) {
    const match = category.rules.every(rule => {
      if (rule.dimension === 'balance') {
        if (rule.min !== undefined && rule.max !== undefined)
          return balance >= rule.min && balance < rule.max;
        else if (rule.max !== undefined) return balance < rule.max;
        else return balance >= rule.min;
      }
      if (rule.dimension === 'trades') {
        if (rule.min !== undefined && rule.max !== undefined)
          return trades >= rule.min && trades < rule.max;
        else if (rule.max !== undefined) return trades < rule.max;
        else return trades >= rule.min;
      }
      if (rule.dimension === 'age') {
        if (rule.min !== undefined && rule.max !== undefined)
          return age >= rule.min && age < rule.max;
        else if (rule.max !== undefined) return age < rule.max;
        else return age >= rule.min;
      }
      return false;
    });

    if (match) return category.name;
  }

  return '🐟 散户';
}

// 点二列相关系数
function pointBiserialCorrelation(binaryValues, continuousValues) {
  const n = binaryValues.length;
  if (n < 3) return null;

  const group1 = [];
  const group0 = [];

  binaryValues.forEach((b, i) => {
    if (b === 1) group1.push(continuousValues[i]);
    else group0.push(continuousValues[i]);
  });

  if (group1.length === 0 || group0.length === 0) return null;

  const n1 = group1.length;
  const n0 = group0.length;

  const mean1 = group1.reduce((a, b) => a + b, 0) / n1;
  const mean0 = group0.reduce((a, b) => a + b, 0) / n0;

  const allValues = continuousValues;
  const mean = allValues.reduce((a, b) => a + b, 0) / n;
  const variance = allValues.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return null;

  const r = ((mean1 - mean0) / stdDev) * Math.sqrt((n1 * n0) / (n * n));
  return r;
}

// Spearman等级相关系数
function spearmanCorrelation(x, y) {
  const n = x.length;
  if (n < 3) return null;

  const rank = (arr) => {
    const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(n);
    sorted.forEach((item, r) => ranks[item.i] = r);
    return ranks;
  };

  const rankX = rank(x);
  const rankY = rank(y);

  let sumD2 = 0;
  for (let i = 0; i < n; i++) {
    const d = rankX[i] - rankY[i];
    sumD2 += d * d;
  }

  return 1 - (6 * sumD2) / (n * (n * n - 1));
}

// 主分析
async function main() {
  console.log('='.repeat(80));
  console.log('基于人工标注质量的分析 v3（细致分类 + 余额权重）');
  console.log('='.repeat(80));

  // 构建钱包分类映射
  const walletClassMap = {};
  walletDataComplete.forEach(wallet => {
    walletClassMap[wallet.address.toLowerCase()] = classifyWallet(wallet, detailedScheme);
  });

  // 统计分类分布
  const classStats = {};
  Object.values(walletClassMap).forEach(cat => {
    classStats[cat] = (classStats[cat] || 0) + 1;
  });

  console.log('\n钱包分类统计:');
  console.log('-'.repeat(60));
  Object.entries(classStats).sort((a, b) => b[1] - a[1]).forEach(([name, count]) => {
    console.log(`  ${name}: ${count} 个 (${(count/walletDataComplete.length*100).toFixed(1)}%)`);
  });

  // 获取代币收益和标注
  const tokenResults = await getTokenReturnsAndLabels();

  // 统计标注情况
  const labeled = tokenResults.filter(t => t.label !== null);
  const unlabeled = tokenResults.filter(t => t.label === null);

  console.log('\n标注统计:');
  console.log(`  总代币数: ${tokenResults.length}`);
  console.log(`  已标注: ${labeled.length}`);
  console.log(`  未标注: ${unlabeled.length}`);

  if (labeled.length === 0) {
    console.log('\n❌ 没有已标注的代币，无法分析');
    return;
  }

  // 按质量分类统计
  const qualityGroups = { high_quality: [], mid_quality: [], low_quality: [] };
  labeled.forEach(t => {
    if (qualityGroups[t.label.category]) {
      qualityGroups[t.label.category].push(t);
    }
  });

  console.log('\n质量分布:');
  console.log(`  高质量: ${qualityGroups.high_quality.length} 个`);
  console.log(`  中质量: ${qualityGroups.mid_quality.length} 个`);
  console.log(`  低质量: ${qualityGroups.low_quality.length} 个`);

  // 分析每个代币的早期参与者构成（加权）
  const analysisResults = [];
  const categoryData = {};
  detailedScheme.categories.forEach(cat => {
    categoryData[cat.name] = { weightedRatios: [], qualityValues: [], binaryQuality: [], returnRates: [] };
  });

  labeled.forEach(token => {
    const tokenAddr = token.token_address.toLowerCase();
    const participants = tokenEarlyParticipants[tokenAddr]?.participants || [];

    if (participants.length === 0) return;

    // 统计各分类加权占比
    const categoryWeightedSum = {};
    let totalWeight = 0;

    participants.forEach(addr => {
      const cat = walletClassMap[addr.toLowerCase()] || '未知';
      const weight = walletBalanceMap[addr.toLowerCase()] || 0;
      categoryWeightedSum[cat] = (categoryWeightedSum[cat] || 0) + weight;
      totalWeight += weight;
    });

    const categoryRatios = {};
    Object.keys(categoryWeightedSum).forEach(cat => {
      categoryRatios[cat] = categoryWeightedSum[cat] / totalWeight;
    });

    const quality = token.label.category;
    const qualityValue = { high_quality: 2, mid_quality: 1, low_quality: 0 }[quality];
    const binaryQuality = (quality === 'high_quality' || quality === 'mid_quality') ? 1 : 0;

    // 记录数据
    Object.keys(categoryRatios).forEach(cat => {
      if (categoryData[cat]) {
        categoryData[cat].weightedRatios.push(categoryRatios[cat]);
        categoryData[cat].qualityValues.push(qualityValue);
        categoryData[cat].binaryQuality.push(binaryQuality);
        categoryData[cat].returnRates.push(token.return_rate);
      }
    });

    analysisResults.push({
      token_symbol: token.token_symbol,
      token_address: token.token_address,
      quality: quality,
      quality_value: qualityValue,
      binary_quality: binaryQuality,
      return_rate: token.return_rate,
      participant_count: participants.length,
      total_weight_usd: totalWeight,
      category_ratios: categoryRatios
    });
  });

  // 计算相关性
  console.log('\n' + '='.repeat(80));
  console.log('钱包分类占比与质量的相关性分析（余额加权）');
  console.log('='.repeat(80));

  const correlations = {};

  Object.keys(categoryData).forEach(cat => {
    const data = categoryData[cat];
    if (data.weightedRatios.length < 3) return;

    const spearman = spearmanCorrelation(data.weightedRatios, data.qualityValues);
    const pointBiserial = pointBiserialCorrelation(data.binaryQuality, data.weightedRatios);

    if (spearman !== null || pointBiserial !== null) {
      correlations[cat] = {
        spearman: spearman,
        point_biserial: pointBiserial,
        token_count: data.weightedRatios.length,
        avg_ratio: data.weightedRatios.reduce((a, b) => a + b, 0) / data.weightedRatios.length
      };

      console.log(`\n${cat}:`);
      console.log(`  样本数: ${data.weightedRatios.length}`);
      console.log(`  平均加权占比: ${(correlations[cat].avg_ratio * 100).toFixed(1)}%`);
      if (spearman !== null) {
        const direction = spearman > 0 ? '正相关' : '负相关';
        console.log(`  三分类相关性: ${spearman.toFixed(3)} (${direction})`);
      }
      if (pointBiserial !== null) {
        const direction = pointBiserial > 0 ? '正相关' : '负相关';
        const strength = Math.abs(pointBiserial) > 0.5 ? '强' : Math.abs(pointBiserial) > 0.3 ? '中' : '弱';
        console.log(`  二分类相关性: ${pointBiserial.toFixed(3)} (${strength}${direction})`);
        console.log(`    → 能否区分低质量: ${pointBiserial > 0.3 ? '✅ 是' : pointBiserial < -0.3 ? '✅ 反向有效' : '❌ 效果不明显'}`);
      }
    }
  });

  // 找出最相关的分类
  console.log('\n' + '='.repeat(80));
  console.log('关键发现');
  console.log('='.repeat(80));

  const sortedByCorrelation = Object.entries(correlations)
    .filter(([_, d]) => d.point_biserial !== null)
    .sort((a, b) => Math.abs(b[1].point_biseral) - Math.abs(a[1].point_biseral));

  if (sortedByCorrelation.length > 0) {
    console.log('\n按二分类相关性排序（区分低质量 vs 高中质量）:');
    sortedByCorrelation.slice(0, 5).forEach(([cat, data]) => {
      const direction = data.point_biserial > 0 ? '正相关' : '负相关';
      const strength = Math.abs(data.point_biserial) > 0.5 ? '强' : Math.abs(data.point_biserial) > 0.3 ? '中' : '弱';
      console.log(`  ${cat}: ${strength}${direction} (r=${data.point_biserial.toFixed(3)}, 平均占比${(data.avg_ratio*100).toFixed(1)}%)`);
    });
  }

  // 保存结果
  const result = {
    scheme: detailedScheme,
    wallet_stats: classStats,
    token_count: tokenResults.length,
    labeled_count: labeled.length,
    quality_distribution: {
      high: qualityGroups.high_quality.length,
      mid: qualityGroups.mid_quality.length,
      low: qualityGroups.low_quality.length
    },
    correlations: correlations,
    analysis: analysisResults
  };

  fs.writeFileSync(
    path.join(DATA_DIR, 'data/quality_weighted_analysis_results.json'),
    JSON.stringify(result, null, 2)
  );

  console.log(`\n✅ 分析完成! 结果已保存到 data/quality_weighted_analysis_results.json`);
}

main().catch(console.error);
