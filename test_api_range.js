/**
 * 使用实际数据中的时间范围测试 AVE API
 */

require('dotenv').config({ path: 'config/.env' });
const { AveTxAPI } = require('./src/core/ave-api');

const txApi = new AveTxAPI(
  'https://prod.ave-api.com',
  30000,
  process.env.AVE_API_KEY
);

async function testApiWithActualRange() {
  // 使用 1$ 代币的实际数据范围
  const pairId = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444-bsc';

  // 从数据库中获取的实际时间范围
  const actualFirstTime = 1773077437;
  const actualLastTime = 1773077511;
  const targetFromTime = 1773077422; // 信号时间 - 90秒

  console.log('=== 测试 AVE API 时间范围行为 ===\n');
  console.log('交易对:', pairId);
  console.log('');

  // 测试 1: 请求完整的目标时间窗口
  console.log('--- 测试 1: 请求完整目标时间窗口 ---');
  console.log('fromTime:', targetFromTime);
  console.log('toTime:', actualLastTime);
  const result1 = await txApi.getSwapTransactions(pairId, 300, targetFromTime, actualLastTime, 'asc');
  console.log('返回交易数:', result1.length);
  if (result1.length > 0) {
    console.log('最早时间:', result1[0].time);
    console.log('最晚时间:', result1[result1.length - 1].time);
  }
  console.log('');

  // 测试 2: 只请求实际有数据的时间范围
  console.log('--- 测试 2: 请求实际有数据的时间范围 ---');
  console.log('fromTime:', actualFirstTime);
  console.log('toTime:', actualLastTime);
  const result2 = await txApi.getSwapTransactions(pairId, 300, actualFirstTime, actualLastTime, 'asc');
  console.log('返回交易数:', result2.length);
  if (result2.length > 0) {
    console.log('最早时间:', result2[0].time);
    console.log('最晚时间:', result2[result2.length - 1].time);
  }
  console.log('');

  // 测试 3: 请求缺失的时间段
  console.log('--- 测试 3: 请求缺失的时间段 ---');
  console.log('fromTime:', targetFromTime);
  console.log('toTime:', actualFirstTime - 1);
  const result3 = await txApi.getSwapTransactions(pairId, 300, targetFromTime, actualFirstTime - 1, 'asc');
  console.log('返回交易数:', result3.length);
  if (result3.length > 0) {
    console.log('最早时间:', result3[0].time);
    console.log('最晚时间:', result3[result3.length - 1].time);
  } else {
    console.log('⚠️  API 返回空数据');
    console.log('这说明: 在 targetFromTime 到 actualFirstTime-1 之间，API 确实没有交易数据');
    console.log('可能是:');
    console.log('  1. 代币创建后前几秒确实没有交易');
    console.log('  2. AVE API 的数据存储有延迟，只存储了最近 N 秒的数据');
  }

  console.log('\n=== 结论 ===');
  console.log('如果测试 3 返回空数据，说明缺失的时间段内确实没有交易数据。');
  console.log('这不是 API 限制，而是数据本身就不完整。');
}

testApiWithActualRange().catch(console.error);
