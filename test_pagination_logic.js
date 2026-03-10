/**
 * 测试回测引擎的分页逻辑是否正常工作
 */

require('dotenv').config({ path: 'config/.env' });
const { AveTxAPI } = require('./src/core/ave-api');

const txApi = new AveTxAPI(
  'https://prod.ave-api.com',
  30000,
  process.env.AVE_API_KEY
);

async function testPagination() {
  const tokenAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';
  const pairId = `${tokenAddress}_fo-bsc`;

  // 模拟回测引擎的时间窗口
  const checkTime = 1773077512;
  const targetFromTime = checkTime - 90; // 90秒窗口
  const currentToTime = checkTime;

  console.log('=== 测试回测引擎的分页逻辑 ===\n');
  console.log('pairId:', pairId);
  console.log('时间窗口:', targetFromTime, '-', currentToTime, '(90秒)');
  console.log('');

  const maxLoops = 10;
  let loopCount = 0;
  let allTrades = [];

  while (loopCount < maxLoops) {
    loopCount++;

    console.log(`--- 第 ${loopCount} 次查询 ---`);
    console.log('参数:');
    console.log('  limit: 300');
    console.log('  fromTime:', targetFromTime);
    console.log('  toTime:', currentToTime);
    console.log('  sort: asc');

    try {
      const trades = await txApi.getSwapTransactions(
        pairId,
        300,
        targetFromTime,
        currentToTime,
        'asc'
      );

      console.log('\n结果:');
      console.log('  返回交易数:', trades.length);

      if (trades.length === 0) {
        console.log('  批次无数据，结束');
        break;
      }

      const batchFirstTime = trades[0].time;
      const batchLastTime = trades[trades.length - 1].time;

      console.log('  最早交易:', batchFirstTime, '(' + new Date(batchFirstTime * 1000).toLocaleString() + ')');
      console.log('  最晚交易:', batchLastTime, '(' + new Date(batchLastTime * 1000).toLocaleString() + ')');
      console.log('  时间跨度:', (batchLastTime - batchFirstTime).toFixed(1), '秒');

      allTrades.push(...trades);

      // 检查是否已经覆盖到目标起始时间
      if (batchFirstTime <= targetFromTime) {
        console.log('\n✓ 已覆盖完整时间窗口');
        console.log(`  目标起始时间: ${targetFromTime}`);
        console.log(`  实际最早时间: ${batchFirstTime}`);
        break;
      }

      // 如果返回了300条数据，可能还有更早的数据
      if (trades.length === 300) {
        currentToTime = batchFirstTime - 1;
        console.log('\n⚠️  返回了300条，可能还有更早的数据');
        console.log(`  继续查询，新的 toTime: ${currentToTime}`);
      } else {
        console.log('\n✓ 返回数据不足300条，已获取完毕');
        break;
      }
    } catch (error) {
      console.error('\n❌ API 调用失败:', error.message);
      break;
    }

    console.log('');
  }

  console.log('\n=== 总结 ===');
  console.log('查询次数:', loopCount);
  console.log('总交易数:', allTrades.length);

  if (allTrades.length > 0) {
    const firstTime = allTrades[0].time;
    const lastTime = allTrades[allTrades.length - 1].time;
    console.log('时间范围:', firstTime, '-', lastTime, `(${(lastTime - firstTime).toFixed(1)}秒)`);

    // 检查是否有缺失
    if (firstTime > targetFromTime) {
      const gap = firstTime - targetFromTime;
      console.log('\n⚠️  数据不完整！');
      console.log('  缺失时间:', gap.toFixed(1), '秒');
      console.log('  说明: 在目标起始时间前', gap.toFixed(1), '秒内没有交易');
    } else {
      console.log('\n✓ 数据完整');
    }
  }
}

testPagination().catch(console.error);
