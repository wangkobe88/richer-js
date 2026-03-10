/**
 * 测试 AVE API 的行为，看是否存在数据不完整的问题
 */

require('dotenv').config({ path: 'config/.env' });
const { AveTxAPI } = require('./src/core/ave-api');

const txApi = new AveTxAPI(
  'https://prod.ave-api.com',
  30000,
  process.env.AVE_API_KEY
);

async function testApiBehavior() {
  // 使用 1$ 代币的交易对
  const pairId = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444-bsc';
  const checkTime = 1773077512;  // 信号时间
  const targetFromTime = checkTime - 90;  // 目标起始时间

  console.log('=== 测试 AVE API 行为 ===\n');
  console.log('交易对:', pairId);
  console.log('目标时间窗口:', targetFromTime, '-', checkTime, '(90秒)\n');

  let currentToTime = checkTime;
  let loopCount = 0;
  const allTrades = [];

  while (loopCount < 5) {
    loopCount++;

    console.log(`--- 第 ${loopCount} 次调用 ---`);
    console.log('参数:');
    console.log('  fromTime:', targetFromTime);
    console.log('  toTime:', currentToTime);
    console.log('  limit: 300');

    const trades = await txApi.getSwapTransactions(
      pairId,
      300,
      targetFromTime,
      currentToTime,
      'asc'
    );

    console.log('结果:');
    console.log('  返回交易数:', trades.length);

    if (trades.length > 0) {
      const batchFirstTime = trades[0].time;
      const batchLastTime = trades[trades.length - 1].time;
      console.log('  最早交易时间:', batchFirstTime);
      console.log('  最晚交易时间:', batchLastTime);
      console.log('  时间跨度:', (batchLastTime - batchFirstTime).toFixed(1), '秒');

      allTrades.push(...trades);

      if (batchFirstTime <= targetFromTime) {
        console.log('  ✓ 已覆盖目标起始时间');
        break;
      }

      if (trades.length === 300) {
        currentToTime = batchFirstTime - 1;
        console.log('  → 继续获取更早的数据，toTime 更新为:', currentToTime);
      } else {
        console.log('  ✗ 返回数据 < 300条，但未覆盖目标时间');
        console.log('  ⚠️  这可能是 API 的限制：只返回了最近的数据');
        break;
      }
    } else {
      console.log('  ✗ 返回空数据');
      break;
    }

    console.log('');
  }

  console.log('\n=== 最终结果 ===');
  if (allTrades.length > 0) {
    const actualFirst = allTrades[0].time;
    const actualLast = allTrades[allTrades.length - 1].time;
    const actualSpan = actualLast - actualFirst;
    const gap = actualFirst - targetFromTime;

    console.log('总交易数:', allTrades.length);
    console.log('实际时间窗口:', actualFirst, '-', actualLast, `(${actualSpan.toFixed(1)}秒)`);
    console.log('缺失时间:', gap.toFixed(1), '秒');

    if (gap > 0) {
      console.log('\n⚠️  数据不完整！');
      console.log('可能原因:');
      console.log('1. AVE API 只存储了最近 N 秒的交易数据');
      console.log('2. from_time 参数的行为不符合预期（可能只返回有数据的时间范围）');
      console.log('3. 代币创建后前几秒确实没有交易');
    }
  } else {
    console.log('未获取到任何交易数据');
  }
}

testApiBehavior().catch(console.error);
