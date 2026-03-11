/**
 * 调整分类系统 - 放宽"疑似机器人"和其他类别的定义
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = '/Users/nobody1/Desktop/Codes/richer-js/scripts/experiment_505ac306_analysis';
const existingWalletData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wallet_data.json'), 'utf8'));

console.log('='.repeat(100));
console.log('调整分类系统');
console.log('='.repeat(100));

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

const metrics = {
  balance: existingWalletData.map(w => w.total_balance || 0).filter(v => v > 0),
  trades: existingWalletData.map(w => w.total_trades || 0).filter(v => v > 0),
  age: existingWalletData.map(w => w.wallet_age_days || 0).filter(v => v > 0),
  profitRatio: existingWalletData.map(w => w.total_tokens > 0 ? (w.profitable_tokens || 0) / w.total_tokens : 0).filter(v => v >= 0)
};

const balanceP = percentiles(metrics.balance, [0, 10, 25, 50, 75, 90, 95, 99, 100]);
const tradesP = percentiles(metrics.trades, [0, 10, 25, 50, 75, 90, 95, 99, 100]);
const ageP = percentiles(metrics.age, [0, 10, 25, 50, 75, 90, 95, 99, 100]);

// 调整后的分类系统
const adjustedSystem = {
  version: "2.1",
  description: "调整分类阈值，使各类别分布更均衡",
  dimensions: {
    balance: {
      description: "钱包余额(BNB)",
      categories: [
        { name: "🏆 巨鲸", min: balanceP[95] },
        { name: "💰 大户", min: balanceP[75], max: balanceP[95] },
        { name: "🐟 中户", min: balanceP[25], max: balanceP[75] },
        { name: "🐟 散户", max: balanceP[25] }
      ]
    },
    trading: {
      description: "总交易次数",
      categories: [
        { name: "🎲 高频", min: tradesP[90] },
        { name: "⚡ 活跃", min: tradesP[60], max: tradesP[90] },
        { name: "🐌 中等", min: tradesP[25], max: tradesP[60] },
        { name: "🌱 低频", max: tradesP[25] }
      ]
    },
    age: {
      description: "钱包年龄(天)",
      categories: [
        { name: "🦅 老鸟", min: ageP[75] },
        { name: "🌿 中等", min: ageP[25], max: ageP[75] },
        { name: "🌱 新钱包", max: ageP[25] }
      ]
    },
    profitability: {
      description: "盈利代币比例",
      categories: [
        { name: "🏆 赢家", min: 0.5 },
        { name: "🤔 中等", min: 0.25, max: 0.5 },
        { name: "📉 输家", max: 0.25 }
      ]
    }
  },
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
        { dimension: "trading", category: "⚡ 活跃" }
      ],
      description: "高频或活跃交易"
    },
    {
      name: "🤖 超新钱包",
      priority: 4,
      rules: [
        { dimension: "age", category: "🌱 新钱包" },
        { dimension: "trading", category: "⚡ 活跃" }
      ],
      description: "新钱包+活跃交易"
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
      rules: [{ dimension: "balance", category: "🐟 散户" }],
      description: "低余额"
    },
    {
      name: "🐟 普通玩家",
      priority: 999,
      rules: [],
      description: "其他所有钱包"
    }
  ]
};

// 分类函数
function classifyWallet(wallet, system) {
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

  const sortedCombos = [...system.combo_categories].sort((a, b) => a.priority - b.priority);

  for (const combo of sortedCombos) {
    if (combo.rules.length === 0) continue;

    const match = combo.rules.every(rule => {
      if (rule.dimension === 'balance') return balanceCat.name === rule.category;
      else if (rule.dimension === 'trading') return tradingCat.name === rule.category;
      else if (rule.dimension === 'age') return ageCat.name === rule.category;
      else if (rule.dimension === 'profitability') return profitCat.name === rule.category;
      return false;
    });

    if (match) {
      return combo.name;
    }
  }

  return sortedCombos.find(c => c.rules.length === 0).name;
}

// 测试
const categoryCounts = {};
const categoryDetails = {};

existingWalletData.forEach(wallet => {
  const name = classifyWallet(wallet, adjustedSystem);
  categoryCounts[name] = (categoryCounts[name] || 0) + 1;

  if (!categoryDetails[name]) {
    categoryDetails[name] = { count: 0, balance: [], trades: [], age: [] };
  }
  categoryDetails[name].count++;
  categoryDetails[name].balance.push(wallet.total_balance || 0);
  categoryDetails[name].trades.push(wallet.total_trades || 0);
  categoryDetails[name].age.push(wallet.wallet_age_days || 0);
});

console.log('\n调整后的阈值:');
console.log(`  交易: 高频 ≥${tradesP[90]} (P90), 活跃 ${tradesP[60]}-${tradesP[90]} (P60-90)`);
console.log(`  其他阈值保持不变`);

console.log('\n新分类结果:');
console.log('类别'.padEnd(22) + '数量'.padEnd(10) + '占比');
console.log('-'.repeat(50));

Object.entries(categoryDetails)
  .sort((a, b) => b[1].count - a[1].count)
  .forEach(([name, data]) => {
    console.log(`${name.padEnd(22)} ${data.count.toString().padEnd(10)} ${(data.count / existingWalletData.length * 100).toFixed(1)}%`);
  });

// 保存
fs.writeFileSync(
  path.join(DATA_DIR, 'classification_system_v2.1.json'),
  JSON.stringify(adjustedSystem, null, 2)
);

console.log('\n✅ 已保存到: classification_system_v2.1.json');
