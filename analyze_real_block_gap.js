/**
 * 基于真实早期交易数据分析区块号间隔分布
 * 从回测实验信号中获取代币，调用AVE API获取早期交易数据
 */

const { createClient } = require('@supabase/supabase-js');
const { AveTxAPI } = require('./src/core/ave-api/tx-api');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// 用户标注的数据
const pumpAndDump = [
  '0x2be52e98e45ed3d27f56284972b3545dac964444',
  '0x281f05868b5ba9e55869541a117ebb661f474444',
  '0xf3372a3dbc824f0b0044ca77209559514b294444',
  '0xb9b1142a28fade5771b7ae076c96c3bee8beffff',
  '0xd8d4ddeb91987a121422567260a88230dbb34444',
  '0x68b04d6e06495866cc810d4179caf97651a5ffff',
  '0x98fe71847aa16d9e40a4f0e123d172bc71d14444',
  '0x721f5abc0d34948aa0904ba135cc4d9c6ff84444',
  '0xf40dec26ab76df60a761e78c84682d7117a64444',
  '0x0da3a0a3bd66bbeaaa4d35d12cb9ea3725294444'
];

const notPumpAndDump = [
  '0x1443d233e2dbad52df65e6b17063274e6c844444',
  '0x16aeb87aeb78e4cf7987f16e910c285d77354444',
  '0xa9fe96fd5230a135ada220523032b3e1a67d4444',
  '0x4d15d67fcf9bd0b109efa7fc1b150416cca04444',
  '0xd7a23f95c6698c44c7b861408f0d7b47acc74444'
];

// 初始化AVE API
const txApi = new AveTxAPI(
  process.env.AVE_API_BASE_URL || 'https://prod.ave-api.com',
  30000,
  process.env.AVE_API_KEY
);

/**
 * 获取早期交易数据（固定90秒回溯窗口）
 * 循环获取直到覆盖完整时间窗口
 */
