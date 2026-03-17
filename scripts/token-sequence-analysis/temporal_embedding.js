/**
 * 时序加权钱包嵌入分析
 * 结合时间衰减和交易金额的序列嵌入方法
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data', 'processed');
const OUTPUT_DIR = path.join(__dirname, 'data', 'embeddings');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// ==================== 配置参数 ====================
const CONFIG = {
  // 时间衰减常数（秒）
  timeDecayTau: 60,           // 60秒衰减到 37%

  // 金额缩放
  amountLogScale: true,       // 使用对数缩放
  amountMin: 10,              // 最小金额（美元）

  // 窗口设置
  windowSize: 5,              // 上下文窗口大小
  useSymmetricWindow: true,   // 使用对称窗口

  // 过滤设置
  minWalletTrades: 3,         // 钱包最小交易次数
  minTokenTrades: 5,          // 代币最小交易数

  // 嵌入维度
  embedDim: 32,

  // SVD 设置
  svdDimensions: 16
};

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
 * 计算时间衰减权重
 * @param {number} timeOffset - 距离第一笔交易的时间（秒）
 * @param {number} tau - 衰减常数
 */
function timeDecayWeight(timeOffset, tau = CONFIG.timeDecayTau) {
  return Math.exp(-timeOffset / tau);
}

/**
 * 计算金额权重
 * @param {number} amount - 交易金额（绝对值）
 */
function amountWeight(amount) {
  const absAmount = Math.abs(amount);
  if (CONFIG.amountLogScale) {
    return Math.log(1 + Math.max(absAmount, CONFIG.amountMin));
  }
  return absAmount;
}

/**
 * 构建带权重的钱包-代币矩阵
 */
function buildWeightedMatrix(sequences) {
  console.log('\n========================================');
  console.log('构建时序加权矩阵');
  console.log('========================================\n');

  console.log('参数配置:');
  console.log(`  时间衰减常数 τ: ${CONFIG.timeDecayTau} 秒`);
  console.log(`  金额缩放: ${CONFIG.amountLogScale ? '对数' : '线性'}`);
  console.log(`  窗口大小: ${CONFIG.windowSize}`);
  console.log(`  最小钱包交易数: ${CONFIG.minWalletTrades}\n`);

  // 1. 统计钱包交易次数（用于过滤）
  const walletTradeCount = {};
  sequences.forEach(seq => {
    seq.sequence.forEach(([wallet]) => {
      walletTradeCount[wallet] = (walletTradeCount[wallet] || 0) + 1;
    });
  });

  // 2. 过滤钱包
  const validWallets = new Set(
    Object.keys(walletTradeCount).filter(w => walletTradeCount[w] >= CONFIG.minWalletTrades)
  );

  console.log(`原始钱包数: ${Object.keys(walletTradeCount).length}`);
  console.log(`过滤后钱包数: ${validWallets.size}`);
  console.log(`过滤掉: ${Object.keys(walletTradeCount).length - validWallets.size} 个低频钱包\n`);

  // 3. 收集所有有效钱包
  const walletList = Array.from(validWallets);
  const walletToIdx = {};
  walletList.forEach((w, i) => walletToIdx[w] = i);

  // 4. 为每个代币构建加权钱包向量
  const tokenVectors = [];  // 每个代币是一个钱包向量（稀疏）

  for (const seq of sequences) {
    if (seq.sequence.length < CONFIG.minTokenTrades) continue;

    // 钱包 -> 加权值
    const walletWeights = new Map();

    // 第一遍：计算时间偏移（假设交易已按时间排序）
    const tradesWithTime = seq.sequence.map(([wallet, amount], idx) => ({
      wallet,
      amount,
      timeOffset: idx * 3  // 假设每笔交易间隔3秒（简化）
    }));

    const maxTime = tradesWithTime[tradesWithTime.length - 1].timeOffset;

    // 第二遍：计算权重
    tradesWithTime.forEach(({ wallet, amount, timeOffset }) => {
      if (!validWallets.has(wallet)) return;

      // 时间衰减权重
      const timeW = timeDecayWeight(timeOffset, CONFIG.timeDecayTau);

      // 金额权重
      const amountW = amountWeight(amount);

      // 组合权重
      const totalW = timeW * amountW;

      walletWeights.set(wallet, (walletWeights.get(wallet) || 0) + totalW);
    });

    // 转换为稀疏向量格式
    const sparseVector = [];
    walletWeights.forEach((weight, wallet) => {
      sparseVector.push([walletToIdx[wallet], weight]);
    });

    tokenVectors.push({
      token_address: seq.token_address,
      token_symbol: seq.token_symbol,
      max_change_percent: seq.max_change_percent,
      vector: sparseVector
    });
  }

  console.log(`有效代币数: ${tokenVectors.length}\n`);

  return {
    tokenVectors,
    walletList,
    walletToIdx
  };
}

