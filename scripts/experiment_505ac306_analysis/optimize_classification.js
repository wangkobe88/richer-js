/**
 * 基于3024个钱包数据优化分类系统
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = '/Users/nobody1/Desktop/Codes/richer-js/scripts/experiment_505ac306_analysis';

// 加载数据
const tokenEarlyParticipants = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'token_early_participants_all.json'), 'utf8'));
const existingWalletData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wallet_data.json'), 'utf8'));

console.log('='.repeat(100));
console.log('钱包分类系统优化');
console.log('='.repeat(100));

// 从 token_early_participants 中提取所有钱包地址
const allWalletAddresses = new Set();
Object.values(tokenEarlyParticipants).forEach(data => {
  data.participants.forEach(addr => allWalletAddresses.add(addr));
});

console.log(`\n总钱包数: ${allWalletAddresses.size}`);
console.log(`已有钱包数据: ${existingWalletData.length}`);

// 获取所有有数据的钱包
const walletMap = new Map();
existingWalletData.forEach(w => {
  walletMap.set(w.address.toLowerCase(), w);
});

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

console.log('\n[余额分布]');
const balanceP = percentiles(metrics.balance, [0, 10, 25, 50, 75, 90, 95, 99, 100]);
console.log(`  总数: ${metrics.balance.length}`);
console.log(`  最小值: ${balanceP[0].toFixed(2)}`);
console.log(`  P10: ${balanceP[10].toFixed(2)}`);
console.log(`  P25: ${balanceP[25].toFixed(2)}`);
console.log(`  P50 (中位数): ${balanceP[50].toFixed(2)}`);
console.log(`  P75: ${balanceP[75].toFixed(2)}`);
console.log(`  P90: ${balanceP[90].toFixed(2)}`);
console.log(`  P95: ${balanceP[95].toFixed(2)}`);
console.log(`  P99: ${balanceP[99].toFixed(2)}`);
console.log(`  最大值: ${balanceP[100].toFixed(2)}`);

console.log('\n[交易数分布]');
const tradesP = percentiles(metrics.trades, [0, 10, 25, 50, 75, 90, 95, 99, 100]);
console.log(`  总数: ${metrics.trades.length}`);
console.log(`  最小值: ${tradesP[0]}`);
console.log(`  P10: ${tradesP[10]}`);
console.log(`  P25: ${tradesP[25]}`);
console.log(`  P50 (中位数): ${tradesP[50]}`);
console.log(`  P75: ${tradesP[75]}`);
console.log(`  P90: ${tradesP[90]}`);
console.log(`  P95: ${tradesP[95]}`);
console.log(`  P99: ${tradesP[99]}`);
console.log(`  最大值: ${tradesP[100]}`);

console.log('\n[钱包年龄分布]');
const ageP = percentiles(metrics.age, [0, 10, 25, 50, 75, 90, 95, 99, 100]);
console.log(`  总数: ${metrics.age.length}`);
console.log(`  最小值: ${ageP[0]}`);
console.log(`  P10: ${ageP[10]}`);
console.log(`  P25: ${ageP[25]}`);
console.log(`  P50 (中位数): ${ageP[50]}`);
console.log(`  P75: ${ageP[75]}`);
console.log(`  P90: ${ageP[90]}`);
console.log(`  P95: ${ageP[95]}`);
console.log(`  P99: ${ageP[99]}`);
console.log(`  最大值: ${ageP[100]}`);

console.log('\n[盈利比例分布]');
const profitP = percentiles(metrics.profitRatio, [0, 10, 25, 50, 75, 90, 95, 99, 100]);
console.log(`  总数: ${metrics.profitRatio.length}`);
console.log(`  最小值: ${(profitP[0] * 100).toFixed(1)}%`);
console.log(`  P10: ${(profitP[10] * 100).toFixed(1)}%`);
console.log(`  P25: ${(profitP[25] * 100).toFixed(1)}%`);
console.log(`  P50 (中位数): ${(profitP[50] * 100).toFixed(1)}%`);
console.log(`  P75: ${(profitP[75] * 100).toFixed(1)}%`);
console.log(`  P90: ${(profitP[90] * 100).toFixed(1)}%`);
console.log(`  P95: ${(profitP[95] * 100).toFixed(1)}%`);
console.log(`  P99: ${(profitP[99] * 100).toFixed(1)}%`);
console.log(`  最大值: ${(profitP[100] * 100).toFixed(1)}%`);

// 构建新的分类系统
console.log('\n' + '='.repeat(100));
console.log('[构建优化分类系统]');
console.log('='.repeat(100));

const newSystem = {
  version: "2.0",
  description: "基于3024个早期参与者的优化分类",
  dimensions: {
    balance: {
      description: "钱包余额(BNB)",
      categories: [
        { name: "🏆 巨鲸", min: balanceP[95], emoji: "🏆" },  // Top 5%
        { name: "💰 大户", min: balanceP[75], max: balanceP[95], emoji: "💰" },  // 75-95%
        { name: "🐟 中户", min: balanceP[25], max: balanceP[75], emoji: "🐟" },  // 25-75%
        { name: "🐟 散户", min: 0.001, max: balanceP[25], emoji: "🐟" },  // 0-25%
        { name: "🪶 贫民", min: 0, max: 0.001, emoji: "🪶" }  // 0
      ]
    },
    trading: {
      description: "总交易次数",
      categories: [
        { name: "🎲 高频", min: tradesP[95], emoji: "🎲" },  // Top 5%
        { name: "⚡ 活跃", min: tradesP[75], max: tradesP[95], emoji: "⚡" },  // 75-95%
        { name: "🐌 中等", min: tradesP[25], max: tradesP[75], emoji: "🐌" },  // 25-75%
        { name: "🌱 低频", min: 1, max: tradesP[25], emoji: "🌱" },  // 1-25%
        { name: "👶 新手", min: 0, max: 1, emoji: "👶" }  // 0
      ]
    },
    age: {
      description: "钱包年龄(天)",
      categories: [
        { name: "🦅 老鸟", min: ageP[75], emoji: "🦅" },  // Top 25%
        { name: "🌿 中等", min: ageP[25], max: ageP[75], emoji: "🌿" },  // 25-75%
        { name: "🌱 新钱包", min: 0, max: ageP[25], emoji: "🌱" }  // 0-25%
      ]
    },
    profitability: {
      description: "盈利代币比例",
      categories: [
        { name: "🏆 赢家", min: 0.6, emoji: "🏆" },  // >= 60%
        { name: "🤔 中等", min: 0.4, max: 0.6, emoji: "🤔" },  // 40-60%
        { name: "📉 输家", min: 0, max: 0.4, emoji: "📉" }  // < 40%
      ]
    }
  },
  combo_categories: [
    {
      name: "🏆 巨鲸",
      rules: [{ dimension: "balance", category: "🏆 巨鲸" }],
      description: "余额Top 5%"
    },
    {
      name: "💰 大户",
      rules: [{ dimension: "balance", category: "💰 大户" }],
      description: "余额75-95%"
    },
    {
      name: "💎 聪明钱",
      rules: [
        { dimension: "balance", category: "💰 大户" },
        { dimension: "trading", category: "⚡ 活跃" },
        { dimension: "age", category: "🦅 老鸟" }
      ],
      description: "大户+活跃+老鸟"
    },
    {
      name: "🎲 高频玩家",
      rules: [{ dimension: "trading", category: "🎲 高频" }],
      description: "交易数Top 5%"
    },
    {
      name: "🤖 疑似机器人",
      rules: [
        { dimension: "trading", category: "🎲 高频" },
        { dimension: "age", category: "🌱 新钱包" }
      ],
      description: "高频但钱包新"
    },
    {
      name: "🌟 新星玩家",
      rules: [
        { dimension: "trading", category: "⚡ 活跃" },
        { dimension: "age", category: "🌱 新钱包" }
      ],
      description: "活跃但钱包新"
    },
    {
      name: "🦅 老鸟赢家",
      rules: [
        { dimension: "age", category: "🦅 老鸟" },
        { dimension: "profitability", category: "🏆 赢家" }
      ],
      description: "老钱包+高盈利"
    },
    {
      name: "🐟 散户",
      rules: [
        { dimension: "balance", category: "🐟 散户" },
        { dimension: "trading", category: "🐌 中等" }
      ],
      description: "低余额+中等交易"
    },
    {
      name: "🐟 普通玩家",
      rules: [],
      description: "其他所有钱包"
    }
  ]
};

console.log('\n新分类阈值:');
console.log(`  余额: 巨鲸 >${balanceP[95].toFixed(2)}, 大户 ${balanceP[75].toFixed(2)}-${balanceP[95].toFixed(2)}, 中户 ${balanceP[25].toFixed(2)}-${balanceP[75].toFixed(2)}, 散户 <${balanceP[25].toFixed(2)}`);
console.log(`  交易: 高频 >${tradesP[95]}, 活跃 ${tradesP[75]}-${tradesP[95]}, 中等 ${tradesP[25]}-${tradesP[75]}, 低频 <${tradesP[25]}`);
console.log(`  年龄: 老鸟 >${ageP[75]}天, 中等 ${ageP[25]}-${ageP[75]}天, 新钱包 <${ageP[25]}天`);
console.log(`  盈利: 赢家 >=60%, 中等 40-60%, 输家 <40%`);

// 测试新分类系统
console.log('\n' + '='.repeat(100));
console.log('[测试新分类系统]');
console.log('='.repeat(100));

function classifyWallet(wallet, system) {
  const balanceCat = system.dimensions.balance.categories.find(c => {
    if (c.max !== undefined && c.min !== undefined)
      return wallet.total_balance >= c.min && wallet.total_balance < c.max;
    else if (c.max !== undefined) return wallet.total_balance < c.max;
    else return wallet.total_balance >= c.min;
  });

  const tradingCat = system.dimensions.trading.categories.find(c => {
    if (c.max !== undefined && c.min !== undefined)
      return wallet.total_trades >= c.min && wallet.total_trades < c.max;
    else if (c.max !== undefined) return wallet.total_trades < c.max;
    else return wallet.total_trades >= c.min;
  });

  const ageCat = system.dimensions.age.categories.find(c => {
    if (c.max !== undefined && c.min !== undefined)
      return wallet.wallet_age_days >= c.min && wallet.wallet_age_days < c.max;
    else if (c.max !== undefined) return wallet.wallet_age_days < c.max;
    else return wallet.wallet_age_days >= c.min;
  });

  const profitRatio = wallet.total_tokens > 0 ? (wallet.profitable_tokens || 0) / wallet.total_tokens : 0;
  const profitCat = system.dimensions.profitability.categories.find(c => {
    if (c.max !== undefined && c.min !== undefined)
      return profitRatio >= c.min && profitRatio < c.max;
    else if (c.max !== undefined) return profitRatio < c.max;
    else return profitRatio >= c.min;
  });

  const combo = [];
  system.combo_categories.forEach(comboCat => {
    const match = comboCat.rules.every(rule => {
      if (rule.dimension === 'balance') return balanceCat && balanceCat.name === rule.category;
      else if (rule.dimension === 'trading') return tradingCat && tradingCat.name === rule.category;
      else if (rule.dimension === 'age') return ageCat && ageCat.name === rule.category;
      else if (rule.dimension === 'profitability') return profitCat && profitCat.name === rule.category;
      return false;
    });
    if (match) combo.push(comboCat);
  });

  return { balanceCat, tradingCat, ageCat, profitCat, combo };
}

// 统计分类结果
const categoryCounts = {};
existingWalletData.forEach(wallet => {
  const result = classifyWallet(wallet, newSystem);
  result.combo.forEach(cat => {
    categoryCounts[cat.name] = (categoryCounts[cat.name] || 0) + 1;
  });
  if (result.combo.length === 0) {
    categoryCounts['🐟 普通玩家'] = (categoryCounts['🐟 普通玩家'] || 0) + 1;
  }
});

console.log('\n分类结果分布:');
console.log('类别'.padEnd(22) + '数量'.padEnd(10) + '占比');
console.log('-'.repeat(50));
Object.entries(categoryCounts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([name, count]) => {
    console.log(`${name.padEnd(22)} ${count.toString().padEnd(10)} ${(count / existingWalletData.length * 100).toFixed(1)}%`);
  });

// 保存新分类系统
fs.writeFileSync(
  path.join(DATA_DIR, 'classification_system_v2.json'),
  JSON.stringify(newSystem, null, 2)
);

console.log('\n✅ 新分类系统已保存到: classification_system_v2.json');
