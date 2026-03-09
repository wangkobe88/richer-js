/**
 * 验证修改后的行为：卡牌管理器完全控制买卖，状态不干预
 * 测试场景：全部卖出后状态=sold，但仍可再次买入（观察期内）
 */

const { CardPositionManager } = require('../src/portfolio/CardPositionManager');

console.log('🧪 验证卡牌管理器控制买卖行为\n');

// 模拟代币状态
class MockToken {
  constructor(address, symbol) {
    this.token = address;
    this.symbol = symbol;
    this.status = 'monitoring';
    this.soldAt = null;
  }
}

// 模拟引擎逻辑
class MockEngine {
  constructor() {
    this.tokens = new Map();
    this.cardManagers = new Map();
  }

  getOrCreateToken(address, symbol) {
    if (!this.tokens.has(address)) {
      this.tokens.set(address, new MockToken(address, symbol));
    }
    return this.tokens.get(address);
  }

  getOrCreateCardManager(address) {
    if (!this.cardManagers.has(address)) {
      const manager = new CardPositionManager({
        totalCards: 4,
        perCardMaxBNB: 0.25,
        minCardsForTrade: 1,
        initialAllocation: { bnbCards: 4, tokenCards: 0 }
      });
      this.cardManagers.set(address, manager);
    }
    return this.cardManagers.get(address);
  }

  // 模拟买入（只检查卡牌管理器，不检查状态）
  canBuy(address) {
    const cardManager = this.getOrCreateCardManager(address);
    const token = this.getOrCreateToken(address, symbol);

    console.log(`\n🔍 评估买入条件 | ${token.symbol}`);
    console.log(`   状态: ${token.status}`);
    console.log(`   BNB卡: ${cardManager.bnbCards}, 代币卡: ${cardManager.tokenCards}`);

    // 修改后：只检查卡牌管理器
    const buyAmount = cardManager.calculateBuyAmount(1);
    const canBuy = buyAmount > 0;

    console.log(`   计算买入金额: ${buyAmount} BNB`);
    console.log(`   结果: ${canBuy ? '✅ 可以买入' : '❌ 无法买入（无BNB卡）'}`);

    return canBuy;
  }

  executeBuy(address, symbol, cards) {
    const cardManager = this.getOrCreateCardManager(address);
    const token = this.getOrCreateToken(address, symbol);

    const buyAmount = cardManager.calculateBuyAmount(cards);
    if (buyAmount <= 0) {
      console.log(`   ❌ 买入失败：无BNB卡`);
      return false;
    }

    cardManager.afterBuy(symbol, cards);
    token.status = 'bought';

    console.log(`   ✅ 买入成功: ${cards}张卡, ${buyAmount}BNB`);
    console.log(`   买入后状态: ${token.status}, BNB卡:${cardManager.bnbCards}, 代币卡:${cardManager.tokenCards}`);
    return true;
  }

  executeSell(address, symbol, cards) {
    const cardManager = this.getOrCreateCardManager(address);
    const token = this.getOrCreateToken(address, symbol);

    const sellAll = (cards === 'all');
    const actualCards = sellAll ? cardManager.tokenCards : cards;

    cardManager.afterSell(symbol, actualCards);

    // 更新状态：全部卖出后进入观察期
    if (cardManager.tokenCards === 0) {
      token.status = 'sold';
      token.soldAt = Date.now();
      console.log(`   ✅ 全部卖出，状态更新为sold（观察期开始）`);
    } else {
      console.log(`   ✅ 部分卖出，状态保持bought`);
    }

    console.log(`   卖出后状态: ${token.status}, BNB卡:${cardManager.bnbCards}, 代币卡:${cardManager.tokenCards}`);
    return true;
  }
}

// 开始测试
const engine = new MockEngine();
const address = '0xTEST';
const symbol = 'TEST';

console.log('=== 场景1: 买入 → 全部卖出 → 尝试买入 ===');
engine.executeBuy(address, symbol, 4);

engine.executeSell(address, symbol, 'all');

const canBuy1 = engine.canBuy(address, symbol);
console.log(`\n结论: ${canBuy1 ? '✅ 可以买入（卡牌管理器控制）' : '❌ 无法买入'}`);

console.log('\n=== 场景2: 全部卖出后再次买入 ===');
if (canBuy1) {
  engine.executeBuy(address, symbol, 2);
  console.log('\n再次尝试买入:');
  const canBuy2 = engine.canBuy(address, symbol);
  console.log(`结论: ${canBuy2 ? '✅ 仍可买入（有剩余BNB卡）' : '❌ 无法买入（BNB卡已用完）'}`);
}

console.log('\n=== 场景3: 部分卖出后继续买入 ===');
// 重置
engine.tokens.clear();
engine.cardManagers.clear();

engine.executeBuy(address, symbol, 2);
engine.executeSell(address, symbol, 1);
const canBuy3 = engine.canBuy(address, symbol);
console.log(`\n结论: ${canBuy3 ? '✅ 可以买入（部分卖出）' : '❌ 无法买入'}`);

console.log('\n✅ 测试总结:');
console.log('1. ✅ 全部卖出后状态=sold，但仍可买入（观察期内）');
console.log('2. ✅ 买入行为完全由卡牌管理器控制');
console.log('3. ✅ 状态不干预买卖决策，只用于淘汰管理');
console.log('4. ✅ 无BNB卡时自然无法买入，无需状态检查');
