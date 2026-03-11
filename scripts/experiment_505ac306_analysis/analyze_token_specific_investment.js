/**
 * 基于代币特定投入金额的分类分析
 * 按每个钱包在该代币上的投入金额分类（大户/中户/小户）
 */

require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });
const fs = require('fs');
const path = require('path');
const http = require('http');

const DATA_DIR = '/Users/nobody1/Desktop/Codes/richer-js/scripts/experiment_505ac306_analysis';
const EXPERIMENT_ID = '505ac306-97fc-43d6-b027-00b909469b81';
const SOURCE_EXPERIMENT_ID = '6b17ff18-002d-4ce0-a745-b8e02676abd4';

// 加载数据
const tokenEarlyInvestments = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'data/token_early_participants_with_investment.json'), 'utf8'));

console.log('='.repeat(80));
console.log('基于代币特定投入金额的分类分析');
console.log('='.repeat(80));
console.log(`代币数: ${tokenEarlyInvestments.length}`);

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
  console.log('[获取交易和标注数据...]');
  const [tradesRes, tokensRes] = await Promise.all([
    get(`http://localhost:3010/api/experiment/${EXPERIMENT_ID}/trades?limit=10000`),
    get(`http://localhost:3010/api/experiment/${SOURCE_EXPERIMENT_ID}/tokens?limit=10000`)
  ]);

  const trades = tradesRes.trades || [];
  const labelsMap = new Map();
  if (tokensRes.success && tokensRes.data) {
    tokensRes.data.forEach(token => {
      if (token.human_judges && token.human_judges.category) {
        labelsMap.set(token.token_address.toLowerCase(), token.human_judges);
      }
    });
  }

  // 计算收益
  const tokenTrades = {};
  trades.forEach(t => {
    if (!tokenTrades[t.token_address]) tokenTrades[t.token_address] = [];
    tokenTrades[t.token_address].push(t);
  });

  const tokenResults = Object.keys(tokenTrades).map(tokenAddress => {
    const tts = tokenTrades[tokenAddress].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const buyQueue = [];
    let totalBNBSpent = 0;
    let totalReceived = 0;

    tts.forEach(t => {
      const dir = t.trade_direction || t.direction || t.action;
      if (dir === 'buy' || dir === 'BUY') {
        const amt = parseFloat(t.input_amount || 0);
        if (amt > 0) {
          buyQueue.push({ amt, cost: amt });
          totalBNBSpent += amt;
        }
      } else {
        const inputAmt = parseFloat(t.input_amount || 0);
        let remaining = inputAmt;
        while (remaining > 0 && buyQueue.length > 0) {
          const oldest = buyQueue[0];
          const sellAmt = Math.min(remaining, oldest.amt);
          remaining -= sellAmt;
          oldest.amt -= sellAmt;
          if (oldest.amt <= 0.00000001) buyQueue.shift();
        }
        totalReceived += parseFloat(t.output_amount || 0);
      }
    });

    const remainingCost = buyQueue.reduce((s, b) => s + b.cost, 0);
    const totalCost = totalBNBSpent || 1;
    const returnRate = ((totalReceived + remainingCost - totalCost) / totalCost) * 100;

    return {
      token_address: tokenAddress,
      token_symbol: tts[0]?.token_symbol || 'Unknown',
      return_rate: returnRate,
      label: labelsMap.get(tokenAddress.toLowerCase()) || null
    };
  }).filter(t => t !== null);

  console.log(`  ✓ ${tokenResults.length} 个代币有交易数据`);
  console.log(`  ✓ ${labelsMap.size} 条标注数据`);

  return tokenResults;
}