/**
 * 构建钱包共现矩阵（考虑时序上下文）
 */
function buildWalletCooccurrenceMatrix(tokenVectors, walletCount) {
  console.log('========================================');
  console.log('构建钱包共现矩阵');
  console.log('========================================\n');

  // 方法：使用"钱包对"在同一代币中的共现
  // 共现权重 = 两钱包权重的几何平均

  const cooccurrence = Array(walletCount).fill(null).map(() => Array(walletCount).fill(0));

  let processed = 0;
  for (const token of tokenVectors) {
    const wallets = token.vector.map(([idx]) => idx);
    const weights = token.vector.map(([, w]) => w);

    // 计算钱包对的共现权重
    for (let i = 0; i < wallets.length; i++) {
      for (let j = i; j < wallets.length; j++) {
        const w1 = wallets[i];
        const w2 = wallets[j];

        // 几何平均作为共现权重
        const weight = Math.sqrt(weights[i] * weights[j]);

        cooccurrence[w1][w2] += weight;
        if (w1 !== w2) {
          cooccurrence[w2][w1] += weight;
        }
      }
    }

    processed++;
    if (processed % 100 === 0) {
      console.log(`  进度: ${processed}/${tokenVectors.length}`);
    }
  }

  console.log(`  完成: ${processed}/${tokenVectors.length}\n`);

  // 归一化（按最大值）
  let maxVal = 0;
  for (let i = 0; i < walletCount; i++) {
    for (let j = 0; j < walletCount; j++) {
      maxVal = Math.max(maxVal, cooccurrence[i][j]);
    }
  }

  for (let i = 0; i < walletCount; i++) {
    for (let j = 0; j < walletCount; j++) {
      if (maxVal > 0) {
        cooccurrence[i][j] /= maxVal;
      }
    }
  }

  return cooccurrence;
}

/**
 * 简化的 SVD（幂迭代法）
 */
function simpleSVD(matrix, k) {
  console.log('========================================');
  console.log('执行 SVD 分解');
  console.log('========================================\n');

  const n = matrix.length;

  // 计算对称矩阵 C = M + M^T（如果不对称）
  const C = Array(n).fill(null).map(() => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      C[i][j] = (matrix[i][j] + matrix[j][i]) / 2;
    }
  }

  // 幂迭代求前 k 个特征向量
  const maxIter = 50;
  const tolerance = 1e-6;

  const eigenvectors = [];
  const eigenvalues = [];

  for (let iter = 0; iter < k; iter++) {
    let vec = Array(n).fill(null).map(() => Math.random());

    // 归一化
    let norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    vec = vec.map(v => v / norm);

    let eigenvalue = 0;
    let converged = false;
    let iterCount = 0;

    while (!converged && iterCount < maxIter) {
      // 矩阵向量乘法
      const newVec = Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          newVec[i] += C[i][j] * vec[j];
        }
      }

      // Rayleigh quotient
      eigenvalue = 0;
      for (let i = 0; i < n; i++) {
        eigenvalue += newVec[i] * vec[i];
      }

      // 归一化
      norm = Math.sqrt(newVec.reduce((sum, v) => sum + v * v, 0));
      vec = newVec.map(v => v / norm);

      // 检查收敛
      converged = norm > 0 && iterCount > 0;
      iterCount++;
    }

    eigenvectors.push(vec);
    eigenvalues.push(eigenvalue);

    // Deflation
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        C[i][j] -= eigenvalue * vec[i] * vec[j];
      }
    }

    if (iter % 5 === 0) {
      console.log(`  计算第 ${iter + 1} 个特征向量...`);
    }
  }

  console.log(`\n特征值: [${eigenvalues.slice(0, 5).map(v => v.toFixed(3)).join(', ')}...]\n`);

  return {
    U: eigenvectors,    // n × k
    S: eigenvalues      // k
  };
}

