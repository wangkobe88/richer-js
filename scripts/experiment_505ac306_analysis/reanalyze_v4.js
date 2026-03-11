/**
 * 使用方案2分类系统重新分析
 */

require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });
const fs = require('fs');
const path = require('path');
const http = require('http');

const DATA_DIR = '/Users/nobody1/Desktop/Codes/richer-js/scripts/experiment_505ac306_analysis';
const EXPERIMENT_ID = '505ac306-97fc-43d6-b027-00b909469b81';

// 加载数据
const tokenEarlyParticipants = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'data/token_early_participants_all.json'), 'utf8'));
const walletDataComplete = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'data/wallet_data_complete.json'), 'utf8'));

console.log('='.repeat(80));
console.log('使用方案2分类系统重新分析');
console.log('='.repeat(80));
console.log(`钱包数据: ${walletDataComplete.length} 个钱包`);
console.log(`早期参与者数据: ${Object.keys(tokenEarlyParticipants).length} 个代币`);

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
const ageValues = walletDataComplete.map(w => w.wallet_age_days || 0).filter(v => v > 0);

const balanceP = percentiles(balanceValues, [0, 20, 40, 60, 80, 90, 95, 100]);
const tradeP = percentiles(tradeValues, [0, 20, 40, 60, 80, 90, 95, 100]);
const ageP = percentiles(ageValues, [0, 20, 40, 60, 80, 100]);

console.log('\n方案2分类阈值:');
console.log(`  余额: P20=${balanceP[20].toFixed(0)}, P90=${balanceP[90].toFixed(0)}`);
console.log(`  交易: P60=${tradeP[60]}`);

// 方案2分类系统
const scheme2 = {
  version: "4.2",
  name: "简化四分类",
  description: "巨鲸(10%) + 活跃玩家(20%) + 普通玩家(50%) + 散户(20%)",
  categories: [
    {
      name: "🏆 巨鲸",
      priority: 1,
      rules: [{ dimension: "balance", min: balanceP[90] }],
      description: `余额 > ${balanceP[90].toFixed(0)} BNB (Top 10%)`
    },
    {
      name: "🔥 活跃玩家",
      priority: 2,
      rules: [
        { dimension: "trades", min: tradeP[60] },
        { dimension: "balance", min: balanceP[20] }
      ],
      description: `交易数 > ${tradeP[60]} 且余额 > ${balanceP[20].toFixed(0)} BNB`
    },
    {
      name: "👤 普通玩家",
      priority: 3,
      rules: [
        { dimension: "balance", min: balanceP[20] }
      ],
      description: `余额 > ${balanceP[20].toFixed(0)} BNB，但不是巨鲸或活跃玩家`
    },
    {
      name: "🐟 散户",
      priority: 4,
      rules: [{ dimension: "balance", max: balanceP[20] }],
      description: `余额 < ${balanceP[20].toFixed(0)} BNB (Bottom 20%)`
    }
  ]
};

// 分类函数
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

  console.log('\n[获取交易数据...]');
  const response = await get(`http://localhost:3010/api/experiment/${EXPERIMENT_ID}/trades?limit=10000`);
  const trades = response.data || response.trades || [];

  if (trades.length > 0) {
    tradesCache = trades;
    console.log(`  ✓ 获取到 ${trades.length} 条交易记录`);
    return trades;
  }

  console.log('  ✗ 获取交易数据失败');
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

// 构建钱包分类映射
console.log('\n[构建钱包分类映射...]');
const walletClassMap = {};
walletDataComplete.forEach(wallet => {
  walletClassMap[wallet.address.toLowerCase()] = classifyWallet(wallet, scheme2);
});

// 统计分类
const classStats = {};
Object.values(walletClassMap).forEach(cat => {
  classStats[cat] = (classStats[cat] || 0) + 1;
});

console.log('钱包分类统计:');
Object.entries(classStats).sort((a, b) => b[1] - a[1]).forEach(([name, count]) => {
  console.log(`  ${name}: ${count} (${(count/walletDataComplete.length*100).toFixed(1)}%)`);
});

