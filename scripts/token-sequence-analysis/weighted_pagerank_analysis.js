/**
 * 加权PageRank分析
 * 对比三种PageRank实现：
 * 1. 无权重（原版）
 * 2. 美元金额加权
 * 3. 份额占比加权
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data', 'processed');
const OUTPUT_DIR = path.join(__dirname, 'data', 'outputs');

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
 * 构建钱包-代币图（包含金额信息）
 */
function buildWeightedGraph(sequences) {
  const wallets = {};
  const tokens = {};

  sequences.forEach(seq => {
    if (!tokens[seq.token_address]) {
      tokens[seq.token_address] = {
        address: seq.token_address,
        symbol: seq.token_symbol,
        change: seq.max_change_percent,
        wallets: new Map()  // wallet -> { buy_amount, sell_amount, total_amount }
      };
    }

    seq.sequence.forEach(([wallet, amount]) => {
      const absAmount = Math.abs(amount);

      // 钱包信息
      if (!wallets[wallet]) {
        wallets[wallet] = {
          address: wallet,
          tokens: new Set(),
          total_amount: 0
        };
      }
      wallets[wallet].tokens.add(seq.token_address);
      wallets[wallet].total_amount += absAmount;

      // 代币的钱包信息（包含金额）
      if (!tokens[seq.token_address].wallets.has(wallet)) {
        tokens[seq.token_address].wallets.set(wallet, {
          buy_amount: 0,
          sell_amount: 0,
          total_amount: 0
        });
      }

      const walletData = tokens[seq.token_address].wallets.get(wallet);
      if (amount > 0) {
        walletData.buy_amount += amount;
      } else {
        walletData.sell_amount += absAmount;
      }
      walletData.total_amount += absAmount;
    });
  });

  return { wallets, tokens };
}

/**
 * 版本1: 无权重PageRank（原版）
 */
function pagerankUnweighted(graph, maxIter = 50) {
  console.log('\n【版本1: 无权重PageRank】\n');

  const walletList = Object.keys(graph.wallets);
  const walletIndex = new Map(walletList.map((w, i) => [w, i]));
  const n = walletList.length;

  // 只处理度 >= 5 的钱包
  const activeWallets = new Set();
  Object.values(graph.wallets).forEach(w => {
    if (w.tokens.size >= 5) {
      activeWallets.add(w.address);
    }
  });

  // 构建邻接表（无权重）
  const outLinks = new Array(n).fill(null).map(() => []);

  Object.values(graph.tokens).forEach(token => {
    const tokenWallets = Array.from(token.wallets.keys()).filter(w => activeWallets.has(w));

    for (let i = 0; i < tokenWallets.length; i++) {
      for (let j = 0; j < tokenWallets.length; j++) {
        if (i !== j) {
          const wi = walletIndex.get(tokenWallets[i]);
          const wj = walletIndex.get(tokenWallets[j]);
          if (wi !== undefined && wj !== undefined) {
            outLinks[wi].push(wj);
          }
        }
      }
    }
  });

  // PageRank迭代
  const dampingFactor = 0.85;
  let pr = new Array(n).fill(1 / n);

  for (let iter = 0; iter < maxIter; iter++) {
    const newPr = new Array(n).fill((1 - dampingFactor) / n);

    for (let i = 0; i < n; i++) {
      if (outLinks[i].length === 0) continue;
      const outboundDistributed = pr[i] / outLinks[i].length;
      for (const j of outLinks[i]) {
        newPr[j] += dampingFactor * outboundDistributed;
      }
    }

    let maxDiff = 0;
    for (let i = 0; i < n; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(newPr[i] - pr[i]));
    }

    pr = newPr;
    if (maxDiff < 1e-5) {
      break;
    }
  }

  return walletList.map((wallet, i) => ({
    address: wallet,
    pagerank: pr[i],
    degree: graph.wallets[wallet].tokens.size
  })).sort((a, b) => b.pagerank - a.pagerank);
}

/**
 * 版本2: 美元金额加权PageRank
 */
