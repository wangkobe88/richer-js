/**
 * 使用3分钟窗口重新查询
 */

const { AveTxAPI } = require('./src/core/ave-api/tx-api');
require('dotenv').config({ path: 'config/.env' });

const txApi = new AveTxAPI(
  process.env.AVE_API_BASE_URL || 'https://prod.ave-api.com',
  30000,
  process.env.AVE_API_KEY
);

async function check3MinWindow() {
  const tokenAddress = '0x6df5fd6949f2527ee99ce7c979c00f2a5bd34444';
  const chain = 'bsc';
  const innerPair = `${tokenAddress}_fo`;
  const pairId = `${innerPair}-${chain}`;

  // 使用 launch_at 作为起始时间
  const launchAt = 1773041446; // 2026-03-09T07:30:46.000Z
  const timeWindowMinutes = 3;

  const fromTime = launchAt;
  const toTime = launchAt + (timeWindowMinutes * 60);

  console.log('=== 使用3分钟窗口查询 ===\n');
  console.log(`launch_at: ${launchAt} (${new Date(launchAt * 1000).toISOString()})`);
  console.log(`时间窗口: ${timeWindowMinutes}分钟`);
  console.log(`fromTime: ${fromTime} (${new Date(fromTime * 1000).toISOString()})`);
  console.log(`toTime: ${toTime} (${new Date(toTime * 1000).toISOString()})`);
  console.log(`pairId: ${pairId}\n`);

  const allTrades = [];
  let currentToTime = toTime;
  let pageCount = 0;

  while (pageCount < 10) {
    const trades = await txApi.getSwapTransactions(
      pairId, 300, fromTime, currentToTime, 'asc'
    );

    pageCount++;
    console.log(`第${pageCount}次: ${trades.length}笔, toTime=${currentToTime} (${new Date(currentToTime * 1000).toISOString()})`);

    if (trades.length === 0) {
      console.log('  → 没有数据，结束');
      break;
    }

    allTrades.push(...trades);

    if (trades.length < 300) {
      console.log('  → 返回少于300笔，结束');
      break;
    }

    currentToTime = trades[0].time - 1;
    console.log(`  → 继续查询，新 toTime: ${new Date(currentToTime * 1000).toISOString()}`);
  }

  // 去重
  const uniqueTrades = [];
  const seen = new Set();
  for (const trade of allTrades.sort((a, b) => a.time - b.time)) {
    const key = trade.tx_id || `${trade.time}_${trade.from_address}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueTrades.push(trade);
    }
  }

  console.log(`\n总共获取: ${allTrades.length}笔`);
  console.log(`去重后: ${uniqueTrades.length}笔`);

  if (uniqueTrades.length > 0) {
    const firstTime = uniqueTrades[0].time;
    const lastTime = uniqueTrades[uniqueTrades.length - 1].time;
    const coverage = lastTime - firstTime;

    console.log(`\n时间范围:`);
    console.log(`  最早: ${firstTime} (${new Date(firstTime * 1000).toISOString()})`);
    console.log(`  最晚: ${lastTime} (${new Date(lastTime * 1000).toISOString()})`);
    console.log(`  跨度: ${coverage.toFixed(1)}秒 (${(coverage/60).toFixed(1)}分钟)`);
  }

  // 计算时间间隔
  const gaps = [];
  for (let i = 1; i < uniqueTrades.length; i++) {
    const gap = uniqueTrades[i].time - uniqueTrades[i - 1].time;
    gaps.push(gap);
  }

  const largeGaps = gaps.filter(g => g > 2);
  console.log(`\n时间间隔:`);
  console.log(`  总间隔数: ${gaps.length}`);
  console.log(`  >2秒的间隔: ${largeGaps.length}个`);

  if (largeGaps.length > 0) {
    console.log(`\n>2秒的间隔详情:`);
    largeGaps.slice(0, 20).forEach((gap, idx) => {
      const gapIdx = gaps.indexOf(gap);
      const time1 = uniqueTrades[gapIdx].time;
      const time2 = uniqueTrades[gapIdx + 1].time;
      console.log(`  ${idx + 1}. ${gap.toFixed(1)}秒 (${new Date(time1 * 1000).toISOString().substr(14, 9)} ~ ${new Date(time2 * 1000).toISOString().substr(14, 9)})`);
    });
  }

  // 重新聚簇
  const clusterTimeThreshold = 2;
  const clusters = [];
  let clusterStartIdx = 0;

  for (let i = 1; i <= uniqueTrades.length; i++) {
    if (i === uniqueTrades.length || (uniqueTrades[i].time - uniqueTrades[i - 1].time) > clusterTimeThreshold) {
      const clusterSize = i - clusterStartIdx;
      clusters.push(clusterSize);
      clusterStartIdx = i;
    }
  }

  console.log(`\n聚簇结果 (阈值: 2秒):`);
  console.log(`  总簇数: ${clusters.length}`);
  console.log(`  簇大小: ${clusters.join(', ')}`);

  const sortedSizes = [...clusters].sort((a, b) => b - a);
  console.log(`  前5大簇: ${sortedSizes.slice(0, 5).join(', ')}`);

  // 计算 megaClusterRatio
  const avgClusterSize = clusters.reduce((a, b) => a + b, 0) / clusters.length;
  const megaClusterThreshold = Math.max(5, Math.floor(avgClusterSize * 2));
  const megaClusters = clusters.filter(s => s >= megaClusterThreshold);
  const megaClusterTradeCount = megaClusters.reduce((sum, s) => sum + s, 0);
  const megaClusterRatio = megaClusterTradeCount / uniqueTrades.length;

  console.log(`\nmegaClusterRatio 计算:`);
  console.log(`  平均簇大小: ${avgClusterSize.toFixed(2)}`);
  console.log(`  megaCluster阈值: max(5, ${avgClusterSize.toFixed(2)} * 2) = ${megaClusterThreshold}`);
  console.log(`  超大簇数量: ${megaClusters.length}`);
  console.log(`  megaClusterRatio: ${megaClusterTradeCount}/${uniqueTrades.length} = ${megaClusterRatio.toFixed(4)}`);
}

check3MinWindow().catch(console.error);
