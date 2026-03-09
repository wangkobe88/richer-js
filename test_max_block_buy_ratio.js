/**
 * 测试新因子 walletClusterMaxBlockBuyRatio
 */

const { WalletClusterService } = require('./src/trading-engine/pre-check/WalletClusterService');

// 模拟交易数据
const mockTrades = [
  // 区块 85547523 - 10笔交易（逆克莱默的情况）
  { time: 1773042536, block_number: 85547523, from_usd: 115.22, to_usd: 0 },
  { time: 1773042536, block_number: 85547523, from_usd: 325.10, to_usd: 0 },
  { time: 1773042536, block_number: 85547523, from_usd: 50.26, to_usd: 0 },
  { time: 1773042536, block_number: 85547523, from_usd: 68.64, to_usd: 0 },
  { time: 1773042536, block_number: 85547523, from_usd: 161.57, to_usd: 0 },
  { time: 1773042536, block_number: 85547523, from_usd: 194.52, to_usd: 0 },
  { time: 1773042536, block_number: 85547523, from_usd: 50.51, to_usd: 0 },
  { time: 1773042536, block_number: 85547523, from_usd: 41.25, to_usd: 0 },
  { time: 1773042536, block_number: 85547523, from_usd: 91.08, to_usd: 0 },
  { time: 1773042536, block_number: 85547523, from_usd: 132.25, to_usd: 0 },
  // 其他区块
  { time: 1773042540, block_number: 85547524, from_usd: 50.00, to_usd: 0 },
  { time: 1773042541, block_number: 85547525, from_usd: 100.00, to_usd: 0 },
  { time: 1773042542, block_number: 85547526, from_usd: 75.00, to_usd: 0 },
];

// 简单的logger
const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
};

const walletClusterService = new WalletClusterService(logger);

console.log('=== 测试 walletClusterMaxBlockBuyRatio 因子 ===\n');

console.log('模拟交易数据：');
console.log(`  总交易数: ${mockTrades.length}`);
console.log(`  总买入额: $${mockTrades.reduce((sum, t) => sum + (t.from_usd || 0), 0).toFixed(2)}`);
console.log('');

const result = walletClusterService.performClusterAnalysis(mockTrades);

console.log('【计算结果】\n');
console.log(`walletClusterMaxBlockBuyRatio: ${result.walletClusterMaxBlockBuyRatio}`);
console.log(`walletClusterMaxBlockNumber: ${result.walletClusterMaxBlockNumber}`);
console.log(`walletClusterMaxBlockBuyAmount: $${result.walletClusterMaxBlockBuyAmount}`);
console.log(`walletClusterTotalBuyAmount: $${result.walletClusterTotalBuyAmount}`);
console.log('');

// 验证计算
const totalBuyAmount = mockTrades.reduce((sum, t) => sum + (t.from_usd || 0), 0);
const block85547523Amount = mockTrades
  .filter(t => t.block_number === 85547523)
  .reduce((sum, t) => sum + (t.from_usd || 0), 0);
const expectedRatio = block85547523Amount / totalBuyAmount;

console.log('【验证】\n');
console.log(`区块85547523买入金额: $${block85547523Amount.toFixed(2)}`);
console.log(`总买入金额: $${totalBuyAmount.toFixed(2)}`);
console.log(`预期最大区块买入占比: ${(expectedRatio * 100).toFixed(1)}%`);
console.log(`实际计算结果: ${(result.walletClusterMaxBlockBuyRatio * 100).toFixed(1)}%`);
console.log(`差异: ${Math.abs(result.walletClusterMaxBlockBuyRatio - expectedRatio) < 0.0001 ? '✓ 通过' : '✗ 失败'}`);
console.log('');

// 测试阈值
const threshold = 0.15;
console.log('【阈值测试】\n');
console.log(`阈值: ${threshold * 100}%`);
console.log(`结果: ${result.walletClusterMaxBlockBuyRatio >= threshold ? '拒绝' : '通过'}`);

if (result.walletClusterMaxBlockBuyRatio >= threshold) {
  console.log(`→ 建议拒绝此代币（第一区块买入占比${(result.walletClusterMaxBlockBuyRatio * 100).toFixed(1)}% >= ${threshold * 100}%）`);
} else {
  console.log(`→ 通过检查（第一区块买入占比${(result.walletClusterMaxBlockBuyRatio * 100).toFixed(1)}% < ${threshold * 100}%）`);
}
