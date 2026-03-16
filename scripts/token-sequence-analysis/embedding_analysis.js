/**
 * 矩阵分解嵌入分析
 * 使用 SVD/NMF 从钱包-代币共现矩阵中学习向量表示
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data', 'processed');
const OUTPUT_DIR = path.join(__dirname, 'data', 'embeddings');

// 确保输出目录存在
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * 加载序列数据
 */
function loadSequences() {
  const sequencesPath = path.join(DATA_DIR, 'all_sequences.json');
  const content = fs.readFileSync(sequencesPath, 'utf-8');
  const data = JSON.parse(content);
  return data.sequences;
}

/**
 * 构建钱包-代币矩阵
 * @param {Array} sequences - 代币序列数据
 * @param {Object} options - 配置选项
 * @returns {Object} 矩阵数据和元信息
 */
function buildWalletTokenMatrix(sequences, options = {}) {
  const {
    weightingMethod = 'net_amount', // 'net_amount', 'tfidf', 'binary'
    normalize = true
  } = options;

  console.log('\n构建钱包-代币矩阵...');

  // 收集所有钱包和代币
  const walletSet = new Set();
  const tokenSet = new Set();

  sequences.forEach(seq => {
    seq.sequence.forEach(([wallet]) => {
      walletSet.add(wallet);
    });
    tokenSet.add(seq.token_address);
  });

  const wallets = Array.from(walletSet);
  const tokens = Array.from(tokenSet);

  console.log(`  钱包数量: ${wallets.length}`);
  console.log(`  代币数量: ${tokens.length}`);

  // 构建映射
  const walletToIdx = {};
  const tokenToIdx = {};
  wallets.forEach((w, i) => walletToIdx[w] = i);
  tokens.forEach((t, i) => tokenToIdx[t] = i);

  // 构建矩阵
  // matrix[wallet_idx][token_idx] = 值
  const matrix = Array(wallets.length).fill(null).map(() => Array(tokens.length).fill(0));

  // 统计：每个钱包在每个代币中的交易
  const walletTokenTrades = {}; // [wallet_token] = { buys, sells, count }

  sequences.forEach(seq => {
    const tokenIdx = tokenToIdx[seq.token_address];

    seq.sequence.forEach(([wallet, amount]) => {
      const walletIdx = walletToIdx[wallet];
      const key = `${walletIdx}_${tokenIdx}`;

      if (!walletTokenTrades[key]) {
        walletTokenTrades[key] = { buys: 0, sells: 0, count: 0, buyAmount: 0, sellAmount: 0 };
      }

      if (amount > 0) {
        walletTokenTrades[key].buys++;
        walletTokenTrades[key].buyAmount += amount;
      } else {
        walletTokenTrades[key].sells++;
        walletTokenTrades[key].sellAmount += Math.abs(amount);
      }
      walletTokenTrades[key].count++;
    });
  });

  // 根据权重方法填充矩阵
  Object.entries(walletTokenTrades).forEach(([key, trades]) => {
    const [walletIdx, tokenIdx] = key.split('_').map(Number);

    let value;
    switch (weightingMethod) {
      case 'net_amount':
        // 净交易金额（买入 - 卖出）
        value = trades.buyAmount - trades.sellAmount;
        break;

      case 'net_ratio':
        // 净交易比例（买入 - 卖出）/ 总额
        const total = trades.buyAmount + trades.sellAmount;
        value = total > 0 ? (trades.buyAmount - trades.sellAmount) / total : 0;
        break;

      case 'buy_only':
        // 只考虑买入金额
        value = trades.buyAmount;
        break;

      case 'count':
        // 交易次数
        value = trades.count;
        break;

      case 'binary':
        // 是否参与（0/1）
        value = 1;
        break;

      default:
        value = trades.buyAmount - trades.sellAmount;
    }

    matrix[walletIdx][tokenIdx] = value;
  });

  // 归一化
  if (normalize && weightingMethod !== 'net_ratio' && weightingMethod !== 'binary') {
    console.log('  归一化矩阵...');

    // 按列归一化（每个代币）
    for (let t = 0; t < tokens.length; t++) {
      const column = matrix.map(row => row[t]);
      const max = Math.max(...column.map(Math.abs));
      if (max > 0) {
        for (let w = 0; w < wallets.length; w++) {
          matrix[w][t] /= max;
        }
      }
    }
  }

  console.log(`  矩阵大小: ${wallets.length} × ${tokens.length}`);
  console.log(`  非零元素: ${Object.keys(walletTokenTrades).length}`);

  return {
    matrix,
    wallets,
    tokens,
    walletToIdx,
    tokenToIdx,
    walletTokenTrades
  };
}

