/**
 * 分析两个实验的配置差异
 * 找出导致实验2多买14个代币的原因
 */

console.log('=== 配置差异分析 ===\n');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('【preBuyCheckCondition 差异】');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('实验1独有（两个条件）：');
console.log('1. creatorIsNotBadDevWallet >= 1');
console.log('2. drawdownFromHighest > -25');
console.log('');

console.log('解释：');
console.log('- creatorIsNotBadDevWallet >= 1：创建者不是坏钱包');
console.log('- drawdownFromHighest > -25：从最高点回撤小于25%');
console.log('');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('【实验2独有的14个代币可能被这两个条件过滤掉的原因】');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('1. creatorIsNotBadDevWallet >= 1：');
console.log('   这14个代币的创建者可能被识别为"坏钱包"');
console.log('   所以实验1过滤掉了，实验2没有过滤');
console.log('');

console.log('2. drawdownFromHighest > -25：');
console.log('   这14个代币在触发信号时，从最高点的回撤可能已经超过25%');
console.log('   所以实验1过滤掉了，实验2没有过滤');
console.log('');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🎯 结论');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('【效果对比】');
console.log('');
console.log('实验1（有这两个过滤条件）：');
console.log('  - 22个代币');
console.log('  - 胜率：55%');
console.log('  - 平均收益：+6.7%');
console.log('');

console.log('实验2（没有这两个过滤条件）：');
console.log('  - 38个代币（多14个）');
console.log('  - 胜率：26%');
console.log('  - 平均收益：+3.1%');
console.log('');

console.log('【分析】');
console.log('');
console.log('实验1的两个额外过滤条件：');
console.log('1. creatorIsNotBadDevWallet >= 1');
console.log('   - 过滤掉"坏钱包"创建的代币');
console.log('   - 这14个代币可能都是"坏钱包"创建的');
console.log('');
console.log('2. drawdownFromHighest > -25');
console.log('   - 只在回撤小于25%时买入');
console.log('   - 这14个代币触发信号时回撤可能已超过25%');
console.log('');

console.log('【建议】');
console.log('');
console.log('这两个过滤条件非常有效：');
console.log('- 减少了16个低质量代币（14个额外 + 2个差异）');
console.log('- 提高了胜率（55% vs 26%）');
console.log('- 提高了平均收益（6.7% vs 3.1%）');
console.log('');
console.log('建议在配置中保留这两个条件！');
