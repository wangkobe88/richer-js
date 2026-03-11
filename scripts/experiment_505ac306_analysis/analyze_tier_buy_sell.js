/**
 * 分析不同类别钱包（大户/中户/小户）的买卖行为
 * 看大户是否在卖出，小户是否在买入
 */

require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });
const fs = require('fs');
const path = require('path');
const http = require('http');

const DATA_DIR = '/Users/nobody1/Desktop/Codes/richer-js/scripts/experiment_505ac306_analysis';
const EXPERIMENT_ID = '505ac306-97fc-43d6-b027-00b909469b81';
const SOURCE_EXPERIMENT_ID = '6b17ff18-002d-4ce0-a745-b8e02676abd4';

// 加载数据
const tokenEarlyInvestments = JSON.parse(fs.readFileSync(
  path.join(DATA_DIR, 'data/token_early_participants_with_investment.json'),
  'utf8'
));
const tokenEarlyTrades = JSON.parse(fs.readFileSync(
  path.join(DATA_DIR, 'data/token_early_trades_with_direction.json'),
  'utf8'
));

console.log('='.repeat(80));
console.log('大小中户买卖行为分析');
console.log('='.repeat(80));

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

// 按投入金额分类钱包
function classifyWalletsByInvestment(walletInvestments, thresholds) {
  const classified = { large: [], medium: [], small: [] };

  Object.entries(walletInvestments).forEach(([addr, amount]) => {
    if (amount >= thresholds.large) {
      classified.large.push(addr);
    } else if (amount >= thresholds.medium) {
      classified.medium.push(addr);
    } else {
      classified.small.push(addr);
    }
  });

  return classified;
}

// 分析每个代币的买卖行为（按钱包类别）
function analyzeTokenTierBuySell(trades, tokenAddress, classifiedWallets) {
  const tokenAddr = tokenAddress.toLowerCase();

  // 构建钱包分类集合
  const largeWallets = new Set(classifiedWallets.large.map(w => w.toLowerCase()));
  const mediumWallets = new Set(classifiedWallets.medium.map(w => w.toLowerCase()));
  const smallWallets = new Set(classifiedWallets.small.map(w => w.toLowerCase()));

  // 每个类别的买卖统计
  const tierStats = {
    large: { buyUSD: 0, sellUSD: 0, buyTx: 0, sellTx: 0, walletTx: {} },
    medium: { buyUSD: 0, sellUSD: 0, buyTx: 0, sellTx: 0, walletTx: {} },
    small: { buyUSD: 0, sellUSD: 0, buyTx: 0, sellTx: 0, walletTx: {} }
  };

  trades.forEach(trade => {
    const wallet = trade.from_address?.toLowerCase();
    if (!wallet) return;

    // 确定钱包类别
    let tier = null;
    if (largeWallets.has(wallet)) tier = 'large';
    else if (mediumWallets.has(wallet)) tier = 'medium';
    else if (smallWallets.has(wallet)) tier = 'small';
    else return; // 不在已分类的钱包中

    const fromToken = trade.from_token?.toLowerCase() || '';
    const toToken = trade.to_token?.toLowerCase() || '';
    const fromUSD = trade.from_usd || 0;

    // 判断买卖方向
    const isSelling = fromToken === tokenAddr;
    const isBuying = toToken === tokenAddr;

    // 统计每笔交易
    if (isBuying && !isSelling) {
      tierStats[tier].buyUSD += fromUSD;
      tierStats[tier].buyTx += 1;
    } else if (isSelling && !isBuying) {
      tierStats[tier].sellUSD += fromUSD;
      tierStats[tier].sellTx += 1;
    }
  });

  // 计算每个类别的指标
  const result = {};

  ['large', 'medium', 'small'].forEach(tier => {
    const stats = tierStats[tier];
    const totalVolume = stats.buyUSD + stats.sellUSD;
    const totalTx = stats.buyTx + stats.sellTx;

    result[`${tier}_buy_usd`] = stats.buyUSD;
    result[`${tier}_sell_usd`] = stats.sellUSD;
    result[`${tier}_net_inflow_usd`] = stats.buyUSD - stats.sellUSD;
    result[`${tier}_sell_ratio`] = totalVolume > 0 ? stats.sellUSD / totalVolume : 0;
    result[`${tier}_net_inflow_ratio`] = totalVolume > 0 ? (stats.buyUSD - stats.sellUSD) / totalVolume : 0;
    result[`${tier}_buy_tx`] = stats.buyTx;
    result[`${tier}_sell_tx`] = stats.sellTx;
    result[`${tier}_total_tx`] = totalTx;
  });

  return result;
}

