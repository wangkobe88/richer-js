/**
 * 钱包簇分析对比
 * 对比时间戳聚簇 vs 区块号聚簇的真实效果
 */

const { createClient } = require('@supabase/supabase-js');
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

async function analyzeClustering() {
  const experimentId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';

  console.log('=== 钱包簇分析：时间戳聚簇 vs 区块号聚簇 ===');
  console.log('');

  // 1. 获取原始实验数据（时间戳聚簇）
  console.log('步骤1：获取原始实验数据（时间戳聚簇）');
  const { data: sourceSignals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy')
    .in('token_address', [...pumpAndDump, ...notPumpAndDump]);

  console.log('获取到信号数:', sourceSignals?.length || 0);
  console.log('');

  // 2. 分析时间戳聚簇结果
  console.log('=== 时间戳聚簇分析 ===');
  const timestampResults = [];
  sourceSignals?.forEach(sig => {
    const isPump = pumpAndDump.includes(sig.token_address);
    const preBuy = sig.metadata?.preBuyCheckFactors || {};

    timestampResults.push({
      address: sig.token_address,
      symbol: sig.metadata?.symbol || sig.token_address.substring(0, 8),
      isPump,
      // 聚簇因子
      clusterCount: preBuy.walletClusterCount || 0,
      maxSize: preBuy.walletClusterMaxSize || 0,
      secondToFirstRatio: preBuy.walletClusterSecondToFirstRatio || 0,
      megaRatio: preBuy.walletClusterMegaRatio || 0,
      // 使用的聚簇方法
      method: preBuy.walletClusterMethod || 'time',
      threshold: preBuy.walletClusterThreshold || 2
    });
  });

  // 显示时间戳聚簇结果
  console.log('拉砸代币:');
  timestampResults.filter(r => r.isPump).forEach(r => {
    console.log(`  ${r.symbol}: 簇=${r.clusterCount}, 最大=${r.maxSize}, 第二/第一=${r.secondToFirstRatio.toFixed(2)}, Mega=${r.megaRatio.toFixed(2)}`);
  });

  console.log('');
  console.log('正常代币:');
  timestampResults.filter(r => !r.isPump).forEach(r => {
    console.log(`  ${r.symbol}: 簇=${r.clusterCount}, 最大=${r.maxSize}, 第二/第一=${r.secondToFirstRatio.toFixed(2)}, Mega=${r.megaRatio.toFixed(2)}`);
  });

  // 3. 测试时间戳聚簇的检测效果
  console.log('');
  console.log('=== 时间戳聚簇检测效果测试 ===');

  const testCondition = (data, condition) => {
    const pumpData = data.filter(d => d.isPump);
    const normalData = data.filter(d => !d.isPump);

    const pumpRejected = pumpData.filter(condition).length;
    const normalRejected = normalData.filter(condition).length;

    console.log(`条件: ${condition.toString()}`);
    console.log(`  拉砸拒绝: ${pumpRejected}/${pumpData.length} (${(pumpRejected/pumpData.length*100).toFixed(1)}%)`);
    console.log(`  正常通过: ${normalData.length-normalRejected}/${normalData.length} (${((normalData.length-normalRejected)/normalData.length*100).toFixed(1)}%)`);
    console.log('');
  };

  // 测试原来的方案
  const condition1 = d => d.maxSize > 200 || d.megaRatio > 0.7 || d.secondToFirstRatio < 0.1;
  testCondition(timestampResults, condition1);

  const condition2 = d => d.maxSize > 250 || (d.megaRatio > 0.8 && d.secondToFirstRatio < 0.2);
  testCondition(timestampResults, condition2);

  // 4. 现在我需要获取区块号聚簇的数据
  console.log('=== 下一步：获取区块号聚簇数据 ===');
  console.log('需要重新运行实验或从AVE API获取原始交易数据');
  console.log('然后用区块号聚簇算法重新计算');

  return {
    timestampResults,
    experimentId
  };
}

analyzeClustering().catch(console.error);
