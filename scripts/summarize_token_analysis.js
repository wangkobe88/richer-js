/**
 * 总结代币 0xfe874780...444 在两个实验中的差异
 */

console.log('=== 代币 0xfe874780...444 分析总结 ===\n');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('【关键发现】');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('这个代币在两个实验中都存在，时间点也完全一样！\n');

console.log('【23:40:14 信号】');
console.log('  实验1: rejected (countPerMin: 229.2)');
console.log('  实验2: rejected (countPerMin: 229.2)');
console.log('  ⚠️  两个实验都拒绝了！因为 countPerMin >= 150\n');

console.log('【23:42:44 信号】');
console.log('  实验1: executed (countPerMin: 138.9)');
console.log('  实验2: executed (countPerMin: 138.9)');
console.log('  ✅ 两个实验都执行了！因为 countPerMin < 150\n');

console.log('【实验1多出的信号】');
console.log('  23:44:04 - executed');
console.log('  23:51:04 - executed');
console.log('  23:56:34 - executed');
console.log('  ⚠️  实验2没有这些信号！\n');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('【问题】为什么实验1有更多次买入？');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('可能的原因：');
console.log('');
console.log('1. 实验1开启了多次购买功能');
console.log('2. 实验2没有开启多次购买，或者配置不同');
console.log('3. 这个代币的早期信号被拒绝后，countPerMin 下降到了 138.9');
console.log('   所以后续信号通过了 countPerMin < 150 的检查\n');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🎯 重要发现');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('1. countPerMin < 150 确实生效了：');
console.log('   - 23:40:14 (countPerMin: 229.2) → 两个实验都拒绝');
console.log('   - 23:42:44 (countPerMin: 138.9) → 两个实验都执行\n');

console.log('2. 实验1配置了多次购买：');
console.log('   - 在 23:42:44 买入后，又触发了3次买入信号');
console.log('   - 23:44:04, 23:51:04, 23:56:34');
console.log('   - 这些信号在实验2中没有出现\n');

console.log('3. 这解释了为什么实验1的代币数更少但收益更好：');
console.log('   - 实验1: 22个代币，有多次购买功能');
console.log('   - 实验2: 38个代币，可能没有多次购买或配置不同');
console.log('   - 多次购买可以让优秀代币获得更好的收益\n');

console.log('【建议】');
console.log('');
console.log('检查两个实验的配置差异，特别是：');
console.log('- maxExecutions (每次策略最大执行次数)');
console.log('- 是否开启了多次购买功能');
console.log('- buyStrategies 的数量');