function pagerankUSDWeighted(graph, maxIter = 50) {
  console.log('\n【版本2: 美元金额加权PageRank】\n');
  console.log('权重计算: 钱包在代币中的购买金额越高，权重越大\n');

  const walletList = Object.keys(graph.wallets);
  const walletIndex = new Map(walletList.map((w, i) => [w, i]));
  const n = walletList.length;

  // 只处理度 >= 5 的钱包
  const activeWallets = new Set();
  Object.values(graph.wallets).forEach(w => {
    if (w.tokens.size >= 5) {
      activeWallets.add(w.address);
    }
  });

  // 构建加权邻接表
  // outLinks[i] = [{ target: j, weight: w }, ...]
  const outLinks = new Array(n).fill(null).map(() => []);

  Object.values(graph.tokens).forEach(token => {
    const tokenWallets = Array.from(token.wallets.entries())
      .filter(([w]) => activeWallets.has(w));

    // 计算该代币的总购买金额（用于归一化）
    const totalBuyAmount = tokenWallets.reduce((sum, [, data]) => sum + data.buy_amount, 0);

    for (let i = 0; i < tokenWallets.length; i++) {
      for (let j = 0; j < tokenWallets.length; j++) {
        if (i !== j) {
          const [walletI, dataI] = tokenWallets[i];
          const [walletJ] = tokenWallets[j];

          const wi = walletIndex.get(walletI);
          const wj = walletIndex.get(walletJ);

          if (wi !== undefined && wj !== undefined) {
            // 权重 = 钱包I在该代币中的购买金额占比
            const weight = totalBuyAmount > 0 ? dataI.buy_amount / totalBuyAmount : 0;
            outLinks[wi].push({ target: wj, weight });
          }
        }
      }
    }
  });

  // PageRank迭代（加权版）
  const dampingFactor = 0.85;
  let pr = new Array(n).fill(1 / n);

  for (let iter = 0; iter < maxIter; iter++) {
    const newPr = new Array(n).fill((1 - dampingFactor) / n);

    for (let i = 0; i < n; i++) {
      if (outLinks[i].length === 0) continue;

      // 计算总权重（用于归一化）
      const totalWeight = outLinks[i].reduce((sum, link) => sum + link.weight, 0);

      if (totalWeight === 0) continue;

      // 按权重分配PageRank值
      for (const link of outLinks[i]) {
        const normalizedWeight = link.weight / totalWeight;
        newPr[link.target] += dampingFactor * pr[i] * normalizedWeight;
      }
    }

    let maxDiff = 0;
    for (let i = 0; i < n; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(newPr[i] - pr[i]));
    }

    pr = newPr;
    if (maxDiff < 1e-5) {
      break;
    }
  }

  return walletList.map((wallet, i) => ({
    address: wallet,
    pagerank: pr[i],
    degree: graph.wallets[wallet].tokens.size
  })).sort((a, b) => b.pagerank - a.pagerank);
}

/**
 * 版本3: 份额占比加权PageRank
 * 假设代币供应量都是10亿（1,000,000,000）
 */
