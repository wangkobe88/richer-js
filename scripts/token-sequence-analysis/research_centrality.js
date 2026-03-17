/**
 * 网络中心性分析
 * 分析钱包和代币在网络中的重要性
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data', 'processed');

function loadSequences() {
  const sequencesPath = path.join(DATA_DIR, 'all_sequences.json');
  const content = fs.readFileSync(sequencesPath, 'utf-8');
  const data = JSON.parse(content);
  return data.sequences;
}

/**
 * 构建二部图：钱包 <-> 代币
 */
function buildBipartiteGraph(sequences) {
  console.log('========================================');
  console.log('构建二部图');
  console.log('========================================\n');

  // wallets: { address: { tokens: Set, total_amount: number } }
  // tokens: { address: { wallets: Set, total_amount: number } }

  const wallets = {};
  const tokens = {};

  sequences.forEach(seq => {
    if (!tokens[seq.token_address]) {
      tokens[seq.token_address] = {
        address: seq.token_address,
        symbol: seq.token_symbol,
        change: seq.max_change_percent,
        wallets: new Set(),
        total_amount: 0
      };
    }

    seq.sequence.forEach(([wallet, amount]) => {
      const absAmount = Math.abs(amount);

      // 钱包 -> 代币
      if (!wallets[wallet]) {
        wallets[wallet] = {
          address: wallet,
          tokens: new Set(),
          total_amount: 0
        };
      }
      wallets[wallet].tokens.add(seq.token_address);
      wallets[wallet].total_amount += absAmount;

      // 代币 -> 钱包
      tokens[seq.token_address].wallets.add(wallet);
      tokens[seq.token_address].total_amount += absAmount;
    });
  });

  console.log(`钱包数: ${Object.keys(wallets).length}`);
  console.log(`代币数: ${Object.keys(tokens).length}\n`);

  return { wallets, tokens };
}

/**
 * 计算度中心性
 */
