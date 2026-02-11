/**
 * 测试 FourMemeDirectTrader 的新代码是否正确加载
 */
const { ethers } = require('ethers');

// 测试 getTokenDecimals 方法是否存在
const FourMemeDirectTrader = require('../src/trading-engine/traders/implementations/FourMemeDirectTrader');

const trader = new FourMemeDirectTrader();

console.log('FourMemeDirectTrader 方法检查:');
console.log('  getTokenDecimals:', typeof trader.getTokenDecimals);
console.log('  sellToken:', typeof trader.sellToken);

// 检查 sellToken 方法源码中是否包含 "4参数版本" 字符串
const sellTokenSource = trader.sellToken.toString();
console.log('  sellToken 源码包含 "4参数版本":', sellTokenSource.includes('4参数版本'));
console.log('  sellToken 源码包含 "getTokenDecimals":', sellTokenSource.includes('getTokenDecimals'));
