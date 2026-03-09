/**
 * 分析区块号间隔作为因子的效果
 * 找出最能区分拉砸代币和正常代币的统计量
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

const txApi = new AveTxAPI(
  process.env.AVE_API_BASE_URL || 'https://prod.ave-api.com',
  30000,
  process.env.AVE_API_KEY
);

/**
 * 计算区块号间隔的所有统计量
 */
function calculateBlockGapFactors(trades) {
  if (!trades || trades.length < 2) {
    return null;
  }

  // 计算所有相邻交易的区块号间隔
  const gaps = [];
  for (let i = 1; i < trades.length; i++) {
    const gap = trades[i].block_number - trades[i - 1].block_number;
    gaps.push(gap);
  }

  // 排序用于计算分位数
  const sortedGaps = [...gaps].sort((a, b) => a - b);

  // 基础统计量
  const sum = gaps.reduce((a, b) => a + b, 0);
  const mean = sum / gaps.length;

  // 方差和标准差
  const variance = gaps.reduce((acc, g) => acc + Math.pow(g - mean, 2), 0) / gaps.length;
  const stdDev = Math.sqrt(variance);

  // 分位数
  const p25 = sortedGaps[Math.floor(gaps.length * 0.25)];
  const p50 = sortedGaps[Math.floor(gaps.length * 0.50)];
  const p75 = sortedGaps[Math.floor(gaps.length * 0.75)];
  const p90 = sortedGaps[Math.floor(gaps.length * 0.90)];
  const p95 = sortedGaps[Math.floor(gaps.length * 0.95)];

  // 分布统计
  const gap0Count = gaps.filter(g => g === 0).length;
  const gap1Count = gaps.filter(g => g === 1).length;
  const gap2to5Count = gaps.filter(g => g >= 2 && g <= 5).length;
  const gap6to10Count = gaps.filter(g => g >= 6 && g <= 10).length;
  const gapOver10Count = gaps.filter(g => g > 10).length;

  return {
    // 基础统计
    totalTrades: trades.length,
    totalGaps: gaps.length,
    blockGapMean: parseFloat(mean.toFixed(2)),
    blockGapMin: Math.min(...gaps),
    blockGapMax: Math.max(...gaps),
    blockGapStdDev: parseFloat(stdDev.toFixed(2)),
    blockGapVariance: parseFloat(variance.toFixed(2)),

    // 分位数
    blockGapP25: p25,
    blockGapP50: p50,
    blockGapP75: p75,
    blockGapP90: p90,
    blockGapP95: p95,

    // 分布统计（绝对值）
    blockGap0Count: gap0Count,
    blockGap1Count: gap1Count,
    blockGap2to5Count: gap2to5Count,
    blockGap6to10Count: gap6to10Count,
    blockGapOver10Count: gapOver10Count,

    // 分布统计（占比）
    blockGap0Ratio: parseFloat((gap0Count / gaps.length).toFixed(4)),
    blockGap1Ratio: parseFloat((gap1Count / gaps.length).toFixed(4)),
    blockGap2to5Ratio: parseFloat((gap2to5Count / gaps.length).toFixed(4)),
    blockGap6to10Ratio: parseFloat((gap6to10Count / gaps.length).toFixed(4)),
    blockGapOver10Ratio: parseFloat((gapOver10Count / gaps.length).toFixed(4)),

    // 集中度指标（gap <= 2 的占比，越高越集中）
    blockGapConcentration: parseFloat(((gap0Count + gap1Count + gaps.filter(g => g === 2).length) / gaps.length).toFixed(4))
  };
}

/**
 * 获取早期交易数据
 */
