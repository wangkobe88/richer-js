/**
 * 使用正确的 pairId 格式真实测试 AVE API
 */

require('dotenv').config({ path: 'config/.env' });
const { AveTxAPI } = require('./src/core/ave-api');

const txApi = new AveTxAPI(
  'https://prod.ave-api.com',
  30000,
  process.env.AVE_API_KEY
);

async function testRealApiCall() {
  // 1$ 代币的正确 pairId
  const pairId = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444_fo-bsc';

  // 回测时的检查时间
  const checkTime = 1773077512;
  const targetFromTime = checkTime - 90; // 1773077422

  console.log('=== 真实 API 调用测试 ===\n');
  console.log('pairId:', pairId);
  console.log('checkTime:', checkTime, '(' + new Date(checkTime * 1000).toLocaleString() + ')');
  console.log('targetFromTime:', targetFromTime, '(' + new Date(targetFromTime * 1000).toLocaleString() + ')');
  console.log('');

  // 第一次调用（模拟代码逻辑）
  console.log('--- 第 1 次调用 ---');
  console.log('参数:');
  console.log('  limit: 300');
  console.log('  fromTime:', targetFromTime);
  console.log('  toTime:', checkTime);
  console.log('  sort: asc');

  try {
    const trades1 = await txApi.getSwapTransactions(
      pairId,
      300,
      targetFromTime,
      checkTime,
      'asc'
    );

    console.log('\n结果:');
    console.log('  返回交易数:', trades1.length);

    if (trades1.length > 0) {
      const batchFirstTime = trades1[0].time;
      const batchLastTime = trades1[trades1.length - 1].time;

      console.log('  最早交易时间:', batchFirstTime, '(' + new Date(batchFirstTime * 1000).toLocaleString() + ')');
      console.log('  最晚交易时间:', batchLastTime, '(' + new Date(batchLastTime * 1000).toLocaleString() + ')');
      console.log('  时间跨度:', (batchLastTime - batchFirstTime).toFixed(1), '秒');

      console.log('\n前3笔交易:');
      trades1.slice(0, 3).forEach((t, i) => {
        console.log(`  ${i + 1}. 时间:${t.time} 钱包:${t.from_address?.substring(0, 10)}... 金额:$${t.from_usd?.toFixed(2) || 0}`);
      });

      // 检查是否需要继续获取
      if (batchFirstTime > targetFromTime) {
        console.log('\n⚠️  最早交易时间 > 目标起始时间，需要继续获取更早的数据');
        console.log('  缺失:', (batchFirstTime - targetFromTime).toFixed(1), '秒');

        // 第二次调用
        const currentToTime = batchFirstTime - 1;
        console.log('\n--- 第 2 次调用 ---');
        console.log('参数:');
        console.log('  limit: 300');
        console.log('  fromTime:', targetFromTime);
        console.log('  toTime:', currentToTime);
        console.log('  sort: asc');

        const trades2 = await txApi.getSwapTransactions(
          pairId,
          300,
          targetFromTime,
          currentToTime,
          'asc'
        );

        console.log('\n结果:');
        console.log('  返回交易数:', trades2.length);

        if (trades2.length === 0) {
          console.log('\n✓ 第二次调用返回空数据');
          console.log('  说明: 在 targetFromTime 到 currentToTime 之间确实没有交易');
          console.log('  这证实了: 缺失的15秒内确实没有交易，不是数据丢失');
        }
      } else {
        console.log('\n✓ 已覆盖完整时间窗口');
      }
    } else {
      console.log('  ⚠️  返回空数据');
      console.log('  说明: AVE API 没有这个交易对的数据');
    }
  } catch (error) {
    console.error('\n❌ API 调用失败:');
    console.error('  错误:', error.message);
    console.error('  可能原因:');
    console.error('    1. pairId 格式不正确');
    console.error('    2. AVE API 没有这个交易对的历史数据');
    console.error('    3. AVE API Key 无效或过期');
  }
}

testRealApiCall().catch(console.error);
