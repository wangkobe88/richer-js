/**
 * 聚类分析脚本
 * 使用 K-Means 对代币交易序列进行无监督聚类
 */

const fs = require('fs');
const path = require('path');

const PROCESSED_DATA_DIR = path.join(__dirname, 'data', 'processed');

/**
 * 读取特征数据
 */
function loadFeatures() {
  const featuresPath = path.join(PROCESSED_DATA_DIR, 'features.json');
  const content = fs.readFileSync(featuresPath, 'utf-8');
  const data = JSON.parse(content);
  return data.features;
}

/**
 * 读取序列数据
 */
function loadSequences() {
  const sequencesPath = path.join(PROCESSED_DATA_DIR, 'all_sequences.json');
  const content = fs.readFileSync(sequencesPath, 'utf-8');
  const data = JSON.parse(content);
  return data.sequences;
}

/**
 * 标准化特征（Z-score normalization）
 */
function normalizeFeatures(features, featureNames) {
  // 计算每个特征的均值和标准差
  const stats = {};
  featureNames.forEach(name => {
    const values = features.map(f => f[name]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    const std = Math.sqrt(variance);
    stats[name] = { mean, std };
  });

  // 标准化
  const normalized = features.map(f => {
    const normalizedFeature = { ...f };
    featureNames.forEach(name => {
      const { mean, std } = stats[name];
      if (std > 0) {
        normalizedFeature[`norm_${name}`] = (f[name] - mean) / std;
      } else {
        normalizedFeature[`norm_${name}`] = 0;
      }
    });
    return normalizedFeature;
  });

  return { normalized, stats };
}

/**
 * 计算两个向量的欧氏距离
 */
function euclideanDistance(v1, v2, featureNames) {
  let sum = 0;
  featureNames.forEach(name => {
    const diff = v1[`norm_${name}`] - v2[`norm_${name}`];
    sum += diff * diff;
  });
  return Math.sqrt(sum);
}

/**
 * K-Means 聚类
 */
function kMeans(features, k, maxIterations = 100, featureNames) {
  const n = features.length;

  // 随机初始化中心点
  const centroids = [];
  const usedIndices = new Set();
  while (centroids.length < k) {
    const idx = Math.floor(Math.random() * n);
    if (!usedIndices.has(idx)) {
      usedIndices.add(idx);
      centroids.push({ ...features[idx] });
    }
  }

  let clusters = Array(n).fill(0);
  let iterations = 0;
  let converged = false;

  while (!converged && iterations < maxIterations) {
    // 分配样本到最近的中心点
    const newClusters = features.map((f, i) => {
      let minDist = Infinity;
      let cluster = 0;
      centroids.forEach((c, cIdx) => {
        const dist = euclideanDistance(f, c, featureNames);
        if (dist < minDist) {
          minDist = dist;
          cluster = cIdx;
        }
      });
      return cluster;
    });

    // 检查是否收敛
    if (JSON.stringify(newClusters) === JSON.stringify(clusters)) {
      converged = true;
    }
    clusters = newClusters;

    // 更新中心点
    const newCentroids = centroids.map((_, cIdx) => {
      const clusterFeatures = features.filter((_, i) => clusters[i] === cIdx);
      if (clusterFeatures.length === 0) return centroids[cIdx];

      const centroid = {};
      featureNames.forEach(name => {
        const values = clusterFeatures.map(f => f[`norm_${name}`]);
        centroid[`norm_${name}`] = values.reduce((a, b) => a + b, 0) / values.length;
      });
      return centroid;
    });

    centroids.length = 0;
    centroids.push(...newCentroids);
    iterations++;
  }

  return { clusters, centroids, iterations };
}

/**
 * 计算聚类统计信息
 */
function calculateClusterStats(features, clusters, sequences, k) {
  const clusterStats = [];

  for (let c = 0; c < k; c++) {
    const clusterFeatures = features.filter((_, i) => clusters[i] === c);
    const clusterSequences = sequences.filter((_, i) => clusters[i] === c);

    // 计算统计信息
    const maxChanges = clusterFeatures.map(f => f.max_change_percent);
    maxChanges.sort((a, b) => a - b);

    const seqLengths = clusterFeatures.map(f => f.seq_length);
    seqLengths.sort((a, b) => a - b);

    const netFlows = clusterFeatures.map(f => f.net_flow);
    netFlows.sort((a, b) => a - b);

    const uniqueWallets = clusterFeatures.map(f => f.unique_wallets);
    uniqueWallets.sort((a, b) => a - b);

    clusterStats.push({
      cluster_id: c,
      size: clusterFeatures.length,
      percentage: (clusterFeatures.length / features.length * 100).toFixed(1),

      // 涨幅统计
      max_change_min: maxChanges[0].toFixed(1),
      max_change_max: maxChanges[maxChanges.length - 1].toFixed(1),
      max_change_median: maxChanges[Math.floor(maxChanges.length / 2)].toFixed(1),
      max_change_mean: (maxChanges.reduce((a, b) => a + b, 0) / maxChanges.length).toFixed(1),

      // 序列长度统计
      seq_length_min: seqLengths[0],
      seq_length_max: seqLengths[seqLengths.length - 1],
      seq_length_median: seqLengths[Math.floor(seqLengths.length / 2)],

      // 净流入统计
      net_flow_min: netFlows[0].toFixed(0),
      net_flow_max: netFlows[netFlows.length - 1].toFixed(0),
      net_flow_median: netFlows[Math.floor(netFlows.length / 2)].toFixed(0),

      // 唯一钱包数统计
      unique_wallets_min: uniqueWallets[0],
      unique_wallets_max: uniqueWallets[uniqueWallets.length - 1],
      unique_wallets_median: uniqueWallets[Math.floor(uniqueWallets.length / 2)],

      // 代表性代币（涨幅最高的5个）
      top_tokens: clusterSequences
        .sort((a, b) => b.max_change_percent - a.max_change_percent)
        .slice(0, 5)
        .map(s => ({
          symbol: s.token_symbol,
          max_change: s.max_change_percent.toFixed(1)
        }))
    });
  }

  return clusterStats;
}

/**
 * 打印聚类结果
 */
function printClusterResults(clusterStats, k, iterations) {
  console.log('\n========================================');
  console.log(`K-Means 聚类结果 (K=${k})`);
  console.log('========================================');
  console.log(`迭代次数: ${iterations}`);
  console.log(`\n聚类统计:\n`);

  clusterStats.forEach((stats, i) => {
    console.log(`【聚类 ${i}】 ${stats.size} 个代币 (${stats.percentage}%)`);
    console.log(`  涨幅: 中位数 ${stats.max_change_median}%, 范围 [${stats.max_change_min}%, ${stats.max_change_max}%]`);
    console.log(`  序列长度: 中位数 ${stats.seq_length_median}, 范围 [${stats.seq_length_min}, ${stats.seq_length_max}]`);
    console.log(`  净流入: 中位数 $${stats.net_flow_median}, 范围 [$${stats.net_flow_min}, $${stats.net_flow_max}]`);
    console.log(`  唯一钱包: 中位数 ${stats.unique_wallets_median}, 范围 [${stats.unique_wallets_min}, ${stats.unique_wallets_max}]`);
    console.log(`  代表性代币: ${stats.top_tokens.map(t => `${t.symbol}(+${t.max_change}%)`).join(', ')}`);
    console.log('');
  });

  console.log('========================================\n');
}

/**
 * 保存聚类结果
 */
function saveClusterResults(features, clusters, sequences, clusterStats, k) {
  // 给每个特征添加聚类标签
  const labeledFeatures = features.map((f, i) => ({
    ...f,
    cluster: clusters[i]
  }));

  // 保存聚类结果
  const resultPath = path.join(PROCESSED_DATA_DIR, `clusters_k${k}.json`);
  fs.writeFileSync(resultPath, JSON.stringify({
    k: k,
    total_tokens: features.length,
    generated_at: new Date().toISOString(),
    cluster_stats: clusterStats,
    tokens: labeledFeatures
  }, null, 2));
  console.log(`✓ 已保存聚类结果: clusters_k${k}.json`);
}

/**
 * 主函数
 */
async function main() {
  console.log('========================================');
  console.log('代币交易序列聚类分析');
  console.log('========================================\n');

  // 读取数据
  console.log('读取数据...');
  const features = loadFeatures();
  const sequences = loadSequences();
  console.log(`✓ 读取 ${features.length} 个代币的特征\n`);

  // 选择用于聚类的特征
  const featureNames = [
    'seq_length',
    'unique_wallets',
    'total_buys',
    'total_sells',
    'buy_sell_ratio',
    'total_buy_amount',
    'total_sell_amount',
    'net_flow',
    'avg_buy_amount',
    'avg_sell_amount',
    'wallet_repeat_ratio',
    'first_buy_amount',
    'last_buy_amount'
  ];

  console.log(`使用 ${featureNames.length} 个特征进行聚类:\n  ${featureNames.join(', ')}\n`);

  // 标准化特征
  console.log('标准化特征...');
  const { normalized, stats } = normalizeFeatures(features, featureNames);
  console.log('✓ 特征标准化完成\n');

  // 尝试不同的 K 值
  const kValues = [3, 4, 5];

  for (const k of kValues) {
    console.log(`\n运行 K-Means (K=${k})...`);

    const { clusters, centroids, iterations } = kMeans(normalized, k, 100, featureNames);

    const clusterStats = calculateClusterStats(normalized, clusters, sequences, k);

    printClusterResults(clusterStats, k, iterations);

    saveClusterResults(features, clusters, sequences, clusterStats, k);
  }

  console.log('✓ 聚类分析完成!');
  console.log(`结果保存在: ${PROCESSED_DATA_DIR}\n`);
}

// 运行
main().catch(err => {
  console.error('聚类分析失败:', err);
  process.exit(1);
});
