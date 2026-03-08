/**
 * 钱包簇分类器设计
 * 基于当前12个样本设计判断规则，计算混淆矩阵
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();
const config = require('../config/default.json');

const { AveTxAPI } = require('../src/core/ave-api');
const txApi = new AveTxAPI(config.ave.apiUrl, config.ave.timeout, process.env.AVE_API_KEY);

const PUMP_DUMP_TOKENS = [
  '0x244b0d8273ae7a9a290b18746ebfc12d5d484444',  // 神雕侠侣
  '0xe008178efbc988d0c44ab3f9ff8137a19a444444',  // XMONEY
  '0x67e4c7e7b6b0a3431dd9fed80df2c56ecdfb4444',  // FREEDOM
  '0xfc295e1d2b4202baf68a07ffd1cde7bbe7d34444',  // AND
  '0x30a8dc7efe946872277afb5da71aed4010f54444',  // 鲸狗
  '0xfaf1a2339e2f00ed8dd6577cd7245dec4ae44444'   // 小龙虾
];

const NORMAL_TOKENS = [
  '0x09fd8d7311be4b824f92a3752594e88402d9ffff',  // CLAWSTER
  '0x972173486ea3cfc5ce7f4afdf9d47d3faf654444',  // WIF
  '0x1d9fc1aa3c4d4fd84a417251fdf159f85b58ffff',  // CLAWR
  '0x616ddfe8a24f95984f35de866e1570550b1a4444',  // 巨鲸
  '0x75688525cfb77c1a51401c520f13a54f75544444',  // WOC
  '0x8f53ac5d09aba6a3626696620ee63ac728d04444'   // 中国链
];

function getInnerPair(tokenAddress, chain, tokenMetadata) {
  if (tokenMetadata?.inner_pair) return tokenMetadata.inner_pair;
  if (tokenMetadata?.main_pair) return tokenMetadata.main_pair;
  if (tokenMetadata?.pair) return tokenMetadata.pair;
  if (chain === 'ethereum' || chain === 'eth') return `${tokenAddress}_iportal`;
  return `${tokenAddress}_fo`;
}

function detectClusters(trades, thresholdSecs = 2) {
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

function calculateFeatures(trades) {
  const clusters = detectClusters(trades, 2);
  const clusterSizes = clusters.map(c => c.length);
  const sortedSizes = [...clusterSizes].sort((a, b) => b - a);

  const megaClusterThreshold = 100;
  const megaClusters = clusters.filter(c => c.length >= megaClusterThreshold);
  const megaClusterTradeCount = megaClusters.reduce((sum, c) => sum + c.length, 0);

  return {
    clusterCount: clusters.length,
    maxClusterSize: sortedSizes[0] || 0,
    secondClusterSize: sortedSizes[1] || 0,
    secondToFirstRatio: sortedSizes.length >= 2 ? sortedSizes[1] / sortedSizes[0] : 0,
    top2ClusterRatio: sortedSizes.length >= 2
      ? (sortedSizes[0] + sortedSizes[1]) / trades.length
      : sortedSizes[0] / trades.length,
    megaClusterCount: megaClusters.length,
    megaClusterRatio: megaClusterTradeCount / trades.length,
    clusterSizeDistribution: sortedSizes
  };
}

/**
 * 分类规则设计
 */
const CLASSIFICATION_RULES = {
  // 规则1：仅使用第2簇/第1簇比值（最强特征）
  rule1: {
    name: '规则1: 第2簇/第1簇 < 0.3',
    predict: (features) => features.secondToFirstRatio < 0.3
  },

  // 规则2：第2簇/第1簇 < 0.25（更严格）
  rule2: {
    name: '规则2: 第2簇/第1簇 < 0.25',
    predict: (features) => features.secondToFirstRatio < 0.25
  },

  // 规则3：第2簇/第1簇 < 0.2（非常严格）
  rule3: {
    name: '规则3: 第2簇/第1簇 < 0.2',
    predict: (features) => features.secondToFirstRatio < 0.2
  },

  // 规则4：超大簇占比 > 30%
  rule4: {
    name: '规则4: 超大簇占比 > 30%',
    predict: (features) => features.megaClusterRatio > 0.3
  },

  // 规则5：前2簇占比 > 80%
  rule5: {
    name: '规则5: 前2簇占比 > 80%',
    predict: (features) => features.top2ClusterRatio > 0.8
  },

  // 规则6：组合规则（第2簇/第1簇 < 0.3 且 前2簇占比 > 75%）
  rule6: {
    name: '规则6: 第2簇/第1簇 < 0.3 且 前2簇占比 > 75%',
    predict: (features) => features.secondToFirstRatio < 0.3 && features.top2ClusterRatio > 0.75
  },

  // 规则7：组合规则（第2簇/第1簇 < 0.3 或 超大簇占比 > 40%）
  rule7: {
    name: '规则7: 第2簇/第1簇 < 0.3 或 超大簇占比 > 40%',
    predict: (features) => features.secondToFirstRatio < 0.3 || features.megaClusterRatio > 0.4
  },

  // 规则8：宽松组合（第2簇/第1簇 < 0.4 或 前2簇占比 > 80%）
  rule8: {
    name: '规则8: 第2簇/第1簇 < 0.4 或 前2簇占比 > 80%',
    predict: (features) => features.secondToFirstRatio < 0.4 || features.top2ClusterRatio > 0.8
  }
};

