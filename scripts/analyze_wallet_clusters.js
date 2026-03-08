/**
 * 钱包簇特征分析脚本
 * 验证拉砸代币 vs 非拉砸代币的钱包簇特征差异
 *
 * 核心假设：
 * - 拉砸代币：少数大型"钱包簇"，无间隔时间一起行动
 * - 非拉砸代币：钱包簇更多、更小，或分布更均匀
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();
const config = require('../config/default.json');

// AVE Tx API
const { AveTxAPI } = require('../src/core/ave-api');
const txApi = new AveTxAPI(
  config.ave.apiUrl,
  config.ave.timeout,
  process.env.AVE_API_KEY
);

// 拉砸代币列表
const PUMP_DUMP_TOKENS = [
  '0x244b0d8273ae7a9a290b18746ebfc12d5d484444',
  '0xe008178efbc988d0c44ab3f9ff8137a19a444444',
  '0x67e4c7e7b6b0a3431dd9fed80df2c56ecdfb4444',
  '0xfc295e1d2b4202baf68a07ffd1cde7bbe7d34444',
  '0x30a8dc7efe946872277afb5da71aed4010f54444',
  '0xfaf1a2339e2f00ed8dd6577cd7245dec4ae44444'
];

// 非拉砸代币列表
const NORMAL_TOKENS = [
  '0x09fd8d7311be4b824f92a3752594e88402d9ffff',
  '0x972173486ea3cfc5ce7f4afdf9d47d3faf654444',
  '0x1d9fc1aa3c4d4fd84a417251fdf159f85b58ffff',
  '0x616ddfe8a24f95984f35de866e1570550b1a4444',
  '0x75688525cfb77c1a51401c520f13a54f75544444',
  '0xefb07751d4717fdcc9166fae62c7f5b08bce44444',
  '0x8f53ac5d09aba6a3626696620ee63ac728d04444'
];

const ALL_TOKENS = [...PUMP_DUMP_TOKENS, ...NORMAL_TOKENS];

/**
 * 构建 innerPair
 */
function getInnerPair(tokenAddress, chain, tokenMetadata) {
  // 尝试从 metadata 获取
  if (tokenMetadata?.inner_pair) {
    return tokenMetadata.inner_pair;
  }
  if (tokenMetadata?.main_pair) {
    return tokenMetadata.main_pair;
  }
  if (tokenMetadata?.pair) {
    return tokenMetadata.pair;
  }

  // 否则按规则构建
  if (chain === 'ethereum' || chain === 'eth') {
    return `${tokenAddress}_iportal`;
  }
  // 默认 bsc
  return `${tokenAddress}_fo`;
}

/**
 * 识别交易簇
 * @param {Array} trades - 交易数组，按时间升序排列
 * @param {number} thresholdSecs - 时间间隔阈值（秒）
 * @returns {Array} 簇数组，每个簇包含交易的索引
 */
function detectClusters(trades, thresholdSecs = 1) {
  if (!trades || trades.length === 0) return [];

  const clusters = [];
  let currentCluster = [0];

  for (let i = 1; i < trades.length; i++) {
    const interval = trades[i].time - trades[i-1].time;
    if (interval <= thresholdSecs) {
      currentCluster.push(i);
    } else {
      if (currentCluster.length > 0) {
        clusters.push([...currentCluster]);
      }
      currentCluster = [i];
    }
  }

  if (currentCluster.length > 0) {
    clusters.push([...currentCluster]);
  }

  return clusters;
}

/**
 * 计算标准差
 */
