/**
 * 基于观察到的数据分布，对早期参与者进行分类
 */

const fs = require('fs');
const walletData = JSON.parse(fs.readFileSync('/tmp/early_participants_raw.json', 'utf8'));

console.log('='.repeat(70));
console.log('代币早期参与者分类体系设计');
console.log('='.repeat(70));

// 根据数据分布观察到的关键特征：
// 1. 持仓极度不均：最大$9.7亿，中位数$3363，需要用对数尺度
// 2. 交易活跃：中位数1095次
// 3. AVE API盈亏数据不完整，但有盈利代币数/总代币数可用

// 设计分类体系

console.log('\n[分类维度设计]');
console.log('基于数据分布，采用以下维度:');
console.log('');
console.log('维度1: 持仓规模 (对数)');
console.log('  - 超巨鲸: log(持仓) > 18 (>$10M)   ', walletData.filter(w => Math.log10(w.total_balance + 1) > 18).length, '个');
console.log('  - 巨鲸: 16 < log(持仓) <= 18 ($100k-$10M)', walletData.filter(w => Math.log10(w.total_balance + 1) > 16 && Math.log10(w.total_balance + 1) <= 18).length, '个');
console.log('  - 大户: 14 < log(持仓) <= 16 ($10k-$100k) ', walletData.filter(w => Math.log10(w.total_balance + 1) > 14 && Math.log10(w.total_balance + 1) <= 16).length, '个');
console.log('  - 中户: 12 < log(持仓) <= 14 ($1k-$10k)   ', walletData.filter(w => Math.log10(w.total_balance + 1) > 12 && Math.log10(w.total_balance + 1) <= 14).length, '个');
console.log('  - 散户: log(持仓) <= 12 ( <$1k)          ', walletData.filter(w => Math.log10(w.total_balance + 1) <= 12).length, '个');
console.log('');
console.log('维度2: 交易活跃度');
console.log('  - 超高频: >2000次  ', walletData.filter(w => w.total_trades > 2000).length, '个');
console.log('  - 高频: 1000-2000次', walletData.filter(w => w.total_trades > 1000 && w.total_trades <= 2000).length, '个');
console.log('  - 中频: 500-1000次 ', walletData.filter(w => w.total_trades > 500 && w.total_trades <= 1000).length, '个');
console.log('  - 低频: <=500次    ', walletData.filter(w => w.total_trades <= 500).length, '个');
console.log('');
console.log('维度3: 持仓多样性 (总代币数)');
console.log('  - 高分散: >95个    ', walletData.filter(w => w.total_tokens > 95).length, '个');
console.log('  - 中分散: 50-95个  ', walletData.filter(w => w.total_tokens > 50 && w.total_tokens <= 95).length, '个');
console.log('  - 低分散: <=50个   ', walletData.filter(w => w.total_tokens <= 50).length, '个');
console.log('');
console.log('维度4: 盈利代币占比 (盈利代币/总代币)');
const profitRatio = walletData.map(w => w.total_tokens > 0 ? w.profitable_tokens / w.total_tokens : 0);
console.log('  - 高胜率: >50%     ', walletData.filter(w => w.total_tokens > 0 && w.profitable_tokens / w.total_tokens > 0.5).length, '个');
console.log('  - 中胜率: 30-50%   ', walletData.filter(w => w.total_tokens > 0 && w.profitable_tokens / w.total_tokens > 0.3 && w.profitable_tokens / w.total_tokens <= 0.5).length, '个');
console.log('  - 低胜率: <30%     ', walletData.filter(w => w.total_tokens > 0 && w.profitable_tokens / w.total_tokens <= 0.3).length, '个');

// 组合分类
console.log('\n' + '='.repeat(70));
console.log('[组合分类结果]');
console.log('='.repeat(70));

function getBalanceCategory(w) {
  const logBal = Math.log10(w.total_balance + 1);
  if (logBal > 18) return '超巨鲸';
  if (logBal > 16) return '巨鲸';
  if (logBal > 14) return '大户';
  if (logBal > 12) return '中户';
  return '散户';
}

function getTradeCategory(w) {
  if (w.total_trades > 2000) return '超高频';
  if (w.total_trades > 1000) return '高频';
  if (w.total_trades > 500) return '中频';
  return '低频';
}

function getDiversificationCategory(w) {
  if (w.total_tokens > 95) return '高分散';
  if (w.total_tokens > 50) return '中分散';
  return '低分散';
}

function getProfitRatioCategory(w) {
  if (w.total_tokens === 0) return '未知';
  const ratio = w.profitable_tokens / w.total_tokens;
  if (ratio > 0.5) return '高胜率';
  if (ratio > 0.3) return '中胜率';
  return '低胜率';
}

// 为每个钱包分配类别
const categories = {};

walletData.forEach(w => {
  const balance = getBalanceCategory(w);
  const trade = getTradeCategory(w);
  const div = getDiversificationCategory(w);
  const profit = getProfitRatioCategory(w);

  const key = `${balance}|${trade}|${div}|${profit}`;
  if (!categories[key]) {
    categories[key] = {
      name: `${balance}${trade}${div}${profit}`,
      count: 0,
      wallets: []
    };
  }
  categories[key].count++;
  categories[key].wallets.push(w);
});

