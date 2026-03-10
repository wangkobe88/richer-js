/**
 * 验证页面API能否获取代币的所有历史交易
 */

require('dotenv').config({ path: 'config/.env' });
const { AveTokenAPI, AveTxAPI } = require('./src/core/ave-api');

const tokenApi = new AveTokenAPI('https://prod.ave-api.com', 30000, process.env.AVE_API_KEY);
const txApi = new AveTxAPI('https://prod.ave-api.com', 30000, process.env.AVE_API_KEY);

async function verifyAllTrades() {
  const tokenAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';
  const pairId = `${tokenAddress}_fo-bsc`;
  const tokenId = `${tokenAddress}-bsc`;

  // 1. 获取代币详情
  const tokenDetail = await tokenApi.getTokenDetail(tokenId);
  const launchAt = tokenDetail.token.launch_at;
  const currentTime = Math.floor(Date.now() / 1000);

  console.log('=== 验证代币所有历史交易 ===\n');
  console.log('代币信息:');
  console.log('  launch_at:', launchAt, '(' + new Date(launchAt * 1000).toLocaleString() + ')');
  console.log('  当前时间:', currentTime, '(' + new Date(currentTime * 1000).toLocaleString() + ')');
  console.log('  代币年龄:', ((currentTime - launchAt) / 3600).toFixed(2), '小时');
  console.log('');

  // 2. 使用页面API的分页逻辑获取所有交易
  console.log('--- 使用页面API的分页逻辑获取所有交易 ---\n');

  // 页面API的逻辑：使用 launch_at 作为 fromTime，一直向前分页
  let allTrades = [];
  let currentToTime = null; // 第一次查询不设置 toTime，获取最新的
  let pageCount = 0;
  const MAX_PAGES = 20; // 最多查询20次

  while (pageCount < MAX_PAGES) {
    pageCount++;

    // 第一次查询：从 launch_at 到当前时间
    // 后续查询：从 launch_at 到 currentToTime
    const toTime = currentToTime || currentTime;

    console.log(`第${pageCount}次查询:`);
    console.log(`  fromTime: ${launchAt} (${new Date(launchAt * 1000).toLocaleString()})`);
    console.log(`  toTime: ${toTime} (${new Date(toTime * 1000).toLocaleString()})`);

    const trades = await txApi.getSwapTransactions(
      pairId,
      300,
      launchAt,
      toTime,
      'desc' // 页面API使用 desc 按时间降序，获取最新的交易
    );

    console.log(`  返回: ${trades.length} 条`);

    if (trades.length === 0) {
      console.log('  没有更多交易，结束');
      break;
    }

    // 记录时间范围
    const batchLastTime = trades[trades.length - 1].time; // desc排序，最后的是最早的
    console.log(`  本批次最晚: ${trades[0].time} (${new Date(trades[0].time * 1000).toLocaleString()})`);
    console.log(`  本批次最早: ${batchLastTime} (${new Date(batchLastTime * 1000).toLocaleString()})`);

    allTrades.unshift(...trades); // desc排序，插入到前面

    // 如果返回少于300条，说明已经获取完所有数据
    if (trades.length < 300) {
      console.log('  返回少于300条，已获取所有数据');
      break;
    }

    // 继续分页：新的 toTime = 当前批次最早交易时间 - 1
    currentToTime = batchLastTime - 1;
    console.log(`  继续分页，新的 toTime: ${currentToTime}`);
  }

  console.log('\n=== 结果 ===\n');
  console.log(`总共查询 ${pageCount} 次`);
  console.log(`总交易数: ${allTrades.length}`);

  if (allTrades.length > 0) {
    const firstTime = allTrades[0].time;
    const lastTime = allTrades[allTrades.length - 1].time;
    console.log(`最早交易: ${firstTime} (${new Date(firstTime * 1000).toLocaleString()})`);
    console.log(`最晚交易: ${lastTime} (${new Date(lastTime * 1000).toLocaleString()})`);
    console.log(`时间跨度: ${((lastTime - firstTime) / 60).toFixed(2)} 分钟`);

    // 检查数据完整性
    const timeSinceLaunch = currentTime - launchAt;
    const coveredTime = lastTime - launchAt;
    const coverage = (coveredTime / timeSinceLaunch * 100).toFixed(1);
    console.log(`数据覆盖率: ${coverage}% (${coveredTime.toFixed(0)}秒 / ${timeSinceLaunch.toFixed(0)}秒)`);
  }

  console.log('\n=== 对比回测引擎 ===\n');
  console.log('回测引擎获取的交易数: 300');
  console.log('页面API获取的交易数:', allTrades.length);
  console.log('差异:', allTrades.length - 300);

  if (allTrades.length > 300) {
    console.log('\n⚠️  回测引擎只获取了部分数据！');
    console.log(`  回测引擎获取了 ${(300 / allTrades.length * 100).toFixed(1)}% 的数据`);
    console.log(`  遗漏了 ${allTrades.length - 300} 笔交易`);
  }

  return allTrades;
}

verifyAllTrades().catch(console.error);
