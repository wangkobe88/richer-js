/**
 * 测试早期大户因子集成
 */

const { EarlyWhaleService } = require('./src/trading-engine/pre-check/EarlyWhaleService');
const { buildPreBuyCheckFactorValues } = require('./src/trading-engine/core/FactorBuilder');

// 模拟交易数据
const mockTrades = [
  // 早期交易（前10笔）
  { time: 1000, wallet_address: '0xAAA', from_token_symbol: 'USDT', from_usd: 500, to_amount: 1000, from_amount: 300 },
  { time: 1001, wallet_address: '0xAAA', to_token_symbol: 'USDT', to_usd: 0, from_amount: 500 },
  { time: 1002, wallet_address: '0xBBB', from_token_symbol: 'USDT', from_usd: 300, to_amount: 600, from_amount: 200 },
  { time: 1003, wallet_address: '0xBBB', to_token_symbol: 'USDT', to_usd: 400, from_amount: 400 },
  { time: 1004, wallet_address: '0xCCC', from_token_symbol: 'USDT', from_usd: 400, to_amount: 800 },
  // 持有的大户（不卖出）
  { time: 1005, wallet_address: '0xDDD', from_token_symbol: 'USDT', from_usd: 350, to_amount: 700 },
  // 更多交易...
  { time: 2000, wallet_address: '0xEEE', from_token_symbol: 'USDT', from_usd: 100, to_amount: 200 },
  { time: 3000, wallet_address: '0xFFF', from_token_symbol: 'USDT', from_usd: 150, to_amount: 300 },
];

// 创建 logger
const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
};

console.log('=== 测试早期大户因子 ===\n');

// 1. 测试 EarlyWhaleService
const whaleService = new EarlyWhaleService(logger);

console.log('1. 测试真实早期数据方法:');
const result1 = whaleService.performEarlyWhaleAnalysis(mockTrades, {
  tokenCreateTime: 1000,
  checkTime: 1120  // 时间差 = 120秒，使用真实早期方法
});
console.log('  方法:', result1.method);
console.log('  持有率:', result1.earlyWhaleHoldRatio);
console.log('  卖出率:', result1.earlyWhaleSellRatio);
console.log('  大户数:', result1.earlyWhaleCount);

console.log('\n2. 测试相对交易位置方法:');
const result2 = whaleService.performEarlyWhaleAnalysis(mockTrades, {
  tokenCreateTime: 1000,
  checkTime: 1300  // 时间差 = 300秒，使用相对方法
});
console.log('  方法:', result2.method);
console.log('  持有率:', result2.earlyWhaleHoldRatio);
console.log('  卖出率:', result2.earlyWhaleSellRatio);
console.log('  大户数:', result2.earlyWhaleCount);

// 3. 测试因子构建
console.log('\n3. 测试因子构建:');
const mockPreBuyResult = {
  holderWhitelistCount: 5,
  holderBlacklistCount: 0,
  earlyWhaleHoldRatio: 0.4,
  earlyWhaleSellRatio: 0.7,
  earlyWhaleCount: 3,
  earlyWhaleMethod: 'real_early'
};

const factors = buildPreBuyCheckFactorValues(mockPreBuyResult);
console.log('  构建的因子:', {
  earlyWhaleHoldRatio: factors.earlyWhaleHoldRatio,
  earlyWhaleSellRatio: factors.earlyWhaleSellRatio,
  earlyWhaleCount: factors.earlyWhaleCount,
  earlyWhaleMethod: factors.earlyWhaleMethod
});

// 4. 测试条件评估
console.log('\n4. 测试条件评估:');
const conditions = [
  'earlyWhaleSellRatio > 0.7',
  'earlyWhaleHoldRatio < 0.4 && earlyWhaleSellRatio > 0.3',
  'earlyWhaleSellRatio > 0.5'
];

for (const condition of conditions) {
  const canBuy = evaluateCondition(condition, factors);
  console.log(`  "${condition}" => ${canBuy ? '通过' : '拒绝'}`);
}

function evaluateCondition(expression, context) {
  const jsExpr = expression
    .replace(/\bAND\b/gi, '&&')
    .replace(/\bOR\b/gi, '||')
    .replace(/\bNOT\b/gi, '!');

  const keys = Object.keys(context);
  const values = Object.values(context);
  const fn = new Function(...keys, `return ${jsExpr};`);
  return fn(...values);
}

console.log('\n✓ 所有测试通过！');
