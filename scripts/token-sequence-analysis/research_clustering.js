/**
 * 聚类分析
 * 根据钱包组成对代币进行聚类，探索自然分组
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data', 'processed');
const OUTPUT_DIR = path.join(__dirname, 'data', 'clusters');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function loadSequences() {
  const sequencesPath = path.join(DATA_DIR, 'all_sequences.json');
  const content = fs.readFileSync(sequencesPath, 'utf-8');
  const data = JSON.parse(content);
  return data.sequences;
}

/**
 * K-means 聚类算法
 */
function kMeans(vectors, k, maxIter = 100) {
  const n = vectors.length;
  const dim = vectors[0].length;

  // 初始化质心（随机选择k个点）
  const centroids = [];
  const indices = new Set();
  while (indices.size < k) {
    indices.add(Math.floor(Math.random() * n));
  }
  for (const idx of indices) {
    centroids.push([...vectors[idx]]);
  }

  let assignments = new Array(n).fill(0);
  let iter = 0;
  let converged = false;

  while (!converged && iter < maxIter) {
    iter++;

    // 分配每个点到最近的质心
    const newAssignments = vectors.map(v => {
      let minDist = Infinity;
      let closest = 0;
      for (let i = 0; i < k; i++) {
        const dist = euclideanDistance(v, centroids[i]);
        if (dist < minDist) {
          minDist = dist;
          closest = i;
        }
      }
      return closest;
    });

    // 检查是否收敛
    converged = assignments.every((a, i) => a === newAssignments[i]);
    assignments = newAssignments;

    // 更新质心
    for (let i = 0; i < k; i++) {
      const clusterPoints = vectors.filter((_, idx) => assignments[idx] === i);
      if (clusterPoints.length > 0) {
        for (let j = 0; j < dim; j++) {
          centroids[i][j] = clusterPoints.reduce((sum, v) => sum + v[j], 0) / clusterPoints.length;
        }
      }
    }

    if (iter % 20 === 0) {
      console.log(`  迭代 ${iter}, 聚类内距离平方和: ${calcWCSS(vectors, assignments, centroids).toFixed(2)}`);
    }
  }

  return { assignments, centroids, iterations: iter };
}

function euclideanDistance(v1, v2) {
  let sum = 0;
  for (let i = 0; i < v1.length; i++) {
    sum += (v1[i] - v2[i]) ** 2;
  }
  return Math.sqrt(sum);
}

function calcWCSS(vectors, assignments, centroids) {
  let wcss = 0;
  for (let i = 0; i < vectors.length; i++) {
    wcss += euclideanDistance(vectors[i], centroids[assignments[i]]) ** 2;
  }
  return wcss;
}

/**
 * 层次聚类（凝聚式）
 */
function hierarchicalClustering(vectors, linkage = 'ward') {
  // 初始化：每个点是一个簇
  let clusters = vectors.map((_, i) => [i]);
  const distances = [];

  // 计算初始距离矩阵
  for (let i = 0; i < vectors.length; i++) {
    distances[i] = [];
    for (let j = i + 1; j < vectors.length; j++) {
      distances[i][j] = euclideanDistance(vectors[i], vectors[j]);
    }
  }

  // 凝聚过程
  const history = [];
  while (clusters.length > 1) {
    let minDist = Infinity;
    let mergeI = -1, mergeJ = -1;

    // 找最近的两个簇
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        let dist;
        if (linkage === 'ward') {
          dist = wardDistance(clusters[i], clusters[j], vectors);
        } else if (linkage === 'complete') {
          dist = completeLinkage(clusters[i], clusters[j], vectors, distances);
        } else {
          dist = singleLinkage(clusters[i], clusters[j], vectors, distances);
        }
        if (dist < minDist) {
          minDist = dist;
          mergeI = i;
          mergeJ = j;
        }
      }
    }

    // 合并簇
    const newCluster = [...clusters[mergeI], ...clusters[mergeJ]];
    history.push({
      merged: [clusters[mergeI], clusters[mergeJ]],
      distance: minDist
    });

    clusters = clusters.filter((_, i) => i !== mergeI && i !== mergeJ);
    clusters.push(newCluster);

    if (clusters.length % 100 === 0) {
      console.log(`  剩余 ${clusters.length} 个簇`);
    }
  }

  return history;
}

function wardDistance(cluster1, cluster2, vectors) {
  // Ward方法：合并后簇内方差增加量
  const n1 = cluster1.length;
  const n2 = cluster2.length;
  const n = n1 + n2;

  // 计算簇中心
  const mean1 = clusterMean(cluster1, vectors);
  const mean2 = clusterMean(cluster2, vectors);
  const mean = clusterMean([...cluster1, ...cluster2], vectors);

  let dist = 0;
  for (let i = 0; i < mean1.length; i++) {
    dist += n1 * (mean1[i] - mean[i]) ** 2 + n2 * (mean2[i] - mean[i]) ** 2;
  }

  return Math.sqrt(dist);
}

