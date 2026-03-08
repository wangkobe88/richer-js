/**
 * 钱包簇特征分析脚本 v2
 * 尝试多个时间阈值，寻找最佳区分特征
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();
const config = require('../config/default.json');

const { AveTxAPI } = require('../src/core/ave-api');
const txApi = new AveTxAPI(config.ave.apiUrl, config.ave.timeout, process.env.AVE_API_KEY);

const PUMP_DUMP_TOKENS = [
  '0x244b0d8273ae7a9a290b18746ebfc12d5d484444',
  '0xe008178efbc988d0c44ab3f9ff8137a19a444444',
  '0x67e4c7e7b6b0a3431dd9fed80df2c56ecdfb4444',
  '0xfc295e1d2b4202baf68a07ffd1cde7bbe7d34444',
  '0x30a8dc7efe946872277afb5da71aed4010f54444',
  '0xfaf1a2339e2f00ed8dd6577cd7245dec4ae44444'
];

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

function getInnerPair(tokenAddress, chain, tokenMetadata) {
  if (tokenMetadata?.inner_pair) return tokenMetadata.inner_pair;
  if (tokenMetadata?.main_pair) return tokenMetadata.main_pair;
  if (tokenMetadata?.pair) return tokenMetadata.pair;
  if (chain === 'ethereum' || chain === 'eth') return `${tokenAddress}_iportal`;
  return `${tokenAddress}_fo`;
}

function detectClusters(trades, thresholdSecs = 1) {
  if (!trades || trades.length === 0) return [];
  const clusters = [];
  let currentCluster = [0];
  for (let i = 1; i < trades.length; i++) {
    const interval = trades[i].time - trades[i-1].time;
    if (interval <= thresholdSecs) {
      currentCluster.push(i);
    } else {
      if (currentCluster.length > 0) clusters.push([...currentCluster]);
      currentCluster = [i];
    }
  }
  if (currentCluster.length > 0) clusters.push(currentCluster);
  return clusters;
}

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
 * 分析簇特征（多阈值版本）
 */
function analyzeClustersMultiThreshold(trades, thresholds = [0.5, 1, 2]) {
  if (!trades || trades.length === 0) return null;

  const results = {};

  for (const threshold of thresholds) {
    const clusters = detectClusters(trades, threshold);
    if (clusters.length === 0) continue;

    const clusterSizes = clusters.map(c => c.length);
    const sortedSizes = [...clusterSizes].sort((a, b) => b - a);

    // 关键特征：第2簇与第1簇的比值
    const secondToFirstRatio = sortedSizes.length >= 2
      ? sortedSizes[1] / sortedSizes[0]
      : 0;

    // 超大簇特征
    const megaClusterThreshold = 100;
    const megaClusters = clusters.filter(c => c.length >= megaClusterThreshold);
    const megaClusterTradeCount = megaClusters.reduce((sum, c) => sum + c.length, 0);

    results[`t${threshold}`] = {
      clusterCount: clusters.length,
      maxClusterSize: sortedSizes[0] || 0,
      avgClusterSize: clusterSizes.reduce((a, b) => a + b, 0) / clusters.length,
      topClusterRatio: (sortedSizes[0] || 0) / trades.length,
      top2ClusterRatio: sortedSizes.length >= 2
        ? (sortedSizes[0] + sortedSizes[1]) / trades.length
        : (sortedSizes[0] || 0) / trades.length,
      giniCoefficient: calculateGini(clusterSizes),
      secondToFirstRatio,
      megaClusterCount: megaClusters.length,
      megaClusterRatio: megaClusterTradeCount / trades.length,
      clusterSizeDistribution: sortedSizes
    };
  }

  return results;
}

async function getEarlyTrades(tokenAddress, chain, innerPair, signalTime) {
  try {
    const checkTime = Math.floor(new Date(signalTime).getTime() / 1000);
    const fromTime = checkTime - 90;
    const toTime = checkTime;
    const pairId = `${innerPair}-${chain}`;

    const trades = await txApi.getSwapTransactions(pairId, 300, fromTime, toTime, 'asc');
    return trades;
  } catch (error) {
    return null;
  }
}

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function calculateStd(values) {
  if (values.length === 0) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / values.length);
}

/**
 * 简化的统计检验
 */
