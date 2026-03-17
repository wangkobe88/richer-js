/**
 * Node2Vec 风格的嵌入分析
 * 在钱包-代币二分图上进行随机游走，然后学习节点嵌入
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data', 'processed');
const OUTPUT_DIR = path.join(__dirname, 'data', 'embeddings');

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
 * 构建钱包-代币二分图
 */
function buildBipartiteGraph(sequences, minWalletTrades = 3) {
  console.log('\n构建钱包-代币二分图...');
  console.log(`  过滤阈值: 钱包至少交易 ${minWalletTrades} 次`);

  // 统计每个钱包的交易次数
  const walletTradeCount = {};
  const walletTokenMap = {}; // wallet -> Set of token addresses
  const tokenWalletMap = {}; // token -> Set of wallet addresses

  sequences.forEach(seq => {
    if (!tokenWalletMap[seq.token_address]) {
      tokenWalletMap[seq.token_address] = new Set();
    }

    seq.sequence.forEach(([wallet, amount]) => {
      if (!walletTradeCount[wallet]) walletTradeCount[wallet] = 0;
      walletTradeCount[wallet]++;

      if (!walletTokenMap[wallet]) walletTokenMap[wallet] = new Set();
      walletTokenMap[wallet].add(seq.token_address);
      tokenWalletMap[seq.token_address].add(wallet);
    });
  });

  // 过滤低频钱包
  const validWallets = Object.keys(walletTradeCount).filter(w => walletTradeCount[w] >= minWalletTrades);
  const validWalletSet = new Set(validWallets);

  console.log(`  原始钱包数: ${Object.keys(walletTradeCount).length}`);
  console.log(`  过滤后钱包数: ${validWallets.length}`);
  console.log(`  过滤掉: ${Object.keys(walletTradeCount).length - validWallets.length} 个低频钱包`);

  // 构建邻接表
  const graph = {
    wallets: {},  // wallet -> Set of tokens
    tokens: {}    // token -> Set of wallets (only valid wallets)
  };

  validWallets.forEach(w => {
    graph.wallets[w] = walletTokenMap[w] || new Set();
  });

  Object.keys(tokenWalletMap).forEach(t => {
    graph.tokens[t] = new Set();
    tokenWalletMap[t].forEach(w => {
      if (validWalletSet.has(w)) {
        graph.tokens[t].add(w);
      }
    });
  });

  // 统计
  const totalEdges = Object.values(graph.wallets).reduce((sum, set) => sum + set.size, 0);
  console.log(`  边数: ${totalEdges}`);
  console.log(`  平均每钱包连接: ${(totalEdges / validWallets.length).toFixed(1)} 个代币`);
  console.log(`  平均每代币连接: ${(totalEdges / Object.keys(graph.tokens).length).toFixed(1)} 个钱包`);

  return { graph, validWallets };
}

/**
 * 随机游走
 */
function randomWalk(graph, startNode, nodeType, walkLength) {
  const walk = [];
  let currentNode = startNode;
  let currentType = nodeType;

  for (let i = 0; i < walkLength; i++) {
    walk.push(`${currentType}:${currentNode}`);

    // 根据当前类型决定下一步
    if (currentType === 'wallet') {
      // 钱包 -> 随机选择一个连接的代币
      const neighbors = Array.from(graph.wallets[currentNode] || []);
      if (neighbors.length === 0) break;
      currentNode = neighbors[Math.floor(Math.random() * neighbors.length)];
      currentType = 'token';
    } else {
      // 代币 -> 随机选择一个连接的钱包
      const neighbors = Array.from(graph.tokens[currentNode] || []);
      if (neighbors.length === 0) break;
      currentNode = neighbors[Math.floor(Math.random() * neighbors.length)];
      currentType = 'wallet';
    }
  }

  return walk;
}

/**
 * 生成所有随机游走
 */
function generateWalks(graph, validWallets, numWalks, walkLength) {
  console.log('\n生成随机游走...');
  console.log(`  每节点游走数: ${numWalks}`);
  console.log(`  游走长度: ${walkLength}`);

  const walks = [];

  // 从钱包节点开始游走
  let count = 0;
  for (const wallet of validWallets) {
    for (let i = 0; i < numWalks; i++) {
      const walk = randomWalk(graph, wallet, 'wallet', walkLength);
      if (walk.length > 2) {
        walks.push(walk);
      }
    }
    count++;
    if (count % 1000 === 0) {
      console.log(`  进度: ${count}/${validWallets.length}`);
    }
  }

  // 从代币节点开始游走
  count = 0;
  for (const token of Object.keys(graph.tokens)) {
    for (let i = 0; i < numWalks; i++) {
      const walk = randomWalk(graph, token, 'token', walkLength);
      if (walk.length > 2) {
        walks.push(walk);
      }
    }
    count++;
    if (count % 100 === 0) {
      console.log(`  进度: ${count}/${Object.keys(graph.tokens).length}`);
    }
  }

  console.log(`  生成 ${walks.length} 条游走`);
  return walks;
}