// 点二列相关系数
function pointBiserialCorrelation(binaryValues, continuousValues) {
  const n = binaryValues.length;
  if (n < 3) return null;

  const group1 = [], group0 = [];
  binaryValues.forEach((b, i) => {
    if (b === 1) group1.push(continuousValues[i]);
    else group0.push(continuousValues[i]);
  });

  if (group1.length === 0 || group0.length === 0) return null;

  const n1 = group1.length, n0 = group0.length;
  const mean1 = group1.reduce((a, b) => a + b, 0) / n1;
  const mean0 = group0.reduce((a, b) => a + b, 0) / n0;

  const allValues = continuousValues;
  const mean = allValues.reduce((a, b) => a + b, 0) / n;
  const variance = allValues.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return null;

  return ((mean1 - mean0) / stdDev) * Math.sqrt((n1 * n0) / (n * n));
}

// 主分析
async function main() {
  // 获取标注数据
  console.log('[获取标注数据...]');
  const tokensRes = await get(`http://localhost:3010/api/experiment/${SOURCE_EXPERIMENT_ID}/tokens?limit=10000`);

  const labelsMap = new Map();
  if (tokensRes.success && tokensRes.data) {
    tokensRes.data.forEach(token => {
      if (token.human_judges && token.human_judges.category) {
        labelsMap.set(token.token_address.toLowerCase(), token.human_judges);
      }
    });
  }
  console.log(`  ✓ ${labelsMap.size} 条标注数据`);

  // 构建投资数据映射
  const investmentMap = {};
  tokenEarlyInvestments.forEach(t => {
    investmentMap[t.token_address.toLowerCase()] = t;
  });

  // 构建交易数据映射
  const tradesMap = {};
  tokenEarlyTrades.forEach(t => {
    tradesMap[t.token_address.toLowerCase()] = t;
  });

  // 使用方案D的阈值 (大户>$100, 中户>$10)
  const thresholds = { large: 100, medium: 10 };

  console.log(`[使用阈值: 大户>$${thresholds.large}, 中户>$${thresholds.medium}]`);

  // 分析每个代币
  const analysisResults = [];

  Object.keys(investmentMap).forEach(tokenAddr => {
    const label = labelsMap.get(tokenAddr);
    const invData = investmentMap[tokenAddr];
    const tradeData = tradesMap[tokenAddr];

    if (!label || !invData || !tradeData || invData.wallet_count === 0 || !tradeData.trades) {
      return;
    }

    // 分类钱包
    const walletInvestments = invData.wallet_investments || {};
    const wallets = Object.keys(walletInvestments).map(addr => ({
      address: addr,
      investment: walletInvestments[addr]
    }));

    const classified = classifyWalletsByInvestment(walletInvestments, thresholds);

    // 分析买卖行为
    const tierBehavior = analyzeTokenTierBuySell(tradeData.trades, tokenAddr, classified);

    analysisResults.push({
      token_symbol: invData.token_symbol || tradeData.token_symbol,
      token_address: tokenAddr,
      quality: label.category,
      large_count: classified.large.length,
      medium_count: classified.medium.length,
      small_count: classified.small.length,
      total_count: classified.large.length + classified.medium.length + classified.small.length,
      ...tierBehavior
    });
  });

  console.log(`  ✓ ${analysisResults.length} 个代币有完整数据`);

  // 按质量分组
  const qualityGroups = {
    high_quality: analysisResults.filter(r => r.quality === 'high_quality'),
    mid_quality: analysisResults.filter(r => r.quality === 'mid_quality'),
    low_quality: analysisResults.filter(r => r.quality === 'low_quality')
  };

  console.log('\n质量分布:');
  console.log(`  高质量: ${qualityGroups.high_quality.length} 个`);
  console.log(`  中质量: ${qualityGroups.mid_quality.length} 个`);
  console.log(`  低质量: ${qualityGroups.low_quality.length} 个`);

  // 计算相关性
  console.log('\n' + '='.repeat(80));
  console.log('大小中户买卖行为与质量的相关性');
  console.log('='.repeat(80));

  const metrics = [
    // 大户指标
    { name: '大户卖出比例', key: 'large_sell_ratio', tier: '大户' },
    { name: '大户净流入比例', key: 'large_net_inflow_ratio', tier: '大户' },
    { name: '大户净流入金额($)', key: 'large_net_inflow_usd', tier: '大户' },
    // 中户指标
    { name: '中户卖出比例', key: 'medium_sell_ratio', tier: '中户' },
    { name: '中户净流入比例', key: 'medium_net_inflow_ratio', tier: '中户' },
    { name: '中户净流入金额($)', key: 'medium_net_inflow_usd', tier: '中户' },
    // 小户指标
    { name: '小户卖出比例', key: 'small_sell_ratio', tier: '小户' },
    { name: '小户净流入比例', key: 'small_net_inflow_ratio', tier: '小户' },
    { name: '小户净流入金额($)', key: 'small_net_inflow_usd', tier: '小户' },
  ];

  const binaryQuality = analysisResults.map(r =>
    (r.quality === 'high_quality' || r.quality === 'mid_quality') ? 1 : 0
  );

  const correlations = {};

  metrics.forEach(metric => {
    const values = analysisResults.map(r => r[metric.key]);
    const pb = pointBiserialCorrelation(binaryQuality, values);

    if (pb !== null) {
      correlations[metric.key] = pb;

      const direction = pb > 0 ? '正相关' : '负相关';
      const strength = Math.abs(pb) > 0.3 ? '强' : Math.abs(pb) > 0.15 ? '中' : '弱';
      const indicator = pb > 0.3 ? '✅ 正向指标' : pb < -0.3 ? '🚩 反向指标' : '⚠️ 弱相关';

      console.log(`\n${metric.name}`);
      console.log(`  相关性: r=${pb.toFixed(3)} (${strength}${direction}) ${indicator}`);
    }
  });

  // 各质量组的平均值
  console.log('\n' + '='.repeat(80));
  console.log('各质量组的大小中户买卖行为特征');
  console.log('='.repeat(80));

  ['high_quality', 'mid_quality', 'low_quality'].forEach(quality => {
    const tokens = qualityGroups[quality];
    if (tokens.length === 0) return;

    const label = { high_quality: '高', mid_quality: '中', low_quality: '低' }[quality];
    console.log(`\n${label}质量 (${tokens.length}个代币):`);

    console.log(`  大户:`);
    console.log(`    卖出比例: ${(tokens.reduce((s, t) => s + t.large_sell_ratio, 0) / tokens.length * 100).toFixed(1)}%`);
    console.log(`    净流入: $${(tokens.reduce((s, t) => s + t.large_net_inflow_usd, 0) / tokens.length).toFixed(2)}`);

    console.log(`  中户:`);
    console.log(`    卖出比例: ${(tokens.reduce((s, t) => s + t.medium_sell_ratio, 0) / tokens.length * 100).toFixed(1)}%`);
    console.log(`    净流入: $${(tokens.reduce((s, t) => s + t.medium_net_inflow_usd, 0) / tokens.length).toFixed(2)}`);

    console.log(`  小户:`);
    console.log(`    卖出比例: ${(tokens.reduce((s, t) => s + t.small_sell_ratio, 0) / tokens.length * 100).toFixed(1)}%`);
    console.log(`    净流入: $${(tokens.reduce((s, t) => s + t.small_net_inflow_usd, 0) / tokens.length).toFixed(2)}`);
  });

  // 保存结果
  const result = {
    thresholds: thresholds,
    metrics: metrics,
    correlations: correlations,
    quality_groups: {
      high_quality: qualityGroups.high_quality,
      mid_quality: qualityGroups.mid_quality,
      low_quality: qualityGroups.low_quality
    },
    all_results: analysisResults
  };

  fs.writeFileSync(
    path.join(DATA_DIR, 'data/tier_buy_sell_analysis.json'),
    JSON.stringify(result, null, 2)
  );

  console.log('\n✅ 分析完成! 结果已保存到 data/tier_buy_sell_analysis.json');
}

main().catch(console.error);
