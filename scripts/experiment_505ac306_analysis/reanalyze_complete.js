/**
 * 基于完整钱包数据的重新分析
 * 3024个钱包数据
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
const classificationSystem = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'data/classification_system_v3.json'), 'utf8'));

console.log('='.repeat(80));
console.log('基于完整钱包数据重新分析');
console.log('='.repeat(80));
console.log(`钱包数据: ${walletDataComplete.length} 个钱包`);
console.log(`早期参与者数据: ${Object.keys(tokenEarlyParticipants).length} 个代币`);

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

  // API 返回 {success: true, data: [...]} 或 {success: true, trades: [...]}
  const trades = response.data || response.trades || [];

  if (trades.length > 0) {
    tradesCache = trades;
    console.log(`  ✓ 获取到 ${trades.length} 条交易记录`);
    return trades;
  }

  console.log('  ✗ 获取交易数据失败');
  return [];
}

// 计算代币收益百分比（基于profitPercent字段）
async function getTokenProfitPercent(tokenAddress) {
  const trades = await getAllTrades();
  const tokenTrades = trades.filter(t =>
    t.token_address && t.token_address.toLowerCase() === tokenAddress.toLowerCase()
  );

  if (tokenTrades.length === 0) return null;

  // 计算总收益
  let totalProfit = 0;
  let totalInvested = 0;
  let hasBuy = false;

  tokenTrades.forEach(trade => {
    const profitPercent = trade.metadata?.profitPercent || trade.profitPercent || 0;

    if (trade.trade_direction === 'buy' || trade.direction === 'buy') {
      hasBuy = true;
      totalInvested += trade.input_amount || 0;
    } else if (trade.trade_direction === 'sell' || trade.direction === 'sell') {
      // 使用 profit_percent 计算
      const invested = trade.output_amount || 0; // 卖出时获得bnb是成本
      totalProfit += invested * (profitPercent / 100);
    }
  });

  if (!hasBuy || totalInvested < 0.0001) return null;
  return (totalProfit / totalInvested) * 100;
}

// 构建钱包分类映射
const walletClassMap = {};
walletDataComplete.forEach(wallet => {
  walletClassMap[wallet.address.toLowerCase()] = classifyWallet(wallet, classificationSystem);
});

// 分类函数
function classifyWallet(wallet, system) {
  const balance = wallet.total_balance || 0;
  const trades = wallet.total_trades || 0;
  const age = wallet.wallet_age_days || 0;
  const profitRatio = wallet.total_tokens > 0 ? (wallet.profitable_tokens || 0) / wallet.total_tokens : 0;

  const sortedCombos = [...system.combo_categories].sort((a, b) => a.priority - b.priority);

  for (const combo of sortedCombos) {
    if (combo.rules.length === 0) continue;

    const match = combo.rules.every(rule => {
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
      if (rule.dimension === 'profit') {
        if (rule.min !== undefined && rule.max !== undefined)
          return profitRatio >= rule.min && profitRatio < rule.max;
        else if (rule.max !== undefined) return profitRatio < rule.max;
        else return profitRatio >= rule.min;
      }
      return false;
    });

    if (match) return combo.name;
  }

  return '🐟 普通玩家';
}

// 分析每个代币的早期参与者构成
async function main() {
  // 分析结果
  const analysisResults = [];
  const categoryData = {};

  // 初始化分类数据
  Object.values(classificationSystem.combo_categories).forEach(cat => {
    categoryData[cat.name] = {
      tokens: [],
      returns: [],
      ratios: []
    };
  });

  let processedCount = 0;
  for (const tokenAddr in tokenEarlyParticipants) {
    const tokenInfo = tokenEarlyParticipants[tokenAddr];
    const participants = tokenInfo.participants || [];

    // 计算收益
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
  console.log('\n分类与收益相关性分析:');
  console.log('-'.repeat(80));

  const correlations = {};

  Object.keys(categoryData).forEach(cat => {
    const data = categoryData[cat];
    if (data.returns.length < 3) return;

    // 计算该分类占比与收益的相关性
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

    const significance = Math.abs(r) > 0.3 ? (r > 0 ? '+' : '-') : '';
    console.log(`${cat}: r=${r.toFixed(3)} ${significance} (n=${n})`);
  });

  // 找出最相关和最不相关的分类
  console.log('\n关键发现:');
  const sortedByCorrelation = Object.entries(correlations)
    .sort((a, b) => Math.abs(b[1].correlation) - Math.abs(a[1].correlation));

  sortedByCorrelation.slice(0, 5).forEach(([cat, data]) => {
    const direction = data.correlation > 0 ? '正相关' : '负相关';
    console.log(`  ${cat}: ${direction} (r=${data.correlation.toFixed(3)}, 平均占比${(data.avg_ratio * 100).toFixed(1)}%)`);
  });

  // 保存结果
  const result = {
    wallet_count: walletDataComplete.length,
    token_count: analysisResults.length,
    correlations: correlations,
    category_analysis: categoryData,
    tokens: analysisResults
  };

  fs.writeFileSync(
    path.join(DATA_DIR, 'data/complete_analysis_results.json'),
    JSON.stringify(result, null, 2)
  );

  console.log(`\n✅ 分析完成! 结果已保存到 data/complete_analysis_results.json`);
}

main().catch(console.error);