/**
 * 计算向量的 L2 范数
 */
function l2norm(vec) {
  return Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
}

/**
 * 向量归一化
 */
function normalizeVector(vec) {
  const norm = l2norm(vec);
  if (norm === 0) return vec.map(() => 0);
  return vec.map(v => v / norm);
}

/**
 * 简化的 SVD 实现（幂迭代法）
 * 只计算前 k 个奇异值和奇异向量
 */
function truncatedSVD(matrix, k) {
  const m = matrix.length;    // 行数（钱包数）
  const n = matrix[0].length; // 列数（代币数）

  console.log(`\n运行 SVD (k=${k})...`);
  console.log(`  矩阵大小: ${m} × ${n}`);

  // 构建协方差矩阵: M × M^T (更小的那个)
  // 如果 m < n，计算 M × M^T (m × m)
  // 否则计算 M^T × M (n × n)
  const useLeftCov = m <= n;

  let covMatrix;
  let leftVectors, rightVectors;
  let singularValues;

  if (useLeftCov) {
    // 计算 C = M × M^T
    console.log('  计算左协方差矩阵...');
    covMatrix = Array(m).fill(null).map(() => Array(m).fill(0));

    for (let i = 0; i < m; i++) {
      for (let j = i; j < m; j++) {
        let sum = 0;
        for (let t = 0; t < n; t++) {
          sum += matrix[i][t] * matrix[j][t];
        }
        covMatrix[i][j] = sum;
        covMatrix[j][i] = sum;
      }
    }

    // 对 C 进行特征分解
    const eigenResult = powerIterationEigen(covMatrix, k);
    // eigenvectors 是 k × m，需要转置成 m × k
    const eigenVectors = eigenResult.vectors; // k × m
    leftVectors = Array(m).fill(null).map(() => Array(k).fill(0)); // m × k
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < k; j++) {
        leftVectors[i][j] = eigenVectors[j][i];
      }
    }
    singularValues = eigenResult.values.map(v => Math.sqrt(Math.max(0, v)));

    // 计算右奇异向量: V = M^T × U × Σ^(-1)
    console.log('  计算右奇异向量...');
    // rightVectors 是 n × k
    rightVectors = Array(n).fill(null).map(() => Array(k).fill(0));

    for (let t = 0; t < n; t++) {
      for (let j = 0; j < k; j++) {
        let sum = 0;
        for (let i = 0; i < m; i++) {
          sum += matrix[i][t] * leftVectors[i][j];
        }
        rightVectors[t][j] = singularValues[j] > 0 ? sum / singularValues[j] : 0;
      }
    }
  } else {
    // 计算 C = M^T × M
    console.log('  计算右协方差矩阵...');
    covMatrix = Array(n).fill(null).map(() => Array(n).fill(0));

    for (let i = 0; i < n; i++) {
      for (let j = i; j < n; j++) {
        let sum = 0;
        for (let w = 0; w < m; w++) {
          sum += matrix[w][i] * matrix[w][j];
        }
        covMatrix[i][j] = sum;
        covMatrix[j][i] = sum;
      }
    }

    const eigenResult = powerIterationEigen(covMatrix, k);
    // eigenvectors 是 k × n，需要转置成 n × k
    const eigenVectors = eigenResult.vectors; // k × n
    rightVectors = Array(n).fill(null).map(() => Array(k).fill(0)); // n × k
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < k; j++) {
        rightVectors[i][j] = eigenVectors[j][i];
      }
    }
    singularValues = eigenResult.values.map(v => Math.sqrt(Math.max(0, v)));

    // 计算左奇异向量: U = M × V × Σ^(-1)
    console.log('  计算左奇异向量...');
    leftVectors = Array(m).fill(null).map(() => Array(k).fill(0));

    for (let w = 0; w < m; w++) {
      for (let j = 0; j < k; j++) {
        let sum = 0;
        for (let i = 0; i < n; i++) {
          sum += matrix[w][i] * rightVectors[i][j];
        }
        leftVectors[w][j] = singularValues[j] > 0 ? sum / singularValues[j] : 0;
      }
    }
  }

  console.log(`  前 ${k} 个奇异值: [${singularValues.map(v => v.toFixed(2)).join(', ')}]`);

  return {
    U: leftVectors,    // m × k (钱包向量)
    S: singularValues, // k
    V: rightVectors    // n × k (代币向量)
  };
}

