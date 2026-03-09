const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// 用户提供的标注数据
const pumpAndDump = [
  '0x2be52e98e45ed3d27f56284972b3545dac964444',
  '0x281f05868b5ba9e55869541a117ebb661f474444',
  '0xf3372a3dbc824f0b0044ca77209559514b294444',
  '0xb9b1142a28fade5771b7ae076c96c3bee8beffff',
  '0xd8d4ddeb91987a121422567260a88230dbb34444',
  '0x68b04d6e06495866cc810d4179caf97651a5ffff',
  '0x98fe71847aa16d9e40a4f0e123d172bc71d14444',
  '0x721f5abc0d34948aa0904ba135cc4d9c6ff84444'
];

const notPumpAndDump = [
  '0x1443d233e2dbad52df65e6b17063274e6c844444',
  '0xf40dec26ab76df60a761e78c84682d7117a64444',
  '0x0da3a0a3bd66bbeaaa4d35d12cb9ea3725294444',
  '0x16aeb87aeb78e4cf7987f16e910c285d77354444',
  '0xa9fe96fd5230a135ada220523032b3e1a67d4444',
  '0x4d15d67fcf9bd0b109efa7fc1b150416cca04444',
  '0xd7a23f95c6698c44c7b861408f0d7b47acc74444'
];

