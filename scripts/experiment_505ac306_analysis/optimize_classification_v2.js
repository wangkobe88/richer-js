/**
 * 基于3024个钱包数据优化分类系统 v2
 * 重新设计组合分类逻辑
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = '/Users/nobody1/Desktop/Codes/richer-js/scripts/experiment_505ac306_analysis';

// 加载数据
const tokenEarlyParticipants = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'token_early_participants_all.json'), 'utf8'));
const existingWalletData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wallet_data.json'), 'utf8'));

console.log('='.repeat(100));
console.log('钱包分类系统优化 v2');
console.log('='.repeat(100));

// 从 token_early_participants 中提取所有钱包地址
const allWalletAddresses = new Set();
Object.values(tokenEarlyParticipants).forEach(data => {
  data.participants.forEach(addr => allWalletAddresses.add(addr));
});

console.log(`\n总钱包数: ${allWalletAddresses.size}`);
console.log(`已有钱包数据: ${existingWalletData.length}`);

// 提取各类指标的分布
console.log('\n' + '='.repeat(100));
console.log('[数据分布分析]');
console.log('='.repeat(100));

const metrics = {
  balance: existingWalletData.map(w => w.total_balance || 0).filter(v => v > 0),
  trades: existingWalletData.map(w => w.total_trades || 0).filter(v => v > 0),
  age: existingWalletData.map(w => w.wallet_age_days || 0).filter(v => v > 0),
  profitRatio: existingWalletData.map(w => w.total_tokens > 0 ? (w.profitable_tokens || 0) / w.total_tokens : 0).filter(v => v >= 0)
};

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

const balanceP = percentiles(metrics.balance, [0, 10, 25, 50, 75, 90, 95, 99, 100]);
const tradesP = percentiles(metrics.trades, [0, 10, 25, 50, 75, 90, 95, 99, 100]);
const ageP = percentiles(metrics.age, [0, 10, 25, 50, 75, 90, 95, 99, 100]);
const profitP = percentiles(metrics.profitRatio, [0, 10, 25, 50, 75, 90, 95, 99, 100]);

console.log('\n关键阈值:');
console.log(`  余额: P25=${balanceP[25].toFixed(0)}, P75=${balanceP[75].toFixed(0)}, P95=${balanceP[95].toFixed(0)}`);
console.log(`  交易: P25=${tradesP[25]}, P75=${tradesP[75]}, P95=${tradesP[95]}`);
console.log(`  年龄: P25=${ageP[25]}天, P75=${ageP[75]}天`);
console.log(`  盈利: P50=${(profitP[50]*100).toFixed(0)}%, P75=${(profitP[75]*100).toFixed(0)}%`);

// 构建新的分类系统 - 每个钱包只分配到一个类别
console.log('\n' + '='.repeat(100));
console.log('[构建优化分类系统]');
console.log('='.repeat(100));

const newSystem = {
  version: "2.0",
  description: "基于3024个早期参与者的优化分类 - 单标签分类",
  dimensions: {
    balance: {
      description: "钱包余额(BNB)",
      categories: [
        { name: "🏆 巨鲸", min: balanceP[95] },  // Top 5%
        { name: "💰 大户", min: balanceP[75], max: balanceP[95] },  // 75-95%
        { name: "🐟 中户", min: balanceP[25], max: balanceP[75] },  // 25-75%
        { name: "🐟 散户", max: balanceP[25] }  // 0-25%
      ]
    },
    trading: {
      description: "总交易次数",
      categories: [
        { name: "🎲 高频", min: tradesP[95] },  // Top 5%
        { name: "⚡ 活跃", min: tradesP[75], max: tradesP[95] },  // 75-95%
        { name: "🐌 中等", min: tradesP[25], max: tradesP[75] },  // 25-75%
        { name: "🌱 低频", max: tradesP[25] }  // 0-25%
      ]
    },
    age: {
      description: "钱包年龄(天)",
      categories: [
        { name: "🦅 老鸟", min: ageP[75] },  // Top 25%
        { name: "🌿 中等", min: ageP[25], max: ageP[75] },  // 25-75%
        { name: "🌱 新钱包", max: ageP[25] }  // 0-25%
      ]
    },
    profitability: {
      description: "盈利代币比例",
      categories: [
        { name: "🏆 赢家", min: 0.5 },  // >= 50%
        { name: "🤔 中等", min: 0.25, max: 0.5 },  // 25-50%
        { name: "📉 输家", max: 0.25 }  // < 25%
      ]
    }
  },
  // 优先级从高到低的分类规则
  combo_categories: [
    {
      name: "🏆 巨鲸",
      priority: 1,
      rules: [{ dimension: "balance", category: "🏆 巨鲸" }],
      description: "余额Top 5%"
    },
    {
      name: "💎 聪明钱",
      priority: 2,
      rules: [
        { dimension: "balance", category: "💰 大户" },
        { dimension: "age", category: "🦅 老鸟" }
      ],
      description: "大户+老钱包"
    },
    {
      name: "🤖 疑似机器人",
      priority: 3,
      rules: [
        { dimension: "trading", category: "🎲 高频" },
        { dimension: "age", category: "🌱 新钱包" }
      ],
      description: "高频+新钱包"
    },
    {
      name: "🎲 高频玩家",
      priority: 4,
      rules: [{ dimension: "trading", category: "🎲 高频" }],
      description: "交易Top 5%"
    },
    {
      name: "🌟 新星玩家",
      priority: 5,
      rules: [
        { dimension: "trading", category: "⚡ 活跃" },
        { dimension: "age", category: "🌱 新钱包" }
      ],
      description: "活跃+新钱包"
    },
    {
      name: "🦅 老鸟赢家",
      priority: 6,
      rules: [
        { dimension: "age", category: "🦅 老鸟" },
        { dimension: "profitability", category: "🏆 赢家" }
      ],
      description: "老钱包+高盈利"
    },
    {
      name: "💰 大户",
      priority: 7,
      rules: [{ dimension: "balance", category: "💰 大户" }],
      description: "余额75-95%"
    },
    {
      name: "🐟 散户",
      priority: 8,
      rules: [
        { dimension: "balance", category: "🐟 散户" },
        { dimension: "trading", category: "🐌 中等" }
      ],
      description: "低余额+中等交易"
    },
    {
      name: "🐟 普通玩家",
      priority: 999,
      rules: [],
      description: "其他所有钱包"
    }
  ]
};

// 分类函数 - 返回单个最匹配的类别
function classifyWallet(wallet, system) {
  // 先获取各维度的基础分类
  const balanceCat = system.dimensions.balance.categories.find(c => {
    if (c.max !== undefined && c.min !== undefined)
      return wallet.total_balance >= c.min && wallet.total_balance < c.max;
    else if (c.max !== undefined) return wallet.total_balance < c.max;
    else return wallet.total_balance >= c.min;
  }) || system.dimensions.balance.categories[system.dimensions.balance.categories.length - 1];

  const tradingCat = system.dimensions.trading.categories.find(c => {
    if (c.max !== undefined && c.min !== undefined)
      return wallet.total_trades >= c.min && wallet.total_trades < c.max;
    else if (c.max !== undefined) return wallet.total_trades < c.max;
    else return wallet.total_trades >= c.min;
  }) || system.dimensions.trading.categories[system.dimensions.trading.categories.length - 1];

  const ageCat = system.dimensions.age.categories.find(c => {
    if (c.max !== undefined && c.min !== undefined)
      return wallet.wallet_age_days >= c.min && wallet.wallet_age_days < c.max;
    else if (c.max !== undefined) return wallet.wallet_age_days < c.max;
    else return wallet.wallet_age_days >= c.min;
  }) || system.dimensions.age.categories[system.dimensions.age.categories.length - 1];

  const profitRatio = wallet.total_tokens > 0 ? (wallet.profitable_tokens || 0) / wallet.total_tokens : 0;
  const profitCat = system.dimensions.profitability.categories.find(c => {
    if (c.max !== undefined && c.min !== undefined)
      return profitRatio >= c.min && profitRatio < c.max;
    else if (c.max !== undefined) return profitRatio < c.max;
    else return profitRatio >= c.min;
  }) || system.dimensions.profitability.categories[system.dimensions.profitability.categories.length - 1];

  // 按优先级查找匹配的组合类别
  const sortedCombos = [...system.combo_categories].sort((a, b) => a.priority - b.priority);

  for (const combo of sortedCombos) {
    if (combo.rules.length === 0) continue;  // 跳过默认类别

    const match = combo.rules.every(rule => {
      if (rule.dimension === 'balance') return balanceCat.name === rule.category;
      else if (rule.dimension === 'trading') return tradingCat.name === rule.category;
      else if (rule.dimension === 'age') return ageCat.name === rule.category;
      else if (rule.dimension === 'profitability') return profitCat.name === rule.category;
      return false;
    });

    if (match) {
      return combo;
    }
  }

  // 返回默认类别
  return sortedCombos.find(c => c.rules.length === 0);
}

// 测试新分类系统
console.log('\n' + '='.repeat(100));
console.log('[测试新分类系统]');
console.log('='.repeat(100));

const categoryCounts = {};
const categoryDetails = {};

existingWalletData.forEach(wallet => {
  const category = classifyWallet(wallet, newSystem);
  const name = category.name;

  categoryCounts[name] = (categoryCounts[name] || 0) + 1;

  if (!categoryDetails[name]) {
    categoryDetails[name] = {
      count: 0,
      balance: [],
      trades: [],
      age: [],
      profitRatio: []
    };
  }

  categoryDetails[name].count++;
  categoryDetails[name].balance.push(wallet.total_balance || 0);
  categoryDetails[name].trades.push(wallet.total_trades || 0);
  categoryDetails[name].age.push(wallet.wallet_age_days || 0);
  if (wallet.total_tokens > 0) {
    categoryDetails[name].profitRatio.push((wallet.profitable_tokens || 0) / wallet.total_tokens);
  }
});

console.log('\n分类结果分布:');
console.log('类别'.padEnd(22) + '数量'.padEnd(10) + '占比'.padEnd(10) + '平均余额'.padEnd(12) + '平均交易');
console.log('-'.repeat(100));

Object.entries(categoryDetails)
  .sort((a, b) => b[1].count - a[1].count)
  .forEach(([name, data]) => {
    const avgBalance = data.balance.reduce((a, b) => a + b, 0) / data.balance.length;
    const avgTrades = data.trades.reduce((a, b) => a + b, 0) / data.trades.length;
    console.log(`${name.padEnd(22)} ${data.count.toString().padEnd(10)} ${(data.count / existingWalletData.length * 100).toFixed(1)}%`.padEnd(20) + `${avgBalance.toFixed(0).padStart(10)} ${avgTrades.toFixed(0).padStart(8)}`);
  });

// 保存新分类系统
fs.writeFileSync(
  path.join(DATA_DIR, 'classification_system_v2.json'),
  JSON.stringify(newSystem, null, 2)
);

console.log('\n✅ 新分类系统已保存到: classification_system_v2.json');
console.log('\n新分类阈值:');
console.log(`  余额: 巨鲸 ≥${balanceP[95].toFixed(0)}, 大户 ${balanceP[75].toFixed(0)}-${balanceP[95].toFixed(0)}, 中户 ${balanceP[25].toFixed(0)}-${balanceP[75].toFixed(0)}, 散户 <${balanceP[25].toFixed(0)}`);
console.log(`  交易: 高频 ≥${tradesP[95]}, 活跃 ${tradesP[75]}-${tradesP[95]}, 中等 ${tradesP[25]}-${tradesP[75]}, 低频 <${tradesP[25]}`);
console.log(`  年龄: 老鸟 ≥${ageP[75]}天, 中等 ${ageP[25]}-${ageP[75]}天, 新钱包 <${ageP[25]}天`);
console.log(`  盈利: 赢家 ≥50%, 中等 25-50%, 输家 <25%`);