/**
 * 幂迭代法求特征值和特征向量
 * 返回前 k 个最大的特征值及其对应的特征向量
 */
function powerIterationEigen(matrix, k) {
  const n = matrix.length;
  const maxIter = 100;
  const tolerance = 1e-6;

  const values = [];
  const vectors = [];

  // 逐个计算特征值和特征向量
  for (let i = 0; i < k; i++) {
    let vec = Array(n).fill(null).map(() => Math.random());
    vec = normalizeVector(vec);

    let eigenvalue = 0;
    let iter = 0;
    let converged = false;

    while (iter < maxIter && !converged) {
      // 矩阵向量乘法
      const newVec = Array(n).fill(0);
      for (let j = 0; j < n; j++) {
        for (let l = 0; l < n; l++) {
          newVec[j] += matrix[j][l] * vec[l];
        }
      }

      // Rayleigh quotient
      let newEigenvalue = 0;
      for (let j = 0; j < n; j++) {
        newEigenvalue += newVec[j] * vec[j];
      }

      // 归一化
      const norm = l2norm(newVec);
      vec = newVec.map(v => v / norm);

      // 检查收敛
      if (Math.abs(newEigenvalue - eigenvalue) < tolerance) {
        converged = true;
      }
      eigenvalue = newEigenvalue;
      iter++;
    }

    // 保存
    values.push(eigenvalue);
    vectors.push(vec);

    // Deflation: 从矩阵中减去已找到的成分
    for (let j = 0; j < n; j++) {
      for (let l = 0; l < n; l++) {
        matrix[j][l] -= eigenvalue * vec[j] * vec[l];
      }
    }
  }

  return { values, vectors };
}

/**
 * NMF (非负矩阵分解)
 * 使用乘法更新规则
 */
function nmf(matrix, rank, maxIter = 200) {
  const m = matrix.length;
  const n = matrix[0].length;

  console.log(`\n运行 NMF (rank=${rank})...`);
  console.log(`  矩阵大小: ${m} × ${n}`);

  // 初始化 W 和 H 为随机非负矩阵
  let W = Array(m).fill(null).map(() => Array(rank).fill(null).map(() => Math.random()));
  let H = Array(rank).fill(null).map(() => Array(n).fill(null).map(() => Math.random()));

  for (let iter = 0; iter < maxIter; iter++) {
    // 更新 H
    const WtM = matrixMultiply(W, matrix); // rank × n
    const WtWH = matrixMultiply(matrixMultiply(transpose(W), W), H); // rank × n

    for (let r = 0; r < rank; r++) {
      for (let j = 0; j < n; j++) {
        if (WtWH[r][j] > 0) {
          H[r][j] *= WtM[r][j] / WtWH[r][j];
        }
      }
    }

    // 更新 W
    const MHt = matrixMultiply(matrix, transpose(H)); // m × rank
    const WHHt = matrixMultiply(W, matrixMultiply(H, transpose(H))); // m × rank

    for (let i = 0; i < m; i++) {
      for (let r = 0; r < rank; r++) {
        if (WHHt[i][r] > 0) {
          W[i][r] *= MHt[i][r] / WHHt[i][r];
        }
      }
    }

    if (iter % 50 === 0) {
      const error = reconstructionError(matrix, W, H);
      console.log(`  迭代 ${iter}: 重建误差 = ${error.toFixed(4)}`);
    }
  }

  const error = reconstructionError(matrix, W, H);
  console.log(`  最终误差: ${error.toFixed(4)}`);

  return { W, H };
}

/**
 * 矩阵乘法
 */
function matrixMultiply(A, B) {
  const m = A.length;
  const n = B[0].length;
  const p = B.length;

  const result = Array(m).fill(null).map(() => Array(n).fill(0));

  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < p; k++) {
        result[i][j] += A[i][k] * B[k][j];
      }
    }
  }

  return result;
}

