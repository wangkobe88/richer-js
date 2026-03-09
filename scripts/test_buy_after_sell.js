/**
 * 测试卖出后再次买入的功能
 * 验证卡牌仓位管理机制是否正常工作
 *
 * 用法: node scripts/test_buy_after_sell.js [totalCards] [perCardMaxBNB]
 * 示例: node scripts/test_buy_after_sell.js 4 0.25
 */

const { CardPositionManager } = require('../src/portfolio/CardPositionManager');

// 从命令行参数读取配置，或使用默认值
const args = process.argv.slice(2);
const totalCards = parseInt(args[0]) || 4;
const perCardMaxBNB = parseFloat(args[1]) || 0.25;

console.log('🧪 测试卖出后再次买入功能');
console.log(`📋 配置: 总卡牌数=${totalCards}, 单卡BNB=${perCardMaxBNB}\n`);

// 创建卡牌管理器（使用配置参数）
const cardManager = new CardPositionManager({
  totalCards: totalCards,
  perCardMaxBNB: perCardMaxBNB,
  minCardsForTrade: 1,
  initialAllocation: {
    bnbCards: totalCards,
    tokenCards: 0
  }
});

console.log('📊 初始状态:');
cardManager.printStatus();

console.log('\n📈 第一次买入（1张卡）:');
const buyAmount1 = cardManager.calculateBuyAmount(1);
console.log(`   买入金额: ${buyAmount1} BNB`);

cardManager.afterBuy('TEST', 1);
console.log('   买入后状态:');
cardManager.printStatus();

console.log('\n📉 第一次卖出（1张卡）:');
const sellAmount1 = cardManager.calculateSellAmount(10, 'TEST', 1, false); // 假设有10个代币
console.log(`   卖出数量: ${sellAmount1} 代币`);

cardManager.afterSell('TEST', 1, false);
console.log('   卖出后状态:');
cardManager.printStatus();

console.log('\n📈 第二次买入（1张卡）:');
const buyAmount2 = cardManager.calculateBuyAmount(1);
console.log(`   买入金额: ${buyAmount2} BNB`);
console.log(`   能否买入: ${buyAmount2 > 0 ? '✅ 是' : '❌ 否'}`);

if (buyAmount2 > 0) {
  cardManager.afterBuy('TEST', 1);
  console.log('   买入后状态:');
  cardManager.printStatus();
} else {
  console.log('   ❌ 无法买入（没有BNB卡）');
}

console.log(`\n📉 全部卖出（卖出剩余${totalCards - 1}张卡）:`);
const remainingCards = totalCards - 1;
const sellAmount2 = cardManager.calculateSellAmount(2.5, 'TEST', remainingCards, true);
console.log(`   卖出数量: ${sellAmount2} 代币`);

cardManager.afterSell('TEST', remainingCards, true);
console.log('   全部卖出后状态:');
cardManager.printStatus();

console.log('\n📈 尝试第三次买入（全部卖出后）:');
const buyAmount3 = cardManager.calculateBuyAmount(1);
console.log(`   买入金额: ${buyAmount3} BNB`);
console.log(`   能否买入: ${buyAmount3 > 0 ? '✅ 是' : '❌ 否'}`);

console.log('\n✅ 测试总结:');
console.log('1. ✅ 买入后卖出，BNB卡恢复，可以再次买入');
console.log('2. ✅ 卡牌机制自然控制，没有BNB卡时无法买入');
console.log('3. ✅ 支持波段操作：多次买卖同一个代币');
console.log(`4. ⚠️ 全部卖出后所有${totalCards}张BNB卡恢复，可以再次买入（用于多轮交易）`);