/**
 * 计算混淆矩阵和性能指标
 */
function calculateMetrics(predictions, actualLabels) {
  let tp = 0, tn = 0, fp = 0, fn = 0;

  predictions.forEach((pred, i) => {
    const actual = actualLabels[i];
    if (pred === 1 && actual === 1) tp++;
    else if (pred === 0 && actual === 0) tn++;
    else if (pred === 1 && actual === 0) fp++;
    else if (pred === 0 && actual === 1) fn++;
  });

  const accuracy = (tp + tn) / (tp + tn + fp + fn);
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
  const specificity = tn + fp > 0 ? tn / (tn + fp) : 0;

  return { tp, tn, fp, fn, accuracy, precision, recall, f1, specificity };
}

/**
 * 打印混淆矩阵
 */
function printConfusionMatrix(metrics, ruleName) {
  console.log(`\n${ruleName}`);
  console.log('┌─────────────────┬──────────────┬──────────────┐');
  console.log('│                 │ 预测: 非拉砸  │ 预测: 拉砸   │');
  console.log('├─────────────────┼──────────────┼──────────────┤');
  console.log(`│ 实际: 非拉砸    │     ${metrics.tn}        │     ${metrics.fp}        │`);
  console.log(`│ 实际: 拉砸      │     ${metrics.fn}        │     ${metrics.tp}        │`);
  console.log('└─────────────────┴──────────────┴──────────────┘');
  console.log(`准确率: ${(metrics.accuracy * 100).toFixed(1)}%, 精确率: ${(metrics.precision * 100).toFixed(1)}%, 召回率: ${(metrics.recall * 100).toFixed(1)}%, F1: ${metrics.f1.toFixed(2)}`);
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    钱包簇分类器设计与评估                                  ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 获取数据
  const { data: virtualExps } = await supabase
    .from('experiments')
    .select('id')
    .eq('trading_mode', 'virtual');

  const virtualExpIds = virtualExps.map(e => e.id);

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .in('experiment_id', virtualExpIds)
    .in('token_address', [...PUMP_DUMP_TOKENS, ...NORMAL_TOKENS]);

  const virtualBuySignals = signals.filter(s =>
    s.executed === true && s.signal_type === 'BUY' && s.created_at
  );

  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('*')
    .in('token_address', [...PUMP_DUMP_TOKENS, ...NORMAL_TOKENS]);

  const tokenMetadataMap = new Map();
  for (const token of tokens) {
    tokenMetadataMap.set(token.token_address, token);
  }

  // 收集特征
  const allData = [];
  const signalsByToken = new Map();

  for (const signal of virtualBuySignals) {
    if (!signalsByToken.has(signal.token_address)) {
      signalsByToken.set(signal.token_address, []);
    }
    signalsByToken.get(signal.token_address).push(signal);
  }

  for (const [tokenAddress, tokenSignals] of signalsByToken) {
    const isPumpDump = PUMP_DUMP_TOKENS.includes(tokenAddress);

    const tokenMeta = tokenMetadataMap.get(tokenAddress);
    const firstSignal = tokenSignals[0];

    const chain = firstSignal.chain || tokenMeta?.blockchain || 'bsc';
    const innerPair = getInnerPair(tokenAddress, chain, tokenMeta?.metadata);

    const firstBuyTime = tokenSignals
      .filter(s => s.created_at)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0]?.created_at;

    if (!firstBuyTime) continue;

    try {
      const checkTime = Math.floor(new Date(firstBuyTime).getTime() / 1000);
      const fromTime = checkTime - 90;
      const toTime = checkTime;
      const pairId = `${innerPair}-${chain}`;

      const trades = await txApi.getSwapTransactions(pairId, 300, fromTime, toTime, 'asc');

      if (!trades || trades.length === 0) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      const features = calculateFeatures(trades);

      allData.push({
        tokenAddress,
        symbol: firstSignal.token_symbol || tokenAddress.slice(0, 10),
        isPumpDump,
        features
      });

      await new Promise(r => setTimeout(r, 1500));
    } catch (error) {
      console.error(`处理 ${tokenAddress.slice(0, 10)} 失败: ${error.message}`);
    }
  }

  console.log(`\n收集到 ${allData.length} 个代币的数据\n`);

  // 展示每个代币的特征值
  console.log('【代币特征值】\n');
  console.log('代币          类型      第2簇/第1簇  前2簇占比  超大簇占比');
  console.log('────────────────────────────────────────────────────────────');
  allData.forEach(d => {
    const type = d.isPumpDump ? '拉砸  ' : '非拉砸';
    console.log(`${d.symbol.padEnd(12)} ${type}  ${d.features.secondToFirstRatio.toFixed(3).padStart(10)}  ${(d.features.top2ClusterRatio * 100).toFixed(1).padStart(8)}%  ${(d.features.megaClusterRatio * 100).toFixed(1).padStart(8)}%`);
  });

  // 测试所有规则
  console.log('\n\n╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                          分类规则评估                                        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const actualLabels = allData.map(d => d.isPumpDump ? 1 : 0);
  const results = [];

  for (const [ruleKey, rule] of Object.entries(CLASSIFICATION_RULES)) {
    const predictions = allData.map(d => rule.predict(d.features) ? 1 : 0);
    const metrics = calculateMetrics(predictions, actualLabels);
    results.push({ ruleKey, rule, metrics });

    printConfusionMatrix(metrics, rule.name);
  }

  // 找出最佳规则
  console.log('\n\n【规则性能排序（按F1分数）】\n');
  results.sort((a, b) => b.metrics.f1 - a.metrics.f1);

  console.log('排名  规则                                                    准确率  精确率  召回率  F1分数');
  console.log('────────────────────────────────────────────────────────────────────────────────');
  results.forEach((r, i) => {
    console.log(`${(i + 1).toString().padStart(2)}.  ${r.rule.name.padEnd(50)}  ${(r.metrics.accuracy * 100).toFixed(0).padStart(5)}%  ${(r.metrics.precision * 100).toFixed(0).padStart(5)}%  ${(r.metrics.recall * 100).toFixed(0).padStart(5)}%  ${r.metrics.f1.toFixed(2).padStart(5)}`);
  });

  // 推荐规则
  console.log('\n\n【推荐规则】\n');

  const bestF1 = results[0];
  const bestRecall = results.sort((a, b) => b.metrics.recall - a.metrics.recall)[0];
  const bestPrecision = results.sort((a, b) => b.metrics.precision - a.metrics.precision)[0];

  console.log(`🏆 最佳F1分数: ${bestF1.rule.name}`);
  console.log(`   准确率=${(bestF1.metrics.accuracy * 100).toFixed(1)}%, 精确率=${(bestF1.metrics.precision * 100).toFixed(1)}%, 召回率=${(bestF1.metrics.recall * 100).toFixed(1)}%, F1=${bestF1.metrics.f1.toFixed(2)}`);

  console.log(`\n🎯 最佳召回率（不漏拉砸）: ${bestRecall.rule.name}`);
  console.log(`   召回率=${(bestRecall.metrics.recall * 100).toFixed(1)}%, 精确率=${(bestRecall.metrics.precision * 100).toFixed(1)}%`);

  console.log(`\n💎 最佳精确率（不误判）: ${bestPrecision.rule.name}`);
  console.log(`   精确率=${(bestPrecision.metrics.precision * 100).toFixed(1)}%, 召回率=${(bestPrecision.metrics.recall * 100).toFixed(1)}%`);

  // 详细展示最佳规则的预测结果
  console.log(`\n\n【最佳规则详细预测结果】\n`);
  console.log(`规则: ${bestF1.rule.name}`);
  console.log('\n代币          实际    预测    结果');
  console.log('────────────────────────────────────');
  allData.forEach(d => {
    const actual = d.isPumpDump ? '拉砸  ' : '非拉砸';
    const predicted = bestF1.rule.predict(d.features) ? '拉砸  ' : '非拉砸';
    const result = actual === predicted ? '✅' : '❌';
    console.log(`${d.symbol.padEnd(12)} ${actual}  ${predicted}  ${result}`);
  });

  // 实现建议
  console.log('\n\n【实现建议】\n');
  console.log('基于当前12个样本的分析，推荐使用以下规则：\n');
  console.log('```javascript');
  console.log('/**');
  console.log(' * 判断是否为拉砸代币');
  console.log(' * @param {Object} features - 钱包簇特征');
  console.log(' * @returns {boolean} true=拉砸, false=非拉砸');
  console.log(' */');
  console.log('function isPumpDumpToken(features) {');
  console.log('  // 方法1: 单一特征（简单，高召回率）');
  console.log('  if (features.secondToFirstRatio < 0.3) {');
  console.log('    return true;');
  console.log('  }');
  console.log('');
  console.log('  // 方法2: 组合特征（更精确）');
  console.log('  // return features.secondToFirstRatio < 0.3 && features.top2ClusterRatio > 0.75;');
  console.log('');
  console.log('  // 方法3: 宽松组合（不漏拉砸）');
  console.log('  // return features.secondToFirstRatio < 0.4 || features.top2ClusterRatio > 0.8;');
  console.log('');
  console.log('  return false;');
  console.log('}');
  console.log('```');

  console.log('\n特征计算方法：');
  console.log('1. 获取购买信号时间之前的90秒交易数据');
  console.log('2. 使用2秒时间阈值识别交易簇');
  console.log('3. 计算第2簇大小 / 第1簇大小');

  console.log('\n═══════════════════════════════════════════════════════════════════════════');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