/**
 * 矩阵转置
 */
function transpose(matrix) {
  const m = matrix.length;
  const n = matrix[0].length;

  const result = Array(n).fill(null).map(() => Array(m).fill(0));

  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      result[j][i] = matrix[i][j];
    }
  }

  return result;
}

/**
 * 计算重建误差
 */
function reconstructionError(matrix, W, H) {
  const m = matrix.length;
  const n = matrix[0].length;
  const rank = W[0].length;

  let error = 0;
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      let reconstructed = 0;
      for (let r = 0; r < rank; r++) {
        reconstructed += W[i][r] * H[r][j];
      }
      error += Math.pow(matrix[i][j] - reconstructed, 2);
    }
  }

  return Math.sqrt(error);
}

/**
 * 计算余弦相似度
 */
function cosineSimilarity(vec1, vec2) {
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }

  norm1 = Math.sqrt(norm1);
  norm2 = Math.sqrt(norm2);

  if (norm1 === 0 || norm2 === 0) return 0;
  return dotProduct / (norm1 * norm2);
}

/**
 * 找出最相似的项
 */
function findMostSimilar(targetId, idToIdx, embeddings, idList, topK = 10) {
  const targetIdx = idToIdx[targetId];
  if (targetIdx === undefined) return [];

  const targetVec = embeddings[targetIdx];

  const similarities = idList.map((id, idx) => {
    if (idx === targetIdx) return { id, similarity: -1 };
    return {
      id,
      similarity: cosineSimilarity(targetVec, embeddings[idx])
    };
  });

  return similarities
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK)
    .filter(s => s.similarity > 0);
}

/**
 * 分析嵌入质量
 */
