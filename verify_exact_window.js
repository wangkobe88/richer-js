/**
 * 精确验证：代币创建到信号时间之间到底有多少交易
 */

require('dotenv').config({ path: 'config/.env' });
const { AveTokenAPI, AveTxAPI } = require('./src/core/ave-api');

const tokenApi = new AveTokenAPI('https://prod.ave-api.com', 30000, process.env.AVE_API_KEY);
const txApi = new AveTxAPI('https://prod.ave-api.com', 30000, process.env.AVE_API_KEY);

async function verifyExactWindow() {
  const tokenAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';
  const pairId = `${tokenAddress}_fo-bsc`;

  // 1. 获取代币详情
  const tokenId = `${tokenAddress}-bsc`;
  const tokenDetail = await tokenApi.getTokenDetail(tokenId);
  const launchAt = tokenDetail.token.launch_at;

  // 2. 回测引擎的时间窗口
  const checkTime = 1773077512;
  const backtestFromTime = checkTime - 90; // 1773077422
  const backtestToTime = checkTime;         // 1773077512

  console.log('=== 精确验证交易数量 ===\n');
  console.log('代币信息:');
  console.log('  launch_at:', launchAt, '(' + new Date(launchAt * 1000).toLocaleString() + ')');
  console.log('  信号时间:', checkTime, '(' + new Date(checkTime * 1000).toLocaleString() + ')');
  console.log('  时间差:', (checkTime - launchAt), '秒（', ((checkTime - launchAt) / 60).toFixed(2), '分钟）');
  console.log('');

  console.log('回测引擎时间窗口:');
  console.log('  fromTime:', backtestFromTime, '(' + new Date(backtestFromTime * 1000).toLocaleString() + ')');
  console.log('  toTime:', backtestToTime, '(' + new Date(backtestToTime * 1000).toLocaleString() + ')');
  console.log('  跨度:', 90, '秒');
  console.log('');

  // 3. 用页面API的方式查询这个精确窗口（使用分页）
  console.log('--- 查询1：使用回测引擎的精确窗口（带分页） ---');
  let window1AllTrades = [];
  let window1CurrentToTime = backtestToTime;
  let window1PageCount = 0;

  while (window1PageCount < 10) {
    window1PageCount++;
    const batchTrades = await txApi.getSwapTransactions(
      pairId,
      300,
      backtestFromTime,
      window1CurrentToTime,
      'asc'
    );
    console.log(`第${window1PageCount}次查询: 返回 ${batchTrades.length} 条`);
    if (batchTrades.length === 0) break;
    window1AllTrades.push(...batchTrades);
    if (batchTrades.length < 300) break;
    window1CurrentToTime = batchTrades[0].time - 1;
  }

  const window1Trades = window1AllTrades;
  console.log('参数: limit=1000, fromTime=' + backtestFromTime + ', toTime=' + backtestToTime);
  console.log('返回交易数:', window1Trades.length);
  if (window1Trades.length > 0) {
    console.log('最早交易:', window1Trades[0].time, '(' + new Date(window1Trades[0].time * 1000).toLocaleString() + ')');
    console.log('最晚交易:', window1Trades[window1Trades.length - 1].time, '(' + new Date(window1Trades[window1Trades.length - 1].time * 1000).toLocaleString() + ')');
  }
  console.log('');

  // 4. 查询 launch_at 到 checkTime 之间的交易（使用分页）
  console.log('--- 查询2：从 launch_at 到 checkTime（带分页） ---');
  const window2FromTime = launchAt;
  const window2ToTime = checkTime;
  let window2AllTrades = [];
  let window2CurrentToTime = window2ToTime;
  let window2PageCount = 0;

  while (window2PageCount < 10) {
    window2PageCount++;
    const batchTrades = await txApi.getSwapTransactions(
      pairId,
      300,
      window2FromTime,
      window2CurrentToTime,
      'asc'
    );
    console.log(`第${window2PageCount}次查询: 返回 ${batchTrades.length} 条`);
    if (batchTrades.length === 0) break;
    window2AllTrades.push(...batchTrades);
    if (batchTrades.length < 300) break;
    window2CurrentToTime = batchTrades[0].time - 1;
  }

  const window2Trades = window2AllTrades;
  console.log('参数: limit=1000, fromTime=' + window2FromTime + ', toTime=' + window2ToTime);
  console.log('返回交易数:', window2Trades.length);
  if (window2Trades.length > 0) {
    console.log('最早交易:', window2Trades[0].time, '(' + new Date(window2Trades[0].time * 1000).toLocaleString() + ')');
    console.log('最晚交易:', window2Trades[window2Trades.length - 1].time, '(' + new Date(window2Trades[window2Trades.length - 1].time * 1000).toLocaleString() + ')');
    console.log('实际跨度:', (window2Trades[window2Trades.length - 1].time - window2Trades[0].time), '秒');
  }
  console.log('');

  console.log('');

  // 5. 检查是否达到分页限制
  if (window2PageCount >= 10) {
    console.log('⚠️  达到分页上限（10次），可能还有更多交易！');
  }
  console.log('');

  // 6. 模拟页面API的查询方式（launch_at后3分钟）
  console.log('--- 查询3：页面API方式（launch_at后3分钟）---');
  const pageFromTime = launchAt;
  const pageToTime = launchAt + 180;
  const pageTrades = await txApi.getSwapTransactions(
    pairId,
    300,
    pageFromTime,
    pageToTime,
    'asc'
  );
  console.log('参数: limit=300, fromTime=' + pageFromTime + ', toTime=' + pageToTime);
  console.log('返回交易数:', pageTrades.length);
  if (pageTrades.length > 0) {
    console.log('最早交易:', pageTrades[0].time, '(' + new Date(pageTrades[0].time * 1000).toLocaleString() + ')');
    console.log('最晚交易:', pageTrades[pageTrades.length - 1].time, '(' + new Date(pageTrades[pageTrades.length - 1].time * 1000).toLocaleString() + ')');
  }
  console.log('');

  // 7. 分析与总结
  console.log('=== 分析总结 ===\n');

  console.log('关键时间点:');
  console.log('  launch_at:', launchAt);
  console.log('  checkTime:', checkTime);
  console.log('  时间差:', (checkTime - launchAt), '秒');
  console.log('');

  console.log('交易数量对比:');
  console.log('  查询1 [回测窗口]:', window1Trades.length, '条');
  console.log('  查询2 [launch~check]:', window2Trades.length, '条');
  console.log('  查询3 [页面窗口]:', pageTrades.length, '条');
  console.log('');

  // 判断
  if (window1Trades.length === 300) {
    console.log('✓ 确认：回测引擎的时间窗口内刚好有300条交易（API单次限制）');
    console.log('  说明：代币创建到信号时间之间的交易数 >= 300');
  } else if (window2Trades.length === 300) {
    console.log('✓ 确认：launch_at 到 checkTime 之间刚好有300条交易');
  } else {
    console.log('交易数不是300，需要进一步分析');
  }

  // 检查是否有数据缺失
  if (window1Trades.length === 300 && window1Trades[0].time > backtestFromTime) {
    const gap = window1Trades[0].time - backtestFromTime;
    console.log('\n⚠️  回测窗口前', gap.toFixed(1), '秒没有数据（在代币创建前）');
  }

  if (window2Trades.length > 0 && window2Trades[0].time > window2FromTime) {
    const gap = window2Trades[0].time - window2FromTime;
    console.log('⚠️  launch_at 后', gap.toFixed(1), '秒才第一笔交易（代币创建后延迟）');
  }
}

verifyExactWindow().catch(console.error);