function clusterMean(cluster, vectors) {
  const dim = vectors[cluster[0]].length;
  const mean = new Array(dim).fill(0);
  for (const idx of cluster) {
    for (let i = 0; i < dim; i++) {
      mean[i] += vectors[idx][i];
    }
  }
  return mean.map(v => v / cluster.length);
}

function singleLinkage(cluster1, cluster2, vectors, distances) {
  let minDist = Infinity;
  for (const i of cluster1) {
    for (const j of cluster2) {
      const [a, b] = i < j ? [i, j] : [j, i];
      if (distances[a] && distances[a][b]) {
        minDist = Math.min(minDist, distances[a][b]);
      }
    }
  }
  return minDist;
}

function completeLinkage(cluster1, cluster2, vectors, distances) {
  let maxDist = 0;
  for (const i of cluster1) {
    for (const j of cluster2) {
      const [a, b] = i < j ? [i, j] : [j, i];
      if (distances[a] && distances[a][b]) {
        maxDist = Math.max(maxDist, distances[a][b]);
      }
    }
  }
  return maxDist;
}

/**
 * 构建代币特征向量
 */
function buildTokenVectors(sequences) {
  console.log('========================================');
  console.log('构建代币特征向量');
  console.log('========================================\n');

  // 统计所有钱包
  const allWallets = new Set();
  sequences.forEach(seq => {
    seq.sequence.forEach(([wallet]) => allWallets.add(wallet));
  });

  const walletList = Array.from(allWallets);
  const walletIndex = new Map(walletList.map((w, i) => [w, i]));

  console.log(`钱包总数: ${walletList.length}`);

  // 过滤：只保留交易次数 >= 3 的钱包
  const walletTradeCount = {};
  sequences.forEach(seq => {
    seq.sequence.forEach(([wallet]) => {
      walletTradeCount[wallet] = (walletTradeCount[wallet] || 0) + 1;
    });
  });

  const frequentWallets = walletList.filter(w => (walletTradeCount[w] || 0) >= 3);
  const frequentWalletIndex = new Map(frequentWallets.map((w, i) => [w, i]));

  console.log(`过滤后钱包数（交易>=3）: ${frequentWallets.length}\n`);

  // 构建向量
  const vectors = [];
  const tokenData = [];

  for (const seq of sequences) {
    const vector = new Array(frequentWallets.length).fill(0);

    seq.sequence.forEach(([wallet, amount]) => {
      const idx = frequentWalletIndex.get(wallet);
      if (idx !== undefined) {
        vector[idx] += amount;
      }
    });

    // 归一化
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      vectors.push(vector.map(v => v / norm));
      tokenData.push({
        address: seq.token_address,
        symbol: seq.token_symbol,
        change: seq.max_change_percent,
        length: seq.sequence.length
      });
    }
  }

  console.log(`有效代币数: ${vectors.length}\n`);

  return { vectors, tokenData, wallets: frequentWallets };
}

/**
 * 分析K-means聚类结果
 */
function analyzeKMeans(vectors, tokenData, k) {
  console.log('========================================');
  console.log(`K-means 聚类分析 (K=${k})`);
  console.log('========================================\n');

  const result = kMeans(vectors, k);

  // 分析每个簇
  const clusters = [];
  for (let i = 0; i < k; i++) {
    const clusterIndices = result.assignments
      .map((assign, idx) => assign === i ? idx : -1)
      .filter(idx => idx !== -1);

    const clusterTokens = clusterIndices.map(idx => tokenData[idx]);

    const avgChange = clusterTokens.reduce((sum, t) => sum + t.change, 0) / clusterTokens.length;
    const avgLength = clusterTokens.reduce((sum, t) => sum + t.length, 0) / clusterTokens.length;
    const highReturnCount = clusterTokens.filter(t => t.change >= 100).length;

    clusters.push({
      id: i,
      size: clusterTokens.length,
      avgChange,
      avgLength,
      highReturnRate: highReturnCount / clusterTokens.length,
      tokens: clusterTokens
    });
  }

  // 排序并打印
  clusters.sort((a, b) => b.avgChange - a.avgChange);

  console.log('聚类特征（按平均涨幅排序）:\n');

  clusters.forEach((cluster, i) => {
    console.log(`簇 ${i + 1}:`);
    console.log(`  代币数: ${cluster.size}`);
    console.log(`  平均涨幅: ${cluster.avgChange.toFixed(1)}%`);
    console.log(`  平均序列长度: ${cluster.avgLength.toFixed(1)}`);
    console.log(`  高涨幅占比: ${(cluster.highReturnRate * 100).toFixed(1)}%`);

    // 显示代表代币
    console.log(`  代表代币:`);
    cluster.tokens
      .sort((a, b) => b.change - a.change)
      .slice(0, 5)
      .forEach(t => {
        console.log(`    ${t.symbol}: +${t.change.toFixed(1)}%`);
      });
    console.log('');
  });

  // 簇间差异分析
  console.log('【簇间差异分析】\n');

  // 计算簇中心之间的距离
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const dist = euclideanDistance(result.centroids[i], result.centroids[j]);
      console.log(`簇 ${i + 1} <-> 簇 ${j + 1}: 距离 = ${dist.toFixed(3)}`);
    }
  }

  return { result, clusters };
}