function analyzeEmbeddings(walletEmbeddings, tokenEmbeddings, sequences, wallets, tokens) {
  console.log('\n========================================');
  console.log('嵌入质量分析');
  console.log('========================================\n');

  // 构建映射
  const tokenToIdx = {};
  tokens.forEach((t, i) => tokenToIdx[t] = i);

  const walletToIdx = {};
  wallets.forEach((w, i) => walletToIdx[w] = i);

  // 构建代币地址到信息的映射
  const tokenInfo = {};
  sequences.forEach(seq => {
    tokenInfo[seq.token_address] = {
      symbol: seq.token_symbol,
      max_change: seq.max_change_percent,
      seq_length: seq.stats.length,
      unique_wallets: seq.stats.unique_wallets,
      net_flow: seq.stats.net_flow
    };
  });

  // 代币向量分析
  console.log('【代币嵌入分析】');

  // 找出涨幅最高的代币的相似代币
  const topTokens = sequences
    .map(s => ({ address: s.token_address, ...tokenInfo[s.token_address] }))
    .sort((a, b) => b.max_change - a.max_change)
    .slice(0, 5);

  console.log('\n涨幅最高的5个代币及其相似代币:');
  topTokens.forEach(token => {
    const similar = findMostSimilar(token.address, tokenToIdx, tokenEmbeddings, tokens, 5);
    console.log(`\n  ${token.symbol} (+${token.max_change.toFixed(1)}%)`);
    similar.slice(0, 3).forEach((s, i) => {
      const info = tokenInfo[s.id];
      console.log(`    ${i + 1}. ${info.symbol} (+${info.max_change.toFixed(1)}%) - 相似度: ${s.similarity.toFixed(3)}`);
    });
  });

  // 钱包向量分析
  console.log('\n【钱包嵌入分析】');

  // 统计钱包的交易行为
  const walletStats = {};
  sequences.forEach(seq => {
    seq.sequence.forEach(([wallet, amount]) => {
      if (!walletStats[wallet]) {
        walletStats[wallet] = {
          tokens: new Set(),
          totalBuy: 0,
          totalSell: 0,
          count: 0
        };
      }
      walletStats[wallet].tokens.add(seq.token_address);
      if (amount > 0) {
        walletStats[wallet].totalBuy += amount;
      } else {
        walletStats[wallet].totalSell += Math.abs(amount);
      }
      walletStats[wallet].count++;
    });
  });

  // 找出交易次数最多的钱包
  const topWallets = Object.entries(walletStats)
    .map(([addr, stats]) => ({
      address: addr,
      ...stats,
      tokenCount: stats.tokens.size
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  console.log(`\n交易最活跃的10个钱包及其相似钱包:`);
  topWallets.forEach((wallet, idx) => {
    const similar = findMostSimilar(wallet.address, walletToIdx, walletEmbeddings, wallets, 5);
    console.log(`\n  ${idx + 1}. ${wallet.address.slice(0, 10)}... (${wallet.tokenCount} 代币, ${wallet.count} 笔交易)`);
    similar.slice(0, 3).forEach((s, i) => {
      const stats = walletStats[s.id];
      console.log(`    ${i + 1}. ${s.id.slice(0, 10)}... (${stats.tokenCount} 代币, ${stats.count} 笔) - 相似度: ${s.similarity.toFixed(3)}`);
    });
  });
}

/**
 * 保存嵌入结果
 */
function saveEmbeddings(result, method) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  // 保存钱包嵌入
  const walletEmbeddings = {
    method,
    generated_at: new Date().toISOString(),
    dim: result.walletEmbeddings[0].length,
    wallets: result.wallets.map((addr, i) => ({
      address: addr,
      embedding: result.walletEmbeddings[i]
    }))
  };

  fs.writeFileSync(
    path.join(OUTPUT_DIR, `wallets_${method}_${timestamp}.json`),
    JSON.stringify(walletEmbeddings, null, 2)
  );

  // 保存代币嵌入
  const tokenEmbeddings = {
    method,
    generated_at: new Date().toISOString(),
    dim: result.tokenEmbeddings[0].length,
    tokens: result.tokens.map((addr, i) => ({
      address: addr,
      embedding: result.tokenEmbeddings[i]
    }))
  };

  fs.writeFileSync(
    path.join(OUTPUT_DIR, `tokens_${method}_${timestamp}.json`),
    JSON.stringify(tokenEmbeddings, null, 2)
  );

  console.log(`\n✓ 已保存嵌入结果到 ${OUTPUT_DIR}`);
}

/**
 * 主函数
 */
async function main() {
  console.log('========================================');
  console.log('矩阵分解嵌入分析');
  console.log('========================================');

  // 加载数据
  console.log('\n加载数据...');
  const sequences = loadSequences();
  console.log(`✓ 读取 ${sequences.length} 个代币序列`);

  // 测试不同的权重方法和分解方法
  const configs = [
    { method: 'svd', weighting: 'net_amount', k: 16 },
    { method: 'svd', weighting: 'net_ratio', k: 16 },
    { method: 'svd', weighting: 'buy_only', k: 16 },
    { method: 'nmf', weighting: 'net_amount', k: 16 },
  ];

  for (const config of configs) {
    console.log('\n========================================');
    console.log(`配置: ${config.method.toUpperCase()}, 权重: ${config.weighting}, k=${config.k}`);
    console.log('========================================');

    // 构建矩阵
    const { matrix, wallets, tokens, walletToIdx, tokenToIdx } = buildWalletTokenMatrix(
      sequences,
      { weightingMethod: config.weighting, normalize: config.method === 'svd' }
    );

    // 矩阵分解
    let result;
    if (config.method === 'svd') {
      const svd = truncatedSVD(matrix, config.k);

      // 钱包向量 = U × sqrt(S)
      const walletEmbeddings = svd.U.map((row, i) => {
        return row.map((v, j) => v * Math.sqrt(svd.S[j]));
      });

      // 代币向量 = V × sqrt(S)
      const tokenEmbeddings = svd.V.map((row, i) => {
        return row.map((v, j) => v * Math.sqrt(svd.S[j]));
      });

      result = { walletEmbeddings, tokenEmbeddings, wallets, tokens };
    } else {
      const nmfResult = nmf(matrix, config.k, 100);

      result = {
        walletEmbeddings: nmfResult.W,
        tokenEmbeddings: transpose(nmfResult.H),
        wallets,
        tokens
      };
    }

    // 分析
    analyzeEmbeddings(result.walletEmbeddings, result.tokenEmbeddings, sequences, wallets, tokens);

    // 保存
    saveEmbeddings(result, `${config.method}_${config.weighting}_k${config.k}`);
  }

  console.log('\n========================================');
  console.log('✓ 分析完成!');
  console.log('========================================\n');
}

// 运行
main().catch(err => {
  console.error('分析失败:', err);
  process.exit(1);
});
