/**
 * 验证修复后的早期大户识别
 */

require('dotenv').config({ path: 'config/.env' });
const { AveTxAPI } = require('./src/core/ave-api');
const { EarlyWhaleService } = require('./src/trading-engine/pre-check/EarlyWhaleService');

const txApi = new AveTxAPI('https://prod.ave-api.com', 30000, process.env.AVE_API_KEY);

// 创建一个简单的 logger
const logger = {
  info: (msg, data) => console.log('[INFO]', msg, data ? JSON.stringify(data) : ''),
  debug: (msg, data) => console.log('[DEBUG]', msg, data ? JSON.stringify(data) : ''),
  warn: (msg, data) => console.log('[WARN]', msg, data ? JSON.stringify(data) : ''),
  error: (msg, data) => console.log('[ERROR]', msg, data ? JSON.stringify(data) : '')
};

async function verifyFix() {
  const tokenAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';
  const innerPair = `${tokenAddress}_fo`;
  const chain = 'bsc';
  const launchAt = 1773077436;
  const checkTime = 1773077512;

  console.log('=== 验证修复后的早期大户识别 ===\n');
  console.log('代币:', tokenAddress);
  console.log('检查时间:', checkTime, '(' + new Date(checkTime * 1000).toLocaleString() + ')');
  console.log('');

  // 创建 EarlyWhaleService 实例
  const whaleService = new EarlyWhaleService(logger);

  // 先获取交易数据
  const pairId = `${innerPair}-${chain}`;
  const trades = await txApi.getSwapTransactions(pairId, 300, launchAt, checkTime, 'asc');

  console.log('获取到交易数:', trades.length);
  console.log('');

  // 执行早期大户分析
  const result = await whaleService.performEarlyWhaleAnalysis(trades, {
    tokenCreateTime: launchAt,
    checkTime: checkTime
  });

  console.log('=== 结果 ===\n');
  console.log('earlyWhaleCount:', result.earlyWhaleCount);
  console.log('earlyWhaleSellRatio:', result.earlyWhaleSellRatio);
  console.log('earlyWhaleHoldRatio:', result.earlyWhaleHoldRatio);
  console.log('earlyWhaleMethod:', result.earlyWhaleMethod);
  console.log('earlyWhaleEarlyThreshold:', result.earlyWhaleEarlyThreshold);
  console.log('earlyWhaleTotalTrades:', result.earlyWhaleTotalTrades);
  console.log('');

  if (result.earlyWhaleCount > 0) {
    console.log('✓ 修复成功！识别到', result.earlyWhaleCount, '个早期大户');
    console.log('  之前为 0，现在为', result.earlyWhaleCount);
  } else {
    console.log('⚠️  仍然没有识别到早期大户');
  }
}

verifyFix().catch(console.error);