function performStatisticalTest(group1, group2) {
  const n1 = group1.length;
  const n2 = group2.length;
  if (n1 === 0 || n2 === 0) return { pValue: null, effectSize: null, mean1: 0, mean2: 0 };

  const mean1 = mean(group1);
  const mean2 = mean(group2);
  const std1 = calculateStd(group1);
  const std2 = calculateStd(group2);

  const pooledStd = Math.sqrt(((n1 - 1) * std1 * std1 + (n2 - 1) * std2 * std2) / (n1 + n2 - 2));
  const effectSize = pooledStd > 0 ? (mean1 - mean2) / pooledStd : 0;

  const se = pooledStd * Math.sqrt(1/n1 + 1/n2);
  const t = se > 0 ? (mean1 - mean2) / se : 0;

  const absT = Math.abs(t);
  let pValue = absT < 1.96 ? 0.1 : absT < 2.58 ? 0.05 : absT < 3.29 ? 0.01 : 0.001;

  return { mean1, mean2, pValue, effectSize: Math.abs(effectSize), significant: pValue <= 0.05 };
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║              钱包簇特征分析 v2 - 多阈值对比                                  ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 获取虚拟实验
  const { data: virtualExps } = await supabase
    .from('experiments')
    .select('id')
    .eq('trading_mode', 'virtual');

  const virtualExpIds = virtualExps.map(e => e.id);

  // 查询信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .in('experiment_id', virtualExpIds)
    .in('token_address', ALL_TOKENS);

  const virtualBuySignals = signals.filter(s =>
    s.executed === true && s.signal_type === 'BUY' && s.created_at
  );

  console.log(`找到 ${virtualBuySignals.length} 条虚拟实验买入信号\n`);

  // 按代币分组
  const signalsByToken = new Map();
  for (const signal of virtualBuySignals) {
    if (!signalsByToken.has(signal.token_address)) {
      signalsByToken.set(signal.token_address, []);
    }
    signalsByToken.get(signal.token_address).push(signal);
  }

  // 获取代币元数据
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('*')
    .in('token_address', ALL_TOKENS);

  const tokenMetadataMap = new Map();
  for (const token of tokens) {
    tokenMetadataMap.set(token.token_address, token);
  }

  // 分析每个代币
  const results = { pumpDump: [], normal: [] };

  for (const [tokenAddress, tokenSignals] of signalsByToken) {
    const isPumpDump = PUMP_DUMP_TOKENS.includes(tokenAddress);
    const category = isPumpDump ? '拉砸' : '非拉砸';

    const tokenMeta = tokenMetadataMap.get(tokenAddress);
    const firstSignal = tokenSignals[0];

    const chain = firstSignal.chain || tokenMeta?.blockchain || 'bsc';
    const innerPair = getInnerPair(tokenAddress, chain, tokenMeta?.metadata);

    const firstBuyTime = tokenSignals
      .filter(s => s.created_at)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0]?.created_at;

    if (!firstBuyTime) continue;

    const trades = await getEarlyTrades(tokenAddress, chain, innerPair, firstBuyTime);
    if (!trades || trades.length === 0) {
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }

    const features = analyzeClustersMultiThreshold(trades, [0.5, 1, 2]);

    const result = {
      tokenAddress,
      symbol: firstSignal.token_symbol || tokenAddress.slice(0, 10),
      chain,
      tradeCount: trades.length,
      ...features
    };

    if (isPumpDump) {
      results.pumpDump.push(result);
    } else {
      results.normal.push(result);
    }

    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`\n成功分析 ${results.pumpDump.length + results.normal.length} 个代币\n`);

  // 多阈值对比
  const thresholds = [0.5, 1, 2];
  const featuresToCompare = [
    { name: 'secondToFirstRatio', label: '第2簇/第1簇' },
    { name: 'megaClusterCount', label: '超大簇数' },
    { name: 'megaClusterRatio', label: '超大簇占比' },
    { name: 'top2ClusterRatio', label: '前2簇占比' },
    { name: 'giniCoefficient', label: '基尼系数' }
  ];

  for (const threshold of thresholds) {
    const prefix = `t${threshold}`;

    console.log(`\n╔══════════════════════════════════════════════════════════════════════════╗`);
    console.log(`║                    时间阈值 = ${threshold}秒                                              ║`);
    console.log(`╚══════════════════════════════════════════════════════════════════════════╝\n`);

    console.log('┌─────────────────────┬──────────────┬──────────────┬─────────┬──────────┐');
    console.log('│ 特征                │ 拉砸均值     │ 非拉砸均值   │ p-value │ 效应量   │');
    console.log('├─────────────────────┼──────────────┼──────────────┼─────────┼──────────┤');

    for (const feature of featuresToCompare) {
      const pumpValues = results.pumpDump
        .map(r => r[prefix]?.[feature.name])
        .filter(v => v != null);
      const normalValues = results.normal
        .map(r => r[prefix]?.[feature.name])
        .filter(v => v != null);

      if (pumpValues.length === 0 || normalValues.length === 0) continue;

      const test = performStatisticalTest(pumpValues, normalValues);

      const pValueLabel = test.pValue < 0.01 ? '<0.01' :
                          test.pValue < 0.05 ? '<0.05' :
                          test.pValue < 0.1 ? '0.1' : 'ns';

      const sigMarker = test.significant ? '★' : ' ';

      console.log(`│${sigMarker} ${feature.label.padEnd(20)}│ ${test.mean1.toFixed(3).padStart(12)} │ ${test.mean2.toFixed(3).padStart(12)} │ ${pValueLabel.padStart(7)} │ ${test.effectSize.toFixed(2).padStart(8)} │`);
    }

    console.log('└─────────────────────┴──────────────┴──────────────┴─────────┴──────────┘');

    // 显示该阈值下的详细数据
    console.log(`\n【拉砸代币 - ${threshold}秒阈值】`);
    results.pumpDump.forEach(r => {
      const f = r[prefix];
      if (!f) return;
      console.log(`  ${r.symbol.padEnd(12)}: 簇${f.clusterCount}个, 最大${f.maxClusterSize}笔, 2/1=${f.secondToFirstRatio.toFixed(2)}, 超大簇${f.megaClusterCount}个`);
    });

    console.log(`\n【非拉砸代币 - ${threshold}秒阈值】`);
    results.normal.forEach(r => {
      const f = r[prefix];
      if (!f) return;
      console.log(`  ${r.symbol.padEnd(12)}: 簇${f.clusterCount}个, 最大${f.maxClusterSize}笔, 2/1=${f.secondToFirstRatio.toFixed(2)}, 超大簇${f.megaClusterCount}个`);
    });
  }

  console.log('\n\n═══════════════════════════════════════════════════════════════════════════');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
