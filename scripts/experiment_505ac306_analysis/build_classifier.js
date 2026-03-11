/**
 * 构建分类规则 - 区分高收益和低收益代币
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = '/Users/nobody1/Desktop/Codes/richer-js/scripts/experiment_505ac306_analysis';
const analysisResults = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'analysis_results.json'), 'utf8'));

// 按收益率排序
const sortedTokens = [...analysisResults.token_analysis]
  .sort((a, b) => b.profit_percent - a.profit_percent);

const top10 = sortedTokens.slice(0, 10);
const bottom15 = sortedTokens.slice(-15);

console.log('='.repeat(100));
console.log('构建分类规则');
console.log('='.repeat(100));

console.log('\n[高收益组 Top 10]');
top10.forEach((t, i) => {
  console.log(`  ${i + 1}. ${t.token_symbol.padEnd(15)} ${t.profit_percent.toFixed(1).padStart(7)}% | 聪明钱:${(t.category_counts['💎 聪明钱老鸟'] || 0)} 机器人:${(t.category_counts['🤖 疑似机器人'] || 0)} 巨鲸:${(t.category_counts['🏆 巨鲸'] || 0)} 新星:${(t.category_counts['🌟 新星玩家'] || 0)} 散户:${(t.category_counts['🐟 散户'] || 0)}/${t.participant_count}`);
});

console.log('\n[低收益组 Bottom 15]');
bottom15.forEach((t, i) => {
  console.log(`  ${i + 1}. ${t.token_symbol.padEnd(15)} ${t.profit_percent.toFixed(1).padStart(7)}% | 聪明钱:${(t.category_counts['💎 聪明钱老鸟'] || 0)} 机器人:${(t.category_counts['🤖 疑似机器人'] || 0)} 巨鲸:${(t.category_counts['🏆 巨鲸'] || 0)} 新星:${(t.category_counts['🌟 新星玩家'] || 0)} 散户:${(t.category_counts['🐟 散户'] || 0)}/${t.participant_count}`);
});

// 计算各类别的平均比例
const categories = ['💎 聪明钱老鸟', '🤖 疑似机器人', '🏆 巨鲸', '🌟 新星玩家', '🦅 老鸟赢家', '💰 大户', '🎲 高频交易者', '🐟 散户', '🐟 普通玩家'];

function calcGroupStats(tokens) {
  const stats = {};
  categories.forEach(cat => {
    const ratios = tokens.map(t => (t.category_counts[cat] || 0) / t.participant_count);
    stats[cat] = {
      avg: ratios.reduce((a, b) => a + b, 0) / ratios.length,
      min: Math.min(...ratios),
      max: Math.max(...ratios)
    };
  });
  return stats;
}

const topStats = calcGroupStats(top10);
const bottomStats = calcGroupStats(bottom15);

console.log('\n' + '='.repeat(100));
console.log('[类别比例对比 (平均值)]');
console.log('='.repeat(100));
console.log('类别'.padEnd(18) + '高收益组'.padEnd(15) + '低收益组'.padEnd(15) + '差异');
console.log('-'.repeat(100));

categories.forEach(cat => {
  const topAvg = (topStats[cat].avg * 100).toFixed(1) + '%';
  const bottomAvg = (bottomStats[cat].avg * 100).toFixed(1) + '%';
  const diff = ((topStats[cat].avg - bottomStats[cat].avg) * 100).toFixed(1) + '%';
  const arrow = parseFloat(diff) > 0 ? '↑' : '↓';
  console.log(`${cat.padEnd(18)} ${topAvg.padEnd(15)} ${bottomAvg.padEnd(15)} ${arrow} ${diff}`);
});

// 寻找最佳分割点
console.log('\n' + '='.repeat(100));
console.log('[寻找最佳分类规则]');
console.log('='.repeat(100));

const rules = [];

// 测试各种阈值组合
const testRules = [
  { name: '散户比例 < 40%', test: t => ((t.category_counts['🐟 散户'] || 0) / t.participant_count) < 0.4 },
  { name: '散户比例 < 35%', test: t => ((t.category_counts['🐟 散户'] || 0) / t.participant_count) < 0.35 },
  { name: '散户比例 < 30%', test: t => ((t.category_counts['🐟 散户'] || 0) / t.participant_count) < 0.3 },
  { name: '新星玩家比例 > 20%', test: t => ((t.category_counts['🌟 新星玩家'] || 0) / t.participant_count) > 0.2 },
  { name: '巨鲸比例 > 10%', test: t => ((t.category_counts['🏆 巨鲸'] || 0) / t.participant_count) > 0.1 },
  { name: '散户+普通玩家 < 50%', test: t => (((t.category_counts['🐟 散户'] || 0) + (t.category_counts['🐟 普通玩家'] || 0)) / t.participant_count) < 0.5 },
  { name: '散户 < 35% 且 新星玩家 > 20%', test: t => ((t.category_counts['🐟 散户'] || 0) / t.participant_count) < 0.35 && ((t.category_counts['🌟 新星玩家'] || 0) / t.participant_count) > 0.2 },
  { name: '散户 < 30% 或 巨鲸 > 10%', test: t => ((t.category_counts['🐟 散户'] || 0) / t.participant_count) < 0.3 || ((t.category_counts['🏆 巨鲸'] || 0) / t.participant_count) > 0.1 },
  { name: '高频交易者 < 30%', test: t => ((t.category_counts['🎲 高频交易者'] || 0) / t.participant_count) < 0.3 },
  { name: '聪明钱 > 2% 且 散户 < 35%', test: t => ((t.category_counts['💎 聪明钱老鸟'] || 0) / t.participant_count) > 0.02 && ((t.category_counts['🐟 散户'] || 0) / t.participant_count) < 0.35 },
];

testRules.forEach(rule => {
  const topPassed = top10.filter(rule.test).length;
  const bottomPassed = bottom15.filter(rule.test).length;

  // 准确率：高收益组通过率 + 低收益组拒绝率
  const precision = (topPassed / 10 + (15 - bottomPassed) / 15) / 2;

  rules.push({
    name: rule.name,
    topPassed,
    bottomPassed,
    precision: precision.toFixed(3)
  });
});

// 按准确率排序
rules.sort((a, b) => b.precision - a.precision);

console.log('\n规则'.padEnd(40) + '高收益命中'.padEnd(12) + '低收益命中'.padEnd(12) + '准确率');
console.log('-'.repeat(100));
rules.forEach(r => {
  console.log(`${r.name.padEnd(40)} ${r.topPassed}/10`.padEnd(12) + `${r.bottomPassed}/15`.padEnd(12) + r.precision);
});

// 输出最佳规则
console.log('\n' + '='.repeat(100));
console.log('[最佳规则]');
console.log('='.repeat(100));
const bestRule = rules[0];
console.log(`规则: ${bestRule.name}`);
console.log(`准确率: ${bestRule.precision}`);
console.log(`  高收益组命中: ${bestRule.topPassed}/10`);
console.log(`  低收益组命中: ${bestRule.bottomPassed}/15`);

// 详细展示最佳规则的分类结果
console.log('\n' + '='.repeat(100));
console.log(`[规则 "${bestRule.name}" 分类结果]`);
console.log('='.repeat(100));

const bestTest = testRules.find(r => r.name === bestRule.name);

console.log('\n高收益组 (应该被识别为高收益):');
top10.forEach((t, i) => {
  const pass = bestTest.test(t) ? '✓' : '✗';
  console.log(`  ${pass} ${i + 1}. ${t.token_symbol.padEnd(15)} ${t.profit_percent.toFixed(1).padStart(7)}%`);
});

console.log('\n低收益组 (应该被识别为低收益):');
bottom15.forEach((t, i) => {
  const pass = bestTest.test(t) ? '✗ (误判)' : '✓';
  console.log(`  ${pass} ${i + 1}. ${t.token_symbol.padEnd(15)} ${t.profit_percent.toFixed(1).padStart(7)}%`);
});

// 构建复合规则
console.log('\n' + '='.repeat(100));
console.log('[构建决策树规则]');
console.log('='.repeat(100));

// 寻找最优决策树
function findBestSplit(tokens, categories) {
  let bestSplit = null;
  let bestGini = 1;

  categories.forEach(cat => {
    const ratios = tokens.map(t => ({ token: t, ratio: (t.category_counts[cat] || 0) / t.participant_count }));
    ratios.sort((a, b) => a.ratio - b.ratio);

    // 尝试每个可能的分割点
    for (let i = 1; i < ratios.length; i++) {
      const threshold = (ratios[i - 1].ratio + ratios[i].ratio) / 2;
      const leftGroup = ratios.slice(0, i).map(r => r.token);
      const rightGroup = ratios.slice(i).map(r => r.token);

      const leftHigh = leftGroup.filter(t => t.profit_percent > 0).length;
      const rightHigh = rightGroup.filter(t => t.profit_percent > 0).length;

      const gini = 1 - Math.pow(leftHigh / leftGroup.length, 2) - Math.pow((leftGroup.length - leftHigh) / leftGroup.length, 2);

      if (gini < bestGini) {
        bestGini = gini;
        bestSplit = { category: cat, threshold, leftGroup, rightGroup, gini };
      }
    }
  });

  return bestSplit;
}

// 计算分类评估指标
console.log('\n' + '='.repeat(100));
console.log('[综合评估: Top3 规则组合]');
console.log('='.repeat(100));

const top3Rules = rules.slice(0, 3);

top3Rules.forEach((rule, idx) => {
  const testFunc = testRules.find(r => r.name === rule.name).test;

  const truePositive = top10.filter(testFunc).length;  // 高收益被识别为高收益
  const falseNegative = 10 - truePositive;             // 高收益被识别为低收益
  const falsePositive = bottom15.filter(testFunc).length; // 低收益被识别为高收益
  const trueNegative = 15 - falsePositive;             // 低收益被识别为低收益

  const accuracy = (truePositive + trueNegative) / 25;
  const precision_top = truePositive / (truePositive + falsePositive) || 0;
  const recall_top = truePositive / 10;

  console.log(`\n规则 ${idx + 1}: ${rule.name}`);
  console.log(`  准确率: ${(accuracy * 100).toFixed(1)}%`);
  console.log(`  高收益识别率: ${(recall_top * 100).toFixed(1)}% (${truePositive}/10)`);
  console.log(`  低收益识别率: ${((trueNegative / 15) * 100).toFixed(1)}% (${trueNegative}/15)`);
});