function degreeCentrality(graph) {
  console.log('========================================');
  console.log('度中心性分析');
  console.log('========================================\n');

  // 钱包度 = 参与的代币数
  // 代币度 = 参与的钱包数

  const walletDegrees = Object.values(graph.wallets).map(w => ({
    address: w.address,
    degree: w.tokens.size,
    total_amount: w.total_amount
  })).sort((a, b) => b.degree - a.degree);

  const tokenDegrees = Object.values(graph.tokens).map(t => ({
    address: t.address,
    symbol: t.symbol,
    change: t.change,
    degree: t.wallets.size,
    total_amount: t.total_amount
  })).sort((a, b) => b.degree - a.degree);

  // 分析钱包度
  console.log('【钱包度中心性 Top 20】\n');
  walletDegrees.slice(0, 20).forEach((w, i) => {
    console.log(`${i + 1}. ${w.address.slice(0, 10)}...`);
    console.log(`   度: ${w.degree} (参与 ${w.degree} 个代币)`);
    console.log(`   总金额: $${w.total_amount.toFixed(0)}`);
    console.log('');
  });

  // 分析代币度与涨幅的关系
  console.log('【代币度与涨幅的关系】\n');

  const changes = tokenDegrees.map(t => t.change);
  const degrees = tokenDegrees.map(t => t.degree);

  // 计算相关性
  const n = changes.length;
  const meanX = changes.reduce((a, b) => a + b, 0) / n;
  const meanY = degrees.reduce((a, b) => a + b, 0) / n;

  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = changes[i] - meanX;
    const dy = degrees[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const corr = num / Math.sqrt(denX * denY);
  console.log(`代币度（钱包数）与涨幅的相关系数: ${corr.toFixed(3)}`);

  // 按度分组
  console.log('\n按钱包数分组:\n');

  const groups = [
    { name: '小 (1-20)', min: 0, max: 20 },
    { name: '中 (20-50)', min: 20, max: 50 },
    { name: '大 (50-100)', min: 50, max: 100 },
    { name: '巨大 (>100)', min: 100, max: Infinity }
  ];

  groups.forEach(group => {
    const groupTokens = tokenDegrees.filter(t =>
      t.degree >= group.min && t.degree < group.max
    );

    if (groupTokens.length === 0) return;

    const avgChange = groupTokens.reduce((sum, t) => sum + t.change, 0) / groupTokens.length;
    const highReturnRate = groupTokens.filter(t => t.change >= 100).length / groupTokens.length;

    console.log(`${group.name}: ${groupTokens.length} 个代币`);
    console.log(`  平均涨幅: ${avgChange.toFixed(1)}%`);
    console.log(`  高涨幅占比: ${(highReturnRate * 100).toFixed(1)}%`);
    console.log('');
  });

  return { walletDegrees, tokenDegrees };
}

/**
 * 计算简化的PageRank中心性（针对钱包）
 * 使用稀疏方法避免内存溢出
 */
function pagerankCentrality(graph, dampingFactor = 0.85, maxIter = 50) {
  console.log('\n========================================');
  console.log('PageRank 中心性分析（简化版）');
  console.log('========================================\n');

  const walletList = Object.keys(graph.wallets);
  const walletIndex = new Map(walletList.map((w, i) => [w, i]));

  const n = walletList.length;

  // 使用稀疏邻接表：每个钱包指向的其他钱包列表
  const outLinks = new Array(n).fill(null).map(() => []);

  // 只处理度 >= 5 的钱包，减少计算量
  const activeWallets = new Set();
  Object.values(graph.wallets).forEach(w => {
    if (w.tokens.size >= 5) {
      activeWallets.add(w.address);
    }
  });

  console.log(`活跃钱包数（度>=5）: ${activeWallets.size} / ${n}\n`);

  // 构建稀疏邻接表
  let linkCount = 0;
  Object.values(graph.tokens).forEach(token => {
    const tokenWallets = Array.from(token.wallets).filter(w => activeWallets.has(w));

    for (let i = 0; i < tokenWallets.length; i++) {
      for (let j = 0; j < tokenWallets.length; j++) {
        if (i !== j) {
          const wi = walletIndex.get(tokenWallets[i]);
          const wj = walletIndex.get(tokenWallets[j]);
          if (wi !== undefined && wj !== undefined) {
            outLinks[wi].push(wj);
            linkCount++;
          }
        }
      }
    }
  });

  console.log(`构建了 ${linkCount} 条链接\n`);

  // 初始化 PageRank 值
  let pr = new Array(n).fill(1 / n);

  // 迭代计算（稀疏版本）
  for (let iter = 0; iter < maxIter; iter++) {
    const newPr = new Array(n).fill((1 - dampingFactor) / n);

    for (let i = 0; i < n; i++) {
      if (outLinks[i].length === 0) continue;

      const outboundDistributed = pr[i] / outLinks[i].length;
      for (const j of outLinks[i]) {
        newPr[j] += dampingFactor * outboundDistributed;
      }
    }

    // 检查收敛
    let maxDiff = 0;
    for (let i = 0; i < n; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(newPr[i] - pr[i]));
    }

    pr = newPr;

    if ((iter + 1) % 10 === 0) {
      console.log(`  迭代 ${iter + 1}, 最大差异: ${maxDiff.toFixed(8)}`);
    }

    if (maxDiff < 1e-5) {
      console.log(`\nPageRank 在 ${iter + 1} 次迭代后收敛\n`);
      break;
    }
  }

  // 返回钱包的 PageRank 值
  const walletPagerank = walletList.map((wallet, i) => ({
    address: wallet,
    pagerank: pr[i],
    degree: graph.wallets[wallet].tokens.size
  })).sort((a, b) => b.pagerank - a.pagerank);

  console.log('【PageRank 最高的 20 个钱包】\n');
  walletPagerank.slice(0, 20).forEach((w, i) => {
    console.log(`${i + 1}. ${w.address.slice(0, 10)}...`);
    console.log(`   PageRank: ${w.pagerank.toFixed(6)}`);
    console.log(`   度: ${w.degree}`);
    console.log('');
  });

  return walletPagerank;
}

/**
 * 分析高 PageRank 钱包参与代币的表现
 */
function highPagerankWalletAnalysis(graph, walletPagerank) {
  console.log('【高 PageRank 钱包参与代币分析】\n');

  // 找出 PageRank 最高的 10% 钱包
  const topWallets = walletPagerank.slice(0, Math.floor(walletPagerank.length * 0.1));
  const topWalletSet = new Set(topWallets.map(w => w.address));

  console.log(`Top 10% 钱包数: ${topWallets.length}\n`);

  // 分析这些钱包参与的代币
  const topWalletTokens = [];
  const otherWalletTokens = [];

  Object.values(graph.tokens).forEach(token => {
    const tokenWallets = Array.from(token.wallets);
    const overlap = tokenWallets.filter(w => topWalletSet.has(w)).length;

    if (overlap > 0) {
      topWalletTokens.push({
        symbol: token.symbol,
        change: token.change,
        overlap,
        totalWallets: token.wallets.size,
        overlapRatio: overlap / token.wallets.size
      });
    } else {
      otherWalletTokens.push({
        symbol: token.symbol,
        change: token.change
      });
    }
  });

  // 对比分析
  const avgChangeTop = topWalletTokens.reduce((sum, t) => sum + t.change, 0) / topWalletTokens.length;
  const avgChangeOther = otherWalletTokens.reduce((sum, t) => sum + t.change, 0) / otherWalletTokens.length;
  const highReturnTop = topWalletTokens.filter(t => t.change >= 100).length / topWalletTokens.length;
  const highReturnOther = otherWalletTokens.filter(t => t.change >= 100).length / otherWalletTokens.length;

  console.log('包含高 PageRank 钱包的代币:');
  console.log(`  数量: ${topWalletTokens.length}`);
  console.log(`  平均涨幅: ${avgChangeTop.toFixed(1)}%`);
  console.log(`  高涨幅占比: ${(highReturnTop * 100).toFixed(1)}%`);

  console.log('\n不包含高 PageRank 钱包的代币:');
  console.log(`  数量: ${otherWalletTokens.length}`);
  console.log(`  平均涨幅: ${avgChangeOther.toFixed(1)}%`);
  console.log(`  高涨幅占比: ${(highReturnOther * 100).toFixed(1)}%`);

  console.log(`\n差异: ${(avgChangeTop - avgChangeOther).toFixed(1)}%`);

  // 按重叠度分析
  console.log('\n按与高 PageRank 钱包的重叠度分析:\n');

  const overlapGroups = [
    { name: '高重叠 (>30%)', min: 0.3 },
    { name: '中重叠 (10-30%)', min: 0.1, max: 0.3 },
    { name: '低重叠 (<10%)', min: 0, max: 0.1 }
  ];

  overlapGroups.forEach(group => {
    const groupTokens = topWalletTokens.filter(t => {
      if (group.max !== undefined) {
        return t.overlapRatio >= group.min && t.overlapRatio < group.max;
      }
      return t.overlapRatio >= group.min;
    });

    if (groupTokens.length === 0) return;

    const avgChange = groupTokens.reduce((sum, t) => sum + t.change, 0) / groupTokens.length;
    const highReturnRate = groupTokens.filter(t => t.change >= 100).length / groupTokens.length;

    console.log(`${group.name}: ${groupTokens.length} 个代币`);
    console.log(`  平均涨幅: ${avgChange.toFixed(1)}%`);
    console.log(`  高涨幅占比: ${(highReturnRate * 100).toFixed(1)}%`);
    console.log('');
  });
}

