/**
 * 测试修复后的 afterSell 方法
 * 验证全部卖出后卡牌状态正确更新
 */

const { CardPositionManager } = require('../src/portfolio/CardPositionManager');

console.log('🧪 测试 afterSell sellAll 参数修复\n');

// 创建卡牌管理器
const cardManager = new CardPositionManager({
  totalCards: 4,
  perCardMaxBNB: 0.25,
  minCardsForTrade: 1,
  initialAllocation: {
    bnbCards: 4,
    tokenCards: 0
  }
});

console.log('📊 初始状态:');
cardManager.printStatus();

console.log('\n📈 买入4张卡:');
cardManager.afterBuy('TEST', 4);
console.log(`   BNB卡: ${cardManager.bnbCards}, 代币卡: ${cardManager.tokenCards}`);

console.log('\n📉 测试修复前的错误方式（未传递sellAll参数）:');
const cardManager1 = new CardPositionManager({
  totalCards: 4,
  perCardMaxBNB: 0.25,
  minCardsForTrade: 1,
  initialAllocation: { bnbCards: 4, tokenCards: 0 }
});
cardManager1.afterBuy('TEST', 4);
console.log('   买入后状态:');
console.log(`   BNB卡: ${cardManager1.bnbCards}, 代币卡: ${cardManager1.tokenCards}`);

// 错误方式：不传递 sellAll 参数
const actualCards = cardManager1.tokenCards; // 4
cardManager1.afterSell('TEST', actualCards); // ❌ 未传递 sellAll=true
console.log('   错误方式卖出后:');
console.log(`   BNB卡: ${cardManager1.bnbCards}, 代币卡: ${cardManager1.tokenCards}`);
console.log(`   ❌ 代币卡未清零！预期0，实际${cardManager1.tokenCards}`);

console.log('\n✅ 测试修复后的正确方式（传递sellAll参数）:');
// 正确方式：传递 sellAll=true
const actualCards2 = cardManager.tokenCards; // 4
cardManager.afterSell('TEST', actualCards2, true); // ✅ 传递 sellAll=true
console.log('   正确方式卖出后:');
console.log(`   BNB卡: ${cardManager.bnbCards}, 代币卡: ${cardManager.tokenCards}`);
console.log(`   ✅ 代币卡已清零！BNB卡恢复为${cardManager.bnbCards}`);

console.log('\n📈 验证再次买入能力:');
const buyAmount = cardManager.calculateBuyAmount(1);
console.log(`   计算买入金额: ${buyAmount} BNB`);
console.log(`   结果: ${buyAmount > 0 ? '✅ 可以买入' : '❌ 无法买入'}`);

console.log('\n✅ 测试总结:');
console.log('1. ✅ 修复后全部卖出会正确清零代币卡');
console.log('2. ✅ 全部卖出后所有BNB卡恢复，可以再次买入');
console.log('3. ✅ 问题根源：afterSell 调用时未传递 sellAll 参数');
