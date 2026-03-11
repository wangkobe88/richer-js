/**
 * 使用v2数据（含钱包年龄）对比各代币的参与者分类分布
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = '/Users/nobody1/Desktop/Codes/richer-js/scripts/early-participants-analysis';

// 加载分类系统
const system = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'classification_system.json'), 'utf8'));

// 读取v2代币数据
function loadTokenData() {
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.match(/^token\d+_0x[a-f0-9]+_v2\.json$/))
    .sort();

  const tokenData = {};

  files.forEach(file => {
    const filePath = path.join(DATA_DIR, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    let wallets = [];
    let tokenAddress = '';

    if (data.wallets) {
      wallets = data.wallets;
      tokenAddress = data.tokenAddress;
    } else if (Array.isArray(data)) {
      wallets = data;
      const match = file.match(/0x[a-f0-9]+/);
      tokenAddress = match ? match[0] : file;
    }

    tokenData[tokenAddress] = {
      file,
      wallets,
      total_trades: data.totalTrades || 0,
      name: tokenAddress.slice(0, 10)
    };
  });

  return tokenData;
}

// 分类函数
function classifyWallet(wallet, system) {
  const results = [];

  // 基础分类
  const balanceCat = system.dimensions.balance.categories.find(c => {
    if (c.max !== undefined && c.min !== undefined) {
      return wallet.total_balance >= c.min && wallet.total_balance < c.max;
    } else if (c.max !== undefined) {
      return wallet.total_balance < c.max;
    } else {
      return wallet.total_balance >= c.min;
    }
  });

  const tradingCat = system.dimensions.trading.categories.find(c => {
    if (c.max !== undefined && c.min !== undefined) {
      return wallet.total_trades >= c.min && wallet.total_trades < c.max;
    } else if (c.max !== undefined) {
      return wallet.total_trades < c.max;
    } else {
      return wallet.total_trades >= c.min;
    }
  });

  const ageCat = system.dimensions.age.categories.find(c => {
    if (c.max !== undefined && c.min !== undefined) {
      return wallet.wallet_age_days >= c.min && wallet.wallet_age_days < c.max;
    } else if (c.max !== undefined) {
      return wallet.wallet_age_days < c.max;
    } else {
      return wallet.wallet_age_days >= c.min;
    }
  });

  const profitRatio = wallet.total_tokens > 0 ? (wallet.profitable_tokens || 0) / wallet.total_tokens : 0;
  const profitCat = system.dimensions.profitability.categories.find(c => {
    if (c.max !== undefined && c.min !== undefined) {
      return profitRatio >= c.min && profitRatio < c.max;
    } else if (c.max !== undefined) {
      return profitRatio < c.max;
    } else {
      return profitRatio >= c.min;
    }
  });

  // 检查组合分类
  system.combo_categories.forEach(combo => {
    const match = combo.rules.every(rule => {
      if (rule.dimension === 'balance') {
        return balanceCat && balanceCat.name === rule.category;
      } else if (rule.dimension === 'trading') {
        return tradingCat && tradingCat.name === rule.category;
      } else if (rule.dimension === 'age') {
        return ageCat && ageCat.name === rule.category;
      } else if (rule.dimension === 'profitability') {
        return profitCat && profitCat.name === rule.category;
      }
      return false;
    });

    if (match) {
      results.push(combo);
    }
  });

  return {
    basic: { balance: balanceCat?.name, trading: tradingCat?.name, age: ageCat?.name, profitability: profitCat?.name },
    combo: results
  };
}

// 统计分类分布
function getTokenDistribution(wallets, system) {
  const categoryCounts = {};
  const basicCounts = {
    balance: {},
    trading: {},
    age: {},
    profitability: {}
  };

  wallets.forEach(w => {
    const classification = classifyWallet(w, system);

    // 组合分类
    if (classification.combo.length > 0) {
      classification.combo.forEach(c => {
        categoryCounts[c.name] = (categoryCounts[c.name] || 0) + 1;
      });
    } else {
      categoryCounts['🐟 普通玩家'] = (categoryCounts['🐟 普通玩家'] || 0) + 1;
    }

    // 基础分类
    ['balance', 'trading', 'age', 'profitability'].forEach(dim => {
      const cat = classification.basic[dim];
      if (cat) {
        basicCounts[dim][cat] = (basicCounts[dim][cat] || 0) + 1;
      }
    });
  });

  return { categoryCounts, basicCounts };
}

// 主函数
function main() {
  console.log('='.repeat(100));
  console.log('各代币参与者分类分布对比 (使用含钱包年龄的v2数据)');
  console.log('='.repeat(100));

  const tokenData = loadTokenData();
  const tokens = Object.keys(tokenData);

  console.log(`\n共分析 ${tokens.length} 个代币 (v2数据)\n`);

  // 打印每个代币的分布
  tokens.forEach((tokenAddr, idx) => {
    const data = tokenData[tokenAddr];
    const { categoryCounts, basicCounts } = getTokenDistribution(data.wallets, system);

    console.log('─'.repeat(100));
    console.log(`代币${idx + 1}: ${data.name}... (${data.wallets.length}个钱包, ${data.total_trades}条交易)`);
    console.log('─'.repeat(100));

    // 组合分类分布
    console.log('\n[组合分类]');
    const sorted = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]);
    sorted.forEach(([name, count]) => {
      const pct = (count / data.wallets.length * 100).toFixed(1);
      console.log(`  ${name.padEnd(20)} ${count.toString().padStart(4)}个 (${pct.padStart(4)}%)`);
    });
  });

  // 汇总对比表
  console.log('\n' + '='.repeat(100));
  console.log('[汇总对比 - 组合分类占比(%) ]');
  console.log('='.repeat(100));

  const allCategories = ['🏆 巨鲸', '💎 聪明钱老鸟', '🤖 疑似机器人', '🎲 高频交易者', '🌟 新星玩家', '🦅 老鸟赢家', '💰 大户', '🐟 散户', '🐟 普通玩家'];

  // 表头
  console.log('\n' + '类别'.padEnd(22) + tokens.map((t, i) => `代币${i + 1}`.padEnd(10)).join(''));

  // 每个类别的占比
  allCategories.forEach(cat => {
    const row = [cat.padEnd(22)];
    tokens.forEach(tokenAddr => {
      const data = tokenData[tokenAddr];
      const { categoryCounts } = getTokenDistribution(data.wallets, system);
      const count = categoryCounts[cat] || 0;
      const pct = (count / data.wallets.length * 100).toFixed(1);
      row.push(`${pct}%`.padEnd(10));
    });
    console.log(row.join(''));
  });

  // 计算各代币的质量指标
  console.log('\n' + '='.repeat(100));
  console.log('[代币质量指标]');
  console.log('='.repeat(100));

  console.log('\n' + '指标'.padEnd(22) + tokens.map((t, i) => `代币${i + 1}`.padEnd(10)).join(''));

  const metrics = [
    { name: '巨鲸比例', key: '🏆 巨鲸' },
    { name: '聪明钱比例', key: '💎 聪明钱老鸟' },
    { name: '疑似机器人比例', key: '🤖 疑似机器人' },
    { name: '高频交易者比例', key: '🎲 高频交易者' },
    { name: '新星玩家比例', key: '🌟 新星玩家' },
    { name: '老鸟赢家比例', key: '🦅 老鸟赢家' },
    { name: '散户比例', key: '🐟 散户' }
  ];

  metrics.forEach(metric => {
    const row = [metric.name.padEnd(22)];
    tokens.forEach(tokenAddr => {
      const data = tokenData[tokenAddr];
      const { categoryCounts } = getTokenDistribution(data.wallets, system);
      const count = categoryCounts[metric.key] || 0;
      const pct = (count / data.wallets.length * 100).toFixed(1);
      row.push(`${pct}%`.padEnd(10));
    });
    console.log(row.join(''));
  });

  // 聚类分析
  console.log('\n' + '='.repeat(100));
  console.log('[代币特征聚类]');
  console.log('='.repeat(100));

  const tokenProfiles = tokens.map((tokenAddr, idx) => {
    const data = tokenData[tokenAddr];
    const { categoryCounts } = getTokenDistribution(data.wallets, system);
    return {
      token: tokenAddr,
      name: data.name,
      idx: idx + 1,
      wallets: data.wallets.length,
      trades: data.total_trades,
      whaleRatio: (categoryCounts['🏆 巨鲸'] || 0) / data.wallets.length,
      smartMoneyRatio: (categoryCounts['💎 聪明钱老鸟'] || 0) / data.wallets.length,
      botRatio: (categoryCounts['🤖 疑似机器人'] || 0) / data.wallets.length,
      hftRatio: (categoryCounts['🎲 高频交易者'] || 0) / data.wallets.length,
      newStarRatio: (categoryCounts['🌟 新星玩家'] || 0) / data.wallets.length,
      oldWinnerRatio: (categoryCounts['🦅 老鸟赢家'] || 0) / data.wallets.length,
      retailRatio: (categoryCounts['🐟 散户'] || 0) / data.wallets.length
    };
  });

  // 按不同维度排序
  console.log('\n按聪明钱比例排序:');
  const bySmartMoney = [...tokenProfiles].sort((a, b) => b.smartMoneyRatio - a.smartMoneyRatio);
  bySmartMoney.forEach(p => {
    console.log(`  ${p.idx}. 代币${p.idx} (${p.name}...) 聪明钱${(p.smartMoneyRatio * 100).toFixed(1)}% 巨鲸${(p.whaleRatio * 100).toFixed(1)}%`);
  });

  console.log('\n按疑似机器人比例排序:');
  const byBotRatio = [...tokenProfiles].sort((a, b) => b.botRatio - a.botRatio);
  byBotRatio.forEach(p => {
    console.log(`  ${p.idx}. 代币${p.idx} (${p.name}...) 机器人${(p.botRatio * 100).toFixed(1)}% 高频${(p.hftRatio * 100).toFixed(1)}%`);
  });

  console.log('\n按新星玩家比例排序:');
  const byNewStar = [...tokenProfiles].sort((a, b) => b.newStarRatio - a.newStarRatio);
  byNewStar.forEach(p => {
    console.log(`  ${p.idx}. 代币${p.idx} (${p.name}...) 新星${(p.newStarRatio * 100).toFixed(1)}% 老鸟赢家${(p.oldWinnerRatio * 100).toFixed(1)}%`);
  });

  console.log('\n按散户比例排序:');
  const byRetailRatio = [...tokenProfiles].sort((a, b) => b.retailRatio - a.retailRatio);
  byRetailRatio.forEach(p => {
    console.log(`  ${p.idx}. 代币${p.idx} (${p.name}...) 散户${(p.retailRatio * 100).toFixed(1)}% 钱包${p.wallets}个`);
  });

  // 综合评分
  console.log('\n' + '='.repeat(100));
  console.log('[综合质量评分]');
  console.log('='.repeat(100));
  console.log('评分规则: 聪明钱×3 + 老鸟赢家×2 + 新星玩家×1 - 机器人×2 - 散户×0.5');

  tokenProfiles.forEach(p => {
    const score = p.smartMoneyRatio * 3 + p.oldWinnerRatio * 2 + p.newStarRatio * 1 - p.botRatio * 2 - p.retailRatio * 0.5;
    console.log(`  代币${p.idx} (${p.name}...): ${(score * 100).toFixed(1)}分`);
  });

  console.log('\n' + '='.repeat(100));
}

main();
