/**
 * 最终优化分类系统 - v3
 * 基于数据分布调整，使各类别有意义且分布合理
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = '/Users/nobody1/Desktop/Codes/richer-js/scripts/experiment_505ac306_analysis';
const existingWalletData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wallet_data.json'), 'utf8'));

console.log('='.repeat(100));
console.log('最终分类系统 v3');
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

const balanceP = percentiles(metrics.balance, [0, 25, 50, 75, 90, 95, 100]);
const tradesP = percentiles(metrics.trades, [0, 25, 50, 60, 75, 90, 95, 100]);
const ageP = percentiles(metrics.age, [0, 10, 25, 50, 75, 100]);

// 最终分类系统
const finalSystem = {
  version: "3.0",
  description: "基于数据分布的最终优化分类",
  thresholds: {
    balance: { p25: balanceP[25], p75: balanceP[75], p95: balanceP[95] },
    trades: { p25: tradesP[25], p60: tradesP[60], p75: tradesP[75], p90: tradesP[90] },
    age: { p10: ageP[10], p25: ageP[25], p75: ageP[75] }
  },
  combo_categories: [
    {
      name: "🏆 巨鲸",
      priority: 1,
      rules: [{ dimension: "balance", min: balanceP[95] }],
      description: "余额Top 5%"
    },
    {
      name: "💎 聪明钱",
      priority: 2,
      rules: [
        { dimension: "balance", min: balanceP[75], max: balanceP[95] },
        { dimension: "age", min: ageP[75] }
      ],
      description: "大户+老钱包(25%)"
    },
    {
      name: "🤖 高频玩家",
      priority: 3,
      rules: [{ dimension: "trades", min: tradesP[90] }],
      description: "交易Top 10%"
    },
    {
      name: "🌟 新星玩家",
      priority: 4,
      rules: [
        { dimension: "age", max: ageP[25] },
        { dimension: "trades", min: tradesP[60] }
      ],
      description: "新钱包(25%)+活跃交易(40%)"
    },
    {
      name: "🦅 老鸟赢家",
      priority: 5,
      rules: [
        { dimension: "age", min: ageP[75] },
        { dimension: "profit", min: 0.5 }
      ],
      description: "老钱包+高盈利"
    },
    {
      name: "💰 大户",
      priority: 6,
      rules: [{ dimension: "balance", min: balanceP[75], max: balanceP[95] }],
      description: "余额75-95%"
    },
    {
      name: "🐟 散户",
      priority: 7,
      rules: [{ dimension: "balance", max: balanceP[25] }],
      description: "余额Bottom 25%"
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

    if (match) {
      return combo.name;
    }
  }

  return '🐟 普通玩家';
}

// 测试
const categoryCounts = {};
const categoryDetails = {};

existingWalletData.forEach(wallet => {
  const name = classifyWallet(wallet, finalSystem);
  categoryCounts[name] = (categoryCounts[name] || 0) + 1;

  if (!categoryDetails[name]) {
    categoryDetails[name] = { count: 0, balance: [], trades: [], age: [], profit: [] };
  }
  categoryDetails[name].count++;
  categoryDetails[name].balance.push(wallet.total_balance || 0);
  categoryDetails[name].trades.push(wallet.total_trades || 0);
  categoryDetails[name].age.push(wallet.wallet_age_days || 0);
  if (wallet.total_tokens > 0) {
    categoryDetails[name].profit.push((wallet.profitable_tokens || 0) / wallet.total_tokens);
  }
});

console.log('\n分类阈值:');
console.log(`  余额: P25=${balanceP[25].toFixed(0)}, P75=${balanceP[75].toFixed(0)}, P95=${balanceP[95].toFixed(0)}`);
console.log(`  交易: P25=${tradesP[25]}, P60=${tradesP[60]}, P75=${tradesP[75]}, P90=${tradesP[90]}`);
console.log(`  年龄: P10=${ageP[10]}, P25=${ageP[25]}, P75=${ageP[75]}`);

console.log('\n分类结果:');
console.log('类别'.padEnd(20) + '数量'.padEnd(8) + '占比'.padEnd(8) + '平均余额'.padEnd(12) + '平均交易'.padEnd(10) + '平均年龄');
console.log('-'.repeat(100));

Object.entries(categoryDetails)
  .sort((a, b) => b[1].count - a[1].count)
  .forEach(([name, data]) => {
    const avgBalance = data.balance.reduce((a, b) => a + b, 0) / data.balance.length;
    const avgTrades = data.trades.reduce((a, b) => a + b, 0) / data.trades.length;
    const avgAge = data.age.reduce((a, b) => a + b, 0) / data.age.length;
    console.log(`${name.padEnd(20)} ${data.count.toString().padEnd(8)} ${(data.count / existingWalletData.length * 100).toFixed(1)}%`.padEnd(16) + `${avgBalance.toFixed(0).padStart(10)} ${avgTrades.toFixed(0).padStart(8)} ${avgAge.toFixed(0).padStart(6)}天`);
  });

// 保存
fs.writeFileSync(
  path.join(DATA_DIR, 'classification_system_v3.json'),
  JSON.stringify(finalSystem, null, 2)
);

console.log('\n✅ 已保存到: classification_system_v3.json');
