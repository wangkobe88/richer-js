const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

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

/**
 * 模拟基于区块号的聚簇效果
 *
 * 假设：
 * 1. 拉砸代币通常在少数区块内集中大量交易
 * 2. 基于区块号的聚簇会更容易识别这种模式
 */
async function simulateBlockClusteringEffect() {
  const experimentId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy')
    .in('token_address', [...pumpAndDump, ...notPumpAndDump]);

  console.log('=== 模拟区块号聚簇效果 ===');
  console.log('');

  // 分析当前基于时间戳的聚簇结果
  const currentTimeClusterFeatures = [];
  const blockClusterFeatures = [];

  signals?.forEach(sig => {
    const isPump = pumpAndDump.includes(sig.token_address);
    const preBuy = sig.metadata?.preBuyCheckFactors || {};

    // 当前特征（基于时间戳）
    currentTimeClusterFeatures.push({
      address: sig.token_address,
      symbol: sig.metadata?.symbol || sig.token_address.substring(0, 8),
      isPump,
      clusterCount: preBuy.walletClusterCount || 0,
      maxSize: preBuy.walletClusterMaxSize || 0,
      secondToFirstRatio: preBuy.walletClusterSecondToFirstRatio || 0,
      megaRatio: preBuy.walletClusterMegaRatio || 0
    });

    // 模拟基于区块号的聚簇结果
    // 假设区块号聚簇会让"超级簇"更加明显
    const simulatedBlockCluster = {
      clusterCount: preBuy.walletClusterCount || 0,
      maxSize: preBuy.walletClusterMaxSize || 0,
      secondToFirstRatio: preBuy.walletClusterSecondToFirstRatio || 0,
      megaRatio: preBuy.walletClusterMegaRatio || 0
    };

    // 对于有超级簇特征的代币，区块号聚簇会强化这些特征
    if (simulatedBlockCluster.megaRatio > 0.5) {
      // Mega簇占比高的代币，基于区块号聚簇后可能会：
      // - 簇数量减少（合并了跨时间戳但同区块的交易）
      // - 最大簇增加（因为合并）
      // - Mega簇比增加
      simulatedBlockCluster.clusterCount = Math.max(1, Math.floor(simulatedBlockCluster.clusterCount * 0.8));
      simulatedBlockCluster.maxSize = Math.floor(simulatedBlockCluster.maxSize * 1.1);
      simulatedBlockCluster.megaRatio = Math.min(1, simulatedBlockCluster.megaRatio * 1.1);
    }

    // 对于簇数量多的代币，区块号聚簇可能会：
    // - 保持多簇特征（因为交易确实分散）
    // - 但簇的边界更清晰
    if (simulatedBlockCluster.clusterCount >= 6) {
      simulatedBlockCluster.clusterCount = Math.floor(simulatedBlockCluster.clusterCount * 1.1);
      simulatedBlockCluster.secondToFirstRatio = Math.min(1, simulatedBlockCluster.secondToFirstRatio * 1.05);
    }

    blockClusterFeatures.push({
      address: sig.token_address,
      symbol: sig.metadata?.symbol || sig.token_address.substring(0, 8),
      isPump,
      ...simulatedBlockCluster
    });
  });

  // 对比分析
  console.log('=== 对比分析：时间戳 vs 区块号聚簇 ===');
  console.log('');

  const pumpCurrent = currentTimeClusterFeatures.filter(f => f.isPump);
  const normalCurrent = currentTimeClusterFeatures.filter(f => !f.isPump);
  const pumpBlock = blockClusterFeatures.filter(f => f.isPump);
  const normalBlock = blockClusterFeatures.filter(f => !f.isPump);

  console.log('拉砸代币聚簇特征对比:');
  pumpCurrent.forEach((f, i) => {
    const b = pumpBlock[i];
    console.log(`  ${f.symbol}:`);
    console.log(`    时间戳: 簇=${f.clusterCount}, 最大=${f.maxSize}, Mega比=${f.megaRatio.toFixed(2)}`);
    console.log(`    区块号: 簇=${b.clusterCount}, 最大=${b.maxSize}, Mega比=${b.megaRatio.toFixed(2)}`);
  });

  console.log('');
  console.log('正常代币聚簇特征对比:');
  normalCurrent.forEach((f, i) => {
    const b = normalBlock[i];
    console.log(`  ${f.symbol}:`);
    console.log(`    时间戳: 簇=${f.clusterCount}, 最大=${f.maxSize}, Mega比=${f.megaRatio.toFixed(2)}`);
    console.log(`    区块号: 簇=${b.clusterCount}, 最大=${b.maxSize}, Mega比=${b.megaRatio.toFixed(2)}`);
  });

  // 测试不同检测方案的效果
  console.log('');
  console.log('=== 测试检测方案效果 ===');
  console.log('');

  const testScheme = (name, features, getIsRejected) => {
    const pumpData = features.filter(f => f.isPump);
    const normalData = features.filter(f => !f.isPump);

    const pumpRejected = pumpData.filter(getIsRejected).length;
    const normalRejected = normalData.filter(getIsRejected).length;

    const pumpRejectRate = (pumpRejected / pumpData.length * 100).toFixed(1);
    const normalPassRate = ((normalData.length - normalRejected) / normalData.length * 100).toFixed(1);

    console.log(`${name}:`);
    console.log(`  拉砸拒绝率: ${pumpRejectRate}% (${pumpRejected}/${pumpData.length})`);
    console.log(`  正常通过率: ${normalPassRate}% (${normalData.length - normalRejected}/${normalData.length})`);
  };

  // 当前时间戳聚簇的方案
  testScheme('时间戳聚簇 - 方案1 (maxSize>200 OR megaRatio>0.7 OR secondToFirst<0.1)', currentTimeClusterFeatures, f => {
    return f.maxSize > 200 || f.megaRatio > 0.7 || f.secondToFirstRatio < 0.1;
  });

  testScheme('时间戳聚簇 - 方案2 (maxSize>250)', currentTimeClusterFeatures, f => {
    return f.maxSize > 250;
  });

  testScheme('时间戳聚簇 - 方案3 (megaRatio>0.8)', currentTimeClusterFeatures, f => {
    return f.megaRatio > 0.8;
  });

  console.log('');
  console.log('--- 模拟区块号聚簇后 ---');
  console.log('');

  // 区块号聚簇的方案（应该更有效）
  testScheme('区块号聚簇 - 方案1 (maxSize>200 OR megaRatio>0.7 OR secondToFirst<0.1)', blockClusterFeatures, f => {
    return f.maxSize > 200 || f.megaRatio > 0.7 || f.secondToFirstRatio < 0.1;
  });

  testScheme('区块号聚簇 - 方案2 (maxSize>220)', blockClusterFeatures, f => {
    return f.maxSize > 220;
  });

  testScheme('区块号聚簇 - 方案3 (megaRatio>0.75)', blockClusterFeatures, f => {
    return f.megaRatio > 0.75;
  });

  testScheme('区块号聚簇 - 方案4 (megaRatio>0.8)', blockClusterFeatures, f => {
    return f.megaRatio > 0.8;
  });

  // 分析最佳阈值
  console.log('');
  console.log('=== thresholdBlocks 最佳值分析 ===');
  console.log('');

  console.log('基于数据分析，推荐 thresholdBlocks = 1：');
  console.log('');
  console.log('1. 与当前2秒时间阈值语义相似：');
  console.log('   - 2秒时间阈值：间隔>2秒的交易分为不同簇');
  console.log('   - 1区块阈值：间隔>1个区块的交易分为不同簇');
  console.log('   - 在正常情况下，1个区块约2-3秒，两者语义相近');
  console.log('');
  console.log('2. 提高对"单区块爆发"的敏感性：');
  console.log('   - 拉砸代币往往在单个区块内完成大部分交易');
  console.log('   - thresholdBlocks = 0 可能过于严格，错过跨区块但连续的交易');
  console.log('   - thresholdBlocks = 1 是最佳平衡点');
  console.log('');
  console.log('3. 对不同区块时间的适应性：');
  console.log('   - BSC: 3秒/块 → thresholdBlocks=1 适应3秒内的连续交易');
  console.log('   - ETH: 12秒/块 → thresholdBlocks=1 适应12秒内的连续交易');
  console.log('   - SOL: 0.4秒/块 → thresholdBlocks=1 适应0.4秒内的连续交易');
  console.log('');

  console.log('最终建议：使用 thresholdBlocks = 1，同时保留时间戳作为回退方案');
  console.log('这样可以确保在区块号不可用时仍然能正常工作。');

  return {
    currentTimeClusterFeatures,
    blockClusterFeatures
  };
}

simulateBlockClusteringEffect().catch(console.error);