function calculateStd(values) {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * 计算基尼系数（衡量不平等程度，0-1）
 * 值越大表示分布越不平等
 */
function calculateGini(values) {
  const n = values.length;
  if (n === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;

  let gini = 0;
  for (let i = 0; i < n; i++) {
    gini += (2 * (i + 1) - n - 1) * sorted[i];
  }
  return Math.abs(gini) / (n * sum);
}

/**
 * 计算变异系数（标准差/均值）
 */
function calculateCV(values) {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const std = calculateStd(values);
  return std / mean;
}

/**
 * 分析钱包簇特征
 */
function analyzeWalletClusters(trades, thresholdSecs = 1) {
  if (!trades || trades.length === 0) {
    return null;
  }

  // 1. 识别簇
  const clusters = detectClusters(trades, thresholdSecs);

  if (clusters.length === 0) {
    return null;
  }

  // 2. 计算簇大小
  const clusterSizes = clusters.map(c => c.length);
  const totalTrades = trades.length;
  const maxClusterSize = Math.max(...clusterSizes);

  // 3. 计算簇间时间间隔
  const clusterIntervals = [];
  for (let i = 1; i < clusters.length; i++) {
    const prevClusterLastIdx = clusters[i-1][clusters[i-1].length - 1];
    const currClusterFirstIdx = clusters[i][0];
    const interval = trades[currClusterFirstIdx].time - trades[prevClusterLastIdx].time;
    clusterIntervals.push(interval);
  }

  // 4. 钱包分析
  const allWallets = new Set();
  trades.forEach(t => {
    if (t.from_address) allWallets.add(t.from_address.toLowerCase());
    if (t.to_address) allWallets.add(t.to_address.toLowerCase());
  });

  // 5. 最大簇中的钱包数
  const maxClusterIdx = clusterSizes.indexOf(maxClusterSize);
  const maxClusterWallets = new Set();
  clusters[maxClusterIdx].forEach(idx => {
    const t = trades[idx];
    if (t.from_address) maxClusterWallets.add(t.from_address.toLowerCase());
    if (t.to_address) maxClusterWallets.add(t.to_address.toLowerCase());
  });

  // 6. 前3大簇的交易占比
  const sortedSizes = [...clusterSizes].sort((a, b) => b - a);
  const top3Sizes = sortedSizes.slice(0, 3);

  // 7. 超大簇特征（可能区分拉砸的关键）
  const megaClusterThreshold = 100; // 超过100笔的簇
  const megaClusters = clusters.filter(c => c.length >= megaClusterThreshold);
  const megaClusterCount = megaClusters.length;
  const megaClusterTradeCount = megaClusters.reduce((sum, c) => sum + c.length, 0);

  // 8. 第2簇与第1簇的比值（衡量分布不平等）
  const secondToFirstRatio = sortedSizes.length >= 2 ? sortedSizes[1] / sortedSizes[0] : 0;

  // 9. 头部簇集中度（前2簇占比）
  const top2ClusterRatio = sortedSizes.length >= 2
    ? (sortedSizes[0] + sortedSizes[1]) / totalTrades
    : sortedSizes[0] / totalTrades;

  return {
    // 基础统计
    totalTrades,
    uniqueWallets: allWallets.size,

    // 簇数量
    clusterCount: clusters.length,

    // 簇规模
    maxClusterSize,
    avgClusterSize: clusterSizes.reduce((a, b) => a + b, 0) / clusters.length,
    minClusterSize: Math.min(...clusterSizes),
    clusterSizeStd: calculateStd(clusterSizes),
    clusterSizeCV: calculateCV(clusterSizes),

    // 小簇比例
    smallClusterCount: clusters.filter(c => c.length <= 5).length,
    smallClusterRatio: clusters.filter(c => c.length <= 5).length / clusters.length,
    tinyClusterCount: clusters.filter(c => c.length <= 2).length,
    tinyClusterRatio: clusters.filter(c => c.length <= 2).length / clusters.length,

    // 集中度
    topClusterRatio: maxClusterSize / totalTrades,
    top2ClusterRatio,
    top3ClusterRatio: top3Sizes.reduce((a, b) => a + b, 0) / totalTrades,

    // 不平等程度
    giniCoefficient: calculateGini(clusterSizes),
    secondToFirstRatio,

    // 超大簇特征（新）
    megaClusterCount,
    megaClusterRatio: megaClusterTradeCount / totalTrades,
    hasMegaCluster: megaClusterCount > 0,

    // 时间特征
    clusterIntervalMean: clusterIntervals.length > 0
      ? clusterIntervals.reduce((a, b) => a + b, 0) / clusterIntervals.length
      : null,
    clusterIntervalStd: clusterIntervals.length > 0 ? calculateStd(clusterIntervals) : null,

    // 最大簇详情
    uniqueWalletsInMaxCluster: maxClusterWallets.size,

    // 簇规模分布（用于详细分析）
    clusterSizeDistribution: clusterSizes.sort((a, b) => b - a)
  };
}

/**
 * 获取代币的早期交易数据
 */
async function getEarlyTrades(tokenAddress, chain, innerPair, signalTime) {
  try {
    const checkTime = Math.floor(new Date(signalTime).getTime() / 1000);
    const fromTime = checkTime - 90; // 回溯90秒
    const toTime = checkTime;

    const pairId = `${innerPair}-${chain}`;

    console.log(`   获取交易数据: ${pairId}, 窗口: ${fromTime} - ${toTime}`);

    const trades = await txApi.getSwapTransactions(
      pairId,
      300,      // limit
      fromTime,
      toTime,
      'asc'     // 按时间升序
    );

    return trades;

  } catch (error) {
    console.error(`   获取交易失败: ${error.message}`);
    return null;
  }
}

/**
 * 计算均值
 */
function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * 计算中位数
 */
function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * 统计检验（Mann-Whitney U 近似）
 * 返回 p-value 和效应量（Cohen's d）
 */
function performStatisticalTest(group1, group2) {
  const n1 = group1.length;
  const n2 = group2.length;

  if (n1 === 0 || n2 === 0) {
    return { pValue: null, effectSize: null };
  }

  const mean1 = mean(group1);
  const mean2 = mean(group2);
  const std1 = calculateStd(group1);
  const std2 = calculateStd(group2);

  // Cohen's d (效应量)
  const pooledStd = Math.sqrt(((n1 - 1) * std1 * std1 + (n2 - 1) * std2 * std2) / (n1 + n2 - 2));
  const effectSize = pooledStd > 0 ? (mean1 - mean2) / pooledStd : 0;

  // 简化的 t-test
  const se = pooledStd * Math.sqrt(1/n1 + 1/n2);
  const t = se > 0 ? (mean1 - mean2) / se : 0;

  // 简化的 p-value 估算（双侧检验）
  // 这只是近似值，更精确需要 t 分布表
  const absT = Math.abs(t);
  let pValue;
  if (absT < 1.96) {
    pValue = 0.1; // p > 0.05
  } else if (absT < 2.58) {
    pValue = 0.05; // p < 0.05
  } else if (absT < 3.29) {
    pValue = 0.01; // p < 0.01
  } else {
    pValue = 0.001; // p < 0.001
  }

  return {
    mean1,
    mean2,
    std1,
    std2,
    median1: median(group1),
    median2: median(group2),
    pValue,
    effectSize: Math.abs(effectSize),
    significant: pValue <= 0.05
  };
}

/**
 * 主函数
 */
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    钱包簇特征分析 - 拉砸 vs 非拉砸                          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 1. 首先获取所有虚拟实验ID
  console.log('【步骤 1/5】获取虚拟实验列表...\n');

  const { data: virtualExps } = await supabase
    .from('experiments')
    .select('id, experiment_name')
    .eq('trading_mode', 'virtual');

  if (!virtualExps || virtualExps.length === 0) {
    console.error('未找到虚拟实验');
    process.exit(1);
  }

  const virtualExpIds = virtualExps.map(e => e.id);
  console.log(`找到 ${virtualExpIds.length} 个虚拟实验\n`);

  // 2. 查询这些虚拟实验中的所有信号
  console.log('【步骤 2/5】查询虚拟实验中的信号...\n');

  const { data: signals, error } = await supabase
    .from('strategy_signals')
    .select('*')
    .in('experiment_id', virtualExpIds)
    .in('token_address', ALL_TOKENS);

  if (error) {
    console.error('查询失败:', error);
    process.exit(1);
  }

  console.log(`找到 ${signals.length} 条信号\n`);

  // 筛选已执行的买入信号
  const virtualBuySignals = signals.filter(s =>
    s.executed === true &&
    s.signal_type === 'BUY' &&
    s.created_at
  );

  console.log(`其中已执行的买入信号: ${virtualBuySignals.length} 条\n`);

  // 按代币分组
  const signalsByToken = new Map();
  for (const signal of virtualBuySignals) {
    if (!signalsByToken.has(signal.token_address)) {
      signalsByToken.set(signal.token_address, []);
    }
    signalsByToken.get(signal.token_address).push(signal);
  }

  console.log(`涉及 ${signalsByToken.size} 个代币\n`);

  // 3. 获取每个代币的元数据
  console.log('【步骤 3/5】获取代币元数据...\n');

  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('*')
    .in('token_address', ALL_TOKENS);

  const tokenMetadataMap = new Map();
  for (const token of tokens) {
    tokenMetadataMap.set(token.token_address, token);
  }

  // 4. 分析每个代币的钱包簇特征
  console.log('\n【步骤 4/5】分析钱包簇特征...\n');

  const results = {
    pumpDump: [],
    normal: []
  };

  let processedCount = 0;

  for (const [tokenAddress, tokenSignals] of signalsByToken) {
    const isPumpDump = PUMP_DUMP_TOKENS.includes(tokenAddress);
    const category = isPumpDump ? '拉砸' : '非拉砸';

    const tokenMeta = tokenMetadataMap.get(tokenAddress);
    const firstSignal = tokenSignals[0];

    console.log(`${processedCount + 1}. ${firstSignal.token_symbol || tokenAddress.slice(0, 10)} (${category})`);
    console.log(`   地址: ${tokenAddress}`);
    console.log(`   链: ${firstSignal.chain || 'bsc'}`);
    console.log(`   购买信号数: ${tokenSignals.length}`);

    // 构建 innerPair
    const chain = firstSignal.chain || tokenMeta?.blockchain || 'bsc';
    const innerPair = getInnerPair(tokenAddress, chain, tokenMeta?.metadata);

    console.log(`   innerPair: ${innerPair}`);

    // 获取第一条购买信号的时间
    const firstBuyTime = tokenSignals
      .filter(s => s.created_at)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0]?.created_at;

    if (!firstBuyTime) {
      console.log(`   ⚠️  无有效的购买信号时间\n`);
      continue;
    }

    console.log(`   首次购买时间: ${new Date(firstBuyTime).toISOString()}`);

    // 获取早期交易数据
    const trades = await getEarlyTrades(tokenAddress, chain, innerPair, firstBuyTime);

    if (!trades || trades.length === 0) {
      console.log(`   ⚠️  无交易数据\n`);
      await new Promise(r => setTimeout(r, 1000)); // API 限速
      continue;
    }

    console.log(`   交易数: ${trades.length}`);

    // 分析钱包簇特征
    const features = analyzeWalletClusters(trades, 1); // 1秒阈值

    if (!features) {
      console.log(`   ⚠️  无法分析特征\n`);
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }

    console.log(`   簇数: ${features.clusterCount}, 最大簇: ${features.maxClusterSize}笔, 钱包数: ${features.uniqueWallets}`);
    console.log(`   Top簇占比: ${(features.topClusterRatio * 100).toFixed(1)}%, 基尼系数: ${features.giniCoefficient.toFixed(3)}`);

    // 保存结果
    const result = {
      tokenAddress,
      symbol: firstSignal.token_symbol || tokenAddress.slice(0, 10),
      chain,
      buySignalCount: tokenSignals.length,
      tradeCount: trades.length,
      ...features
    };

    if (isPumpDump) {
      results.pumpDump.push(result);
    } else {
      results.normal.push(result);
    }

    processedCount++;

    console.log('');

    // API 限速
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`\n成功分析 ${processedCount} 个代币\n`);

  // 5. 统计对比
  console.log('\n【步骤 5/5】统计对比分析\n');
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                          统计对比报告                                    ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 定义要对比的特征
  const featuresToCompare = [
    { name: 'clusterCount', label: '簇数量' },
    { name: 'maxClusterSize', label: '最大簇大小' },
    { name: 'avgClusterSize', label: '平均簇大小' },
    { name: 'clusterSizeStd', label: '簇大小标准差' },
    { name: 'smallClusterRatio', label: '小簇占比' },
    { name: 'topClusterRatio', label: '最大簇占比' },
    { name: 'top2ClusterRatio', label: '前2簇占比' },
    { name: 'top3ClusterRatio', label: '前3簇占比' },
    { name: 'giniCoefficient', label: '基尼系数' },
    { name: 'secondToFirstRatio', label: '第2簇/第1簇' },
    { name: 'megaClusterCount', label: '超大簇数(>100笔)' },
    { name: 'megaClusterRatio', label: '超大簇占比' },
    { name: 'uniqueWalletsInMaxCluster', label: '最大簇钱包数' }
  ];

  console.log('┌─────────────────────┬──────────────┬──────────────┬─────────┬──────────┐');
  console.log('│ 特征                │ 拉砸均值     │ 非拉砸均值   │ p-value │ 效应量   │');
  console.log('├─────────────────────┼──────────────┼──────────────┼─────────┼──────────┤');

  const comparisons = [];

  for (const feature of featuresToCompare) {
    const pumpValues = results.pumpDump.map(r => r[feature.name]).filter(v => v != null);
    const normalValues = results.normal.map(r => r[feature.name]).filter(v => v != null);

    if (pumpValues.length === 0 || normalValues.length === 0) {
      continue;
    }

    const test = performStatisticalTest(pumpValues, normalValues);

    const pValueLabel = test.pValue < 0.01 ? '<0.01' :
                        test.pValue < 0.05 ? '<0.05' :
                        test.pValue < 0.1 ? '0.1' : 'ns';

    const sigMarker = test.significant ? '★' : ' ';

    console.log(`│${sigMarker} ${feature.label.padEnd(20)}│ ${test.mean1.toFixed(2).padStart(12)} │ ${test.mean2.toFixed(2).padStart(12)} │ ${pValueLabel.padStart(7)} │ ${test.effectSize.toFixed(2).padStart(8)} │`);

    comparisons.push({
      feature: feature.label,
      ...test,
      pumpValues,
      normalValues
    });
  }

  console.log('└─────────────────────┴──────────────┴──────────────┴─────────┴──────────┘');
  console.log('\n★ 表示 p<0.05 显著差异');

  // 详细数据展示
  console.log('\n\n【拉砸代币详细数据】\n');
  results.pumpDump.forEach(r => {
    console.log(`  ${r.symbol.padEnd(12)}: 簇${r.clusterCount}个, 最大${r.maxClusterSize}笔, Top占比${(r.topClusterRatio*100).toFixed(0)}%, 基尼${r.giniCoefficient.toFixed(2)}, 交易${r.tradeCount}笔`);
  });

  console.log('\n【非拉砸代币详细数据】\n');
  results.normal.forEach(r => {
    console.log(`  ${r.symbol.padEnd(12)}: 簇${r.clusterCount}个, 最大${r.maxClusterSize}笔, Top占比${(r.topClusterRatio*100).toFixed(0)}%, 基尼${r.giniCoefficient.toFixed(2)}, 交易${r.tradeCount}笔`);
  });

  // 簇大小分布展示
  console.log('\n\n【簇大小分布对比】\n');

  console.log('拉砸代币簇大小分布:');
  results.pumpDump.forEach(r => {
    const dist = r.clusterSizeDistribution.slice(0, 5); // 前5个
    console.log(`  ${r.symbol.padEnd(12)}: [${dist.map(s => `${s}笔`).join(', ')}${r.clusterSizeDistribution.length > 5 ? '...' : ''}]`);
  });

  console.log('\n非拉砸代币簇大小分布:');
  results.normal.forEach(r => {
    const dist = r.clusterSizeDistribution.slice(0, 5);
    console.log(`  ${r.symbol.padEnd(12)}: [${dist.map(s => `${s}笔`).join(', ')}${r.clusterSizeDistribution.length > 5 ? '...' : ''}]`);
  });

  // 结论
  console.log('\n\n═══════════════════════════════════════════════════════════════════════════');
}

main().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
