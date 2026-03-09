const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// 修正后的标注数据
const pumpAndDump = [
  '0x2be52e98e45ed3d27f56284972b3545dac964444',
  '0x281f05868b5ba9e55869541a117ebb661f474444',
  '0xf3372a3dbc824f0b0044ca77209559514b294444',
  '0xb9b1142a28fade5771b7ae076c96c3bee8beffff',
  '0xd8d4ddeb91987a121422567260a88230dbb34444',
  '0x68b04d6e06495866cc810d4179caf97651a5ffff',
  '0x98fe71847aa16d9e40a4f0e123d172bc71d14444',
  '0x721f5abc0d34948aa0904ba135cc4d9c6ff84444',
  '0xf40dec26ab76df60a761e78c84682d7117a64444', // 修正：也是拉砸
  '0x0da3a0a3bd66bbeaaa4d35d12cb9ea3725294444'  // 修正：也是拉砸
];

const notPumpAndDump = [
  '0x1443d233e2dbad52df65e6b17063274e6c844444',
  '0x16aeb87aeb78e4cf7987f16e910c285d77354444',
  '0xa9fe96fd5230a135ada220523032b3e1a67d4444',
  '0x4d15d67fcf9bd0b109efa7fc1b150416cca04444',
  '0xd7a23f95c6698c44c7b861408f0d7b47acc74444'
];

