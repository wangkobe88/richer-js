/**
 * 统计3024个钱包的分类结果
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = '/Users/nobody1/Desktop/Codes/richer-js/scripts/experiment_505ac306_analysis';

// 加载数据
const walletData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'data/wallet_data_complete.json'), 'utf8'));
const system = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'data/classification_system_v3.json'), 'utf8'));

console.log('='.repeat(80));
console.log('3024个钱包分类统计');
console.log('='.repeat(80));

// 分类阈值
console.log('\n分类阈值:');
console.log(`  余额:`);
console.log(`    P25: ${system.thresholds.balance.p25.toFixed(0)} BNB`);
console.log(`    P75: ${system.thresholds.balance.p75.toFixed(0)} BNB`);
console.log(`    P95: ${system.thresholds.balance.p95.toFixed(0)} BNB`);
console.log(`  交易:`);
console.log(`    P25: ${system.thresholds.trades.p25}`);
console.log(`    P60: ${system.thresholds.trades.p60}`);
console.log(`    P75: ${system.thresholds.trades.p75}`);
console.log(`    P90: ${system.thresholds.trades.p90}`);
console.log(`  年龄:`);
console.log(`    P10: ${system.thresholds.age.p10} 天`);
console.log(`    P25: ${system.thresholds.age.p25} 天`);
console.log(`    P75: ${system.thresholds.age.p75} 天`);

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

    if (match) return combo.name;
  }

  return '🐟 普通玩家';
}

// 统计分类
const categoryStats = {};
const categoryDetails = {};

walletData.forEach(wallet => {
  const category = classifyWallet(wallet, system);

  if (!categoryStats[category]) {
    categoryStats[category] = 0;
    categoryDetails[category] = {
      balances: [],
      trades: [],
      ages: [],
      profitRatios: []
    };
  }

  categoryStats[category]++;
  categoryDetails[category].balances.push(wallet.total_balance || 0);
  categoryDetails[category].trades.push(wallet.total_trades || 0);
  categoryDetails[category].ages.push(wallet.wallet_age_days || 0);
  if (wallet.total_tokens > 0) {
    categoryDetails[category].profitRatios.push((wallet.profitable_tokens || 0) / wallet.total_tokens);
  }
});

// 输出结果
console.log('\n分类结果:');
console.log('-'.repeat(80));

const sortedCategories = Object.entries(categoryStats).sort((a, b) => b[1] - a[1]);

console.log('分类'.padEnd(20) + '数量'.padEnd(10) + '占比'.padEnd(10) + '平均余额'.padEnd(15) + '平均交易'.padEnd(10) + '平均年龄'.padEnd(10) + '平均盈利比');
console.log('-'.repeat(110));

sortedCategories.forEach(([name, count]) => {
  const details = categoryDetails[name];
  const avgBalance = details.balances.reduce((a, b) => a + b, 0) / details.balances.length;
  const avgTrades = details.trades.reduce((a, b) => a + b, 0) / details.trades.length;
  const avgAge = details.ages.reduce((a, b) => a + b, 0) / details.ages.length;
  const avgProfit = details.profitRatios.length > 0
    ? details.profitRatios.reduce((a, b) => a + b, 0) / details.profitRatios.length
    : 0;

  const ratio = (count / walletData.length * 100).toFixed(1);

  console.log(
    `${name.padEnd(20)} ${count.toString().padEnd(10)} ${ratio.padEnd(10)} ` +
    `${avgBalance.toFixed(0).padStart(12)} ${avgTrades.toFixed(0).padStart(8)} ` +
    `${avgAge.toFixed(0).padStart(8)}天 ${(avgProfit * 100).toFixed(1).padStart(6)}%`
  );
});

console.log('-'.repeat(110));
console.log(`总计: ${walletData.length} 个钱包`);
