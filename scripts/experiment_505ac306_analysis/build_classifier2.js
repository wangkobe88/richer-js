/**
 * 构建分类规则 - 区分高收益和低收益代币
 * 总共18个代币，取 Top 9 和 Bottom 9
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = '/Users/nobody1/Desktop/Codes/richer-js/scripts/experiment_505ac306_analysis';
const analysisResults = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'analysis_results.json'), 'utf8'));

// 按收益率排序
const sortedTokens = [...analysisResults.token_analysis]
  .sort((a, b) => b.profit_percent - a.profit_percent);

// 前9个为高收益组，后9个为低收益组
const highProfitGroup = sortedTokens.slice(0, 9);
const lowProfitGroup = sortedTokens.slice(9, 18);

console.log('='.repeat(110));
console.log('构建分类规则: 高收益组(Top 9) vs 低收益组(Bottom 9)');
console.log('='.repeat(110));

console.log('\n[高收益组 Top 9]');
highProfitGroup.forEach((t, i) => {
  const retail = ((t.category_counts['🐟 散户'] || 0) / t.participant_count * 100).toFixed(0);
  const newStar = ((t.category_counts['🌟 新星玩家'] || 0) / t.participant_count * 100).toFixed(0);
  const whale = ((t.category_counts['🏆 巨鲸'] || 0) / t.participant_count * 100).toFixed(0);
  const hft = ((t.category_counts['🎲 高频交易者'] || 0) / t.participant_count * 100).toFixed(0);
  console.log(`  ${i + 1}. ${t.token_symbol.padEnd(15)} ${t.profit_percent.toFixed(1).padStart(7)}% | 散:${retail}% 新:${newStar}% 巨:${whale}% HFT:${hft}%`);
});

console.log('\n[低收益组 Bottom 9]');
lowProfitGroup.forEach((t, i) => {
  const retail = ((t.category_counts['🐟 散户'] || 0) / t.participant_count * 100).toFixed(0);
  const newStar = ((t.category_counts['🌟 新星玩家'] || 0) / t.participant_count * 100).toFixed(0);
  const whale = ((t.category_counts['🏆 巨鲸'] || 0) / t.participant_count * 100).toFixed(0);
  const hft = ((t.category_counts['🎲 高频交易者'] || 0) / t.participant_count * 100).toFixed(0);
  console.log(`  ${i + 1}. ${t.token_symbol.padEnd(15)} ${t.profit_percent.toFixed(1).padStart(7)}% | 散:${retail}% 新:${newStar}% 巨:${whale}% HFT:${hft}%`);
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

// 寻找最佳分割点
console.log('\n' + '='.repeat(110));
console.log('[寻找最佳分类规则]');
console.log('='.repeat(110));

const rules = [];

// 测试各种阈值组合
const testRules = [
  { name: '散户比例 < 27%', test: t => ((t.category_counts['🐟 散户'] || 0) / t.participant_count) < 0.27 },
  { name: '散户比例 < 30%', test: t => ((t.category_counts['🐟 散户'] || 0) / t.participant_count) < 0.30 },
  { name: '散户比例 < 35%', test: t => ((t.category_counts['🐟 散户'] || 0) / t.participant_count) < 0.35 },
  { name: '新星玩家比例 > 22%', test: t => ((t.category_counts['🌟 新星玩家'] || 0) / t.participant_count) > 0.22 },
  { name: '巨鲸比例 > 11%', test: t => ((t.category_counts['🏆 巨鲸'] || 0) / t.participant_count) > 0.11 },
  { name: '散户+普通玩家 < 55%', test: t => (((t.category_counts['🐟 散户'] || 0) + (t.category_counts['🐟 普通玩家'] || 0)) / t.participant_count) < 0.55 },
  { name: '散户 < 27% 且 新星玩家 > 22%', test: t => ((t.category_counts['🐟 散户'] || 0) / t.participant_count) < 0.27 && ((t.category_counts['🌟 新星玩家'] || 0) / t.participant_count) > 0.22 },
  { name: '散户 < 30% 或 巨鲸 > 11%', test: t => ((t.category_counts['🐟 散户'] || 0) / t.participant_count) < 0.30 || ((t.category_counts['🏆 巨鲸'] || 0) / t.participant_count) > 0.11 },
  { name: '高频交易者 < 24%', test: t => ((t.category_counts['🎲 高频交易者'] || 0) / t.participant_count) < 0.24 },
  { name: '高频交易者 >= 24% (反向)', test: t => ((t.category_counts['🎲 高频交易者'] || 0) / t.participant_count) >= 0.24 },
  { name: '巨鲸比例 >= 11% 且 散户 < 27%', test: t => ((t.category_counts['🏆 巨鲸'] || 0) / t.participant_count) >= 0.11 && ((t.category_counts['🐟 散户'] || 0) / t.participant_count) < 0.27 },
];

testRules.forEach(rule => {
  const highPassed = highProfitGroup.filter(rule.test).length;
  const lowPassed = lowProfitGroup.filter(rule.test).length;

  // 准确率 = (高收益命中 + 低收益拒绝) / 总数
  const accuracy = (highPassed + (9 - lowPassed)) / 18;

  rules.push({
    name: rule.name,
    highPassed,
    lowPassed,
    accuracy: accuracy.toFixed(3)
  });
});

// 按准确率排序
rules.sort((a, b) => b.accuracy - a.accuracy);

console.log('\n规则'.padEnd(45) + '高收益命中'.padEnd(12) + '低收益命中'.padEnd(12) + '准确率');
console.log('-'.repeat(110));
rules.forEach(r => {
  console.log(`${r.name.padEnd(45)} ${r.highPassed}/9`.padEnd(12) + `${r.lowPassed}/9`.padEnd(12) + r.accuracy);
});

// 输出最佳规则
console.log('\n' + '='.repeat(110));
console.log('[最佳规则]');
console.log('='.repeat(110));
const bestRule = rules[0];
console.log(`规则: ${bestRule.name}`);
console.log(`准确率: ${bestRule.accuracy} (${(parseFloat(bestRule.accuracy) * 100).toFixed(1)}%)`);
console.log(`  高收益组命中: ${bestRule.highPassed}/9`);
console.log(`  低收益组命中: ${bestRule.lowPassed}/9`);

// 详细展示最佳规则的分类结果
console.log('\n' + '='.repeat(110));
console.log(`[规则 "${bestRule.name}" 分类结果]`);
console.log('='.repeat(110));

const bestTest = testRules.find(r => r.name === bestRule.name);

console.log('\n高收益组 (应该被识别为高收益):');
highProfitGroup.forEach((t, i) => {
  const pass = bestTest.test(t) ? '✓' : '✗';
  const retail = ((t.category_counts['🐟 散户'] || 0) / t.participant_count * 100).toFixed(0);
  console.log(`  ${pass} ${i + 1}. ${t.token_symbol.padEnd(15)} ${t.profit_percent.toFixed(1).padStart(7)}% (散户:${retail}%)`);
});

console.log('\n低收益组 (应该被识别为低收益):');
lowProfitGroup.forEach((t, i) => {
  const pass = bestTest.test(t) ? '✗ (误判)' : '✓';
  const retail = ((t.category_counts['🐟 散户'] || 0) / t.participant_count * 100).toFixed(0);
  console.log(`  ${pass} ${i + 1}. ${t.token_symbol.padEnd(15)} ${t.profit_percent.toFixed(1).padStart(7)}% (散户:${retail}%)`);
});

// 尝试决策树风格的多层规则
console.log('\n' + '='.repeat(110));
console.log('[构建多层决策规则]');
console.log('='.repeat(110));

// 先用散户比例分组，再在组内找差异
function buildMultiLevelRule() {
  const results = [];

  // 第一层：散户比例阈值
  const retailThresholds = [0.25, 0.27, 0.30, 0.35];

  retailThresholds.forEach(retailTh => {
    const lowRetail = sortedTokens.filter(t => (t.category_counts['🐟 散户'] || 0) / t.participant_count < retailTh);
    const highRetail = sortedTokens.filter(t => (t.category_counts['🐟 散户'] || 0) / t.participant_count >= retailTh);

    if (lowRetail.length > 0 && highRetail.length > 0) {
      // 低散户组：应该主要是高收益
      const lowRetailHighProfit = lowRetail.filter(t => highProfitGroup.includes(t)).length;
      // 高散户组：应该主要是低收益
      const highRetailLowProfit = highRetail.filter(t => lowProfitGroup.includes(t)).length;

      const accuracy = (lowRetailHighProfit + highRetailLowProfit) / 18;

      results.push({
        rule: `散户比例 < ${(retailTh * 100).toFixed(0)}% → 预测高收益，否则 → 预测低收益`,
        accuracy: accuracy.toFixed(3),
        lowRetailCount: lowRetail.length,
        lowRetailHighProfit,
        highRetailCount: highRetail.length,
        highRetailLowProfit
      });
    }
  });

  return results.sort((a, b) => b.accuracy - a.accuracy);
}

const multiLevelRules = buildMultiLevelRule();
console.log('\n单层决策规则:');
multiLevelRules.slice(0, 5).forEach((r, i) => {
  console.log(`\n${i + 1}. ${r.rule}`);
  console.log(`   准确率: ${(parseFloat(r.accuracy) * 100).toFixed(1)}%`);
  console.log(`   低散户组: ${r.lowRetailCount}个 (其中高收益: ${r.lowRetailHighProfit}个)`);
  console.log(`   高散户组: ${r.highRetailCount}个 (其中低收益: ${r.highRetailLowProfit}个)`);
});

// 最佳单一规则总结
console.log('\n' + '='.repeat(110));
console.log('[总结]');
console.log('='.repeat(110));
console.log(`\n最佳单一规则: "${bestRule.name}"`);
console.log(`- 准确率: ${(parseFloat(bestRule.accuracy) * 100).toFixed(1)}%`);
console.log(`- 高收益组识别率: ${(bestRule.highPassed / 9 * 100).toFixed(1)}%`);
console.log(`- 低收益组识别率: ${((9 - bestRule.lowPassed) / 9 * 100).toFixed(1)}%`);