async function reAnalyzeWithCorrectedLabels() {
  const experimentId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';

  console.log('=== 修正后的拉砸代币分析 ===');
  console.log('');
  console.log('拉砸代币数量:', pumpAndDump.length);
  console.log('非拉砸代币数量:', notPumpAndDump.length);
  console.log('');

  const allAddresses = [...pumpAndDump, ...notPumpAndDump];

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy')
    .in('token_address', allAddresses);

  const tokenMap = new Map();
  signals.forEach(sig => {
    if (!tokenMap.has(sig.token_address)) {
      const metadata = sig.metadata || {};
      const preBuy = metadata.preBuyCheckFactors || {};
      const tf = metadata.trendFactors || {};

      tokenMap.set(sig.token_address, {
        address: sig.token_address,
        symbol: metadata.symbol || sig.token_address.substring(0, 8) + '...',
        isPump: pumpAndDump.includes(sig.token_address),
        preBuyFactors: preBuy,
        trendFactors: tf
      });
    }
  });

  const pumpData = Array.from(tokenMap.values()).filter(d => d.isPump);
  const normalData = Array.from(tokenMap.values()).filter(d => !d.isPump);

  console.log('=== 修正后的特征对比 ===');
  console.log('');

  const calcStats = (data, key) => {
    const values = data.map(d => d.preBuyFactors[key]).filter(v => v !== undefined && v !== null);
    if (values.length === 0) return null;
    return {
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      count: values.length
    };
  };

  const compare = (name, key) => {
    const pumpStats = calcStats(pumpData, key);
    const normalStats = calcStats(normalData, key);

    if (pumpStats && normalStats) {
      console.log(name + ':');
      console.log('  拉砸: avg=' + pumpStats.avg.toFixed(1) + ', range=[' + pumpStats.min.toFixed(0) + ', ' + pumpStats.max.toFixed(0) + ']');
      console.log('  正常: avg=' + normalStats.avg.toFixed(1) + ', range=[' + normalStats.min.toFixed(0) + ', ' + normalStats.max.toFixed(0) + ']');

      // 计算区分度
      const pumpAvg = pumpStats.avg;
      const normalAvg = normalStats.avg;
      const separation = Math.abs(pumpAvg - normalAvg) / Math.max(pumpAvg, normalAvg);
      console.log('  区分度: ' + (separation * 100).toFixed(1) + '%');
    }
  };

  compare('总交易数', 'earlyTradesTotalCount');
  compare('交易/分', 'earlyTradesCountPerMin');
  compare('聚簇数量', 'walletClusterCount');
  compare('最大簇', 'walletClusterMaxSize');
  compare('第二/第一比', 'walletClusterSecondToFirstRatio');
  compare('Mega簇比', 'walletClusterMegaRatio');

  console.log('');
  console.log('=== 测试各种阈值的区分效果 ===');
  console.log('');

  const testThreshold = (name, getValue, operator, threshold) => {
    let pumpPass = 0, pumpTotal = pumpData.length;
    let normalPass = 0, normalTotal = normalData.length;

    pumpData.forEach(d => {
      const value = getValue(d);
      if (value !== undefined && value !== null) {
        if (operator === '<' ? value < threshold : value > threshold) {
          pumpPass++;
        }
      }
    });

    normalData.forEach(d => {
      const value = getValue(d);
      if (value !== undefined && value !== null) {
        if (operator === '<' ? value < threshold : value > threshold) {
          normalPass++;
        }
      }
    });

    const pumpBlockRate = ((pumpTotal - pumpPass) / pumpTotal * 100).toFixed(1);
    const normalPassRate = (normalPass / normalTotal * 100).toFixed(1);
    const f1Score = ((pumpTotal - pumpPass) + normalPass) > 0
      ? (2 * (pumpTotal - pumpPass) * normalPass) / ((pumpTotal - pumpPass) + normalPass + pumpPass + (normalTotal - normalPass))
      : 0;

    console.log(name + ' (阈值=' + threshold + '):');
    console.log('  拉砸拒绝率: ' + pumpBlockRate + '% (' + (pumpTotal - pumpPass) + '/' + pumpTotal + ')');
    console.log('  正常通过率: ' + normalPassRate + '% (' + normalPass + '/' + normalTotal + ')');
    console.log('  F1分数: ' + f1Score.toFixed(3));
  };

  // 测试各种特征
  testThreshold('walletClusterMaxSize > 150', d => d.preBuyFactors.walletClusterMaxSize || 0, '>', 150);
  testThreshold('walletClusterMaxSize > 200', d => d.preBuyFactors.walletClusterMaxSize || 0, '>', 200);
  testThreshold('walletClusterMaxSize > 250', d => d.preBuyFactors.walletClusterMaxSize || 0, '>', 250);
  testThreshold('walletClusterMegaRatio > 0.3', d => d.preBuyFactors.walletClusterMegaRatio || 0, '>', 0.3);
  testThreshold('walletClusterMegaRatio > 0.5', d => d.preBuyFactors.walletClusterMegaRatio || 0, '>', 0.5);
  testThreshold('walletClusterMegaRatio > 0.7', d => d.preBuyFactors.walletClusterMegaRatio || 0, '>', 0.7);
  testThreshold('walletClusterSecondToFirstRatio < 0.3', d => d.preBuyFactors.walletClusterSecondToFirstRatio || 1, '<', 0.3);
  testThreshold('walletClusterSecondToFirstRatio < 0.2', d => d.preBuyFactors.walletClusterSecondToFirstRatio || 1, '<', 0.2);
  testThreshold('walletClusterSecondToFirstRatio < 0.1', d => d.preBuyFactors.walletClusterSecondToFirstRatio || 1, '<', 0.1);

  console.log('');
  console.log('=== 最优特征组合分析 ===');
  console.log('');

  // 分析"超级簇"特征（>200笔）
  const pumpSuper = pumpData.filter(d => (d.preBuyFactors.walletClusterMaxSize || 0) > 200).length;
  const normalSuper = normalData.filter(d => (d.preBuyFactors.walletClusterMaxSize || 0) > 200).length;

  console.log('超级簇 (>200笔):');
  console.log('  拉砸: ' + pumpSuper + '/' + pumpData.length + ' (' + (pumpSuper / pumpData.length * 100).toFixed(1) + '%)');
  console.log('  正常: ' + normalSuper + '/' + normalData.length + ' (' + (normalSuper / normalData.length * 100).toFixed(1) + '%)');

  // 分析"极端第一簇主导"特征（第二/第一比 < 0.1）
  const pumpExtreme = pumpData.filter(d => (d.preBuyFactors.walletClusterSecondToFirstRatio || 1) < 0.1).length;
  const normalExtreme = normalData.filter(d => (d.preBuyFactors.walletClusterSecondToFirstRatio || 1) < 0.1).length;

  console.log('');
  console.log('极端第一簇主导 (第二/第一 < 0.1):');
  console.log('  拉砸: ' + pumpExtreme + '/' + pumpData.length + ' (' + (pumpExtreme / pumpData.length * 100).toFixed(1) + '%)');
  console.log('  正常: ' + normalExtreme + '/' + normalData.length + ' (' + (normalExtreme / normalData.length * 100).toFixed(1) + '%)');

  // 分析"Mega簇占比高"特征（MegaRatio > 0.6）
  const pumpMegaHigh = pumpData.filter(d => (d.preBuyFactors.walletClusterMegaRatio || 0) > 0.6).length;
  const normalMegaHigh = normalData.filter(d => (d.preBuyFactors.walletClusterMegaRatio || 0) > 0.6).length;

  console.log('');
  console.log('Mega簇占比高 (>0.6):');
  console.log('  拉砸: ' + pumpMegaHigh + '/' + pumpData.length + ' (' + (pumpMegaHigh / pumpData.length * 100).toFixed(1) + '%)');
  console.log('  正常: ' + normalMegaHigh + '/' + normalData.length + ' (' + (normalMegaHigh / normalData.length * 100).toFixed(1) + '%)');

  console.log('');
  console.log('=== 最终推荐方案 ===');
  console.log('');

  console.log('基于修正后的标注数据，推荐以下预检查条件：');
  console.log('');
  console.log('方案1：保守型（高拉砸拒绝率）');
  console.log('  walletClusterMaxSize > 200');
  console.log('  OR walletClusterMegaRatio > 0.7');
  console.log('  OR walletClusterSecondToFirstRatio < 0.1');
  console.log('');
  console.log('方案2：平衡型（推荐）');
  console.log('  walletClusterMaxSize > 250');
  console.log('  OR (walletClusterMegaRatio > 0.8 AND walletClusterSecondToFirstRatio < 0.2)');
  console.log('');
  console.log('方案3：激进型（高正常通过率）');
  console.log('  walletClusterMaxSize > 280');
  console.log('  OR (walletClusterMaxSize > 200 AND walletClusterSecondToFirstRatio < 0.05)');

  // 验证方案1
  console.log('');
  console.log('方案1验证：');
  let pumpBlock = 0, normalPass = 0;
  pumpData.forEach(d => {
    const maxSize = d.preBuyFactors.walletClusterMaxSize || 0;
    const megaRatio = d.preBuyFactors.walletClusterMegaRatio || 0;
    const secondFirst = d.preBuyFactors.walletClusterSecondToFirstRatio || 1;
    if (maxSize > 200 || megaRatio > 0.7 || secondFirst < 0.1) {
      pumpBlock++;
    }
  });
  normalData.forEach(d => {
    const maxSize = d.preBuyFactors.walletClusterMaxSize || 0;
    const megaRatio = d.preBuyFactors.walletClusterMegaRatio || 0;
    const secondFirst = d.preBuyFactors.walletClusterSecondToFirstRatio || 1;
    if (!(maxSize > 200 || megaRatio > 0.7 || secondFirst < 0.1)) {
      normalPass++;
    }
  });
  console.log('  拉砸拒绝率: ' + (pumpBlock / pumpData.length * 100).toFixed(1) + '% (' + pumpBlock + '/' + pumpData.length + ')');
  console.log('  正常通过率: ' + (normalPass / normalData.length * 100).toFixed(1) + '% (' + normalPass + '/' + normalData.length + ')');

  // 验证方案2
  console.log('');
  console.log('方案2验证：');
  pumpBlock = 0, normalPass = 0;
  pumpData.forEach(d => {
    const maxSize = d.preBuyFactors.walletClusterMaxSize || 0;
    const megaRatio = d.preBuyFactors.walletClusterMegaRatio || 0;
    const secondFirst = d.preBuyFactors.walletClusterSecondToFirstRatio || 1;
    if (maxSize > 250 || (megaRatio > 0.8 && secondFirst < 0.2)) {
      pumpBlock++;
    }
  });
  normalData.forEach(d => {
    const maxSize = d.preBuyFactors.walletClusterMaxSize || 0;
    const megaRatio = d.preBuyFactors.walletClusterMegaRatio || 0;
    const secondFirst = d.preBuyFactors.walletClusterSecondToFirstRatio || 1;
    if (!(maxSize > 250 || (megaRatio > 0.8 && secondFirst < 0.2))) {
      normalPass++;
    }
  });
  console.log('  拉砸拒绝率: ' + (pumpBlock / pumpData.length * 100).toFixed(1) + '% (' + pumpBlock + '/' + pumpData.length + ')');
  console.log('  正常通过率: ' + (normalPass / normalData.length * 100).toFixed(1) + '% (' + normalPass + '/' + normalData.length + ')');
}

reAnalyzeWithCorrectedLabels().catch(console.error);