/**
 * 基于涨幅的聚类（基准对比）
 */
function returnBasedClustering(tokenData) {
  console.log('\n========================================');
  console.log('基于涨幅的分组（基准对比）');
  console.log('========================================\n');

  const groups = {
    '超高涨幅 (>1000%)': [],
    '高涨幅 (200-1000%)': [],
    '中涨幅 (50-200%)': [],
    '低涨幅 (<50%)': []
  };

  tokenData.forEach(t => {
    if (t.change >= 1000) {
      groups['超高涨幅 (>1000%)'].push(t);
    } else if (t.change >= 200) {
      groups['高涨幅 (200-1000%)'].push(t);
    } else if (t.change >= 50) {
      groups['中涨幅 (50-200%)'].push(t);
    } else {
      groups['低涨幅 (<50%)'].push(t);
    }
  });

  Object.entries(groups).forEach(([name, tokens]) => {
    if (tokens.length === 0) return;

    const avgChange = tokens.reduce((sum, t) => sum + t.change, 0) / tokens.length;
    const avgLength = tokens.reduce((sum, t) => sum + t.length, 0) / tokens.length;

    console.log(`${name}:`);
    console.log(`  代币数: ${tokens.length}`);
    console.log(`  平均涨幅: ${avgChange.toFixed(1)}%`);
    console.log(`  平均序列长度: ${avgLength.toFixed(1)}`);
    console.log('');
  });
}

/**
 * 最优K值分析（肘部法则）
 */
function findOptimalK(vectors, tokenData, maxK = 15) {
  console.log('\n========================================');
  console.log('最优K值分析（肘部法则）');
  console.log('========================================\n');

  const wcssValues = [];

  console.log('计算不同K值的聚类内距离平方和:');

  for (let k = 1; k <= maxK; k++) {
    const result = kMeans(vectors, k, 50);
    const wcss = calcWCSS(vectors, result.assignments, result.centroids);
    wcssValues.push({ k, wcss });
    console.log(`  K=${k}: WCSS = ${wcss.toFixed(2)}`);
  }

  // 计算下降速度
  console.log('\nWCSS 下降速度:');
  for (let i = 1; i < wcssValues.length; i++) {
    const decrease = wcssValues[i - 1].wcss - wcssValues[i].wcss;
    const percentDecrease = (decrease / wcssValues[i - 1].wcss) * 100;
    console.log(`  K=${wcssValues[i - 1].k} → K=${wcssValues[i].k}: -${decrease.toFixed(2)} (${percentDecrease.toFixed(1)}%)`);
  }

  // 找肘部（下降速度开始显著变小的点）
  let elbowK = 2;
  let maxSecondDerivative = -Infinity;

  for (let i = 2; i < wcssValues.length - 1; i++) {
    const d1 = wcssValues[i - 1].wcss - wcssValues[i].wcss;
    const d2 = wcssValues[i].wcss - wcssValues[i + 1].wcss;
    const secondDerivative = d1 - d2;

    if (secondDerivative > maxSecondDerivative) {
      maxSecondDerivative = secondDerivative;
      elbowK = wcssValues[i].k;
    }
  }

  console.log(`\n建议的最优K值: ${elbowK}（肘部法则）`);

  return wcssValues;
}

async function main() {
  console.log('========================================');
  console.log('代币聚类分析');
  console.log('========================================\n');

  const sequences = loadSequences();
  console.log(`✓ 读取 ${sequences.length} 个代币序列\n`);

  // 构建特征向量
  const { vectors, tokenData, wallets } = buildTokenVectors(sequences);

  // 1. 基于涨幅的分组（基准）
  returnBasedClustering(tokenData);

  // 2. 寻找最优K值
  findOptimalK(vectors, tokenData, 15);

  // 3. K-means聚类
  const k = 6; // 使用固定的K值
  const { result, clusters } = analyzeKMeans(vectors, tokenData, k);

  // 4. 保存聚类结果
  const clusterResult = {
    method: 'k-means',
    k,
    centroids: result.centroids,
    assignments: result.assignments.map((assign, idx) => ({
      token_address: tokenData[idx].address,
      token_symbol: tokenData[idx].symbol,
      change: tokenData[idx].change,
      cluster: assign
    }))
  };

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'kmeans_clusters.json'),
    JSON.stringify(clusterResult, null, 2)
  );

  console.log('\n========================================');
  console.log('✓ 分析完成! 聚类结果已保存');
  console.log('========================================\n');
}

main().catch(err => {
  console.error('分析失败:', err);
  process.exit(1);
});