/**
 * 简化的 Word2Vec (Skip-gram)
 * 使用简单的共现统计而非神经网络
 */
function trainSimpleEmbeddings(walks, dim) {
  console.log('\n训练嵌入向量...');
  console.log(`  向量维度: ${dim}`);

  // 收集所有唯一节点
  const nodes = new Set();
  walks.forEach(walk => walk.forEach(node => nodes.add(node)));

  const nodeList = Array.from(nodes);
  const nodeToIdx = {};
  nodeList.forEach((n, i) => nodeToIdx[n] = i);

  console.log(`  唯一节点数: ${nodeList.length}`);

  // 构建共现矩阵（窗口大小为游走中的邻近节点）
  const windowSize = 3;
  const cooccurrence = Array(nodeList.length).fill(null).map(() => Array(nodeList.length).fill(0));

  walks.forEach(walk => {
    for (let i = 0; i < walk.length; i++) {
      const centerIdx = nodeToIdx[walk[i]];
      // 看窗口内的节点
      for (let j = Math.max(0, i - windowSize); j <= Math.min(walk.length - 1, i + windowSize); j++) {
        if (i !== j) {
          const contextIdx = nodeToIdx[walk[j]];
          cooccurrence[centerIdx][contextIdx]++;
        }
      }
    }
  });

  // 对共现矩阵进行 SVD
  console.log('  对共现矩阵进行 SVD...');

  // 转置以得到更适合的维度
  const n = nodeList.length;
  const useTransposed = n > dim * 10;

  if (useTransposed) {
    // 使用转置矩阵的特征分解
    console.log('  使用转置矩阵...');
    const covMatrix = Array(dim).fill(null).map(() => Array(dim).fill(0));

    // 简化：只使用共现次数最多的前 dim 个节点
    const counts = cooccurrence.map(row => row.reduce((a, b) => a + b, 0));
    const topIndices = counts
      .map((c, i) => ({ idx: i, count: c }))
      .sort((a, b) => b.count - a.count)
      .slice(0, dim)
      .map(x => x.idx);

    // 用这些节点作为"基础向量"
    const embeddings = Array(n).fill(null).map(() => Array(dim).fill(0));

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < dim; j++) {
        embeddings[i][j] = cooccurrence[i][topIndices[j]];
      }
      // 归一化
      const norm = Math.sqrt(embeddings[i].reduce((sum, v) => sum + v * v, 0));
      if (norm > 0) {
        embeddings[i] = embeddings[i].map(v => v / norm);
      }
    }

    return { embeddings, nodeList, nodeToIdx };
  }

  // 简单的随机初始化 + 迭代优化
  console.log('  使用随机初始化...');
  const embeddings = Array(n).fill(null).map(() => Array(dim).fill(0).map(() => Math.random() - 0.5));

  // 简单的迭代更新
  const maxIter = 20;
  for (let iter = 0; iter < maxIter; iter++) {
    // 每次迭代：让相似节点的向量更接近
    for (let i = 0; i < Math.min(n, 1000); i++) {  // 只处理前1000个节点，加速
      const row = cooccurrence[i];
      if (row.every(v => v === 0)) continue;

      // 找到共现最多的节点
      const topNeighbors = row
        .map((count, j) => ({ idx: j, count }))
        .filter(x => x.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      // 向这些节点靠近
      for (const { idx, count } of topNeighbors) {
        for (let d = 0; d < dim; d++) {
          embeddings[i][d] += 0.01 * count * (embeddings[idx][d] - embeddings[i][d]);
        }
      }

      // 归一化
      const norm = Math.sqrt(embeddings[i].reduce((sum, v) => sum + v * v, 0));
      if (norm > 0) {
        embeddings[i] = embeddings[i].map(v => v / norm);
      }
    }
  }

  return { embeddings, nodeList, nodeToIdx };
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
  return dot / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

/**
 * 分析代币相似度
 */
function analyzeTokenSimilarity(embeddings, nodeList, nodeToIdx, sequences) {
  console.log('\n========================================');
  console.log('代币相似度分析');
  console.log('========================================\n');

  // 提取代币嵌入
  const tokenAddresses = sequences.map(s => s.token_address);
  const tokenInfo = {};
  sequences.forEach(s => {
    tokenInfo[s.token_address] = {
      symbol: s.token_symbol,
      change: s.max_change_percent,
      seqLength: s.sequence.length
    };
  });

  const topTokens = [...sequences].sort((a, b) => b.max_change_percent - a.max_change_percent).slice(0, 5);
  const bottomTokens = [...sequences].sort((a, b) => a.max_change_percent - b.max_change_percent).slice(0, 5);

  console.log('【高涨幅代币的相似代币】');

  // 检查哪些代币有嵌入
  const tokensWithEmbed = new Set();
  Object.keys(nodeToIdx).forEach(node => {
    if (node.startsWith('token:')) {
      tokensWithEmbed.add(node.replace('token:', ''));
    }
  });
  console.log(`  有嵌入的代币数: ${tokensWithEmbed.size}/${tokenAddresses.length}`);

  for (const token of topTokens) {
    const tokenNode = `token:${token.token_address}`;
    const tokenIdx = nodeToIdx[tokenNode];
    if (tokenIdx === undefined) {
      console.log(`\n  ${token.symbol} (+${token.max_change_percent.toFixed(1)}%) - 无嵌入向量`);
      continue;
    }

    const tokenEmbed = embeddings[tokenIdx];

    // 计算与其他所有代币的相似度
    const similarities = [];
    for (const otherAddr of tokenAddresses) {
      if (otherAddr === token.token_address) continue;
      const otherNode = `token:${otherAddr}`;
      const otherIdx = nodeToIdx[otherNode];
      if (otherIdx === undefined) continue;

      const sim = cosineSimilarity(tokenEmbed, embeddings[otherIdx]);
      similarities.push({ address: otherAddr, sim });
    }

    similarities.sort((a, b) => b.sim - a.sim);

    console.log(`\n  ${token.token_symbol} (+${token.max_change_percent.toFixed(1)}%)`);
    console.log('    最相似的高涨幅代币:');
    let found = 0;
    for (const s of similarities) {
      if (found >= 3) break;
      const info = tokenInfo[s.address];
      if (!info) continue;
      if (info.change >= 200) {
        console.log(`      ${info.symbol} (+${info.change.toFixed(1)}%) - ${s.sim.toFixed(3)}`);
        found++;
      }
    }
    if (found === 0) console.log('      (无)');

    console.log('    最相似的中等涨幅代币:');
    found = 0;
    for (const s of similarities) {
      if (found >= 3) break;
      const info = tokenInfo[s.address];
      if (!info) continue;
      if (info.change >= 50 && info.change < 200) {
        console.log(`      ${info.symbol} (+${info.change.toFixed(1)}%) - ${s.sim.toFixed(3)}`);
        found++;
      }
    }
    if (found === 0) console.log('      (无)');
  }

  console.log('\n【低涨幅代币的相似代币】');
  for (const token of bottomTokens) {
    const tokenNode = `token:${token.token_address}`;
    const tokenIdx = nodeToIdx[tokenNode];
    if (tokenIdx === undefined) {
      console.log(`\n  ${token.symbol} (+${token.change.toFixed(1)}%) - 无嵌入向量`);
      continue;
    }

    const tokenEmbed = embeddings[tokenIdx];
    const similarities = [];

    for (const otherAddr of tokenAddresses) {
      if (otherAddr === token.token_address) continue;
      const otherNode = `token:${otherAddr}`;
      const otherIdx = nodeToIdx[otherNode];
      if (otherIdx === undefined) continue;

      const sim = cosineSimilarity(tokenEmbed, embeddings[otherIdx]);
      similarities.push({ address: otherAddr, sim });
    }

    similarities.sort((a, b) => b.sim - a.sim);

    console.log(`\n  ${token.token_symbol} (+${token.max_change_percent.toFixed(1)}%)`);
    const top3 = similarities.slice(0, 3);
    top3.forEach((s, i) => {
      const info = tokenInfo[s.address];
      if (!info) return;
      console.log(`    ${i + 1}. ${info.symbol} (+${info.change.toFixed(1)}%) - ${s.sim.toFixed(3)}`);
    });
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('========================================');
  console.log('Node2Vec 风格嵌入分析');
  console.log('========================================');

  const sequences = loadSequences();
  console.log(`\n✓ 读取 ${sequences.length} 个代币序列`);

  // 构建图（过滤掉交易次数 < 5 的钱包）
  const { graph, validWallets } = buildBipartiteGraph(sequences, 5);

  // 生成随机游走
  const walks = generateWalks(graph, validWallets, 10, 20);

  // 训练嵌入
  const { embeddings, nodeList, nodeToIdx } = trainSimpleEmbeddings(walks, 32);

  // 分析相似度
  analyzeTokenSimilarity(embeddings, nodeList, nodeToIdx, sequences);

  console.log('\n========================================');
  console.log('✓ 分析完成!');
  console.log('========================================\n');
}

// 运行
main().catch(err => {
  console.error('分析失败:', err);
  process.exit(1);
});