// 按数量排序
const sortedCategories = Object.entries(categories).sort((a, b) => b[1].count - a[1].count);

console.log('\n所有组合类别 (按数量排序):');
console.log('-'.repeat(70));
sortedCategories.slice(0, 20).forEach(([key, cat], i) => {
  const pct = (cat.count / walletData.length * 100).toFixed(1);
  console.log(`${i + 1}. [${cat.count}个, ${pct}%] ${cat.name}`);
});

// 简化分类 - 主要类别
console.log('\n' + '='.repeat(70));
console.log('[简化分类 - 主要类型]');
console.log('='.repeat(70));

const mainCategories = {
  '🏆 巨鲸交易员': [], // 持仓>$100k 且 交易>1000次
  '💰 大户玩家': [], // 持仓>$10k 且 交易>500次
  '🎲 高频散户': [], // 持仓<$1k 且 交易>1000次
  '🐟 普通散户': [], // 持仓<$1k 且 交易<500次
  '📈 分散投资者': [], // 持仓>$1k 且 代币数>95
  '💎 专注玩家': [], // 持仓>$1k 且 代币数<50
  '🎯 高胜率玩家': [], // 盈利代币占比>50%
  '📉 低胜率玩家': [], // 盈利代币占比<30%
};

walletData.forEach(w => {
  const logBal = Math.log10(w.total_balance + 1);

  if (logBal > 16 && w.total_trades > 1000) {
    mainCategories['🏆 巨鲸交易员'].push(w);
  }
  if (logBal > 14 && w.total_trades > 500) {
    mainCategories['💰 大户玩家'].push(w);
  }
  if (logBal <= 12 && w.total_trades > 1000) {
    mainCategories['🎲 高频散户'].push(w);
  }
  if (logBal <= 12 && w.total_trades <= 500) {
    mainCategories['🐟 普通散户'].push(w);
  }
  if (logBal > 12 && w.total_tokens > 95) {
    mainCategories['📈 分散投资者'].push(w);
  }
  if (logBal > 12 && w.total_tokens <= 50) {
    mainCategories['💎 专注玩家'].push(w);
  }
  if (w.total_tokens > 0 && w.profitable_tokens / w.total_tokens > 0.5) {
    mainCategories['🎯 高胜率玩家'].push(w);
  }
  if (w.total_tokens > 0 && w.profitable_tokens / w.total_tokens <= 0.3) {
    mainCategories['📉 低胜率玩家'].push(w);
  }
});

Object.entries(mainCategories).forEach(([name, wallets]) => {
  const pct = (wallets.length / walletData.length * 100).toFixed(1);
  const avgBal = wallets.length > 0 ? (wallets.reduce((s, w) => s + w.total_balance, 0) / wallets.length).toFixed(0) : 0;
  const avgTrades = wallets.length > 0 ? (wallets.reduce((s, w) => s + w.total_trades, 0) / wallets.length).toFixed(0) : 0;

  console.log(`\n${name}: ${wallets.length}个 (${pct}%)`);
  console.log(`  平均持仓: $${avgBal}, 平均交易: ${avgTrades}次`);

  if (wallets.length > 0 && wallets.length <= 10) {
    console.log(`  代表钱包:`);
    wallets.slice(0, 5).forEach(w => {
      console.log(`    ${w.address.slice(0, 10)}... 持仓$${w.total_balance.toFixed(0)} 交易${w.total_trades}次`);
    });
  }
});

// 保存分类结果
const classificationResult = {
  tokenAddress: '0x30d31d1b0d4f1fb82e17f858497a523fb0dd4444',
  chain: 'bsc',
  timeWindowMinutes: 3,
  totalParticipants: walletData.length,
  timestamp: new Date().toISOString(),
  categories: sortedCategories.map(([key, cat]) => ({
    name: cat.name,
    count: cat.count,
    percentage: (cat.count / walletData.length * 100).toFixed(1) + '%'
  })),
  mainCategories: Object.fromEntries(
    Object.entries(mainCategories).map(([name, wallets]) => [
      name,
      {
        count: wallets.length,
        percentage: (wallets.length / walletData.length * 100).toFixed(1) + '%',
        avgBalance: wallets.length > 0 ? (wallets.reduce((s, w) => s + w.total_balance, 0) / wallets.length).toFixed(2) : 0,
        avgTrades: wallets.length > 0 ? (wallets.reduce((s, w) => s + w.total_trades, 0) / wallets.length).toFixed(0) : 0,
        sampleWallets: wallets.slice(0, 10).map(w => ({
          address: w.address,
          balance: w.total_balance,
          trades: w.total_trades,
          tokens: w.total_tokens,
          profitableRatio: w.total_tokens > 0 ? (w.profitable_tokens / w.total_tokens * 100).toFixed(1) + '%' : 'N/A'
        }))
      }
    ])
  )
};

fs.writeFileSync('/tmp/early_participants_classification.json', JSON.stringify(classificationResult, null, 2));
console.log('\n分类结果已保存到: /tmp/early_participants_classification.json');

console.log('\n' + '='.repeat(70));
console.log('分析完成！');
console.log('='.repeat(70));