async function deepAnalysis() {
  const experimentId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';

  console.log('=== 深度分析拉砸代币区分特征 ===');
  console.log('');

  // 获取所有标注代币的购买信号
  const allAddresses = [...pumpAndDump, ...notPumpAndDump];

  const { data: signals, error } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy')
    .in('token_address', allAddresses)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('查询失败:', error);
    return;
  }

  // 按代币分组
  const tokenMap = new Map();

  signals.forEach(sig => {
    if (!tokenMap.has(sig.token_address)) {
      const metadata = sig.metadata || {};
      const preBuy = metadata.preBuyCheckFactors || {};

      tokenMap.set(sig.token_address, {
        address: sig.token_address,
        symbol: metadata.symbol || sig.token_address.substring(0, 8) + '...',
        buyTime: sig.created_at,
        buyPrice: metadata.price,
        preBuyFactors: preBuy,
        trendFactors: metadata.trendFactors || {}
      });
    }
  });

  const pumpData = pumpAndDump.filter(addr => tokenMap.has(addr)).map(addr => {
    const d = tokenMap.get(addr);
    d.isPump = true;
    return d;
  });

  const normalData = notPumpAndDump.filter(addr => tokenMap.has(addr)).map(addr => {
    const d = tokenMap.get(addr);
    d.isPump = false;
    return d;
  });

  console.log('拉砸代币数量:', pumpData.length);
  console.log('非拉砸代币数量:', normalData.length);
  console.log('');

  // ==================== 第一部分：价格信号分析 ====================
  console.log('========================================');
  console.log('第一部分：价格信号分析');
  console.log('========================================');
  console.log('');

  console.log('拉砸代币价格特征:');
  pumpData.forEach(d => {
    const tf = d.trendFactors;
    console.log(d.symbol + ':');
    console.log('  age=' + tf.age?.toFixed(2) + '分钟, earlyReturn=' + tf.earlyReturn?.toFixed(1) + '%');
  });

  console.log('');
  console.log('非拉砸代币价格特征:');
  normalData.forEach(d => {
    const tf = d.trendFactors;
    console.log(d.symbol + ':');
    console.log('  age=' + tf.age?.toFixed(2) + '分钟, earlyReturn=' + tf.earlyReturn?.toFixed(1) + '%');
  });

  // 价格特征统计
  console.log('');
  console.log('价格特征统计:');

  const calcStats = (data, key) => {
    const values = data.map(d => d.trendFactors[key]).filter(v => v !== undefined && v !== null);
    if (values.length === 0) return null;
    return {
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values)
    };
  };

  const pumpAge = calcStats(pumpData, 'age');
  const normalAge = calcStats(normalData, 'age');
  const pumpReturn = calcStats(pumpData, 'earlyReturn');
  const normalReturn = calcStats(normalData, 'earlyReturn');

  console.log('age(代币年龄):');
  console.log('  拉砸: avg=' + pumpAge.avg.toFixed(2) + ', range=[' + pumpAge.min.toFixed(2) + ', ' + pumpAge.max.toFixed(2) + ']');
  console.log('  正常: avg=' + normalAge.avg.toFixed(2) + ', range=[' + normalAge.min.toFixed(2) + ', ' + normalAge.max.toFixed(2) + ']');
  console.log('');
  console.log('earlyReturn(早期收益率):');
  console.log('  拉砸: avg=' + pumpReturn.avg.toFixed(1) + '%, range=[' + pumpReturn.min.toFixed(1) + '%, ' + pumpReturn.max.toFixed(1) + '%]');
  console.log('  正常: avg=' + normalReturn.avg.toFixed(1) + '%, range=[' + normalReturn.min.toFixed(1) + '%, ' + normalReturn.max.toFixed(1) + '%]');

  // ==================== 第二部分：聚簇分析 ====================
  console.log('');
  console.log('========================================');
  console.log('第二部分：聚簇特征深度分析');
  console.log('========================================');
  console.log('');

  // 计算聚簇特征
  pumpData.forEach(d => {
    const pb = d.preBuyFactors;
    const totalCount = pb.earlyTradesTotalCount || 1;
    const clusterCount = pb.walletClusterCount || 1;
    const maxSize = pb.walletClusterMaxSize || 0;

    // 计算新的特征
    d.features = {
      // 簇集中度：最大簇占比
      maxClusterRatio: maxSize / totalCount,

      // 簇分散度：簇数量 / (总交易数 / 20)
      fragmentation: clusterCount / (totalCount / 20),

      // 是否有超级簇（>200笔）
      hasSuperCluster: maxSize >= 200,

      // 是否有mega簇（>100笔）
      hasMegaCluster: maxSize >= 100,

      // 第一簇主导度
      firstClusterDominance: (pb.walletClusterSecondToFirstRatio || 0) < 0.2,

      // 极端拉砸指标：单簇占比>50% 或 第二/第一<0.1
      extremePumpDump: maxSize / totalCount > 0.5 || (pb.walletClusterSecondToFirstRatio || 1) < 0.1
    };
  });

  normalData.forEach(d => {
    const pb = d.preBuyFactors;
    const totalCount = pb.earlyTradesTotalCount || 1;
    const clusterCount = pb.walletClusterCount || 1;
    const maxSize = pb.walletClusterMaxSize || 0;

    d.features = {
      maxClusterRatio: maxSize / totalCount,
      fragmentation: clusterCount / (totalCount / 20),
      hasSuperCluster: maxSize >= 200,
      hasMegaCluster: maxSize >= 100,
      firstClusterDominance: (pb.walletClusterSecondToFirstRatio || 0) < 0.2,
      extremePumpDump: maxSize / totalCount > 0.5 || (pb.walletClusterSecondToFirstRatio || 1) < 0.1
    };
  });

  console.log('拉砸代币聚簇特征:');
  pumpData.forEach(d => {
    console.log(d.symbol + ':');
    console.log('  最大簇占比=' + d.features.maxClusterRatio.toFixed(3) + ', 分散度=' + d.features.fragmentation.toFixed(2));
    console.log('  超级簇=' + d.features.hasSuperCluster + ', Mega簇=' + d.features.hasMegaCluster);
    console.log('  第一簇主导=' + d.features.firstClusterDominance + ', 极端拉砸=' + d.features.extremePumpDump);
  });

  console.log('');
  console.log('非拉砸代币聚簇特征:');
  normalData.forEach(d => {
    console.log(d.symbol + ':');
    console.log('  最大簇占比=' + d.features.maxClusterRatio.toFixed(3) + ', 分散度=' + d.features.fragmentation.toFixed(2));
    console.log('  超级簇=' + d.features.hasSuperCluster + ', Mega簇=' + d.features.hasMegaCluster);
    console.log('  第一簇主导=' + d.features.firstClusterDominance + ', 极端拉砸=' + d.features.extremePumpDump);
  });

  // ==================== 第三部分：特征区分能力测试 ====================
  console.log('');
  console.log('========================================');
  console.log('第三部分：特征区分能力测试');
  console.log('========================================');
  console.log('');

  const testFeature = (featureName, getValue, threshold, operator) => {
    let pumpPass = 0, pumpTotal = pumpData.length;
    let normalPass = 0, normalTotal = normalData.length;

    pumpData.forEach(d => {
      const value = getValue(d);
      if (operator === '<' ? value < threshold : value > threshold) {
        pumpPass++;
      }
    });

    normalData.forEach(d => {
      const value = getValue(d);
      if (operator === '<' ? value < threshold : value > threshold) {
        normalPass++;
      }
    });

    const pumpBlockRate = ((pumpTotal - pumpPass) / pumpTotal * 100).toFixed(1);
    const normalPassRate = (normalPass / normalTotal * 100).toFixed(1);

    console.log(featureName + ' (阈值=' + threshold + '):');
    console.log('  拉砸拒绝率: ' + pumpBlockRate + '% (' + (pumpTotal - pumpPass) + '/' + pumpTotal + ')');
    console.log('  正常通过率: ' + normalPassRate + '% (' + normalPass + '/' + normalTotal + ')');

    return {
      pumpBlockRate: parseFloat(pumpBlockRate),
      normalPassRate: parseFloat(normalPassRate),
      f1Score: normalPassRate > 0 ? parseFloat(pumpBlockRate) * parseFloat(normalPassRate) / (parseFloat(pumpBlockRate) + parseFloat(normalPassRate)) : 0
    };
  };

  // 测试各种特征
  console.log('--- 单特征测试 ---');
  testFeature('maxClusterRatio', d => d.features.maxClusterRatio, 0.5, '>');
  testFeature('maxClusterRatio', d => d.features.maxClusterRatio, 0.7, '>');
  testFeature('fragmentation', d => d.features.fragmentation, 2.0, '<');
  testFeature('fragmentation', d => d.features.fragmentation, 1.5, '<');
  testFeature('hasSuperCluster', d => d.features.hasSuperCluster ? 1 : 0, 0.5, '>');
  testFeature('hasMegaCluster', d => d.features.hasMegaCluster ? 1 : 0, 0.5, '>');
  testFeature('firstClusterDominance', d => d.features.firstClusterDominance ? 1 : 0, 0.5, '>');
  testFeature('extremePumpDump', d => d.features.extremePumpDump ? 1 : 0, 0.5, '>');

  // 测试组合特征
  console.log('');
  console.log('--- 组合特征测试 ---');

  const testCombined = (name, conditionFunc) => {
    let pumpPass = 0, pumpTotal = pumpData.length;
    let normalPass = 0, normalTotal = normalData.length;

    pumpData.forEach(d => {
      if (conditionFunc(d)) pumpPass++;
    });

    normalData.forEach(d => {
      if (conditionFunc(d)) normalPass++;
    });

    const pumpBlockRate = ((pumpTotal - pumpPass) / pumpTotal * 100).toFixed(1);
    const normalPassRate = (normalPass / normalTotal * 100).toFixed(1);

    console.log(name + ':');
    console.log('  拉砸拒绝率: ' + pumpBlockRate + '% (' + (pumpTotal - pumpPass) + '/' + pumpTotal + ')');
    console.log('  正常通过率: ' + normalPassRate + '% (' + normalPass + '/' + normalTotal + ')');
  };

  // 测试各种组合
  testCombined('方案1: maxClusterRatio > 0.7', d => d.features.maxClusterRatio > 0.7);
  testCombined('方案2: maxClusterRatio > 0.5', d => d.features.maxClusterRatio > 0.5);
  testCombined('方案3: hasSuperCluster', d => d.features.hasSuperCluster);
  testCombined('方案4: hasMegaCluster', d => d.features.hasMegaCluster);
  testCombined('方案5: extremePumpDump', d => d.features.extremePumpDump);
  testCombined('方案6: maxClusterRatio > 0.6 OR hasSuperCluster', d => d.features.maxClusterRatio > 0.6 || d.features.hasSuperCluster);
  testCombined('方案7: maxClusterRatio > 0.5 AND fragmentation < 2.0', d => d.features.maxClusterRatio > 0.5 && d.features.fragmentation < 2.0);
  testCombined('方案8: hasMegaCluster OR firstClusterDominance', d => d.features.hasMegaCluster || d.features.firstClusterDominance);

  // 测试基于现有preBuyCheckFactors的特征
  console.log('');
  console.log('--- 基于preBuyCheckFactors的特征 ---');

  const testExistingFactor = (name, getValue, operator, threshold) => {
    let pumpPass = 0, pumpTotal = pumpData.length;
    let normalPass = 0, normalTotal = normalData.length;

    pumpData.forEach(d => {
      const pb = d.preBuyFactors;
      const value = getValue(pb);
      if (value !== undefined && value !== null) {
        if (operator === '<' ? value < threshold : value > threshold) {
          pumpPass++;
        }
      }
    });

    normalData.forEach(d => {
      const pb = d.preBuyFactors;
      const value = getValue(pb);
      if (value !== undefined && value !== null) {
        if (operator === '<' ? value < threshold : value > threshold) {
          normalPass++;
        }
      }
    });

    const pumpBlockRate = ((pumpTotal - pumpPass) / pumpTotal * 100).toFixed(1);
    const normalPassRate = (normalPass / normalTotal * 100).toFixed(1);

    console.log(name + ':');
    console.log('  拉砸拒绝率: ' + pumpBlockRate + '%');
    console.log('  正常通过率: ' + normalPassRate + '%');
  };

  testExistingFactor('walletClusterMegaRatio > 0.5', pb => pb.walletClusterMegaRatio || 0, '>', 0.5);
  testExistingFactor('walletClusterMegaRatio > 0.3', pb => pb.walletClusterMegaRatio || 0, '>', 0.3);
  testExistingFactor('walletClusterSecondToFirstRatio < 0.3', pb => pb.walletClusterSecondToFirstRatio || 1, '<', 0.3);
  testExistingFactor('walletClusterSecondToFirstRatio < 0.2', pb => pb.walletClusterSecondToFirstRatio || 1, '<', 0.2);
  testExistingFactor('walletClusterCount <= 4', pb => pb.walletClusterCount || 0, '<', 5);
  testExistingFactor('walletClusterMaxSize > 150', pb => pb.walletClusterMaxSize || 0, '>', 150);
  testExistingFactor('walletClusterMaxSize > 200', pb => pb.walletClusterMaxSize || 0, '>', 200);

  // ==================== 第四部分：综合推荐方案 ====================
  console.log('');
  console.log('========================================');
  console.log('第四部分：综合推荐方案');
  console.log('========================================');
  console.log('');

  console.log('基于以上分析，推荐以下预检查条件：');
  console.log('');
  console.log('方案A（保守型，高拒绝率）：');
  console.log('  walletClusterMegaRatio > 0.5');
  console.log('  OR walletClusterSecondToFirstRatio < 0.2');
  console.log('  OR walletClusterMaxSize > 200');
  console.log('');
  console.log('方案B（平衡型）：');
  console.log('  walletClusterMegaRatio > 0.6');
  console.log('  OR (walletClusterSecondToFirstRatio < 0.2 AND walletClusterMaxSize > 100)');
  console.log('');
  console.log('方案C（激进型，高通过率）：');
  console.log('  walletClusterMegaRatio > 0.7');
  console.log('  OR (walletClusterMaxSize > 250 AND walletClusterSecondToFirstRatio < 0.1)');

  // 验证推荐方案
  console.log('');
  console.log('推荐方案验证：');

  const validateScheme = (name, conditionFunc) => {
    let pumpPass = 0, pumpTotal = pumpData.length;
    let normalPass = 0, normalTotal = normalData.length;

    pumpData.forEach(d => {
      if (conditionFunc(d)) pumpPass++;
    });

    normalData.forEach(d => {
      if (conditionFunc(d)) normalPass++;
    });

    const pumpBlockRate = ((pumpTotal - pumpPass) / pumpTotal * 100).toFixed(1);
    const normalPassRate = (normalPass / normalTotal * 100).toFixed(1);

    console.log(name + ':');
    console.log('  拉砸拒绝率: ' + pumpBlockRate + '%');
    console.log('  正常通过率: ' + normalPassRate + '%');
  };

  validateScheme('方案A', d => {
    const pb = d.preBuyFactors;
    return (pb.walletClusterMegaRatio || 0) > 0.5 ||
           (pb.walletClusterSecondToFirstRatio || 1) < 0.2 ||
           (pb.walletClusterMaxSize || 0) > 200;
  });

  validateScheme('方案B', d => {
    const pb = d.preBuyFactors;
    return (pb.walletClusterMegaRatio || 0) > 0.6 ||
           ((pb.walletClusterSecondToFirstRatio || 1) < 0.2 && (pb.walletClusterMaxSize || 0) > 100);
  });

  validateScheme('方案C', d => {
    const pb = d.preBuyFactors;
    return (pb.walletClusterMegaRatio || 0) > 0.7 ||
           ((pb.walletClusterMaxSize || 0) > 250 && (pb.walletClusterSecondToFirstRatio || 1) < 0.1);
  });

  console.log('');
  console.log('注意：方案A会拒绝更多拉砸代币，但也可能误杀更多正常代币。');
  console.log('方案C会更宽松，保留更多正常代币，但也可能放过更多拉砸代币。');
}

deepAnalysis().catch(console.error);
