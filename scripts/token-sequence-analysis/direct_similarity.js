/**
 * 直接时序相似度分析
 * 不使用嵌入，直接基于钱包集合的加权相似度
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
  timeDecayTau: 60,

  // 金额缩放
  amountLogScale: true,
  amountMin: 10,

  // 过滤设置
  minWalletTrades: 3,
  minTokenTrades: 5,

  // 相似度计算方法
  similarityMethod: 'jaccard_weighted'  // 'jaccard', 'jaccard_weighted', 'cosine_sparse'
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
 */
function timeDecayWeight(timeOffset, tau = CONFIG.timeDecayTau) {
  return Math.exp(-timeOffset / tau);
}

/**
 * 计算金额权重
 */
function amountWeight(amount) {
  const absAmount = Math.abs(amount);
  if (CONFIG.amountLogScale) {
    return Math.log(1 + Math.max(absAmount, CONFIG.amountMin));
  }
  return absAmount;
}

/**
 * 将序列转换为加权钱包集合
 */
function sequenceToWeightedWallets(sequence) {
  const walletWeights = new Map();

  sequence.forEach(([wallet, amount], idx) => {
    const timeOffset = idx * 3;  // 假设每笔交易间隔3秒
    const timeW = timeDecayWeight(timeOffset, CONFIG.timeDecayTau);
    const amountW = amountWeight(amount);
    const totalW = timeW * amountW;

    walletWeights.set(wallet, (walletWeights.get(wallet) || 0) + totalW);
  });

  return walletWeights;
}

/**
 * 计算 Jaccard 相似度（加权版本）
 */
function weightedJaccardSimilarity(wallets1, wallets2) {
  // wallets1 和 wallets2 是 Map<address, weight>

  let intersection = 0;
  let union = 0;

  // 计算交集（使用最小权重）
  for (const [wallet, weight1] of wallets1) {
    const weight2 = wallets2.get(wallet) || 0;
    intersection += Math.min(weight1, weight2);
    union += Math.max(weight1, weight2);
  }

  // 计算并集（加上只在 wallets2 中的钱包）
  for (const [wallet, weight2] of wallets2) {
    if (!wallets1.has(wallet)) {
      union += weight2;
    }
  }

  return union > 0 ? intersection / union : 0;
}

/**
 * 计算余弦相似度（稀疏向量版本）
 */