function pagerankShareWeighted(graph, maxIter = 50) {
  console.log('\n【版本3: 份额占比加权PageRank】\n');
  console.log('权重计算: 钱包在代币中的购买份额占比（假设代币供应量10亿）\n');

  const SUPPLY = 1_000_000_000; // 10亿

  const walletList = Object.keys(graph.wallets);
  const walletIndex = new Map(walletList.map((w, i) => [w, i]));
  const n = walletList.length;

  // 只处理度 >= 5 的钱包
  const activeWallets = new Set();
  Object.values(graph.wallets).forEach(w => {
    if (w.tokens.size >= 5) {
      activeWallets.add(w.address);
    }
  });

  // 构建加权邻接表（基于份额占比）
  const outLinks = new Array(n).fill(null).map(() => []);

  Object.values(graph.tokens).forEach(token => {
    const tokenWallets = Array.from(token.wallets.entries())
      .filter(([w]) => activeWallets.has(w));

    // 计算该代币的已购买总份额（用于归一化）
    const totalShare = tokenWallets.reduce((sum, [, data]) => {
      // 假设价格就是1美元=1份额（简化）
      return sum + data.buy_amount;
    }, 0);

    // 计算已购买份额占供应量的比例
    const supplyRatio = Math.min(totalShare / SUPPLY, 1.0);

    for (let i = 0; i < tokenWallets.length; i++) {
      for (let j = 0; j < tokenWallets.length; j++) {
        if (i !== j) {
          const [walletI, dataI] = tokenWallets[i];
          const [walletJ] = tokenWallets[j];

          const wi = walletIndex.get(walletI);
          const wj = walletIndex.get(walletJ);

          if (wi !== undefined && wj !== undefined) {
            // 权重 = 钱包I的份额 / 总份额 * 供应量占比（放大影响）
            const shareRatio = totalShare > 0 ? dataI.buy_amount / totalShare : 0;
            const weight = shareRatio * (1 + supplyRatio * 100); // 供应量占比越高，权重越大
            outLinks[wi].push({ target: wj, weight });
          }
        }
      }
    }
  });

  // PageRank迭代（加权版）
  const dampingFactor = 0.85;
  let pr = new Array(n).fill(1 / n);

  for (let iter = 0; iter < maxIter; iter++) {
    const newPr = new Array(n).fill((1 - dampingFactor) / n);

    for (let i = 0; i < n; i++) {
      if (outLinks[i].length === 0) continue;

      const totalWeight = outLinks[i].reduce((sum, link) => sum + link.weight, 0);

      if (totalWeight === 0) continue;

      for (const link of outLinks[i]) {
        const normalizedWeight = link.weight / totalWeight;
        newPr[link.target] += dampingFactor * pr[i] * normalizedWeight;
      }
    }

    let maxDiff = 0;
    for (let i = 0; i < n; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(newPr[i] - pr[i]));
    }

    pr = newPr;
    if (maxDiff < 1e-5) {
      break;
    }
  }

  return walletList.map((wallet, i) => ({
    address: wallet,
    pagerank: pr[i],
    degree: graph.wallets[wallet].tokens.size
  })).sort((a, b) => b.pagerank - a.pagerank);
}

/**
 * 对比三个版本的结果
 */
