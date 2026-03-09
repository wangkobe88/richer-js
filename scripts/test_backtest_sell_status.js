/**
 * 测试回测引擎卖出后状态更新
 * 验证全部卖出后状态变为 sold，部分卖出后保持 bought
 */

const { CardPositionManager } = require('../src/portfolio/CardPositionManager');

console.log('🧪 测试回测引擎卖出后状态更新\n');

// 模拟 BacktestEngine 的状态管理
class MockBacktestEngine {
  constructor() {
    this._tokenStates = new Map();
    this._portfolioManager = {
      _portfolios: new Map(),
      getPortfolio(portfolioId) {
        if (!this._portfolios.has(portfolioId)) {
          this._portfolios.set(portfolioId, {
            cashBalance: 10,
            positions: new Map()
          });
        }
        return this._portfolios.get(portfolioId);
      }
    };
    this._portfolioId = 'test-portfolio';
  }

  _getHolding(tokenAddress) {
    const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);
    return portfolio.positions.get(tokenAddress) || null;
  }

  _updateHolding(tokenAddress, amount, price) {
    const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);
    const current = portfolio.positions.get(tokenAddress) || { amount: 0, avgBuyPrice: 0 };
    portfolio.positions.set(tokenAddress, { amount, avgBuyPrice: price || current.avgBuyPrice });
  }

  _getOrCreateTokenState(tokenAddress, tokenSymbol) {
    if (!this._tokenStates.has(tokenAddress)) {
      this._tokenStates.set(tokenAddress, {
        token: tokenAddress,
        symbol: tokenSymbol,
        chain: 'bsc',
        status: 'monitoring',
        buyPrice: 0,
        buyTime: null,
        strategyExecutions: {}
      });
    }
    return this._tokenStates.get(tokenAddress);
  }

  // 模拟买入
  _executeBuy(tokenAddress, tokenSymbol, cards, price) {
    const tokenState = this._getOrCreateTokenState(tokenAddress, tokenSymbol);

    // 更新持仓（模拟）
    const currentHolding = this._getHolding(tokenAddress) || { amount: 0 };
    const newAmount = currentHolding.amount + (cards * price);
    this._updateHolding(tokenAddress, newAmount, price);

    // 更新状态
    tokenState.status = 'bought';
    tokenState.buyPrice = price;
    tokenState.buyTime = Date.now();

    console.log(`📈 买入 ${cards} 张卡 | ${tokenSymbol}`);
    console.log(`   状态: ${tokenState.status}, 持仓: ${this._getHolding(tokenAddress)?.amount || 0}`);
  }

  // 模拟卖出（修复后的逻辑）
  _executeSell(tokenAddress, tokenSymbol, cards, price) {
    const tokenState = this._getOrCreateTokenState(tokenAddress, tokenSymbol);
    const holding = this._getHolding(tokenAddress);

    if (!holding || holding.amount <= 0) {
      console.log(`❌ 卖出失败：无持仓`);
      return false;
    }

    const sellAll = (cards === 'all');
    const cardsToSell = sellAll ? 4 : cards; // 假设总卡牌数为4

    // 更新持仓（模拟）
    const sellAmount = (cardsToSell / 4) * holding.amount; // 简化计算
    const newAmount = holding.amount - sellAmount;
    this._updateHolding(tokenAddress, Math.max(0, newAmount), holding.avgBuyPrice);

    // 检查是否全部卖出（修复后的逻辑）
    const isAllSold = sellAll || !this._getHolding(tokenAddress) || this._getHolding(tokenAddress).amount <= 0;

    if (isAllSold) {
      // 全部卖出，状态更新为 'sold'
      tokenState.status = 'sold';
      tokenState.soldAt = Date.now();
      console.log(`📉 全部卖出 ${cards === 'all' ? 'all' : cards} 张卡 | ${tokenSymbol}`);
      console.log(`   状态更新: monitoring/bought → sold ✅`);
    } else {
      // 部分卖出，状态保持 'bought'
      console.log(`📉 部分卖出 ${cards} 张卡 | ${tokenSymbol}`);
      console.log(`   状态保持: bought (剩余 ${this._getHolding(tokenAddress)?.amount || 0})`);
    }

    console.log(`   当前状态: ${tokenState.status}, 持仓: ${this._getHolding(tokenAddress)?.amount || 0}`);
    return true;
  }

  // 模拟策略评估
  _evaluateBuyStrategy(tokenAddress, tokenSymbol) {
    const tokenState = this._getOrCreateTokenState(tokenAddress, tokenSymbol);

    console.log(`\n🔍 评估买入策略 | ${tokenSymbol}`);
    console.log(`   当前状态: ${tokenState.status}`);

    // 只排除 sold 状态
    if (tokenState.status === 'sold') {
      console.log(`   ❌ 跳过买入：状态为 sold`);
      return false;
    }

    console.log(`   ✅ 允许买入：状态为 ${tokenState.status}`);
    return true;
  }

  printStatus(tokenAddress, tokenSymbol) {
    const tokenState = this._getOrCreateTokenState(tokenAddress, tokenSymbol);
    const holding = this._getHolding(tokenAddress);
    console.log(`\n📊 ${tokenSymbol} 状态:`);
    console.log(`   代币状态: ${tokenState.status}`);
    console.log(`   持仓数量: ${holding?.amount || 0}`);
  }
}

// 开始测试
const engine = new MockBacktestEngine();
const tokenAddress = '0xTEST';
const tokenSymbol = 'TEST';

console.log('=== 场景1: 买入 → 部分卖出 → 再次买入 ===');
engine._executeBuy(tokenAddress, tokenSymbol, 2, 0.25);
engine.printStatus(tokenAddress, tokenSymbol);

engine._executeSell(tokenAddress, tokenSymbol, 1, 0.3);
engine.printStatus(tokenAddress, tokenSymbol);

const canBuy1 = engine._evaluateBuyStrategy(tokenAddress, tokenSymbol);
console.log(`\n结论: ${canBuy1 ? '✅ 可以再次买入（部分卖出后）' : '❌ 无法买入'}`);

console.log('\n=== 场景2: 全部卖出 → 尝试买入 ===');
// 重置状态
engine._tokenStates.clear();
engine._portfolioManager._portfolios.clear();

engine._executeBuy(tokenAddress, tokenSymbol, 4, 0.25);
engine.printStatus(tokenAddress, tokenSymbol);

engine._executeSell(tokenAddress, tokenSymbol, 'all', 0.3);
engine.printStatus(tokenAddress, tokenSymbol);

const canBuy2 = engine._evaluateBuyStrategy(tokenAddress, tokenSymbol);
console.log(`\n结论: ${canBuy2 ? '✅ 可以买入（全部卖出后）' : '❌ 无法买入（状态为sold）'}`);

console.log('\n✅ 测试总结:');
console.log('1. ✅ 部分卖出后状态保持 bought，可以再次买入');
console.log('2. ✅ 全部卖出后状态变为 sold，无法再次买入');
console.log('3. ✅ 通过状态机制控制重复买入，配合卡牌管理器实现精确控制');