function cosineSimilarity(wallets1, wallets2) {
  let dot = 0;
  let norm1 = 0;
  let norm2 = 0;

  // 计算点积和 norm1
  for (const [wallet, weight1] of wallets1) {
    const weight2 = wallets2.get(wallet) || 0;
    dot += weight1 * weight2;
    norm1 += weight1 * weight1;
  }

  // 计算 norm2
  for (const weight2 of wallets2.values()) {
    norm2 += weight2 * weight2;
  }

  if (norm1 === 0 || norm2 === 0) return 0;
  return dot / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

/**
 * 构建代币的加权钱包表示
 */
function buildTokenWallets(sequences) {
  console.log('\n========================================');
  console.log('构建代币钱包表示');
  console.log('========================================\n');

  // 统计钱包交易次数
  const walletTradeCount = {};
  sequences.forEach(seq => {
    seq.sequence.forEach(([wallet]) => {
      walletTradeCount[wallet] = (walletTradeCount[wallet] || 0) + 1;
    });
  });

  // 过滤钱包
  const validWallets = new Set(
    Object.keys(walletTradeCount).filter(w => walletTradeCount[w] >= CONFIG.minWalletTrades)
  );

  console.log(`原始钱包数: ${Object.keys(walletTradeCount).length}`);
  console.log(`过滤后钱包数: ${validWallets.size}`);

  // 构建代币钱包表示
  const tokenWallets = [];

  for (const seq of sequences) {
    if (seq.sequence.length < CONFIG.minTokenTrades) continue;

    const weightedWallets = new Map();
    let totalWeight = 0;

    seq.sequence.forEach(([wallet, amount], idx) => {
      if (!validWallets.has(wallet)) return;

      const timeOffset = idx * 3;
      const timeW = timeDecayWeight(timeOffset, CONFIG.timeDecayTau);
      const amountW = amountWeight(amount);
      const totalW = timeW * amountW;

      weightedWallets.set(wallet, (weightedWallets.get(wallet) || 0) + totalW);
      totalWeight += totalW;
    });

    if (weightedWallets.size > 0) {
      // 归一化权重
      const normalizedWallets = new Map();
      for (const [wallet, weight] of weightedWallets) {
        normalizedWallets.set(wallet, weight / totalWeight);
      }

      tokenWallets.push({
        token_address: seq.token_address,
        token_symbol: seq.token_symbol,
        max_change_percent: seq.max_change_percent,
        wallets: normalizedWallets,
        wallet_count: normalizedWallets.size,
        total_weight: totalWeight
      });
    }
  }

  console.log(`有效代币数: ${tokenWallets.length}\n`);

  // 统计信息
  const walletCounts = tokenWallets.map(t => t.wallet_count);
  walletCounts.sort((a, b) => a - b);

  console.log('钱包数量分布:');
  console.log(`  最小: ${walletCounts[0]}`);
  console.log(`  25分位: ${walletCounts[Math.floor(walletCounts.length * 0.25)]}`);
  console.log(`  中位数: ${walletCounts[Math.floor(walletCounts.length * 0.5)]}`);
  console.log(`  75分位: ${walletCounts[Math.floor(walletCounts.length * 0.75)]}`);
  console.log(`  最大: ${walletCounts[walletCounts.length - 1]}\n`);

  return tokenWallets;
}

/**
 * 计算所有代币之间的相似度矩阵
 */
function computeSimilarityMatrix(tokenWallets) {
  console.log('计算相似度矩阵...');

  const n = tokenWallets.length;
  const similarityMatrix = Array(n).fill(null).map(() => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let sim;
      if (CONFIG.similarityMethod === 'cosine_sparse') {
        sim = cosineSimilarity(tokenWallets[i].wallets, tokenWallets[j].wallets);
      } else {
        sim = weightedJaccardSimilarity(tokenWallets[i].wallets, tokenWallets[j].wallets);
      }

      similarityMatrix[i][j] = sim;
      similarityMatrix[j][i] = sim;
    }

    if ((i + 1) % 100 === 0) {
      console.log(`  进度: ${i + 1}/${n}`);
    }
  }

  console.log('✓ 完成\n');
  return similarityMatrix;
}

/**
 * 分析嵌入质量
 */