// 分析每个代币的早期参与者构成
async function main() {
  const analysisResults = [];
  const categoryData = {};

  Object.keys(scheme2.categories).forEach(cat => {
    categoryData[cat] = {
      tokens: [],
      returns: [],
      ratios: []
    };
  });

  let processedCount = 0;
  for (const tokenAddr in tokenEarlyParticipants) {
    const tokenInfo = tokenEarlyParticipants[tokenAddr];
    const participants = tokenInfo.participants || [];

    const totalReturn = await getTokenProfitPercent(tokenAddr);
    if (totalReturn === null) continue;

    processedCount++;
    if ((processedCount % 10) === 0) {
      process.stdout.write(`\r  进度: ${processedCount}/${Object.keys(tokenEarlyParticipants).length}`);
    }

    const participantsWithClass = participants.map(addr => {
      const cat = walletClassMap[addr.toLowerCase()] || '未知';
      return { address: addr, category: cat };
    });

    // 统计各分类占比
    const categoryCounts = {};
    participantsWithClass.forEach(p => {
      categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
    });

    const total = participantsWithClass.length;
    const categoryRatios = {};
    Object.keys(categoryCounts).forEach(cat => {
      categoryRatios[cat] = categoryCounts[cat] / total;
    });

    // 记录到分类数据
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

  console.log(`\r  完成: ${processedCount} 个代币有收益数据`);

  // 计算相关性
  console.log('\n' + '='.repeat(80));
  console.log('方案2分类与收益相关性分析');
  console.log('='.repeat(80));

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
      avg_return: sumY / n,
      p_value: r > 0 ? Math.exp(-2) : null // 简化处理
    };

    const significance = Math.abs(r) > 0.3 ? (r > 0 ? '+++' : Math.abs(r) > 0.2 ? '+' : '-') : '';
    console.log(`${cat}: r=${r.toFixed(3)} ${significance} (n=${n}, 平均占比${(sumX/n*100).toFixed(1)}%)`);
  });

  // 对比v3结果
  console.log('\n' + '='.repeat(80));
  console.log('方案2 vs v3 对比');
  console.log('='.repeat(80));

  const v3Results = {
    '🌟 新星玩家': 0.356,
    '💰 大户': 0.227,
    '🐟 散户': -0.074,
    '🐟 普通玩家': -0.061,
    '💎 聪明钱': -0.045
  };

  console.log('\n分类'.padEnd(20) + 'v2相关性'.padEnd(12) + 'v3相关性');
  console.log('-'.repeat(50));

  Object.keys(correlations).forEach(cat => {
    const v2r = correlations[cat].correlation.toFixed(3);
    const v3r = v3Results[cat] !== undefined ? v3Results[cat].toFixed(3) : 'N/A';
    const change = v3Results[cat] !== undefined ? (correlations[cat].correlation - v3Results[cat]).toFixed(3) : '';
    const changeStr = change ? ` (${change > 0 ? '+' : ''}${change})` : '';
    console.log(`${cat.padEnd(20)} ${v2r.padEnd(12)} ${v3r.padEnd(10)}${changeStr}`);
  });

  // 找出最相关的分类
  console.log('\n关键发现 (方案2):');
  const sortedByCorrelation = Object.entries(correlations)
    .sort((a, b) => Math.abs(b[1].correlation) - Math.abs(a[1].correlation));

  sortedByCorrelation.slice(0, 4).forEach(([cat, data]) => {
    const direction = data.correlation > 0 ? '正相关' : '负相关';
    const strength = Math.abs(data.correlation) > 0.3 ? '强' : Math.abs(data.correlation) > 0.1 ? '中' : '弱';
    console.log(`  ${cat}: ${strength}${direction} (r=${data.correlation.toFixed(3)}, 平均占比${(data.avg_ratio*100).toFixed(1)}%)`);
  });

  // 保存结果
  const result = {
    scheme: scheme2,
    wallet_stats: classStats,
    correlations: correlations,
    v3_comparison: v3Results,
    analysis: analysisResults
  };

  fs.writeFileSync(
    path.join(DATA_DIR, 'data/v2_analysis_results.json'),
    JSON.stringify(result, null, 2)
  );

  console.log(`\n✅ 分析完成! 结果已保存到 data/v2_analysis_results.json`);
}

main().catch(console.error);