/**
 * 接近中心性（针对代币）
 * 分析代币与"重要"钱包的距离
 */
function closenessCentrality(graph, walletPagerank) {
  console.log('\n========================================');
  console.log('接近中心性分析');
  console.log('========================================\n');

  // 计算每个代币与高 PageRank 钱包的"接近度"
  const topWallets = walletPagerank.slice(0, 50);
  const topWalletSet = new Set(topWallets.map(w => w.address));

  const tokenCloseness = Object.values(graph.tokens).map(token => {
    // 计算参与该代币的高 PageRank 钱包数量
    const highPrWallets = Array.from(token.wallets).filter(w => topWalletSet.has(w));

    return {
      address: token.address,
      symbol: token.symbol,
      change: token.change,
      closeness: highPrWallets.length,
      totalWallets: token.wallets.size,
      closenessRatio: highPrWallets.length / token.wallets.size
    };
  }).sort((a, b) => b.closenessRatio - a.closenessRatio);

  console.log('【与高 PageRank 钱包最接近的代币】\n');

  tokenCloseness.slice(0, 20).forEach((t, i) => {
    console.log(`${i + 1}. ${t.symbol}: +${t.change.toFixed(1)}%`);
    console.log(`   高 PageRank 钱包数: ${t.closeness}/${t.totalWallets} (${(t.closenessRatio * 100).toFixed(1)}%)`);
    console.log('');
  });

  // 分析接近度与涨幅的关系
  console.log('【接近度与涨幅的关系】\n');

  const highCloseness = tokenCloseness.filter(t => t.closenessRatio >= 0.2);
  const lowCloseness = tokenCloseness.filter(t => t.closenessRatio < 0.1);

  const avgChangeHigh = highCloseness.reduce((sum, t) => sum + t.change, 0) / highCloseness.length;
  const avgChangeLow = lowCloseness.reduce((sum, t) => sum + t.change, 0) / lowCloseness.length;

  console.log(`高接近度 (>=20%): ${highCloseness.length} 个代币, 平均涨幅: ${avgChangeHigh.toFixed(1)}%`);
  console.log(`低接近度 (<10%): ${lowCloseness.length} 个代币, 平均涨幅: ${avgChangeLow.toFixed(1)}%`);
  console.log(`差异: ${(avgChangeHigh - avgChangeLow).toFixed(1)}%`);

  return tokenCloseness;
}

async function main() {
  console.log('========================================');
  console.log('网络中心性分析');
  console.log('========================================\n');

  const sequences = loadSequences();
  console.log(`✓ 读取 ${sequences.length} 个代币序列\n`);

  // 构建图
  const graph = buildBipartiteGraph(sequences);

  // 度中心性
  const { walletDegrees, tokenDegrees } = degreeCentrality(graph);

  // PageRank
  const walletPagerank = pagerankCentrality(graph);

  // 高 PageRank 钱包分析
  highPagerankWalletAnalysis(graph, walletPagerank);

  // 接近中心性
  const tokenCloseness = closenessCentrality(graph, walletPagerank);

  console.log('\n========================================');
  console.log('✓ 分析完成!');
  console.log('========================================\n');
}

main().catch(err => {
  console.error('分析失败:', err);
  process.exit(1);
});