function analyzeSimilarity(tokenWallets, similarityMatrix) {
  console.log('========================================');
  console.log('相似度分析');
  console.log('========================================\n');

  const n = tokenWallets.length;

  // 按涨幅排序
  const sortedIndices = tokenWallets
    .map((t, i) => ({ change: t.max_change_percent, idx: i }))
    .sort((a, b) => b.change - a.change);

  const topIndices = sortedIndices.slice(0, 5).map(s => s.idx);
  const bottomIndices = sortedIndices.slice(-5).map(s => s.idx);
  const midIndices = sortedIndices.slice(
    Math.floor(sortedIndices.length * 0.45),
    Math.floor(sortedIndices.length * 0.55)
  ).slice(0, 5).map(s => s.idx);

  // 分析函数
  const analyzeGroup = (indices, label) => {
    console.log(`【${label}】`);

    for (const idx of indices) {
      const token = tokenWallets[idx];

      // 找最相似的代币
      const similarities = similarityMatrix[idx]
        .map((sim, i) => ({ similarity: sim, idx: i }))
        .filter(s => s.idx !== idx)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 15);

      // 分类统计
      const high = [];
      const mid = [];
      const low = [];

      for (const s of similarities) {
        const otherToken = tokenWallets[s.idx];
        if (otherToken.max_change_percent >= 200) {
          high.push(s);
        } else if (otherToken.max_change_percent >= 50) {
          mid.push(s);
        } else {
          low.push(s);
        }
      }

      console.log(`\n  ${token.token_symbol} (+${token.max_change_percent.toFixed(1)}%) | 钱包数: ${token.wallet_count}`);

      console.log(`    高涨幅相似: ${high.length} 个`);
      high.slice(0, 3).forEach(s => {
        const t = tokenWallets[s.idx];
        console.log(`      ${t.token_symbol} (+${t.max_change_percent.toFixed(1)}%) - ${s.similarity.toFixed(3)}`);
      });
      if (high.length === 0) console.log('      (无)');

      console.log(`    中涨幅相似: ${mid.length} 个`);
      mid.slice(0, 3).forEach(s => {
        const t = tokenWallets[s.idx];
        console.log(`      ${t.token_symbol} (+${t.max_change_percent.toFixed(1)}%) - ${s.similarity.toFixed(3)}`);
      });
      if (mid.length === 0) console.log('      (无)');

      console.log(`    低涨幅相似: ${low.length} 个`);
      low.slice(0, 3).forEach(s => {
        const t = tokenWallets[s.idx];
        console.log(`      ${t.token_symbol} (+${t.max_change_percent.toFixed(1)}%) - ${s.similarity.toFixed(3)}`);
      });
      if (low.length === 0) console.log('      (无)');
    }
  };

  analyzeGroup(topIndices, '涨幅最高的5个代币');
  analyzeGroup(midIndices, '涨幅中等的5个代币');
  analyzeGroup(bottomIndices, '涨幅最低的5个代币');

  // 统计分析
  console.log('\n【统计汇总】');

  let highInHigh = 0;
  let highTotal = 0;

  for (const idx of topIndices) {
    const similarities = similarityMatrix[idx]
      .map((sim, i) => ({ similarity: sim, idx: i }))
      .filter(s => s.idx !== idx)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 10);

    const highCount = similarities.filter(s => tokenWallets[s.idx].max_change_percent >= 200).length;
    highInHigh += highCount;
    highTotal += similarities.length;
  }

  console.log(`高涨幅代币的前10相似中，高涨幅占比: ${(highInHigh / highTotal * 100).toFixed(1)}%`);

  // 相关性分析
  console.log('\n【相似度与涨幅相关性】');

  const correlations = [];
  for (let i = 0; i < n; i++) {
    const token = tokenWallets[i];
    const avgSimToHigh = similarityMatrix[i]
      .map((sim, j) => ({ sim, change: tokenWallets[j].max_change_percent }))
      .filter(s => s.change >= 200)
      .reduce((sum, s) => sum + s.sim, 0) /
      similarityMatrix[i]
      .map((sim, j) => tokenWallets[j].max_change_percent >= 200 ? 1 : 0)
      .reduce((sum, v) => sum + v, 0);

    if (!isNaN(avgSimToHigh)) {
      correlations.push({ change: token.max_change_percent, avgSimToHigh });
    }
  }

  correlations.sort((a, b) => a.change - b.change);

  // 计算相关性
  const n_corr = correlations.length;
  const meanX = correlations.reduce((sum, c) => sum + c.change, 0) / n_corr;
  const meanY = correlations.reduce((sum, c) => sum + c.avgSimToHigh, 0) / n_corr;

  let num = 0, denX = 0, denY = 0;
  for (const c of correlations) {
    const dx = c.change - meanX;
    const dy = c.avgSimToHigh - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const corr = num / Math.sqrt(denX * denY);
  console.log(`涨幅与"与高涨幅的相似度"的相关系数: ${corr.toFixed(3)}`);
}

/**
 * 主函数
 */
async function main() {
  console.log('========================================');
  console.log('直接时序相似度分析');
  console.log('========================================\n');

  console.log('配置参数:');
  console.log(`  时间衰减常数 τ: ${CONFIG.timeDecayTau} 秒`);
  console.log(`  金额缩放: ${CONFIG.amountLogScale ? '对数' : '线性'}`);
  console.log(`  相似度方法: ${CONFIG.similarityMethod}`);
  console.log(`  最小钱包交易数: ${CONFIG.minWalletTrades}\n`);

  // 1. 加载数据
  const sequences = loadSequences();
  console.log(`✓ 读取 ${sequences.length} 个代币序列\n`);

  // 2. 构建代币钱包表示
  const tokenWallets = buildTokenWallets(sequences);

  // 3. 计算相似度矩阵
  const similarityMatrix = computeSimilarityMatrix(tokenWallets);

  // 4. 分析质量
  analyzeSimilarity(tokenWallets, similarityMatrix);

  console.log('\n========================================');
  console.log('✓ 分析完成!');
  console.log('========================================\n');
}

// 运行
main().catch(err => {
  console.error('分析失败:', err);
  process.exit(1);
});
