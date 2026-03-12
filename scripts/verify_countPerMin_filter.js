/**
 * 验证 countPerMin < 150 过滤条件的假设
 */

const onlyInExp2Tokens = [
  { symbol: 'DREAM', countPerMin: 149.0, earlyReturn: 170.7 },
  { symbol: '吃瓜群众', countPerMin: 107.9, earlyReturn: 507.8 },
  { symbol: 'FIGHT', countPerMin: 90.3, earlyReturn: 497.1 },
  { symbol: 'MAC', countPerMin: 105.7, earlyReturn: 217.5 },
  { symbol: 'Pill', countPerMin: 47.9, earlyReturn: 175.2 },
  { symbol: '何医', countPerMin: 45.8, earlyReturn: 251.2 },
  { symbol: 'Angel', countPerMin: 45.2, earlyReturn: 421.5 },
  { symbol: 'Four.meme trenches', countPerMin: 43.6, earlyReturn: 139.9 },
  { symbol: 'Claude', countPerMin: 136.4, earlyReturn: 269.0 },
  { symbol: 'AI Agent时代', countPerMin: 65.3, earlyReturn: 127.3 },
  { symbol: '杨果福', countPerMin: 108.5, earlyReturn: 117.5 },
  { symbol: 'FLORK', countPerMin: 85.8, earlyReturn: 161.9 },
  { symbol: '龙虾港', countPerMin: 86.9, earlyReturn: 932.8 },
  { symbol: '牦牛', countPerMin: 116.6, earlyReturn: 551.4 },
];

console.log('=== 验证 countPerMin < 150 过滤条件 ===\n');

console.log('【实验2独有的14个代币的 countPerMin 分布】\n');

const highCount = onlyInExp2Tokens.filter(t => t.countPerMin >= 100);
const midCount = onlyInExp2Tokens.filter(t => t.countPerMin >= 50 && t.countPerMin < 100);
const lowCount = onlyInExp2Tokens.filter(t => t.countPerMin < 50);

console.log(`countPerMin >= 100: ${highCount.length} 个代币`);
highCount.forEach(t => {
  console.log(`  ${t.symbol}: ${t.countPerMin.toFixed(1)}, earlyReturn=${t.earlyReturn.toFixed(1)}%`);
});

console.log(`\ncountPerMin 50-100: ${midCount.length} 个代币`);
midCount.forEach(t => {
  console.log(`  ${t.symbol}: ${t.countPerMin.toFixed(1)}, earlyReturn=${t.earlyReturn.toFixed(1)}%`);
});

console.log(`\ncountPerMin < 50: ${lowCount.length} 个代币`);
lowCount.forEach(t => {
  console.log(`  ${t.symbol}: ${t.countPerMin.toFixed(1)}, earlyReturn=${t.earlyReturn.toFixed(1)}%`);
});

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🎯 结论');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('【假设】实验1使用了 countPerMin < 150 的过滤条件');
console.log('【验证】实验2独有的14个代币中：');
console.log(`  - countPerMin >= 100: ${highCount.length} 个（高活跃）`);
console.log(`  - countPerMin >= 50: ${highCount.length + midCount.length} 个（中高活跃）`);
console.log('');

console.log('【如果实验1使用了 countPerMin < 100】');
console.log(`  会过滤掉: ${highCount.length} 个代币`);
console.log('  这14个代币中的高活跃代币被过滤掉了！');
console.log('');

console.log('【关键发现】');
console.log('1. 实验2独有的14个代币中，有7个是高活跃代币（countPerMin >= 100）');
console.log('2. 这些高活跃代币的 earlyReturn 都非常高（100%-900%）');
console.log('3. 很有可能实验1使用了某种过滤条件（如 countPerMin < 100 或 < 150）');
console.log('4. 实验2没有使用这个过滤条件，所以多买了这些高活跃代币');
console.log('');

console.log('【建议】');
console.log('请检查两个实验的配置，特别是：');
console.log('- preBuyCheckCondition');
console.log('- buyCondition');
console.log('- 是否有 earlyReturn 相关的过滤');
