/**
 * 优化后的钱包分类系统 v4
 * 目标：更均衡的分布，更清晰的类别定义
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = '/Users/nobody1/Desktop/Codes/richer-js/scripts/experiment_505ac306_analysis';
const walletData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'data/wallet_data_complete.json'), 'utf8'));

console.log('='.repeat(80));
console.log('优化分类系统设计');
console.log('='.repeat(80));

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

const balanceValues = walletData.map(w => w.total_balance || 0).filter(v => v > 0);
const tradeValues = walletData.map(w => w.total_trades || 0).filter(v => v > 0);
const ageValues = walletData.map(w => w.wallet_age_days || 0).filter(v => v > 0);
const profitRatios = walletData.map(w =>
  w.total_tokens > 0 ? (w.profitable_tokens || 0) / w.total_tokens : 0
).filter(v => v >= 0);

const balanceP = percentiles(balanceValues, [0, 20, 40, 60, 80, 90, 95, 100]);
const tradeP = percentiles(tradeValues, [0, 20, 40, 60, 80, 90, 95, 100]);
const ageP = percentiles(ageValues, [0, 20, 40, 60, 80, 100]);
const profitP = percentiles(profitRatios, [0, 25, 50, 75, 100]);

console.log('\n数据分位数:');
console.log(`  余额: P20=${balanceP[20].toFixed(0)}, P40=${balanceP[40].toFixed(0)}, P60=${balanceP[60].toFixed(0)}, P80=${balanceP[80].toFixed(0)}, P95=${balanceP[95].toFixed(0)}`);
console.log(`  交易: P40=${tradeP[40]}, P60=${tradeP[60]}, P80=${tradeP[80]}, P95=${tradeP[95]}`);
console.log(`  年龄: P20=${ageP[20]}, P40=${ageP[40]}, P60=${ageP[60]}, P80=${ageP[80]}`);
console.log(`  盈利比: P25=${(profitP[25]*100).toFixed(1)}%, P50=${(profitP[50]*100).toFixed(1)}%, P75=${(profitP[75]*100).toFixed(1)}%`);

// ==================== 方案1：基于余额的五分类 ====================
console.log('\n' + '='.repeat(80));
console.log('方案1：基于余额的五分类 + 活跃度标签');
console.log('='.repeat(80));

const scheme1 = {
  version: "4.1",
  name: "基于余额的分层分类",
  description: "按余额分为5层，每层约20%，然后叠加活跃度标签",
  categories: [
    {
      name: "🏆 超级巨鲸",
      priority: 1,
      rules: [{ dimension: "balance", min: balanceP[95] }],
      description: `余额 > ${balanceP[95].toFixed(0)} BNB (Top 5%)`
    },
    {
      name: "🐋 大户",
      priority: 2,
      rules: [{ dimension: "balance", min: balanceP[80], max: balanceP[95] }],
      description: `余额 ${balanceP[80].toFixed(0)}-${(balanceP[95]/1000).toFixed(0)}K BNB (Top 5-20%)`
    },
    {
      name: "🐡 中户",
      priority: 3,
      rules: [{ dimension: "balance", min: balanceP[40], max: balanceP[80] }],
      description: `余额 ${balanceP[40].toFixed(0)}-${balanceP[80].toFixed(0)} BNB (40-80%)`
    },
    {
      name: "🦐 小户",
      priority: 4,
      rules: [{ dimension: "balance", min: balanceP[20], max: balanceP[40] }],
      description: `余额 ${balanceP[20].toFixed(0)}-${balanceP[40].toFixed(0)} BNB (20-40%)`
    },
    {
      name: "🐟 散户",
      priority: 5,
      rules: [{ dimension: "balance", max: balanceP[20] }],
      description: `余额 < ${balanceP[20].toFixed(0)} BNB (Bottom 20%)`
    }
  ]
};

// 测试方案1
const stats1 = testScheme(scheme1, walletData);
printStats('方案1', stats1);

// ==================== 方案2：简化四分类 ====================
console.log('\n' + '='.repeat(80));
console.log('方案2：简化四分类（按余额和活跃度）');
console.log('='.repeat(80));

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

const stats2 = testScheme(scheme2, walletData);
printStats('方案2', stats2);

// ==================== 方案3：双维度标签 ====================
console.log('\n' + '='.repeat(80));
console.log('方案3：双维度标签（资金规模 × 年龄）');
console.log('='.repeat(80));

const scheme3 = {
  version: "4.3",
  name: "双维度标签系统",
  description: "资金规模(3档) × 年龄(3档) = 9个类别，但合并一些小类别",
  categories: [
    // 巨鲸
    {
      name: "🏆 巨鲸老玩家",
      priority: 1,
      rules: [
        { dimension: "balance", min: balanceP[90] },
        { dimension: "age", min: ageP[60] }
      ],
      description: `余额Top 10% + 年龄 > ${ageP[60]}天`
    },
    {
      name: "🏆 巨鲸新玩家",
      priority: 2,
      rules: [
        { dimension: "balance", min: balanceP[90] },
        { dimension: "age", max: ageP[60] }
      ],
      description: `余额Top 10% + 年龄 ≤ ${ageP[60]}天`
    },
    // 中大户
    {
      name: "💼 中大户老玩家",
      priority: 3,
      rules: [
        { dimension: "balance", min: balanceP[40], max: balanceP[90] },
        { dimension: "age", min: ageP[60] }
      ],
      description: `余额40-90% + 年龄 > ${ageP[60]}天`
    },
    {
      name: "💼 中大户新玩家",
      priority: 4,
      rules: [
        { dimension: "balance", min: balanceP[40], max: balanceP[90] },
        { dimension: "age", max: ageP[60] }
      ],
      description: `余额40-90% + 年龄 ≤ ${ageP[60]}天`
    },
    // 散户
    {
      name: "🐟 散户老玩家",
      priority: 5,
      rules: [
        { dimension: "balance", max: balanceP[40] },
        { dimension: "age", min: ageP[60] }
      ],
      description: `余额Bottom 40% + 年龄 > ${ageP[60]}天`
    },
    {
      name: "🐟 散户新玩家",
      priority: 6,
      rules: [
        { dimension: "balance", max: balanceP[40] },
        { dimension: "age", max: ageP[60] }
      ],
      description: `余额Bottom 40% + 年龄 ≤ ${ageP[60]}天`
    }
  ]
};

const stats3 = testScheme(scheme3, walletData);
printStats('方案3', stats3);

// ==================== 方案4：最简化四分类 ====================
console.log('\n' + '='.repeat(80));
console.log('方案4：最简化四分类（均衡分布）');
console.log('='.repeat(80));

const scheme4 = {
  version: "4.4",
  name: "最简化四分类",
  description: "每类约25%，清晰无重叠",
  categories: [
    {
      name: "🏆 巨鲸",
      priority: 1,
      rules: [{ dimension: "balance", min: balanceP[75] }],
      description: `余额Top 25%`
    },
    {
      name: "🦈 大鲨鱼",
      priority: 2,
      rules: [
        { dimension: "balance", min: balanceP[40], max: balanceP[75] }
      ],
      description: `余额中上(25-75%)`
    },
    {
      name: "🐠 小鱼",
      priority: 3,
      rules: [
        { dimension: "balance", min: balanceP[20], max: balanceP[40] }
      ],
      description: `余额中下(20-40%)`
    },
    {
      name: "🐟 散户",
      priority: 4,
      rules: [{ dimension: "balance", max: balanceP[20] }],
      description: `余额Bottom 20%`
    }
  ]
};

const stats4 = testScheme(scheme4, walletData);
printStats('方案4', stats4);

// ==================== 保存方案4 ====================
const scheme4Result = {
  system: scheme4,
  stats: stats4,
  wallet_count: walletData.length
};

fs.writeFileSync(
  path.join(DATA_DIR, 'data/classification_system_v4.json'),
  JSON.stringify(scheme4Result, null, 2)
);

console.log('\n✅ 方案4已保存到 data/classification_system_v4.json');

// ==================== 辅助函数 ====================
function testScheme(scheme, wallets) {
  const categoryStats = {};
  const categoryDetails = {};

  wallets.forEach(wallet => {
    const category = classifyWallet(wallet, scheme);

    if (!categoryStats[category]) {
      categoryStats[category] = 0;
      categoryDetails[category] = { balances: [], trades: [], ages: [] };
    }

    categoryStats[category]++;
    categoryDetails[category].balances.push(wallet.total_balance || 0);
    categoryDetails[category].trades.push(wallet.total_trades || 0);
    categoryDetails[category].ages.push(wallet.wallet_age_days || 0);
  });

  return { categoryStats, categoryDetails };
}

function classifyWallet(wallet, scheme) {
  const balance = wallet.total_balance || 0;
  const trades = wallet.total_trades || 0;
  const age = wallet.wallet_age_days || 0;
  const profitRatio = wallet.total_tokens > 0 ? (wallet.profitable_tokens || 0) / wallet.total_tokens : 0;

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
      if (rule.dimension === 'profit') {
        if (rule.min !== undefined && rule.max !== undefined)
          return profitRatio >= rule.min && profitRatio < rule.max;
        else if (rule.max !== undefined) return profitRatio < rule.max;
        else return profitRatio >= rule.min;
      }
      return false;
    });

    if (match) return category.name;
  }

  return "未知";
}

function printStats(schemeName, stats) {
  const { categoryStats, categoryDetails } = stats;
  const total = Object.values(categoryStats).reduce((a, b) => a + b, 0);

  console.log(`\n${schemeName}分类结果:`);
  console.log('-'.repeat(100));

  const sorted = Object.entries(categoryStats).sort((a, b) => b[1] - a[1]);

  console.log('分类'.padEnd(20) + '数量'.padEnd(8) + '占比'.padEnd(8) + '平均余额'.padEnd(12) + '平均交易'.padEnd(10) + '平均年龄');
  console.log('-'.repeat(100));

  sorted.forEach(([name, count]) => {
    const details = categoryDetails[name];
    const avgBalance = details.balances.reduce((a, b) => a + b, 0) / details.balances.length;
    const avgTrades = details.trades.reduce((a, b) => a + b, 0) / details.trades.length;
    const avgAge = details.ages.reduce((a, b) => a + b, 0) / details.ages.length;

    console.log(
      `${name.padEnd(20)} ${count.toString().padEnd(8)} ${(count/total*100).toFixed(1)}%`.padEnd(8) +
      `${avgBalance.toFixed(0).padStart(10)} ${avgTrades.toFixed(0).padStart(8)} ${avgAge.toFixed(0).padStart(6)}天`
    );
  });

  // 计算分布均衡度 (标准差越小越均衡)
  const ratios = Object.values(categoryStats).map(c => c / total);
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const variance = ratios.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / ratios.length;
  const stdDev = Math.sqrt(variance);

  console.log('-'.repeat(100));
  console.log(`分布均衡度: ${stdDev < 0.1 ? '✅ 非常均衡' : stdDev < 0.15 ? '⚠️  较均衡' : '❌ 不均衡'} (标准差=${stdDev.toFixed(3)})`);
}