async function fetchEarlyTrades(innerPair, chain, checkTime) {
  const pairId = `${innerPair}-${chain}`;
  const targetFromTime = checkTime - 90;
  let currentToTime = checkTime;
  const allTrades = [];
  const maxLoops = 10;

  for (let loop = 1; loop <= maxLoops; loop++) {
    try {
      const trades = await txApi.getSwapTransactions(
        pairId, 300, targetFromTime, currentToTime, 'asc'
      );

      if (trades.length === 0) break;

      allTrades.push(...trades);

      const batchFirstTime = trades[0].time;
      if (batchFirstTime <= targetFromTime) break;

      if (trades.length === 300) {
        currentToTime = batchFirstTime - 1;
      } else {
        break;
      }
    } catch (error) {
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

  return uniqueTrades;
}

async function main() {
  console.log('=== 区块号间隔因子分析 ===\n');

  const backtestExpId = 'd951c4b9-6f3a-4784-afd4-cf93525fc914';

  // 获取信号数据
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, created_at, metadata')
    .eq('experiment_id', backtestExpId)
    .eq('action', 'buy')
    .in('token_address', [...pumpAndDump, ...notPumpAndDump]);

  console.log(`获取到 ${signals?.length || 0} 个信号\n`);

  const results = [];

  for (const signal of signals || []) {
    const tokenAddr = signal.token_address;
    const checkTime = Math.floor(new Date(signal.created_at).getTime() / 1000);
    const isPump = pumpAndDump.includes(tokenAddr);

    const innerPair = `${tokenAddr}_fo`;

    // 获取早期交易数据
    const trades = await fetchEarlyTrades(innerPair, 'bsc', checkTime);

    if (trades.length < 2) {
      console.log(`${tokenAddr}: 交易数不足，跳过`);
      continue;
    }

    // 计算区块号间隔因子
    const factors = calculateBlockGapFactors(trades);

    results.push({
      tokenAddr,
      isPump,
      symbol: signal.metadata?.symbol || tokenAddr.substring(0, 8),
      ...factors
    });

    // 避免API限流
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // 分离拉砸和正常代币
  const pumpResults = results.filter(r => r.isPump);
  const normalResults = results.filter(r => !r.isPump);

  console.log('\n=== 因子对比分析 ===\n');

  // 计算每个因子的区分度
  const factors = [
    'blockGapMean', 'blockGapP50', 'blockGapP75', 'blockGapP90', 'blockGapP95',
    'blockGapStdDev', 'blockGap0Ratio', 'blockGap1Ratio', 'blockGapConcentration'
  ];

  console.log('【因子统计对比】\n');
  console.log('| 因子 | 拉砸均值 | 正常均值 | 差异比 | 说明 |');
  console.log('|------|----------|----------|--------|------|');

  factors.forEach(factor => {
    const pumpMean = pumpResults.reduce((sum, r) => sum + (r[factor] || 0), 0) / pumpResults.length;
    const normalMean = normalResults.reduce((sum, r) => sum + (r[factor] || 0), 0) / normalResults.length;
    const ratio = normalMean / (pumpMean || 0.001);

    let note = '';
    if (ratio > 2) note = '★★★★★';
    else if (ratio > 1.5) note = '★★★★';
    else if (ratio > 1.3) note = '★★★';

    console.log(`| ${factor} | ${pumpMean.toFixed(2)} | ${normalMean.toFixed(2)} | ${ratio.toFixed(2)}x | ${note} |`);
  });

  console.log('\n【推荐因子阈值】\n');

  // 基于分位数分析推荐阈值
  console.log('1. blockGapP75:');
  console.log(`   拉砸 P75 中位数: ${pumpResults.map(r => r.blockGapP75).sort((a,b) => a-b)[Math.floor(pumpResults.length/2)]}`);
  console.log(`   正常 P75 中位数: ${normalResults.map(r => r.blockGapP75).sort((a,b) => a-b)[Math.floor(normalResults.length/2)]}`);
  console.log(`   推荐阈值: 3 (拉砸 < 3, 正常 >= 3)`);

  console.log('\n2. blockGapConcentration (gap<=2占比):');
  const pumpConc = pumpResults.map(r => r.blockGapConcentration).sort((a,b) => a-b)[Math.floor(pumpResults.length*0.75)];
  const normalConc = normalResults.map(r => r.blockGapConcentration).sort((a,b) => a-b)[Math.floor(normalResults.length*0.25)];
  console.log(`   拉砸 P75: ${pumpConc.toFixed(2)}`);
  console.log(`   正常 P25: ${normalConc.toFixed(2)}`);
  console.log(`   推荐阈值: 0.70 (拉砸 >= 0.70, 正常 < 0.70)`);

  console.log('\n3. blockGap0Ratio (同一区块占比):');
  const pumpGap0 = pumpResults.map(r => r.blockGap0Ratio).sort((a,b) => b-a)[Math.floor(pumpResults.length*0.25)];
  const normalGap0 = normalResults.map(r => r.blockGap0Ratio).sort((a,b) => a-b)[Math.floor(normalResults.length*0.75)];
  console.log(`   拉砸 P25: ${pumpGap0.toFixed(2)}`);
  console.log(`   正常 P75: ${normalGap0.toFixed(2)}`);
  console.log(`   推荐阈值: 0.30 (拉砸 >= 0.30, 正常 < 0.30)`);

  console.log('\n【组合因子建议】\n');
  console.log('建议使用以下因子组合来检测拉砸代币：');
  console.log('');
  console.log('条件1: blockGapP75 < 3 AND blockGapConcentration > 0.70');
  console.log('条件2: blockGapMean < 1.5 AND blockGap0Ratio > 0.30');
  console.log('');
  console.log('满足任一条件即判定为拉砸代币');

  // 测试检测效果
  console.log('\n【检测效果测试】\n');

  function testCondition(name, conditionFn) {
    const pumpRejected = pumpResults.filter(conditionFn).length;
    const normalRejected = normalResults.filter(conditionFn).length;
    const pumpPass = pumpResults.length - pumpRejected;
    const normalPass = normalResults.length - normalRejected;

    console.log(`${name}:`);
    console.log(`  拉砸拒绝: ${pumpRejected}/${pumpResults.length} (${(pumpRejected/pumpResults.length*100).toFixed(1)}%)`);
    console.log(`  正常通过: ${normalPass}/${normalResults.length} (${(normalPass/normalResults.length*100).toFixed(1)}%)`);
    console.log('');
  }

  testCondition(
    '条件: blockGapP75 < 3',
    r => r.blockGapP75 < 3
  );

  testCondition(
    '条件: blockGapConcentration > 0.70',
    r => r.blockGapConcentration > 0.70
  );

  testCondition(
    '条件: blockGapMean < 1.5 AND blockGap0Ratio > 0.30',
    r => r.blockGapMean < 1.5 && r.blockGap0Ratio > 0.30
  );

  testCondition(
    '组合: (blockGapP75 < 3 AND blockGapConcentration > 0.70) OR (blockGapMean < 1.5 AND blockGap0Ratio > 0.30)',
    r => (r.blockGapP75 < 3 && r.blockGapConcentration > 0.70) || (r.blockGapMean < 1.5 && r.blockGap0Ratio > 0.30)
  );
}

main().catch(console.error);