function compareVersions(unweighted, usdWeighted, shareWeighted) {
  console.log('\n========================================');
  console.log('三个版本PageRank对比分析');
  console.log('========================================\n');

  // 创建地址->排名的映射
  const unweightedRank = new Map(unweighted.map((w, i) => [w.address, i]));
  const usdRank = new Map(usdWeighted.map((w, i) => [w.address, i]));
  const shareRank = new Map(shareWeighted.map((w, i) => [w.address, i]));

  // 找出Top 20的钱包在三个版本中的排名
  console.log('【Top 20 钱包在三个版本中的排名对比】\n');
  console.log('钱包地址        | 无权重 | 美元加权 | 份额加权');
  console.log('----------------|--------|----------|----------');

  // 取并集Top 20
  const topWallets = new Set([
    ...unweighted.slice(0, 20).map(w => w.address),
    ...usdWeighted.slice(0, 20).map(w => w.address),
    ...shareWeighted.slice(0, 20).map(w => w.address)
  ]);

  Array.from(topWallets).slice(0, 30).forEach(address => {
    const rank1 = unweightedRank.get(address) ?? '-';
    const rank2 = usdRank.get(address) ?? '-';
    const rank3 = shareRank.get(address) ?? '-';

    const fmt = (r) => typeof r === 'number' ? `#${r + 1}`.padStart(7) : '   -   ';

    console.log(`${address.slice(0, 14)}... | ${fmt(rank1)} | ${fmt(rank2)} | ${fmt(rank3)}`);
  });

  // 计算排名相关性
  console.log('\n【排名相关性分析】\n');

  const calcCorrelation = (rank1, rank2) => {
    const commonWallets = Array.from(unweightedRank.keys())
      .filter(addr => rank2.has(addr))
      .slice(0, 100); // 取前100个计算

    if (commonWallets.length < 2) return 0;

    const n = commonWallets.length;
    const r1 = commonWallets.map(addr => rank1.get(addr));
    const r2 = commonWallets.map(addr => rank2.get(addr));

    const mean1 = r1.reduce((a, b) => a + b, 0) / n;
    const mean2 = r2.reduce((a, b) => a + b, 0) / n;

    let num = 0, den1 = 0, den2 = 0;
    for (let i = 0; i < n; i++) {
      const d1 = r1[i] - mean1;
      const d2 = r2[i] - mean2;
      num += d1 * d2;
      den1 += d1 * d1;
      den2 += d2 * d2;
    }

    return num / Math.sqrt(den1 * den2);
  };

  const corr_unweighted_usd = calcCorrelation(unweightedRank, usdRank);
  const corr_unweighted_share = calcCorrelation(unweightedRank, shareRank);
  const corr_usd_share = calcCorrelation(usdRank, shareRank);

  console.log(`无权重 vs 美元加权: ${corr_unweighted_usd.toFixed(3)}`);
  console.log(`无权重 vs 份额加权: ${corr_unweighted_share.toFixed(3)}`);
  console.log(`美元加权 vs 份额加权: ${corr_usd_share.toFixed(3)}`);

  // 分析排名变化最大的钱包
  console.log('\n【排名变化最大的钱包】\n');

  const rankChanges = Array.from(unweightedRank.keys()).map(addr => {
    const r1 = unweightedRank.get(addr) ?? 999;
    const r2 = usdRank.get(addr) ?? 999;
    const change = r1 - r2; // 正值=美元加权排名上升
    return { address: addr, change, r1, r2 };
  }).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

  console.log('无权重 vs 美元加权 - 排名上升最多的10个:');
  rankChanges.filter(r => r.change > 0).slice(0, 10).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.address.slice(0, 12)}...: #${r.r1 + 1} → #${r.r2 + 1} (↑${r.change})`);
  });

  console.log('\n无权重 vs 美元加权 - 排名下降最多的10个:');
  rankChanges.filter(r => r.change < 0).slice(0, 10).reverse().forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.address.slice(0, 12)}...: #${r.r1 + 1} → #${r.r2 + 1} (↓${Math.abs(r.change)})`);
  });
}

/**
 * 保存对比结果
 */
function saveComparison(unweighted, usdWeighted, shareWeighted) {
  const outputPath = path.join(OUTPUT_DIR, 'pagerank_comparison.json');

  const data = {
    unweighted: unweighted.map((w, i) => ({
      rank: i + 1,
      address: w.address,
      pagerank: w.pagerank,
      degree: w.degree
    })),
    usd_weighted: usdWeighted.map((w, i) => ({
      rank: i + 1,
      address: w.address,
      pagerank: w.pagerank,
      degree: w.degree
    })),
    share_weighted: shareWeighted.map((w, i) => ({
      rank: i + 1,
      address: w.address,
      pagerank: w.pagerank,
      degree: w.degree
    }))
  };

  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
  console.log(`\n✓ 对比结果已保存到: ${outputPath}`);
}

async function main() {
  console.log('========================================');
  console.log('加权PageRank对比分析');
  console.log('========================================\n');

  const sequences = loadSequences();
  console.log(`✓ 读取 ${sequences.length} 个代币序列`);

  // 构建图
  const graph = buildWeightedGraph(sequences);
  console.log(`✓ 钱包数: ${Object.keys(graph.wallets).length}`);
  console.log(`✓ 代币数: ${Object.keys(graph.tokens).length}`);

  // 计算三个版本的PageRank
  const unweighted = pagerankUnweighted(graph);
  const usdWeighted = pagerankUSDWeighted(graph);
  const shareWeighted = pagerankShareWeighted(graph);

  // 对比分析
  compareVersions(unweighted, usdWeighted, shareWeighted);

  // 保存结果
  saveComparison(unweighted, usdWeighted, shareWeighted);

  console.log('\n========================================');
  console.log('分析完成!');
  console.log('========================================\n');
}

main().catch(err => {
  console.error('失败:', err);
  process.exit(1);
});
