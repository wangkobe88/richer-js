/**
 * 对比页面API和回测引擎的时间窗口
 */

require('dotenv').config({ path: 'config/.env' });
const { AveTokenAPI, AveTxAPI } = require('./src/core/ave-api');

const tokenApi = new AveTokenAPI('https://prod.ave-api.com', 30000, process.env.AVE_API_KEY);
const txApi = new AveTxAPI('https://prod.ave-api.com', 30000, process.env.AVE_API_KEY);

async function compareTimeWindows() {
  const tokenAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';
  const chain = 'bsc';
  const tokenId = `${tokenAddress}-${chain}`;

  console.log('=== 对比页面API和回测引擎的时间窗口 ===\n');

  // 1. 获取代币详情
  const tokenDetail = await tokenApi.getTokenDetail(tokenId);
  const launchAt = tokenDetail.token.launch_at;

  console.log('代币信息:');
  console.log('  token_address:', tokenAddress);
  console.log('  launch_at:', launchAt, '(' + new Date(launchAt * 1000).toLocaleString() + ')');
  console.log('');

  // 页面API的时间窗口
  const pageFromTime = launchAt;
  const pageToTime = launchAt + 180; // 3分钟

  console.log('页面API时间窗口（3分钟）:');
  console.log('  fromTime:', pageFromTime, '(' + new Date(pageFromTime * 1000).toLocaleString() + ')');
  console.log('  toTime:', pageToTime, '(' + new Date(pageToTime * 1000).toLocaleString() + ')');
  console.log('  时间跨度:', 180, '秒（3分钟）');
  console.log('');

  // 回测引擎的时间窗口
  const checkTime = 1773077512;
  const backtestFromTime = checkTime - 90;
  const backtestToTime = checkTime;

  console.log('回测引擎时间窗口（90秒）:');
  console.log('  fromTime:', backtestFromTime, '(' + new Date(backtestFromTime * 1000).toLocaleString() + ')');
  console.log('  toTime:', backtestToTime, '(' + new Date(backtestToTime * 1000).toLocaleString() + ')');
  console.log('  时间跨度:', 90, '秒');
  console.log('');

  // 检查窗口重叠
  const overlapStart = Math.max(pageFromTime, backtestFromTime);
  const overlapEnd = Math.min(pageToTime, backtestToTime);

  if (overlapStart < overlapEnd) {
    console.log('窗口重叠:');
    console.log('  重叠开始:', overlapStart, '(' + new Date(overlapStart * 1000).toLocaleString() + ')');
    console.log('  重叠结束:', overlapEnd, '(' + new Date(overlapEnd * 1000).toLocaleString() + ')');
    console.log('  重叠长度:', (overlapEnd - overlapStart), '秒');
  } else {
    console.log('窗口不重叠！');
  }
  console.log('');

  // 查询页面API时间窗口的交易数
  const pairId = `${tokenAddress}_fo-bsc`;
  const pageTrades = await txApi.getSwapTransactions(pairId, 300, pageFromTime, pageToTime, 'asc');

  console.log('页面API查询结果（3分钟窗口）:');
  console.log('  返回交易数:', pageTrades.length);
  if (pageTrades.length > 0) {
    console.log('  最早交易:', pageTrades[0].time, '(' + new Date(pageTrades[0].time * 1000).toLocaleString() + ')');
    console.log('  最晚交易:', pageTrades[pageTrades.length - 1].time, '(' + new Date(pageTrades[pageTrades.length - 1].time * 1000).toLocaleString() + ')');
    console.log('  实际跨度:', (pageTrades[pageTrades.length - 1].time - pageTrades[0].time), '秒');
  }
  console.log('');

  // 如果返回了300条，继续分页
  if (pageTrades.length === 300) {
    console.log('页面API返回了300条，继续分页...');
    let allPageTrades = [...pageTrades];
    let currentToTime = pageTrades[0].time - 1;
    let pageCount = 1;

    while (pageCount < 10) {
      pageCount++;
      const moreTrades = await txApi.getSwapTransactions(pairId, 300, pageFromTime, currentToTime, 'asc');

      console.log(`第 ${pageCount} 次查询: 返回 ${moreTrades.length} 条`);
      if (moreTrades.length === 0) break;

      allPageTrades.push(...moreTrades);
      if (moreTrades.length < 300) break;

      currentToTime = moreTrades[0].time - 1;
    }

    console.log('页面API总计（分页后）:');
    console.log('  总交易数:', allPageTrades.length);
    console.log('  查询次数:', pageCount);
  }

  console.log('');
  console.log('=== 结论 ===');
  console.log('页面API和回测引擎使用的是不同的时间窗口：');
  console.log('- 页面API: 代币创建后3分钟');
  console.log('- 回测引擎: 检查时间前90秒');
  console.log('');
  console.log('这就是为什么页面能获取更多交易数据的原因。');
}

compareTimeWindows().catch(console.error);
