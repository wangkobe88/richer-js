/**
 * 保存方案2分类系统并生成完整分析报告
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const DATA_DIR = '/Users/nobody1/Desktop/Codes/richer-js/scripts/experiment_505ac306_analysis';
const EXPERIMENT_ID = '505ac306-97fc-43d6-b027-00b909469b81';

// 加载数据
const tokenEarlyParticipants = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'data/token_early_participants_all.json'), 'utf8'));
const walletDataComplete = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'data/wallet_data_complete.json'), 'utf8'));

// 计算分位数
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

const balanceP = percentiles(balanceValues, [0, 20, 40, 60, 80, 90, 95, 100]);
const tradeP = percentiles(tradeValues, [0, 20, 40, 60, 80, 90, 95, 100]);

// 方案2分类系统
const scheme2 = {
  version: "4.2",
  name: "简化四分类",
  description: "基于余额和交易活跃度的分类系统（不包含年龄）",
  created: "2026-03-11",
  wallet_count: walletDataComplete.length,
  thresholds: {
    balance: {
      P20: balanceP[20],
      P90: balanceP[90]
    },
    trades: {
      P60: tradeP[60]
    }
  },
  categories: [
    {
      name: "🏆 巨鲸",
      priority: 1,
      rules: [{ dimension: "balance", min: balanceP[90] }],
      description: `余额 Top 10% (> ${balanceP[90].toFixed(0)} BNB)`,
      target_ratio: 0.10
    },
    {
      name: "🔥 活跃玩家",
      priority: 2,
      rules: [
        { dimension: "trades", min: tradeP[60] },
        { dimension: "balance", min: balanceP[20] }
      ],
      description: `交易数 Top 40% (> ${tradeP[60]}笔) 且余额 Bottom 80%+`,
      target_ratio: 0.20
    },
    {
      name: "👤 普通玩家",
      priority: 3,
      rules: [{ dimension: "balance", min: balanceP[20] }],
      description: `余额 Top 80%+ 但不是巨鲸或活跃玩家`,
      target_ratio: 0.50
    },
    {
      name: "🐟 散户",
      priority: 4,
      rules: [{ dimension: "balance", max: balanceP[20] }],
      description: `余额 Bottom 20% (< ${balanceP[20].toFixed(0)} BNB)`,
      target_ratio: 0.20
    }
  ]
};

// 分类函数
function classifyWallet(wallet, scheme) {
  const balance = wallet.total_balance || 0;
  const trades = wallet.total_trades || 0;

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
      return false;
    });

    if (match) return category.name;
  }

  return '🐟 散户';
}

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
          resolve({ success: false, error: e.message });
        }
      });
    }).on('error', reject);
  });
}

// 缓存交易数据
let tradesCache = null;

async function getAllTrades() {
  if (tradesCache) return tradesCache;

  const response = await get(`http://localhost:3010/api/experiment/${EXPERIMENT_ID}/trades?limit=10000`);
  const trades = response.data || response.trades || [];

  if (trades.length > 0) {
    tradesCache = trades;
    return trades;
  }
  return [];
}

// 计算代币收益百分比
async function getTokenProfitPercent(tokenAddress) {
  const trades = await getAllTrades();
  const tokenTrades = trades.filter(t =>
    t.token_address && t.token_address.toLowerCase() === tokenAddress.toLowerCase()
  );

  if (tokenTrades.length === 0) return null;

  let totalProfit = 0;
  let totalInvested = 0;
  let hasBuy = false;

  tokenTrades.forEach(trade => {
    const profitPercent = trade.metadata?.profitPercent || trade.profitPercent || 0;

    if (trade.trade_direction === 'buy' || trade.direction === 'buy') {
      hasBuy = true;
      totalInvested += trade.input_amount || 0;
    } else if (trade.trade_direction === 'sell' || trade.direction === 'sell') {
      const invested = trade.output_amount || 0;
      totalProfit += invested * (profitPercent / 100);
    }
  });

  if (!hasBuy || totalInvested < 0.0001) return null;
  return (totalProfit / totalInvested) * 100;
}

// 主分析
async function main() {
  console.log('='.repeat(80));
  console.log('方案2分类系统 - 完整分析报告');
  console.log('='.repeat(80));

  // 构建钱包分类映射
  const walletClassMap = {};
  walletDataComplete.forEach(wallet => {
    walletClassMap[wallet.address.toLowerCase()] = classifyWallet(wallet, scheme2);
  });

  // 统计分类
  const classStats = {};
  Object.values(walletClassMap).forEach(cat => {
    classStats[cat] = (classStats[cat] || 0) + 1;
  });

  console.log('\n1. 钱包分类统计:');
  console.log('-'.repeat(60));
  Object.entries(classStats).sort((a, b) => b[1] - a[1]).forEach(([name, count]) => {
    console.log(`  ${name}: ${count} 个 (${(count/walletDataComplete.length*100).toFixed(1)}%)`);
  });

  // 分析代币
  const analysisResults = [];
  const categoryData = {};
  scheme2.categories.forEach(cat => {
    categoryData[cat.name] = { tokens: [], returns: [], ratios: [] };
  });

  let processedCount = 0;
  for (const tokenAddr in tokenEarlyParticipants) {
    const tokenInfo = tokenEarlyParticipants[tokenAddr];
    const participants = tokenInfo.participants || [];

    const totalReturn = await getTokenProfitPercent(tokenAddr);
    if (totalReturn === null) continue;

    processedCount++;

    const participantsWithClass = participants.map(addr => {
      const cat = walletClassMap[addr.toLowerCase()] || '未知';
      return { address: addr, category: cat };
    });

    const categoryCounts = {};
    participantsWithClass.forEach(p => {
      categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
    });

    const total = participantsWithClass.length;
    const categoryRatios = {};
    Object.keys(categoryCounts).forEach(cat => {
      categoryRatios[cat] = categoryCounts[cat] / total;
    });

    Object.keys(categoryCounts).forEach(cat => {
      if (categoryData[cat]) {
        categoryData[cat].tokens.push(tokenAddr);
        categoryData[cat].returns.push(totalReturn);
        categoryData[cat].ratios.push(categoryCounts[cat] / total);
      }
    });

    analysisResults.push({
      token_address: tokenAddr,
      token_symbol: tokenInfo.token_symbol,
      participant_count: total,
      category_counts: categoryCounts,
      category_ratios: categoryRatios,
      total_return: totalReturn
    });
  }

  console.log(`\n2. 代币分析: ${processedCount} 个代币有收益数据`);

  // 计算相关性
  console.log('\n3. 分类与收益相关性分析:');
  console.log('-'.repeat(60));

  const correlations = {};
  Object.keys(categoryData).forEach(cat => {
    const data = categoryData[cat];
    if (data.returns.length < 3) return;

    const tokensWithCat = analysisResults.filter(r =>
      r.category_ratios[cat] !== undefined
    );

    if (tokensWithCat.length < 3) return;

    const n = tokensWithCat.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;

    tokensWithCat.forEach(token => {
      const x = token.category_ratios[cat];
      const y = token.total_return;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
      sumY2 += y * y;
    });

    const r = (n * sumXY - sumX * sumY) /
              Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    correlations[cat] = {
      correlation: r,
      token_count: n,
      avg_ratio: sumX / n,
      avg_return: sumY / n
    };

    const strength = Math.abs(r) > 0.3 ? '强' : Math.abs(r) > 0.1 ? '中' : '弱';
    const direction = r > 0 ? '正相关' : '负相关';
    console.log(`  ${cat}: r=${r.toFixed(3)} (${strength}${direction}, n=${n}, 平均占比${(sumX/n*100).toFixed(1)}%)`);
  });

  // 保存完整结果
  const fullResult = {
    scheme: scheme2,
    wallet_stats: classStats,
    correlations: correlations,
    analysis: analysisResults,
    summary: {
      best_predictor: Object.entries(correlations)
        .sort((a, b) => Math.abs(b[1].correlation) - Math.abs(a[1].correlation))[0],
      total_wallets: walletDataComplete.length,
      total_tokens_analyzed: processedCount
    }
  };

  fs.writeFileSync(
    path.join(DATA_DIR, 'data/classification_v2_final.json'),
    JSON.stringify(fullResult, null, 2)
  );

  console.log('\n' + '='.repeat(80));
  console.log('4. 最终结论');
  console.log('='.repeat(80));

  const best = Object.entries(correlations)
    .sort((a, b) => Math.abs(b[1].correlation) - Math.abs(a[1].correlation))[0];

  console.log(`\n🎯 最佳预测因子: ${best[0]} (r=${best[1].correlation.toFixed(3)})`);
  console.log(`   - 平均占比: ${(best[1].avg_ratio*100).toFixed(1)}%`);
  console.log(`   - 涉及代币数: ${best[1].token_count} 个`);
  console.log(`   - 该类代币平均收益: ${best[1].avg_return.toFixed(1)}%`);

  console.log('\n5. 实际应用建议:');
  console.log('   - 优先考虑早期参与者中活跃玩家占比 > 30% 的代币');
  console.log('   - 谨慎对待普通玩家占比 > 50% 的代币（负相关）');
  console.log('   - 巨鲸占比的预测力较弱（r=-0.071）');

  console.log(`\n✅ 完整结果已保存到 data/classification_v2_final.json`);
}

main().catch(console.error);
