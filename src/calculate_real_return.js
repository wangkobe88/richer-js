/**
 * 基于 40% 策略分析结果计算 50% 策略的真实收益
 */

const INITIAL_BNB = 100;
const INVESTMENT_PER_TRADE = 1.0; // 4 卡 × 0.25 BNB

// 从 40% 策略分析中获取的所有交易
// 格式: { symbol, buyReturn, finalReturn }
const allTrades = [
    // 40% 以上会触发的交易
    { symbol: 'TORCH', buyReturn: 43.0, finalReturn: 2610.4 },
    { symbol: '4Fund', buyReturn: 72.8, finalReturn: 359.9 },
    { symbol: 'AgentCZ', buyReturn: 66.3, finalReturn: 295.2 },
    { symbol: 'TOGO', buyReturn: 56.7, finalReturn: 278.3 },
    { symbol: 'Claw Print', buyReturn: 44.6, finalReturn: 175.1 },
    { symbol: 'Dogclaw', buyReturn: 50.9, finalReturn: 79.3 },
    { symbol: '578Scan', buyReturn: 100.9, finalReturn: 60.7 },
    { symbol: 'TESS', buyReturn: 47.7, finalReturn: 57.8 },
    { symbol: 'Kitty', buyReturn: 44.6, finalReturn: 43.5 },
    { symbol: 'SEED', buyReturn: 144.9, finalReturn: 15.7 },
    { symbol: 'Trumphouse', buyReturn: 117.4, finalReturn: 1.4 },
    { symbol: '骐骥', buyReturn: 137.8, finalReturn: 0.2 },
    { symbol: 'COBRA', buyReturn: 42.3, finalReturn: -0.8 },
    { symbol: 'Spring', buyReturn: 49.9, finalReturn: -0.8 },
    { symbol: '雪球', buyReturn: 148.7, finalReturn: -3.7 },
    { symbol: 'GOUT', buyReturn: 128.8, finalReturn: -4.1 },
    { symbol: 'SATOSHI', buyReturn: 61.5, finalReturn: -4.4 },
    { symbol: 'MXB', buyReturn: 51.9, finalReturn: -4.8 },
    { symbol: '奇迹', buyReturn: 101.5, finalReturn: -6.2 },
    { symbol: 'LGSN', buyReturn: 46.3, finalReturn: -8.3 },
    { symbol: '4CLAW', buyReturn: 41.0, finalReturn: -10.9 },
    { symbol: 'BORT2.0', buyReturn: 41.7, finalReturn: -11.4 },
    { symbol: '578-bot', buyReturn: 48.6, finalReturn: -12.0 },
    { symbol: 'CLAWBOOK', buyReturn: 40.8, finalReturn: -12.4 },
    { symbol: 'Chenpepe的逆袭之路', buyReturn: 43.7, finalReturn: -12.7 },
    { symbol: 'BOTR578', buyReturn: 44.7, finalReturn: -12.8 },
    { symbol: 'BORT-578', buyReturn: 42.0, finalReturn: -13.4 },
    { symbol: 'Langtrace', buyReturn: 61.7, finalReturn: -16.0 },
    { symbol: 'BTC2', buyReturn: 59.6, finalReturn: -16.7 },
    { symbol: 'CLAWX', buyReturn: 68.6, finalReturn: -33.3 },
    { symbol: 'LIGHTER', buyReturn: 42.1, finalReturn: -36.9 },
    { symbol: 'Token01', buyReturn: 61.2, finalReturn: -38.6 },
    { symbol: '专门接盘华语dev', buyReturn: 65.3, finalReturn: -46.2 },
    { symbol: 'PENGZHAO', buyReturn: 63.1, finalReturn: -65.7 },
];

console.log('🔍 策略收益对比分析\n');
console.log('📋 配置:');
console.log(`  初始资金: ${INITIAL_BNB} BNB`);
console.log(`  每次投资: ${INVESTMENT_PER_TRADE} BNB (4卡 × 0.25BNB)`);
console.log('');

// 分析 40% 策略
const trades40 = allTrades.filter(t => t.buyReturn >= 40 && t.buyReturn < 150);
const profits40 = trades40.filter(t => t.finalReturn > 0);
const losses40 = trades40.filter(t => t.finalReturn <= 0);

// 每笔交易投入 1 BNB，计算真实收益
let totalProfit40 = 0;
trades40.forEach(t => {
    const profitBNB = INVESTMENT_PER_TRADE * (t.finalReturn / 100);
    totalProfit40 += profitBNB;
});

console.log('📊 40% 策略 (age < 5, 40% <= earlyReturn < 150%):');
console.log('─'.repeat(90));
console.log(`触发交易: ${trades40.length} 笔`);
console.log(`盈利交易: ${profits40.length} 笔 (${(profits40.length/trades40.length*100).toFixed(1)}%)`);
console.log(`亏损交易: ${losses40.length} 笔 (${(losses40.length/trades40.length*100).toFixed(1)}%)`);
console.log('');
console.log(`总投入: ${trades40.length * INVESTMENT_PER_TRADE} BNB`);
console.log(`总收益: ${totalProfit40 > 0 ? '+' : ''}${totalProfit40.toFixed(2)} BNB`);
console.log(`最终余额: ${INITIAL_BNB + totalProfit40} BNB`);
console.log(`回报率: ${totalProfit40 > 0 ? '+' : ''}${(totalProfit40 / INITIAL_BNB * 100).toFixed(1)}%`);

