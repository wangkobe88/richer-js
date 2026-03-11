/**
 * 基于完整57个代币数据构建分类规则
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = '/Users/nobody1/Desktop/Codes/richer-js/scripts/experiment_505ac306_analysis';
const analysisResults = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'final_analysis_results_v2.json'), 'utf8'));

// 按收益率排序
const sortedTokens = [...analysisResults.token_analysis]
  .filter(t => t.profit_percent !== null)
  .sort((a, b) => b.profit_percent - a.profit_percent);

console.log(`总代币数: ${sortedTokens.length}`);
console.log('\n' + '='.repeat(110));

// 取高收益组和低收益组
const topN = Math.floor(sortedTokens.length / 2);
const highProfitGroup = sortedTokens.slice(0, topN);
const lowProfitGroup = sortedTokens.slice(topN);

console.log(`高收益组(Top ${topN}):`);
highProfitGroup.forEach((t, i) => {
  const retail = ((t.category_counts['🐟 散户'] || 0) / t.participant_count * 100).toFixed(0);
  const newStar = ((t.category_counts['🌟 新星玩家'] || 0) / t.participant_count * 100).toFixed(0);
  const whale = ((t.category_counts['🏆 巨鲸'] || 0) / t.participant_count * 100).toFixed(0);
  const smart = ((t.category_counts['💎 聪明钱老鸟'] || 0) / t.participant_count * 100).toFixed(0);
  console.log(`  ${i + 1}. ${t.token_symbol.padEnd(15)} ${t.profit_percent.toFixed(1).padStart(7)}% | 散:${retail}% 新:${newStar}% 巨:${whale}% 聪:${smart}%`);
});

console.log(`\n低收益组(Bottom ${sortedTokens.length - topN}):`);
lowProfitGroup.forEach((t, i) => {
  const retail = ((t.category_counts['🐟 散户'] || 0) / t.participant_count * 100).toFixed(0);
  const newStar = ((t.category_counts['🌟 新星玩家'] || 0) / t.participant_count * 100).toFixed(0);
  const whale = ((t.category_counts['🏆 巨鲸'] || 0) / t.participant_count * 100).toFixed(0);
  const smart = ((t.category_counts['💎 聪明钱老鸟'] || 0) / t.participant_count * 100).toFixed(0);
  console.log(`  ${i + 1}. ${t.token_symbol.padEnd(15)} ${t.profit_percent.toFixed(1).padStart(7)}% | 散:${retail}% 新:${newStar}% 巨:${whale}% 聪:${smart}%`);
});

// 类别比例对比
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

const highStats = calcGroupStats(highProfitGroup);
const lowStats = calcGroupStats(lowProfitGroup);

console.log('\n' + '='.repeat(110));
console.log('[类别比例对比 (平均值)]');
console.log('='.repeat(110));
console.log('类别'.padEnd(18) + '高收益组'.padEnd(15) + '低收益组'.padEnd(15) + '差异');
console.log('-'.repeat(110));

categories.forEach(cat => {
  const highAvg = (highStats[cat].avg * 100).toFixed(1) + '%';
  const lowAvg = (lowStats[cat].avg * 100).toFixed(1) + '%';
  const diff = ((highStats[cat].avg - lowStats[cat].avg) * 100).toFixed(1) + '%';
  const arrow = parseFloat(diff) > 0 ? '↑' : '↓';
  console.log(`${cat.padEnd(18)} ${highAvg.padEnd(15)} ${lowAvg.padEnd(15)} ${arrow} ${diff}`);
});

// 寻找最佳分类规则
console.log('\n' + '='.repeat(110));
console.log('[寻找最佳分类规则]');
console.log('='.repeat(110));

const rules = [];

// 测试各种阈值组合
const testRules = [
  { name: '散户比例 < 23%', test: t => ((t.category_counts['🐟 散户'] || 0) / t.participant_count) < 0.23 },
  { name: '散户比例 < 25%', test: t => ((t.category_counts['🐟 散户'] || 0) / t.participant_count) < 0.25 },
  { name: '散户比例 < 30%', test: t => ((t.category_counts['🐟 散户'] || 0) / t.participant_count) < 0.30 },
  { name: '散户比例 < 35%', test: t => ((t.category_counts['🐟 散户'] || 0) / t.participant_count) < 0.35 },
  { name: '老鸟赢家比例 < 3%', test: t => ((t.category_counts['🦅 老鸟赢家'] || 0) / t.participant_count) < 0.03 },
  { name: '巨鲸比例 < 10%', test: t => ((t.category_counts['🏆 巨鲸'] || 0) / t.participant_count) < 0.10 },
  { name: '散户 < 25% 且 老鸟赢家 < 3%', test: t => ((t.category_counts['🐟 散户'] || 0) / t.participant_count) < 0.25 && ((t.category_counts['🦅 老鸟赢家'] || 0) / t.participant_count) < 0.03 },
  { name: '散户 < 25% 或 老鸟赢家 < 3%', test: t => ((t.category_counts['🐟 散户'] || 0) / t.participant_count) < 0.25 || ((t.category_counts['🦅 老鸟赢家'] || 0) / t.participant_count) < 0.03 },
  { name: '高频交易者 < 60%', test: t => ((t.category_counts['🎲 高频交易者'] || 0) / t.participant_count) < 0.60 },
  { name: '聪明钱 > 3%', test: t => ((t.category_counts['💎 聪明钱老鸟'] || 0) / t.participant_count) > 0.03 },
];

testRules.forEach(rule => {
  const highPassed = highProfitGroup.filter(rule.test).length;
  const lowPassed = lowProfitGroup.filter(rule.test).length;

  // 准确率 = (高收益命中 + 低收益拒绝) / 总数
  const accuracy = (highPassed + (lowProfitGroup.length - lowPassed)) / sortedTokens.length;

  rules.push({
    name: rule.name,
    highPassed,
    lowPassed,
    accuracy: accuracy.toFixed(3),
    precision: highPassed / (highPassed + lowPassed) || 0,
    recall: highPassed / highProfitGroup.length
  });
});

// 按准确率排序
rules.sort((a, b) => b.accuracy - a.accuracy);

console.log('\n规则'.padEnd(45) + '高收益命中'.padEnd(12) + '低收益命中'.padEnd(12) + '准确率');
console.log('-'.repeat(110));
rules.forEach(r => {
  console.log(`${r.name.padEnd(45)} ${r.highPassed}/${highProfitGroup.length}`.padEnd(12) + `${r.lowPassed}/${lowProfitGroup.length}`.padEnd(12) + r.accuracy);
});

// 输出最佳规则
console.log('\n' + '='.repeat(110));
console.log('[最佳规则]');
console.log('='.repeat(110));
const bestRule = rules[0];
console.log(`规则: ${bestRule.name}`);
console.log(`准确率: ${bestRule.accuracy} (${(parseFloat(bestRule.accuracy) * 100).toFixed(1)}%)`);
console.log(`  高收益组命中: ${bestRule.highPassed}/${highProfitGroup.length} (${(bestRule.recall * 100).toFixed(1)}%)`);
console.log(`  低收益组命中: ${bestRule.lowPassed}/${lowProfitGroup.length}`);
console.log(`  精确率: ${(bestRule.precision * 100).toFixed(1)}% (预测为高收益中真正高收益的比例)`);

// 详细展示最佳规则的分类结果
console.log('\n' + '='.repeat(110));
console.log(`[规则 "${bestRule.name}" 分类结果]`);
console.log('='.repeat(110));

const bestTest = testRules.find(r => r.name === bestRule.name);

console.log('\n高收益组 (应该被识别为高收益):');
let highCorrect = 0;
highProfitGroup.forEach((t, i) => {
  const pass = bestTest.test(t);
  if (pass) highCorrect++;
  const mark = pass ? '✓' : '✗';
  const retail = ((t.category_counts['🐟 散户'] || 0) / t.participant_count * 100).toFixed(0);
  console.log(`  ${mark} ${i + 1}. ${t.token_symbol.padEnd(15)} ${t.profit_percent.toFixed(1).padStart(7)}% (散户:${retail}%)`);
});
console.log(`  识别率: ${highCorrect}/${highProfitGroup.length} (${(highCorrect / highProfitGroup.length * 100).toFixed(1)}%)`);

console.log('\n低收益组 (应该被识别为低收益):');
let lowCorrect = 0;
lowProfitGroup.forEach((t, i) => {
  const pass = bestTest.test(t);
  if (!pass) lowCorrect++;
  const mark = pass ? '✗ (误判)' : '✓';
  const retail = ((t.category_counts['🐟 散户'] || 0) / t.participant_count * 100).toFixed(0);
  console.log(`  ${mark} ${i + 1}. ${t.token_symbol.padEnd(15)} ${t.profit_percent.toFixed(1).padStart(7)}% (散户:${retail}%)`);
});
console.log(`  识别率: ${lowCorrect}/${lowProfitGroup.length} (${(lowCorrect / lowProfitGroup.length * 100).toFixed(1)}%)`);

console.log('\n' + '='.repeat(110));
console.log('[总结]');
console.log('='.repeat(110));
console.log(`基于 ${sortedTokens.length} 个代币的数据:`);
console.log(`- 最佳规则: "${bestRule.name}"`);
console.log(`- 整体准确率: ${(parseFloat(bestRule.accuracy) * 100).toFixed(1)}%`);
console.log(`- 高收益识别率: ${(bestRule.recall * 100).toFixed(1)}%`);
console.log(`- 低收益识别率: ${((1 - bestRule.lowPassed / lowProfitGroup.length) * 100).toFixed(1)}%`);