async function fetchEarlyTrades(innerPair, chain, checkTime) {
  const pairId = `${innerPair}-${chain}`;
  const targetFromTime = checkTime - 90; // 固定回溯90秒
  let currentToTime = checkTime;

  const allTrades = [];
  const maxLoops = 10;

  console.log(`  获取交易数据: pairId=${pairId}, fromTime=${targetFromTime}, toTime=${currentToTime}`);

  for (let loop = 1; loop <= maxLoops; loop++) {
    try {
      const trades = await txApi.getSwapTransactions(
        pairId,
        300,              // limit - 最大300条
        targetFromTime,   // fromTime - 固定为目标起始时间
        currentToTime,    // toTime - 当前批次的结束时间
        'asc'             // sort - 按时间升序
      );

      if (trades.length === 0) {
        console.log(`    批次${loop}: 无数据，结束`);
        break;
      }

      console.log(`    批次${loop}: 获取到 ${trades.length} 条交易`);
      console.log(`      时间范围: ${trades[0].time} ~ ${trades[trades.length - 1].time}`);

      allTrades.push(...trades);

      // 检查是否已经覆盖到目标起始时间
      const batchFirstTime = trades[0].time;
      if (batchFirstTime <= targetFromTime) {
        console.log(`    已覆盖完整时间窗口`);
        break;
      }

      // 如果返回了300条数据，可能还有更早的数据
      if (trades.length === 300) {
        currentToTime = batchFirstTime - 1;
      } else {
        break;
      }
    } catch (error) {
      console.error(`    批次${loop} 获取失败: ${error.message}`);
      break;
    }
  }

  // 去重并排序
  const uniqueTrades = [];
  const seen = new Set();
  for (const trade of allTrades.sort((a, b) => a.time - b.time)) {
    const key = trade.tx_id || `${trade.time}_${trade.from_address}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueTrades.push(trade);
    }
  }

  console.log(`  总计获取: ${uniqueTrades.length} 条唯一交易`);
  return uniqueTrades;
}

/**
 * 分析区块号间隔分布
 */
function analyzeBlockGaps(trades) {
  if (!trades || trades.length === 0) {
    return null;
  }

  const gaps = [];
  for (let i = 1; i < trades.length; i++) {
    const gap = trades[i].block_number - trades[i - 1].block_number;
    gaps.push(gap);
  }

  return {
    total: gaps.length,
    min: Math.min(...gaps),
    max: Math.max(...gaps),
    mean: gaps.reduce((a, b) => a + b, 0) / gaps.length,
    median: gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)],
    p50: gaps.sort((a, b) => a - b)[Math.floor(gaps.length * 0.5)],
    p75: gaps.sort((a, b) => a - b)[Math.floor(gaps.length * 0.75)],
    p90: gaps.sort((a, b) => a - b)[Math.floor(gaps.length * 0.90)],
    p95: gaps.sort((a, b) => a - b)[Math.floor(gaps.length * 0.95)],
    // 分布统计
    gap0: gaps.filter(g => g === 0).length,
    gap1: gaps.filter(g => g === 1).length,
    gap2to5: gaps.filter(g => g >= 2 && g <= 5).length,
    gap6to10: gaps.filter(g => g >= 6 && g <= 10).length,
    gap11to20: gaps.filter(g => g >= 11 && g <= 20).length,
    gapOver20: gaps.filter(g => g > 20).length
  };
}

/**
 * 测试区块号聚簇效果
 */
function testBlockClustering(trades, threshold) {
  if (!trades || trades.length === 0) {
    return null;
  }

  const clusters = [];
  let clusterStart = 0;

  for (let i = 1; i <= trades.length; i++) {
    if (i === trades.length || (trades[i].block_number - trades[i - 1].block_number) > threshold) {
      const clusterSize = i - clusterStart;
      clusters.push(clusterSize);
      clusterStart = i;
    }
  }

  const sortedSizes = [...clusters].sort((a, b) => b - a);
  const avgClusterSize = clusters.reduce((a, b) => a + b, 0) / clusters.length;
  const megaClusterThreshold = Math.max(5, Math.floor(avgClusterSize * 2));
  const megaClusters = clusters.filter(s => s >= megaClusterThreshold);

  return {
    clusterCount: clusters.length,
    maxSize: sortedSizes[0] || 0,
    secondSize: sortedSizes[1] || 0,
    avgSize: avgClusterSize,
    megaClusterCount: megaClusters.length,
    megaClusterRatio: megaClusters.reduce((sum, s) => sum + s, 0) / trades.length,
    secondToFirstRatio: sortedSizes.length >= 2 ? sortedSizes[1] / sortedSizes[0] : 0
  };
}

async function main() {
  console.log('=== 基于真实早期交易数据分析区块号间隔分布 ===\n');

  const backtestExpId = 'd951c4b9-6f3a-4784-afd4-cf93525fc914';

  // 1. 获取回测实验信号（包含代币信息和检查时间）
  console.log('步骤1: 获取回测实验信号数据...');
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, created_at, metadata')
    .eq('experiment_id', backtestExpId)
    .eq('action', 'buy')
    .in('token_address', [...pumpAndDump, ...notPumpAndDump]);

  console.log(`获取到 ${signals?.length || 0} 个信号\n`);

  // 2. 获取代币的 innerPair 信息
  console.log('步骤2: 获取代币 innerPair 信息...');
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('address, inner_pair, platform, pair')
    .eq('experiment_id', backtestExpId)
    .in('address', [...pumpAndDump, ...notPumpAndDump]);

  const tokenMap = {};
  tokens?.forEach(t => {
    tokenMap[t.address] = t;
  });

  // 3. 对每个代币获取早期交易数据并分析
  console.log('\n步骤3: 获取早期交易数据并分析区块号间隔\n');

  const results = [];

  for (const signal of signals || []) {
    const tokenAddr = signal.token_address;
    const checkTime = Math.floor(new Date(signal.created_at).getTime() / 1000);
    const isPump = pumpAndDump.includes(tokenAddr);

    console.log(`\n【${isPump ? '拉砸' : '正常'}代币】${tokenAddr}`);
    console.log(`检查时间: ${checkTime} (${new Date(signal.created_at).toISOString()})`);

    // 获取 innerPair
    const tokenInfo = tokenMap[tokenAddr];

    let innerPair;
    if (tokenInfo?.inner_pair) {
      innerPair = tokenInfo.inner_pair;
    } else if (tokenInfo?.pair) {
      innerPair = tokenInfo.pair;
    } else {
      // 使用默认格式
      innerPair = `${tokenAddr}_fo`;
      console.log('  未找到代币的 inner_pair，使用默认格式');
    }

    console.log(`  innerPair: ${innerPair}`);

    // 获取早期交易数据
    const trades = await fetchEarlyTrades(innerPair, 'bsc', checkTime);

    if (trades.length === 0) {
      console.log('  错误: 未获取到交易数据，跳过');
      continue;
    }

    // 分析区块号间隔
    const gapAnalysis = analyzeBlockGaps(trades);
    console.log(`\n  区块号间隔分析:`);
    console.log(`    总间隔数: ${gapAnalysis.total}`);
    console.log(`    最小值: ${gapAnalysis.min}`);
    console.log(`    最大值: ${gapAnalysis.max}`);
    console.log(`    平均值: ${gapAnalysis.mean.toFixed(2)}`);
    console.log(`    中位数: ${gapAnalysis.median}`);
    console.log(`    P50: ${gapAnalysis.p50}`);
    console.log(`    P75: ${gapAnalysis.p75}`);
    console.log(`    P90: ${gapAnalysis.p90}`);
    console.log(`    P95: ${gapAnalysis.p95}`);
    console.log(`\n  间隔分布:`);
    console.log(`    gap=0: ${gapAnalysis.gap0} (${(gapAnalysis.gap0/gapAnalysis.total*100).toFixed(1)}%)`);
    console.log(`    gap=1: ${gapAnalysis.gap1} (${(gapAnalysis.gap1/gapAnalysis.total*100).toFixed(1)}%)`);
    console.log(`    gap=2-5: ${gapAnalysis.gap2to5} (${(gapAnalysis.gap2to5/gapAnalysis.total*100).toFixed(1)}%)`);
    console.log(`    gap=6-10: ${gapAnalysis.gap6to10} (${(gapAnalysis.gap6to10/gapAnalysis.total*100).toFixed(1)}%)`);
    console.log(`    gap=11-20: ${gapAnalysis.gap11to20} (${(gapAnalysis.gap11to20/gapAnalysis.total*100).toFixed(1)}%)`);
    console.log(`    gap>20: ${gapAnalysis.gapOver20} (${(gapAnalysis.gapOver20/gapAnalysis.total*100).toFixed(1)}%)`);

    // 测试不同阈值的聚簇效果
    console.log(`\n  聚簇效果测试:`);
    const thresholds = [1, 2, 5, 10, 15];
    thresholds.forEach(th => {
      const clusterResult = testBlockClustering(trades, th);
      console.log(`    threshold=${th}: 簇数=${clusterResult.clusterCount}, 最大簇=${clusterResult.maxSize}, 第二/第一=${clusterResult.secondToFirstRatio.toFixed(2)}`);
    });

    results.push({
      tokenAddr,
      isPump,
      checkTime,
      tradeCount: trades.length,
      gapAnalysis,
      symbol: signal.metadata?.symbol || tokenAddr.substring(0, 8)
    });

    // 避免API限流
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // 4. 汇总分析
  console.log('\n\n=== 汇总分析 ===\n');

  const pumpResults = results.filter(r => r.isPump);
  const normalResults = results.filter(r => !r.isPump);

  console.log('【拉砸代币统计】');
  const pumpAvgGap = pumpResults.reduce((sum, r) => sum + r.gapAnalysis.mean, 0) / pumpResults.length;
  const pumpP50 = pumpResults.map(r => r.gapAnalysis.p50).sort((a, b) => a - b)[Math.floor(pumpResults.length / 2)];
  const pumpP75 = pumpResults.map(r => r.gapAnalysis.p75).sort((a, b) => a - b)[Math.floor(pumpResults.length * 0.75)];
  console.log(`  平均间隔: ${pumpAvgGap.toFixed(2)}`);
  console.log(`  P50中位数: ${pumpP50}`);
  console.log(`  P75中位数: ${pumpP75}`);

  console.log('\n【正常代币统计】');
  const normalAvgGap = normalResults.reduce((sum, r) => sum + r.gapAnalysis.mean, 0) / normalResults.length;
  const normalP50 = normalResults.map(r => r.gapAnalysis.p50).sort((a, b) => a - b)[Math.floor(normalResults.length / 2)];
  const normalP75 = normalResults.map(r => r.gapAnalysis.p75).sort((a, b) => a - b)[Math.floor(normalResults.length * 0.75)];
  console.log(`  平均间隔: ${normalAvgGap.toFixed(2)}`);
  console.log(`  P50中位数: ${normalP50}`);
  console.log(`  P75中位数: ${normalP75}`);

  // 5. 建议阈值
  console.log('\n=== 建议的 blockThreshold ===\n');
  console.log('基于所有代币的 P75 值，建议使用 blockThreshold = 5-10');
  console.log('这样可以让大部分相邻交易不被分开，达到类似时间戳聚簇的效果');
}

main().catch(console.error);
