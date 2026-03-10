/**
 * 直接对比回测引擎和页面API获取的数据
 */

require('dotenv').config({ path: 'config/.env' });
const { AveTokenAPI, AveTxAPI } = require('./src/core/ave-api');

const tokenApi = new AveTokenAPI('https://prod.ave-api.com', 30000, process.env.AVE_API_KEY);
const txApi = new AveTxAPI('https://prod.ave-api.com', 30000, process.env.AVE_API_KEY);

async function compareDirectly() {
  const tokenAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';
  const pairId = `${tokenAddress}_fo-bsc`;
  const tokenId = `${tokenAddress}-bsc`;

  const tokenDetail = await tokenApi.getTokenDetail(tokenId);
  const launchAt = tokenDetail.token.launch_at;
  const checkTime = 1773077512; // 回测时的检查时间

  console.log('=== 直接对比回测引擎 vs 页面API ===\n');
  console.log('launch_at:', launchAt);
  console.log('checkTime:', checkTime);
  console.log('');

  // 回测引擎的方式：checkTime前90秒
  const backtestFromTime = checkTime - 90;
  const backtestToTime = checkTime;

  console.log('回测引擎查询:');
  console.log('  fromTime:', backtestFromTime);
  console.log('  toTime:', backtestToTime);
  console.log('  窗口:', (backtestToTime - backtestFromTime), '秒');

  const backtestTrades = await txApi.getSwapTransactions(pairId, 300, backtestFromTime, backtestToTime, 'asc');
  console.log('  返回:', backtestTrades.length, '条');
  if (backtestTrades.length > 0) {
    console.log('  最早:', backtestTrades[0].time);
    console.log('  最晚:', backtestTrades[backtestTrades.length - 1].time);
  }
  console.log('');

  // 页面API的方式：从launch_at开始，获取到checkTime的所有交易
  console.log('页面API查询（launch_at到checkTime）:');
  console.log('  fromTime:', launchAt);
  console.log('  toTime:', checkTime);
  console.log('  窗口:', (checkTime - launchAt), '秒');

  // 使用分页获取所有数据
  let allPageTrades = [];
  let currentToTime = checkTime;
  let pageCount = 0;

  while (pageCount < 10) {
    pageCount++;
    const batch = await txApi.getSwapTransactions(pairId, 300, launchAt, currentToTime, 'asc');
    if (batch.length === 0) break;
    allPageTrades.push(...batch);
    if (batch.length < 300) break;
    currentToTime = batch[0].time - 1;
  }

  console.log('  返回:', allPageTrades.length, '条（分页', pageCount, '次）');
  if (allPageTrades.length > 0) {
    console.log('  最早:', allPageTrades[0].time);
    console.log('  最晚:', allPageTrades[allPageTrades.length - 1].time);
  }
  console.log('');

  // 对比
  console.log('=== 对比结果 ===\n');
  console.log('回测引擎: ', backtestTrades.length, '条');
  console.log('页面API:   ', allPageTrades.length, '条');
  console.log('');

  if (backtestTrades.length === allPageTrades.length) {
    console.log('✓ 数量相同！回测引擎获取了完整数据');
    console.log('  说明：在 launch_at 到 checkTime 之间（', (checkTime - launchAt), '秒）');
    console.log('  刚好有', backtestTrades.length, '笔交易');
  } else {
    console.log('⚠️  数量不同！');
    console.log('  回测引擎遗漏了', allPageTrades.length - backtestTrades.length, '笔交易');
  }

  // 检查内容是否一致
  if (backtestTrades.length > 0 && allPageTrades.length > 0) {
    console.log('');
    console.log('内容对比:');
    console.log('  回测引擎最早:', backtestTrades[0].time);
    console.log('  页面API最早:  ', allPageTrades[0].time);
    console.log('  回测引擎最晚:', backtestTrades[backtestTrades.length - 1].time);
    console.log('  页面API最晚:  ', allPageTrades[allPageTrades.length - 1].time);

    if (backtestTrades[0].time === allPageTrades[0].time &&
        backtestTrades[backtestTrades.length - 1].time === allPageTrades[allPageTrades.length - 1].time) {
      console.log('  ✓ 时间范围一致');
    }
  }
}

compareDirectly().catch(console.error);
