/**
 * 基于人工标注质量的分析
 * 目标：分析早期参与者构成与代币质量的关系
 */

require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });
const fs = require('fs');
const path = require('path');
const http = require('http');

const DATA_DIR = '/Users/nobody1/Desktop/Codes/richer-js/scripts/experiment_505ac306_analysis';
const EXPERIMENT_ID = '505ac306-97fc-43d6-b027-00b909469b81';
const SOURCE_EXPERIMENT_ID = '6b17ff18-002d-4ce0-a745-b8e02676abd4'; // 源实验，包含人工标注

// 加载数据
const tokenEarlyParticipants = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'data/token_early_participants_all.json'), 'utf8'));
const walletDataComplete = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'data/wallet_data_complete.json'), 'utf8'));

// 获取人工标注（从源实验获取）
async function getHumanLabeledTokens() {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:3010/api/experiment/${SOURCE_EXPERIMENT_ID}/tokens?limit=10000`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          const tokens = result.data || result.tokens || [];
          // 筛选有人工标注的代币
          const labeled = tokens.filter(t => t.human_judges && t.human_judges.category);
          resolve(labeled);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// 质量值映射
const qualityValues = {
  'high_quality': 2,
  'mid_quality': 1,
  'low_quality': 0
};

// 二分类映射
const binaryQualityValues = {
  'high_quality': 1,
  'mid_quality': 1,
  'low_quality': 0
};

// 分类系统（方案2）
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

const scheme2 = {
  version: "4.2",
  name: "简化四分类",
  categories: [
    {
      name: "🏆 巨鲸",
      priority: 1,
      rules: [{ dimension: "balance", min: balanceP[90] }]
    },
    {
      name: "🔥 活跃玩家",
      priority: 2,
      rules: [
        { dimension: "trades", min: tradeP[60] },
        { dimension: "balance", min: balanceP[20] }
      ]
    },
    {
      name: "👤 普通玩家",
      priority: 3,
      rules: [{ dimension: "balance", min: balanceP[20] }]
    },
    {
      name: "🐟 散户",
      priority: 4,
      rules: [{ dimension: "balance", max: balanceP[20] }]
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

// 计算点二列相关系数 (Point-biserial correlation)
// 用于衡量二分类变量与连续变量的相关性
function pointBiserialCorrelation(binaryValues, continuousValues) {
  const n = binaryValues.length;
  if (n < 3) return null;

  // 分组
  const group1 = []; // binary = 1
  const group0 = []; // binary = 0

  binaryValues.forEach((b, i) => {
    if (b === 1) group1.push(continuousValues[i]);
    else group0.push(continuousValues[i]);
  });

  if (group1.length === 0 || group0.length === 0) return null;

  const n1 = group1.length;
  const n0 = group0.length;

  // 计算均值
  const mean1 = group1.reduce((a, b) => a + b, 0) / n1;
  const mean0 = group0.reduce((a, b) => a + b, 0) / n0;

  // 计算标准差
  const allValues = continuousValues;
  const mean = allValues.reduce((a, b) => a + b, 0) / n;
  const variance = allValues.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return null;

  // 点二列相关系数公式
  const r = ((mean1 - mean0) / stdDev) * Math.sqrt((n1 * n0) / (n * n));

  return r;
}

// 计算Spearman等级相关系数
function spearmanCorrelation(x, y) {
  const n = x.length;
  if (n < 3) return null;

  // 转换为等级
  const rank = (arr) => {
    const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(n);
    sorted.forEach((item, r) => ranks[item.i] = r);
    return ranks;
  };

  const rankX = rank(x);
  const rankY = rank(y);

  // 计算相关系数
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
  console.log('基于人工标注质量的分析');
  console.log('='.repeat(80));

  // 获取人工标注数据
  const labeledTokens = await getHumanLabeledTokens();

  console.log(`\n总代币数: ${labeledTokens.length}`);
  console.log('有人工标注的代币:');
  labeledTokens.forEach(t => {
    console.log(`  ${t.token_symbol.padEnd(15)} - ${t.human_judges.category}`);
  });

  // 构建钱包分类映射
  const walletClassMap = {};
  walletDataComplete.forEach(wallet => {
    walletClassMap[wallet.address.toLowerCase()] = classifyWallet(wallet, scheme2);
  });

  // 分析每个标注代币
  const analysisResults = [];
  const categoryData = {};
  scheme2.categories.forEach(cat => {
    categoryData[cat.name] = { ratios: [], qualityValues: [], binaryQuality: [] };
  });

  labeledTokens.forEach(token => {
    const tokenAddr = token.token_address.toLowerCase();
    const participants = tokenEarlyParticipants[tokenAddr]?.participants || [];

    if (participants.length === 0) {
      console.log(`\n⚠️ ${token.token_symbol} 没有早期参与者数据`);
      return;
    }

    // 统计各分类占比
    const categoryCounts = {};
    participants.forEach(addr => {
      const cat = walletClassMap[addr.toLowerCase()] || '未知';
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });

    const total = participants.length;
    const categoryRatios = {};
    Object.keys(categoryCounts).forEach(cat => {
      categoryRatios[cat] = categoryCounts[cat] / total;
    });

    const quality = token.human_judges.category;
    const qualityValue = qualityValues[quality];
    const binaryQuality = binaryQualityValues[quality];

    // 记录数据
    Object.keys(categoryRatios).forEach(cat => {
      if (categoryData[cat]) {
        categoryData[cat].ratios.push(categoryRatios[cat]);
        categoryData[cat].qualityValues.push(qualityValue);
        categoryData[cat].binaryQuality.push(binaryQuality);
      }
    });

    analysisResults.push({
      token_symbol: token.token_symbol,
      token_address: token.token_address,
      quality: quality,
      quality_value: qualityValue,
      binary_quality: binaryQuality,
      participant_count: total,
      category_ratios: categoryRatios
    });
  });

  // 计算相关性
  console.log('\n' + '='.repeat(80));
  console.log('钱包分类占比与质量的相关性分析');
  console.log('='.repeat(80));

  const correlations = {};

  Object.keys(categoryData).forEach(cat => {
    const data = categoryData[cat];
    if (data.ratios.length < 3) return;

    // 三分类质量相关性
    const spearman = spearmanCorrelation(data.ratios, data.qualityValues);

    // 二分类质量相关性 (能否区分低质量 vs 高中质量)
    const pointBiserial = pointBiserialCorrelation(data.binaryQuality, data.ratios);

    if (spearman !== null || pointBiserial !== null) {
      correlations[cat] = {
        spearman: spearman,
        point_biserial: pointBiserial,
        token_count: data.ratios.length,
        avg_ratio: data.ratios.reduce((a, b) => a + b, 0) / data.ratios.length
      };

      console.log(`\n${cat}:`);
      console.log(`  样本数: ${data.ratios.length}`);
      console.log(`  平均占比: ${(correlations[cat].avg_ratio * 100).toFixed(1)}%`);
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

  // 详细数据展示
  console.log('\n' + '='.repeat(80));
  console.log('详细数据');
  console.log('='.repeat(80));

  console.log('\n代币'.padEnd(15) + '质量'.padEnd(15) + '巨鲸%'.padEnd(10) + '活跃%'.padEnd(10) + '普通%'.padEnd(10) + '散户%');
  console.log('-'.repeat(80));

  analysisResults.forEach(r => {
    const qualityLabel = {
      'high_quality': '高',
      'mid_quality': '中',
      'low_quality': '低'
    }[r.quality];

    console.log(
      r.token_symbol.padEnd(15) +
      qualityLabel.padEnd(15) +
      ((r.category_ratios['🏆 巨鲸'] || 0) * 100).toFixed(0).padStart(6) + '%'.padEnd(4) +
      ((r.category_ratios['🔥 活跃玩家'] || 0) * 100).toFixed(0).padStart(6) + '%'.padEnd(4) +
      ((r.category_ratios['👤 普通玩家'] || 0) * 100).toFixed(0).padStart(6) + '%'.padEnd(4) +
      ((r.category_ratios['🐟 散户'] || 0) * 100).toFixed(0).padStart(6) + '%'
    );
  });

  // 统计各质量组的平均占比
  console.log('\n' + '='.repeat(80));
  console.log('各质量组的平均钱包构成');
  console.log('='.repeat(80));

  ['high_quality', 'mid_quality', 'low_quality'].forEach(quality => {
    const tokens = analysisResults.filter(r => r.quality === quality);
    if (tokens.length === 0) return;

    const qualityLabel = { high_quality: '高', mid_quality: '中', low_quality: '低' }[quality];

    console.log(`\n${qualityLabel}质量 (${tokens.length}个代币):`);

    scheme2.categories.forEach(cat => {
      const avgRatio = tokens.reduce((sum, t) =>
        sum + (t.category_ratios[cat.name] || 0), 0
      ) / tokens.length;
      console.log(`  ${cat.name}: ${(avgRatio * 100).toFixed(1)}%`);
    });
  });

  // 保存结果
  const result = {
    scheme: scheme2,
    labeled_tokens: labeledTokens.map(t => ({
      symbol: t.token_symbol,
      address: t.token_address,
      quality: t.human_judges.category
    })),
    correlations: correlations,
    analysis: analysisResults
  };

  fs.writeFileSync(
    path.join(DATA_DIR, 'data/quality_analysis_results.json'),
    JSON.stringify(result, null, 2)
  );

  console.log('\n✅ 分析完成! 结果已保存到 data/quality_analysis_results.json');

  // 结论
  console.log('\n' + '='.repeat(80));
  console.log('结论');
  console.log('='.repeat(80));

  const bestBinary = Object.entries(correlations)
    .filter(([_, d]) => d.point_biserial !== null)
    .sort((a, b) => Math.abs(b[1].point_biserial) - Math.abs(a[1].point_biserial))[0];

  if (bestBinary) {
    console.log(`\n🎯 最佳区分因子（低质量 vs 高中质量）: ${bestBinary[0]}`);
    console.log(`   二分类相关系数: ${bestBinary[1].point_biserial.toFixed(3)}`);
    console.log(`   样本数: ${bestBinary[1].token_count} 个代币`);
  }

  if (analysisResults.length < 10) {
    console.log('\n⚠️ 样本量较小，结果仅供参考。建议增加人工标注数量。');
  }
}

main().catch(console.error);
