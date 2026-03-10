/**
 * 检查 BINANCE 3分钟窗口数据
 */

const { AveTxAPI } = require('./src/core/ave-api/tx-api');
require('dotenv').config({ path: 'config/.env' });

const txApi = new AveTxAPI(
  process.env.AVE_API_BASE_URL || 'https://prod.ave-api.com',
  30000,
  process.env.AVE_API_KEY
);

async function checkBinance() {
  const tokenAddress = '0xd9625927fec260a637f86cc143b938a1eac54444'; // BINANCE
  const chain = 'bsc';
  const innerPair = `${tokenAddress}_fo`;
  const pairId = `${innerPair}-${chain}`;

  const launchAt = 1773061805; // 从 API 获取
  const timeWindowMinutes = 3;
  const fromTime = launchAt;
  const toTime = launchAt + (timeWindowMinutes * 60);

  console.log('=== BINANCE 3分钟窗口分析 ===\n');
  console.log(`fromTime: ${fromTime} (${new Date(fromTime * 1000).toISOString()})`);
  console.log(`toTime: ${toTime} (${new Date(toTime * 1000).toISOString()})`);

  const allTrades = [];
  let currentToTime = toTime;
  let pageCount = 0;

  while (pageCount < 10) {
    const trades = await txApi.getSwapTransactions(
      pairId, 300, fromTime, currentToTime, 'asc'
    );
    pageCount++;
    if (trades.length === 0) break;
    allTrades.push(...trades);
    if (trades.length < 300) break;
    currentToTime = trades[0].time - 1;
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

  console.log(`\n总交易数: ${uniqueTrades.length}`);

  if (uniqueTrades.length === 0) {
    console.log('没有交易数据');
    return;
  }

  const firstTime = uniqueTrades[0].time;
  const lastTime = uniqueTrades[uniqueTrades.length - 1].time;
  console.log(`时间范围: ${new Date(firstTime * 1000).toISOString()} ~ ${new Date(lastTime * 1000).toISOString()}`);
  console.log(`跨度: ${(lastTime - firstTime).toFixed(1)}秒`);

  // 聚簇
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

  const sortedSizes = [...clusters].sort((a, b) => b - a);

  console.log(`\n聚簇结果:`);
  console.log(`  簇数: ${clusters.length}`);
  console.log(`  簇大小: ${clusters.join(', ')}`);
  console.log(`  前5大簇: ${sortedSizes.slice(0, 5).join(', ')}`);

  const secondToFirstRatio = clusters.length >= 2 ? sortedSizes[1] / sortedSizes[0] : 0;
  const top2Ratio = (sortedSizes[0] + (sortedSizes[1] || 0)) / uniqueTrades.length;

  console.log(`\n因子:`);
  console.log(`  secondToFirstRatio: ${(secondToFirstRatio * 100).toFixed(1)}%`);
  console.log(`  top2Ratio: ${(top2Ratio * 100).toFixed(1)}%`);

  console.log(`\n【分析】`);
  if (clusters.length === 1) {
    console.log(`  ⚠️ 只有1个簇，无法判断是热门还是刷单`);
  } else if (secondToFirstRatio < 0.1 && top2Ratio > 0.8) {
    console.log(`  ❌ 符合刷单特征:极度不均匀`);
  } else {
    console.log(`  ✓ 可能是热门代币:簇分布相对均匀`);
  }
}

checkBinance().catch(console.error);
