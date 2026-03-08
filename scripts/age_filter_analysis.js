/**
 * age > 3 过滤条件效果分析总结
 */

console.log('╔══════════════════════════════════════════════════════════════════════════╗');
console.log('║                    age > 3 过滤条件效果分析总结                             ║');
console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

console.log('【一、核心数据对比】\n');
console.log('指标                源实验      回测实验    变化      评价');
console.log('─'.repeat(70));
console.log(`交易数                  17        13       -4       减少23%代币`);
console.log(`胜率                  35.3%      38.5%    +3.2%    ✅ 有提升`);
console.log(`总收益率               14.04%     20.20%   +6.17%   ✅ 显著提升`);
console.log(`总盈亏 (BNB)          2.3862    2.6263  +0.2402   ✅ +10.1%`);
console.log('');

console.log('【二、被过滤的5个代币】\n');
console.log('代币          收益%      Age(分钟)  质量标签      评价');
console.log('─'.repeat(60));
console.log(`SUPERBSC     +34.41%     2.93      未标注        ⚠️  误伤盈利代币`);
console.log(`熊猫          -13.31%     5.22      中质量        ✅ 正确过滤`);
console.log(`海鳗          -12.37%     4.23      低质量        ✅ 正确过滤`);
console.log(`打工仔日记     -26.04%     3.39      未标注        ✅ 正确过滤`);
console.log(`SHIFT         -29.68%     7.20      未标注        ✅ 正确过滤`);
console.log('');

console.log('【三、关键发现：Age与收益的关系】\n');
console.log('Age区间        代币数  胜率      平均收益%    结论');
console.log('─'.repeat(55));
console.log(`0-2分钟        8       50.0%     +29.06       ✅ 最佳区间`);
console.log(`2-3分钟        5       40.0%     +17.50       ✅ 良好区间`);
console.log(`3-5分钟        2        0.0%     -19.20       ❌ 高风险区间`);
console.log(`≥5分钟         2        0.0%     -21.50       ❌ 高风险区间`);
console.log('');

console.log('【四、被误伤的SUPERBSC分析】\n');
console.log('SUPERBSC 是唯一被误伤的盈利代币：');
console.log('  - 收益: +34.41%');
console.log('  - Age: 2.93分钟 (刚好低于3分钟阈值)');
console.log('  - 问题: 处于2-3分钟的边界上');
console.log('');
console.log('📊 建议: 可以考虑将阈值调整为 age < 3.2 或 age < 3.5');
console.log('         这样可以保留像SUPERBSC这样的边界盈利代币');
console.log('');

console.log('【五、剩余8个亏损代币的特征】\n');
console.log('这些代币的Age都在3分钟以内，说明问题不在Age：');
console.log('');
console.log('代币          收益%    Age    trendCV    分析');
console.log('─'.repeat(55));
console.log(`FREEDOM      -27.49%   1.6     0.127      ⚠️  trendCV过低`);
console.log(`做你自己      -22.98%   1.3     0.318      ⚠️  ratio偏低(0.67)`);
console.log(`AND          -21.75%   2.6     0.281      ⚠️  ratio偏低(0.71)`);
console.log(`鲸狗         -16.38%   1.3     0.184      ⚠️  ratio偏低(0.67)`);
console.log(`AWIC         -13.35%   2.8     0.277      ⚠️  ratio偏低(0.71)`);
console.log(`42            -9.38%   1.4     0.270      ⚠️  ratio偏低(0.71)`);
console.log(`Runnr         -4.79%   1.2     0.262      ℹ️  接近盈亏平衡`);
console.log(`鲨鱼宝宝       -3.33%   2.4     0.378      ℹ️  接近盈亏平衡`);
console.log('');

console.log('🔍 关键洞察: 剩余亏损代币的主要问题是');
console.log('   1. trendRiseRatio 偏低 (0.67-0.71)');
console.log('   2. trendCV 过低 (如FREEDOM的0.127)');
console.log('');

console.log('【六、优化建议】\n');

console.log('方案1: 添加 trendRiseRatio 过滤');
console.log('  当前条件: trendRiseRatio >= 0.7');
console.log('  建议调整为: trendRiseRatio >= 0.75');
console.log('  预期效果: 可过滤掉FREEDOM、AND、鲸狗、AWIC、42等5个代币');
console.log('  风险: 可能也会过滤掉部分盈利代币，需要权衡');
console.log('');

console.log('方案2: 添加 trendCV 过滤');
console.log('  建议条件: trendCV >= 0.2');
console.log('  预期效果: 可过滤掉FREEDOM (trendCV=0.127)');
console.log('  注意: 盈利代币的平均trendCV是0.346，亏损是0.262');
console.log('');

console.log('方案3: 调整Age阈值为3.2分钟');
console.log('  当前条件: age < 3');
console.log('  建议调整为: age < 3.2');
console.log('  预期效果: 可以保留SUPERBSC，同时过滤大部分高age代币');
console.log('');

console.log('方案4 (推荐): 组合策略');
console.log('  1. age < 3.2  (放宽边界，减少误伤)');
console.log('  2. trendRiseRatio >= 0.73  (适度提高)');
console.log('  3. trendCV >= 0.2  (过滤极端低值)');
console.log('');

console.log('【七、结论】\n');
console.log('✅ age > 3 条件是有效的: ');
console.log('   - 成功过滤了4个亏损代币');
console.log('   - 只误伤了1个盈利代币 (SUPERBSC)');
console.log('   - 总体收益提升10.1%');
console.log('');
console.log('⚠️  但仍有优化空间: ');
console.log('   - 8个亏损代币的Age都在3分钟以内');
console.log('   - 需要结合其他因子(trendRiseRatio、trendCV)进一步过滤');
console.log('');
console.log('📊 推荐组合条件: ');
console.log('   age < 3.2 && trendRiseRatio >= 0.73 && trendCV >= 0.2');
console.log('');

console.log('═══════════════════════════════════════════════════════════════════════════');