// 分析 50% 策略
const trades50 = allTrades.filter(t => t.buyReturn >= 50 && t.buyReturn < 150);
const profits50 = trades50.filter(t => t.finalReturn > 0);
const losses50 = trades50.filter(t => t.finalReturn <= 0);

let totalProfit50 = 0;
trades50.forEach(t => {
    const profitBNB = INVESTMENT_PER_TRADE * (t.finalReturn / 100);
    totalProfit50 += profitBNB;
});

console.log(`\n📊 50% 策略 (age < 5, 50% <= earlyReturn < 150%) [实验 28ee83a3 配置]:`);
console.log('─'.repeat(90));
console.log(`触发交易: ${trades50.length} 笔`);
console.log(`盈利交易: ${profits50.length} 笔 (${(profits50.length/trades50.length*100).toFixed(1)}%)`);
console.log(`亏损交易: ${losses50.length} 笔 (${(losses50.length/trades50.length*100).toFixed(1)}%)`);
console.log('');
console.log(`总投入: ${trades50.length * INVESTMENT_PER_TRADE} BNB`);
console.log(`总收益: ${totalProfit50 > 0 ? '+' : ''}${totalProfit50.toFixed(2)} BNB`);
console.log(`最终余额: ${INITIAL_BNB + totalProfit50.toFixed(2)} BNB`);
console.log(`回报率: ${totalProfit50 > 0 ? '+' : ''}${(totalProfit50 / INITIAL_BNB * 100).toFixed(1)}%`);

// 显示 50% 策略的所有交易
console.log(`\n📋 50% 策略所有交易详情:`);
console.log('─'.repeat(90));

trades50.sort((a, b) => b.finalReturn - a.finalReturn);

trades50.forEach((t, i) => {
    const profitBNB = INVESTMENT_PER_TRADE * (t.finalReturn / 100);
    const status = t.finalReturn > 0 ? '✅ 盈利' : '❌ 亏损';
    console.log(`[${i + 1}] ${t.symbol.padEnd(20)} ${status.padEnd(8)} 买入: ${t.buyReturn.toFixed(1)}% → 最终: ${t.finalReturn.toFixed(1).padStart(6)}% | BNB: ${profitBNB > 0 ? '+' : ''}${profitBNB.toFixed(3)}`);
});

// 对比分析
console.log(`\n📊 策略对比:`);
console.log('─'.repeat(90));
console.log(`40% 策略: ${trades40.length} 笔交易 → ${INITIAL_BNB + totalProfit40} BNB (${(totalProfit40 / INITIAL_BNB * 100).toFixed(1)}%)`);
console.log(`50% 策略: ${trades50.length} 笔交易 → ${INITIAL_BNB + totalProfit50} BNB (${(totalProfit50 / INITIAL_BNB * 100).toFixed(1)}%)`);
console.log('');

const diffTrades = trades40.length - trades50.length;
const diffProfit = totalProfit40 - totalProfit50;
console.log(`差异:`);
console.log(`  少交易: ${diffTrades} 笔`);
console.log(`  少收益: ${diffProfit > 0 ? '+' : ''}${diffProfit.toFixed(2)} BNB`);

// 检查被过滤掉的交易
const filteredTrades = allTrades.filter(t => t.buyReturn >= 40 && t.buyReturn < 50);
if (filteredTrades.length > 0) {
    const filteredProfit = filteredTrades.reduce((sum, t) => sum + INVESTMENT_PER_TRADE * (t.finalReturn / 100), 0);
    console.log(`\n❌ 被 50% 阈值过滤掉的交易 (${filteredTrades.length} 笔):`);
    console.log('─'.repeat(90));

    filteredTrades.sort((a, b) => b.finalReturn - a.finalReturn);

    filteredTrades.forEach((t, i) => {
        const profitBNB = INVESTMENT_PER_TRADE * (t.finalReturn / 100);
        const status = t.finalReturn > 0 ? '✅ 盈利' : '❌ 亏损';
        console.log(`[${i + 1}] ${t.symbol.padEnd(20)} ${status.padEnd(8)} 买入: ${t.buyReturn.toFixed(1)}% → 最终: ${t.finalReturn.toFixed(1).padStart(6)}% | BNB: ${profitBNB > 0 ? '+' : ''}${profitBNB.toFixed(3)}`);
    });

    console.log(`\n这些被过滤的交易总收益: ${filteredProfit > 0 ? '+' : ''}${filteredProfit.toFixed(2)} BNB`);
}

console.log(`\n✅ 分析完成`);