/**
 * 计算代币嵌入（聚合钱包嵌入）
 */
function computeTokenEmbeddings(tokenVectors, walletEmbeddings, walletCount) {
  console.log('计算代币嵌入...');

  const tokenEmbeddings = [];

  for (const token of tokenVectors) {
    // 初始化嵌入向量
    const embed = Array(walletEmbeddings[0].length).fill(0);

    // 加权聚合钱包嵌入
    let totalWeight = 0;
    for (const [walletIdx, weight] of token.vector) {
      if (walletIdx >= walletEmbeddings.length) continue;

      const walletEmbed = walletEmbeddings[walletIdx];
      if (!walletEmbed) continue;

      for (let d = 0; d < embed.length; d++) {
        embed[d] += weight * walletEmbed[d];
      }
      totalWeight += weight;
    }

    // 归一化
    if (totalWeight > 0) {
      for (let d = 0; d < embed.length; d++) {
        embed[d] /= totalWeight;
      }
    }

    // L2 归一化
    const norm = Math.sqrt(embed.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let d = 0; d < embed.length; d++) {
        embed[d] /= norm;
      }
    }

    tokenEmbeddings.push({
      token_address: token.token_address,
      token_symbol: token.token_symbol,
      max_change_percent: token.max_change_percent,
      embedding: embed
    });
  }

  console.log(`✓ 完成 ${tokenEmbeddings.length} 个代币嵌入\n`);

  return tokenEmbeddings;
}

/**
 * 余弦相似度
 */
