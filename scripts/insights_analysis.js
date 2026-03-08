/**
 * 深入分析：为什么好票也有大量同时交易？
 */

console.log('╔══════════════════════════════════════════════════════════════════════════╗');
console.log('║                    深入分析：好票的"大量同时交易"现象                             ║');
console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

console.log('【案例1：Mr Whale (盈利+2.3%, 最大组188笔)】\n');
console.log('这只代币几乎不盈利，但有188笔同时交易。可能原因：');
console.log('1. 这不是"好票"，只是勉强盈利');
console.log('2. 或者存在其他风险因素（如age大、trendCV低等）\n');

console.log('【案例2：中国链 (盈利+12.7%, 最大组162笔)】\n');
console.log('这只代币盈利一般，但有162笔同时交易。可能原因：');
console.log('1. 可能是中等质量的代币');
console.log('2. 或者波动性较大\n');

console.log('【案例3：鲸狗 (小亏-16.4%, 最大组230笔)】\n');
console.log('这只代币亏损最大，同时交易也最多。典型拉盘砸盘！\n');

console.log('【案例4：巨鲸 (高收益+257%, 最大组23笔)】\n');
console.log('这只代币收益最高，但同时交易很少！这说明：');
console.log('1. 真正的好票可能不需要"刷"交易');
console.log('2. 自然增长比人造热度更可持续\n');

console.log('【案例5：鲸落 (盈利+91.5%, 最大组23笔)】\n');
console.log('另一只高收益好票，同时交易也很少！\n');

console.log('【新发现：重新定义"好票"】\n');
console.log('之前的分类可能不够精确。让我重新分析：');
console.log('');
console.log('✅ 真正好票 (高收益+低同时交易):');
console.log('   - 巨鲸 (+257%, 23笔)');
console.log('   - 鲸落 (+91%, 23笔)');
console.log('');
console.log('⚠️  伪好票 (低收益+高同时交易):');
console.log('   - Mr Whale (+2.3%, 188笔)');
console.log('   - 中国链 (+12.7%, 162笔)');
console.log('');
console.log('❌ 拉盘砸盘 (亏损+高同时交易):');
console.log('   - 鲸狗 (-16.4%, 230笔)');
console.log('   - AND (-21.8%, 187笔)');

console.log('\n【修正后的阈值分析】\n');
console.log('如果我们只考虑"真正的好票"(高收益>50%)：');
console.log('   - 巨鲸: 23笔');
console.log('   - 鲸落: 23笔');
console.log('   平均: 23笔\n');

console.log('拉盘砸盘代币(亏损>15%)：');
console.log('   - 鲸狗: 230笔');
console.log('   - AND: 187笔');
console.log('   - 海鳗: 115笔');
console.log('   - AWIC: 84笔');
console.log('   - FREEDOM: 47笔');
console.log('   - 平均: 132.6笔\n');

console.log('💡 建议的双阈值策略：');
console.log('   1. maxGroupSize < 50  // 过滤掉明显的拉盘砸盘');
console.log('   2. AND profitPercent > 50  // 要求真正的高收益');

console.log('\n═══════════════════════════════════════════════════════════════════════════');
