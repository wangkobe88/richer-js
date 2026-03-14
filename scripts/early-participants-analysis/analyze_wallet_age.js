/**
 * 分析钱包年龄维度的数据分布
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = __dirname;

// 读取所有代币数据
function loadAllTokenData() {
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.match(/^token\d+_0x[a-f0-9]+.*\.json$/) && !f.includes('classification'))
    .sort();

  const allData = [];
  const tokenStats = {};

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

    // 过滤有效年龄数据
    const validWallets = wallets.filter(w => w.wallet_age_days !== undefined && w.wallet_age_days > 0);

    tokenStats[tokenAddress] = {
      file,
      tokenAddress,
      totalWallets: wallets.length,
      validWallets: validWallets.length,
      wallets: validWallets
    };

    validWallets.forEach(w => {
      allData.push({
        ...w,
        token: tokenAddress,
        token_file: file
      });
    });
  });

  return { allData, tokenStats };
}

// 计算分位数
function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * p / 100);
  return sorted[idx];
}

// 钱包年龄分类
function getAgeCategory(days) {
  if (days < 7) return { name: '新钱包(<7天)', group: 'new' };
  if (days < 30) return { name: '较新(7-30天)', group: 'recent' };
  if (days < 90) return { name: '1-3个月', group: 'mature' };
  if (days < 180) return { name: '3-6个月', group: 'old' };
  return { name: '老钱包(>6个月)', group: 'very_old' };
}

// 分析钱包年龄与其他维度的关系
function main() {
  const { allData, tokenStats } = loadAllTokenData();

  const ages = allData.map(w => w.wallet_age_days);

  console.log('='.repeat(80));
  console.log('钱包年龄维度分析');
  console.log('='.repeat(80));
  console.log(`\n总钱包数: ${allData.length}`);
  console.log(`代币数量: ${Object.keys(tokenStats).length}`);

  // ========== 1. 基础统计 ==========
  console.log('\n' + '─'.repeat(80));
  console.log('[1] 基础统计');
  console.log('─'.repeat(80));

  ages.sort((a, b) => a - b);

  console.log(`年龄范围: ${ages[0]}天 ~ ${ages[ages.length - 1]}天`);
  console.log(`年龄中位数: ${ages[Math.floor(ages.length / 2)]}天`);
  console.log(`年龄平均值: ${(ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(1)}天`);

  console.log('\n分位数:');
  console.log(`  P5:  ${percentile(ages, 5)}天`);
  console.log(`  P10: ${percentile(ages, 10)}天`);
  console.log(`  P25: ${percentile(ages, 25)}天`);
  console.log(`  P50: ${percentile(ages, 50)}天`);
  console.log(`  P75: ${percentile(ages, 75)}天`);
  console.log(`  P90: ${percentile(ages, 90)}天`);
  console.log(`  P95: ${percentile(ages, 95)}天`);

  // ========== 2. 年龄分布 ==========
  console.log('\n' + '─'.repeat(80));
  console.log('[2] 年龄分组分布');
  console.log('─'.repeat(80));

  const ageGroups = {
    '新钱包(<7天)': 0,
    '较新(7-30天)': 0,
    '1-3个月': 0,
    '3-6个月': 0,
    '老钱包(>6个月)': 0
  };

  allData.forEach(w => {
    const cat = getAgeCategory(w.wallet_age_days);
    ageGroups[cat.name]++;
  });

  Object.entries(ageGroups).forEach(([name, count]) => {
    const pct = (count / allData.length * 100).toFixed(1);
    const bar = '█'.repeat(Math.floor(count / allData.length * 50));
    console.log(`  ${name.padEnd(18)} ${count.toString().padStart(4)} (${pct.padStart(4)}%) ${bar}`);
  });

  // ========== 3. 年龄与盈利能力关系 ==========
  console.log('\n' + '─'.repeat(80));
  console.log('[3] 年龄与盈利能力关系');
  console.log('─'.repeat(80));

  const ageByProfit = {
    'new': { profitable: 0, total: 0, avgProfit: 0 },
    'recent': { profitable: 0, total: 0, avgProfit: 0 },
    'mature': { profitable: 0, total: 0, avgProfit: 0 },
    'old': { profitable: 0, total: 0, avgProfit: 0 },
    'very_old': { profitable: 0, total: 0, avgProfit: 0 }
  };

  const profitsByGroup = {
    'new': [],
    'recent': [],
    'mature': [],
    'old': [],
    'very_old': []
  };

  allData.forEach(w => {
    const cat = getAgeCategory(w.wallet_age_days);
    const group = ageByProfit[cat.group];
    group.total++;

    const profit = w.total_all_profit || 0;
    profitsByGroup[cat.group].push(profit);

    if (profit > 0) {
      group.profitable++;
    }
  });

  console.log('\n' + '年龄分组'.padEnd(18) + '钱包数'.padEnd(10) + '盈利钱包数'.padEnd(12) + '盈利占比'.padEnd(10) + '平均盈利');
  console.log('─'.repeat(80));

  Object.entries(ageByProfit).forEach(([group, data]) => {
    if (data.total === 0) return;

    const profitRatio = (data.profitable / data.total * 100).toFixed(1);
    const profits = profitsByGroup[group];
    const avgProfit = (profits.reduce((a, b) => a + b, 0) / profits.length).toFixed(2);

    const groupName = {
      'new': '新钱包(<7天)',
      'recent': '较新(7-30天)',
      'mature': '1-3个月',
      'old': '3-6个月',
      'very_old': '老钱包(>6个月)'
    }[group];

    console.log(`${groupName.padEnd(18)}${data.total.toString().padStart(6)}${data.profitable.toString().padStart(12)}${profitRatio.padStart(10)}%  $${avgProfit}`);
  });

  // ========== 4. 年龄与交易活跃度关系 ==========
  console.log('\n' + '─'.repeat(80));
  console.log('[4] 年龄与交易活跃度关系');
  console.log('─'.repeat(80));

  const tradesByGroup = {
    'new': [],
    'recent': [],
    'mature': [],
    'old': [],
    'very_old': []
  };

  allData.forEach(w => {
    const cat = getAgeCategory(w.wallet_age_days);
    tradesByGroup[cat.group].push(w.total_trades || 0);
  });

  console.log('\n' + '年龄分组'.padEnd(18) + '平均交易次数'.padEnd(14) + '中位数交易次数'.padEnd(16) + '高频钱包占比(>500次)');
  console.log('─'.repeat(80));

  Object.entries(tradesByGroup).forEach(([group, trades]) => {
    if (trades.length === 0) return;

    trades.sort((a, b) => a - b);
    const avgTrades = (trades.reduce((a, b) => a + b, 0) / trades.length).toFixed(0);
    const medianTrades = trades[Math.floor(trades.length / 2)];
    const highFreqRatio = (trades.filter(t => t > 500).length / trades.length * 100).toFixed(1);

    const groupName = {
      'new': '新钱包(<7天)',
      'recent': '较新(7-30天)',
      'mature': '1-3个月',
      'old': '3-6个月',
      'very_old': '老钱包(>6个月)'
    }[group];

    console.log(`${groupName.padEnd(18)}${avgTrades.padStart(10)}${medianTrades.toString().padStart(16)}${highFreqRatio.padStart(12)}%`);
  });

  // ========== 5. 年龄与持仓规模关系 ==========
  console.log('\n' + '─'.repeat(80));
  console.log('[5] 年龄与持仓规模关系');
  console.log('─'.repeat(80));

  const balanceByGroup = {
    'new': [],
    'recent': [],
    'mature': [],
    'old': [],
    'very_old': []
  };

  allData.forEach(w => {
    const cat = getAgeCategory(w.wallet_age_days);
    balanceByGroup[cat.group].push(w.total_balance || 0);
  });

  console.log('\n' + '年龄分组'.padEnd(18) + '平均持仓'.padEnd(16) + '中位数持仓'.padEnd(16) + '大户占比(>$10k)');
  console.log('─'.repeat(80));

  Object.entries(balanceByGroup).forEach(([group, balances]) => {
    if (balances.length === 0) return;

    balances.sort((a, b) => a - b);
    const avgBal = (balances.reduce((a, b) => a + b, 0) / balances.length).toFixed(2);
    const medianBal = balances[Math.floor(balances.length / 2)].toFixed(2);
    const largeRatio = (balances.filter(b => b > 10000).length / balances.length * 100).toFixed(1);

    const groupName = {
      'new': '新钱包(<7天)',
      'recent': '较新(7-30天)',
      'mature': '1-3个月',
      'old': '3-6个月',
      'very_old': '老钱包(>6个月)'
    }[group];

    console.log(`${groupName.padEnd(18)}$${avgBal.padStart(10)} $${medianBal.padStart(14)}${largeRatio.padStart(10)}%`);
  });

  // ========== 6. 各代币的年龄分布对比 ==========
  console.log('\n' + '─'.repeat(80));
  console.log('[6] 各代币钱包年龄分布对比');
  console.log('─'.repeat(80));

  const tokens = Object.values(tokenStats);
  tokens.forEach((token, idx) => {
    const ages = token.wallets.map(w => w.wallet_age_days);
    ages.sort((a, b) => a - b);

    const avgAge = (ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(1);
    const medianAge = ages[Math.floor(ages.length / 2)];
    const newWalletRatio = (ages.filter(a => a < 7).length / ages.length * 100).toFixed(1);
    const oldWalletRatio = (ages.filter(a => a > 180).length / ages.length * 100).toFixed(1);

    console.log(`\n代币${idx + 1}: ${token.tokenAddress.slice(0, 12)}... (${token.validWallets}/${token.totalWallets}有效)`);
    console.log(`  平均年龄: ${avgAge}天, 中位数: ${medianAge}天`);
    console.log(`  新钱包(<7天): ${newWalletRatio}%, 老钱包(>6个月): ${oldWalletRatio}%`);
  });

  // ========== 7. 典型钱包示例 ==========
  console.log('\n' + '─'.repeat(80));
  console.log('[7] 各年龄组典型钱包示例');
  console.log('─'.repeat(80));

  const samplesByGroup = {
    'new': [],
    'recent': [],
    'mature': [],
    'old': [],
    'very_old': []
  };

  allData.forEach(w => {
    const cat = getAgeCategory(w.wallet_age_days);
    if (samplesByGroup[cat.group].length < 3) {
      samplesByGroup[cat.group].push(w);
    }
  });

  Object.entries(samplesByGroup).forEach(([group, wallets]) => {
    if (wallets.length === 0) return;

    const groupName = {
      'new': '新钱包(<7天)',
      'recent': '较新(7-30天)',
      'mature': '1-3个月',
      'old': '3-6个月',
      'very_old': '老钱包(>6个月)'
    }[group];

    console.log(`\n【${groupName}】`);
    wallets.forEach(w => {
      console.log(`  ${w.address.slice(0, 12)}... | 年龄: ${w.wallet_age_days}天 | 持仓: $${(w.total_balance || 0).toFixed(0)} | 交易: ${w.total_trades}次 | 盈利: $${(w.total_all_profit || 0).toFixed(0)}`);
    });
  });

  console.log('\n' + '='.repeat(80));
}

main();