function cosineSimilarity(vec1, vec2) {
  let dot = 0, norm1 = 0, norm2 = 0;
  for (let i = 0; i < vec1.length; i++) {
    dot += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }
  if (norm1 === 0 || norm2 === 0) return 0;
  return dot / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

/**
 * 分析嵌入质量
 */
function analyzeEmbeddings(tokenEmbeddings) {
  console.log('========================================');
  console.log('嵌入质量分析');
  console.log('========================================\n');

  // 按涨幅排序
  const sorted = [...tokenEmbeddings].sort((a, b) => b.max_change_percent - a.max_change_percent);
  const topTokens = sorted.slice(0, 5);
  const bottomTokens = sorted.slice(-5);
  const midTokens = sorted.slice(
    Math.floor(sorted.length * 0.45),
    Math.floor(sorted.length * 0.55)
  ).slice(0, 5);

  // 构建地址映射
  const addrToIdx = {};
  tokenEmbeddings.forEach((t, i) => addrToIdx[t.token_address] = i);

  // 分析函数
  const analyze = (tokens, label) => {
    console.log(`【${label}】`);
    tokens.forEach(token => {
      const idx = addrToIdx[token.token_address];
      const embed = tokenEmbeddings[idx].embedding;

      // 找最相似的代币
      const similarities = tokenEmbeddings
        .map((t, i) => ({
          token: t,
          similarity: i === idx ? -1 : cosineSimilarity(embed, t.embedding)
        }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 10);

      console.log(`\n  ${token.token_symbol} (+${token.max_change_percent.toFixed(1)}%)`);

      // 分类统计
      const high = similarities.filter(s => s.token.max_change_percent >= 200);
      const mid = similarities.filter(s => s.token.max_change_percent >= 50 && s.token.max_change_percent < 200);
      const low = similarities.filter(s => s.token.max_change_percent < 50);

      console.log(`    高涨幅相似: ${high.length} 个`);
      high.slice(0, 3).forEach(s => {
        console.log(`      ${s.token.token_symbol} (+${s.token.max_change_percent.toFixed(1)}%) - ${s.similarity.toFixed(3)}`);
      });

      console.log(`    中涨幅相似: ${mid.length} 个`);
      mid.slice(0, 3).forEach(s => {
        console.log(`      ${s.token.token_symbol} (+${s.token.max_change_percent.toFixed(1)}%) - ${s.similarity.toFixed(3)}`);
      });

      console.log(`    低涨幅相似: ${low.length} 个`);
      low.slice(0, 3).forEach(s => {
        console.log(`      ${s.token.token_symbol} (+${s.token.max_change_percent.toFixed(1)}%) - ${s.similarity.toFixed(3)}`);
      });
    });
  };

  analyze(topTokens, '涨幅最高的5个代币');
  analyze(midTokens, '涨幅中等的5个代币');
  analyze(bottomTokens, '涨幅最低的5个代币');

  // 统计分析
  console.log('\n【统计汇总】');

  let sameCategoryCount = 0;
  let totalComparisons = 0;

  for (const token of topTokens) {
    const idx = addrToIdx[token.token_address];
    const embed = tokenEmbeddings[idx].embedding;

    const similarities = tokenEmbeddings
      .map((t, i) => ({
        isHigh: t.max_change_percent >= 200,
        similarity: i === idx ? 0 : cosineSimilarity(embed, t.embedding)
      }))
      .filter(s => s.similarity > 0)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 10);

    const highCount = similarities.filter(s => s.isHigh).length;
    sameCategoryCount += highCount;
    totalComparisons += similarities.length;
  }

  console.log(`高涨幅代币的前10相似中，高涨幅占比: ${(sameCategoryCount / totalComparisons * 100).toFixed(1)}%`);
}

/**
 * 保存嵌入结果
 */
function saveEmbeddings(tokenEmbeddings, walletEmbeddings, walletList) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  // 保存代币嵌入
  const tokensData = {
    method: 'temporal_weighted_wallet_embedding',
    config: CONFIG,
    generated_at: new Date().toISOString(),
    dim: tokenEmbeddings[0].embedding.length,
    tokens: tokenEmbeddings.map(t => ({
      address: t.token_address,
      symbol: t.token_symbol,
      max_change_percent: t.max_change_percent,
      embedding: t.embedding
    }))
  };

  fs.writeFileSync(
    path.join(OUTPUT_DIR, `tokens_temporal_${timestamp}.json`),
    JSON.stringify(tokensData, null, 2)
  );

  // 保存钱包嵌入
  const walletsData = {
    method: 'temporal_weighted_wallet_embedding',
    config: CONFIG,
    generated_at: new Date().toISOString(),
    dim: walletEmbeddings[0].length,
    wallets: walletList.map((addr, i) => ({
      address: addr,
      embedding: walletEmbeddings[i]
    }))
  };

  fs.writeFileSync(
    path.join(OUTPUT_DIR, `wallets_temporal_${timestamp}.json`),
    JSON.stringify(walletsData, null, 2)
  );

  console.log(`\n✓ 已保存嵌入结果到 ${OUTPUT_DIR}\n`);
}

/**
 * 主函数
 */
async function main() {
  console.log('========================================');
  console.log('时序加权钱包嵌入分析');
  console.log('========================================\n');

  // 1. 加载数据
  const sequences = loadSequences();
  console.log(`✓ 读取 ${sequences.length} 个代币序列\n`);

  // 2. 构建加权矩阵
  const { tokenVectors, walletList, walletToIdx } = buildWeightedMatrix(sequences);

  // 3. 构建钱包共现矩阵
  const cooccurrence = buildWalletCooccurrenceMatrix(tokenVectors, walletList.length);

  // 4. SVD 分解得到钱包嵌入
  const svd = simpleSVD(cooccurrence, CONFIG.svdDimensions);

  // 钱包嵌入 = U × sqrt(S)
  const walletEmbeddings = svd.U.map((row, i) => {
    return row.map((v, j) => v * Math.sqrt(Math.max(0, svd.S[j])));
  });

  // 5. 计算代币嵌入（聚合钱包嵌入）
  const tokenEmbeddings = computeTokenEmbeddings(tokenVectors, walletEmbeddings, walletList.length);

  // 6. 分析质量
  analyzeEmbeddings(tokenEmbeddings);

  // 7. 保存结果
  saveEmbeddings(tokenEmbeddings, walletEmbeddings, walletList);

  console.log('========================================');
  console.log('✓ 分析完成!');
  console.log('========================================\n');
}

// 运行
main().catch(err => {
  console.error('分析失败:', err);
  process.exit(1);
});