// 按代币特定投入金额分类钱包
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
  const tokenResults = await getTokenReturnsAndLabels();
  const labeled = tokenResults.filter(t => t.label !== null);

  console.log('\n质量分布:');
  const qualityGroups = { high_quality: [], mid_quality: [], low_quality: [] };
  labeled.forEach(t => {
    if (qualityGroups[t.label.category]) {
      qualityGroups[t.label.category].push(t);
    }
  });
  console.log(`  高质量: ${qualityGroups.high_quality.length} 个`);
  console.log(`  中质量: ${qualityGroups.mid_quality.length} 个`);
  console.log(`  低质量: ${qualityGroups.low_quality.length} 个`);

  // 构建代币投入映射
  const investmentMap = {};
  tokenEarlyInvestments.forEach(t => {
    investmentMap[t.token_address.toLowerCase()] = t;
  });

  // 尝试不同的阈值
  const thresholdOptions = [
    { name: '方案A', large: 1000, medium: 100 },   // >$1000大户, >$100中户
    { name: '方案B', large: 500, medium: 50 },     // >$500大户, >$50中户
    { name: '方案C', large: 200, medium: 20 },     // >$200大户, >$20中户
    { name: '方案D', large: 100, medium: 10 }      // >$100大户, >$10中户
  ];

  // 保存所有方案的分析结果
  const allResults = {};

  console.log('\n' + '='.repeat(80));
  console.log('尝试不同投入金额阈值');
  console.log('='.repeat(80));

  for (const option of thresholdOptions) {
    console.log(`\n${option.name} (大户>$${option.large}, 中户>$${option.medium}):`);

    const categoryData = {
      large_ratio: [],
      medium_ratio: [],
      small_ratio: [],
      qualityValues: [],
      binaryQuality: [],
      returns: []
    };

    labeled.forEach(token => {
      const invData = investmentMap[token.token_address.toLowerCase()];
      if (!invData || invData.wallet_count === 0) return;

      const classified = classifyWalletsByInvestment(invData.wallet_investments, option);

      const total = classified.large.length + classified.medium.length + classified.small.length;
      if (total === 0) return;

      const largeRatio = classified.large.length / total;
      const mediumRatio = classified.medium.length / total;
      const smallRatio = classified.small.length / total;

      const quality = token.label.category;
      const qualityValue = { high_quality: 2, mid_quality: 1, low_quality: 0 }[quality];
      const binaryQuality = (quality === 'high_quality' || quality === 'mid_quality') ? 1 : 0;

      categoryData.large_ratio.push(largeRatio);
      categoryData.medium_ratio.push(mediumRatio);
      categoryData.small_ratio.push(smallRatio);
      categoryData.qualityValues.push(qualityValue);
      categoryData.binaryQuality.push(binaryQuality);
      categoryData.returns.push(token.return_rate);
    });

    // 计算相关性
    const categories = [
      { name: '大户', ratios: categoryData.large_ratio },
      { name: '中户', ratios: categoryData.medium_ratio },
      { name: '小户', ratios: categoryData.small_ratio }
    ];

    // 调试：显示样本数
    const n1 = categoryData.binaryQuality.filter(b => b === 1).length;
    const n0 = categoryData.binaryQuality.filter(b => b === 0).length;
    console.log(`  样本数: ${categoryData.binaryQuality.length} 个代币 (高质量+中质量: ${n1}, 低质量: ${n0})`);

    categories.forEach(cat => {
      if (cat.ratios.length < 3) {
        console.log(`  ${cat.name}: 样本数不足 (${cat.ratios.length})`);
        return;
      }

      const pb = pointBiserialCorrelation(categoryData.binaryQuality, cat.ratios);

      if (pb !== null) {
        const direction = pb > 0 ? '正相关' : '负相关';
        const strength = Math.abs(pb) > 0.3 ? '强' : Math.abs(pb) > 0.15 ? '中' : '弱';
        console.log(`  ${cat.name}: r=${pb.toFixed(3)} (${strength}${direction}), 样本数=${cat.ratios.length}`);
      } else {
        console.log(`  ${cat.name}: 无法计算相关性 (方差=0或分组为空)`);
      }
    });

    // 保存此方案的结果
    allResults[option.name] = {
      large_ratio: [...categoryData.large_ratio],
      medium_ratio: [...categoryData.medium_ratio],
      small_ratio: [...categoryData.small_ratio],
      binaryQuality: [...categoryData.binaryQuality]
    };
  }

  // 使用最佳阈值显示详细结果
  console.log('\n' + '='.repeat(80));
  console.log('各质量组的资金构成（使用方案B: >$500大户, >$50中户）');
  console.log('='.repeat(80));

  const option = thresholdOptions[1];
  const qualityAvg = { high_quality: { large: 0, medium: 0, small: 0, count: 0 }, mid_quality: { large: 0, medium: 0, small: 0, count: 0 }, low_quality: { large: 0, medium: 0, small: 0, count: 0 } };

  labeled.forEach(token => {
    const invData = investmentMap[token.token_address.toLowerCase()];
    if (!invData || invData.wallet_count === 0) return;

    const classified = classifyWalletsByInvestment(invData.wallet_investments, option);
    const total = classified.large.length + classified.medium.length + classified.small.length;

    const quality = token.label.category;
    qualityAvg[quality].large += classified.large.length / total;
    qualityAvg[quality].medium += classified.medium.length / total;
    qualityAvg[quality].small += classified.small.length / total;
    qualityAvg[quality].count += 1;
  });

  ['high_quality', 'mid_quality', 'low_quality'].forEach(quality => {
    const counts = qualityAvg[quality];
    const n = counts.count;
    if (n === 0) return;

    const qualityLabel = { high_quality: '高', mid_quality: '中', low_quality: '低' }[quality];
    console.log(`\n${qualityLabel}质量 (${n}个代币):`);
    console.log(`  大户(>$${option.large}): ${(counts.large / n * 100).toFixed(1)}%`);
    console.log(`  中户(>$${option.medium}): ${(counts.medium / n * 100).toFixed(1)}%`);
    console.log(`  小户(<$${option.medium}): ${(counts.small / n * 100).toFixed(1)}%`);
  });

  // 保存结果
  const result = {
    threshold_options: thresholdOptions,
    all_results: allResults
  };

  fs.writeFileSync(
    path.join(DATA_DIR, 'data/token_specific_investment_analysis.json'),
    JSON.stringify(result, null, 2)
  );

  console.log(`\n✅ 分析完成! 结果已保存`);
}

main().catch(console.error);
