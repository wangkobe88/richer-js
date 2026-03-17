/**
 * 修正版：加权PageRank分析
 * 正确区分美元金额和份额占比
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data', 'raw');
const OUTPUT_DIR = path.join(__dirname, 'data', 'outputs');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * 加载原始数据（包含价格信息）
 */
function loadRawData() {
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(DATA_DIR, f));

  const allData = [];
  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const data = JSON.parse(content);
      if (data.tokens) {
        allData.push(...data.tokens);
      }
    } catch (e) {
      console.error(`Error reading ${file}:`, e.message);
    }
  }

  return allData;
}

/**
 * 加载序列数据（包含交易序列）
 */
function loadSequences() {
  const sequencesPath = path.join(__dirname, 'data', 'processed', 'all_sequences.json');
  const content = fs.readFileSync(sequencesPath, 'utf-8');
  const data = JSON.parse(content);
  return data.sequences;
}

/**
 * 合并数据：将价格信息合并到序列数据中
 */
function mergeDataWithPrices(sequences, rawData) {
  // 创建token_address -> 价格信息的映射
  const priceMap = new Map();

  rawData.forEach(token => {
    const aveData = token.ave_api_response?.data;
    if (aveData?.tokenInfo) {
      const info = aveData.tokenInfo.token;
      priceMap.set(token.token_address, {
        launch_price: parseFloat(info.launch_price || 0),
        current_price_usd: parseFloat(info.current_price_usd || 0),
        total_supply: parseFloat(info.total || 1e9)
      });
    }
  });

  // 将价格信息合并到序列中
  return sequences.map(seq => ({
    ...seq,
    price_info: priceMap.get(seq.token_address) || {
      launch_price: 0,
      current_price_usd: 0,
      total_supply: 1e9
    }
  }));
}

/**
 * 构建加权图（包含金额和份额信息）
 */
function buildWeightedGraph(sequencesWithPrices) {
  const wallets = {};
  const tokens = {};

  sequencesWithPrices.forEach(seq => {
    if (!tokens[seq.token_address]) {
      tokens[seq.token_address] = {
        address: seq.token_address,
        symbol: seq.token_symbol,
        change: seq.max_change_percent,
        price_usd: seq.price_info.current_price_usd,
        total_supply: seq.price_info.total_supply,
        wallets: new Map()  // wallet -> { usd_amount, share_amount, share_ratio }
      };
    }

    seq.sequence.forEach(([wallet, usdAmount]) => {
      const token = tokens[seq.token_address];
      const price = token.price_usd;

      // 计算份额数量
      const shareAmount = price > 0 ? usdAmount / price : 0;
      const shareRatio = token.total_supply > 0 ? shareAmount / token.total_supply : 0;

      // 钱包信息
      if (!wallets[wallet]) {
        wallets[wallet] = {
          address: wallet,
          tokens: new Set(),
          total_usd: 0
        };
      }
      wallets[wallet].tokens.add(seq.token_address);
      wallets[wallet].total_usd += Math.abs(usdAmount);

      // 代币的钱包信息
      if (!token.wallets.has(wallet)) {
        token.wallets.set(wallet, {
          usd_buy: 0,
          usd_sell: 0,
          share_buy: 0,
          share_sell: 0
        });
      }

      const w = token.wallets.get(wallet);
      if (usdAmount > 0) {
        w.usd_buy += usdAmount;
        w.share_buy += shareAmount;
      } else {
        w.usd_sell += Math.abs(usdAmount);
        w.share_sell += Math.abs(shareAmount);
      }
    });
  });

  return { wallets, tokens };
}

/**
 * 版本1: 无权重PageRank（基准）
 */
function pagerankUnweighted(graph, maxIter = 50) {
  console.log('\n【版本1: 无权重PageRank（基准）】\n');

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
    if (maxDiff < 1e-5) break;
  }

  return walletList.map((wallet, i) => ({
    address: wallet,
    pagerank: pr[i],
    degree: graph.wallets[wallet].tokens.size
  })).sort((a, b) => b.pagerank - a.pagerank);
}

/**
 * 版本2: 美元金额加权PageRank
 * 权重 = 钱包的美元购买金额 / 该代币总美元购买金额
 */
function pagerankUSDWeighted(graph, maxIter = 50) {
  console.log('\n【版本2: 美元金额加权PageRank】\n');
  console.log('权重 = 钱包美元购买金额 / 代币总美元购买金额\n');

  const walletList = Object.keys(graph.wallets);
  const walletIndex = new Map(walletList.map((w, i) => [w, i]));
  const n = walletList.length;

  const activeWallets = new Set();
  Object.values(graph.wallets).forEach(w => {
    if (w.tokens.size >= 5) activeWallets.add(w.address);
  });

  const outLinks = new Array(n).fill(null).map(() => []);

  Object.values(graph.tokens).forEach(token => {
    const tokenWallets = Array.from(token.wallets.entries())
      .filter(([w]) => activeWallets.has(w));

    // 计算该代币的总美元购买金额
    const totalUSDBuy = tokenWallets.reduce((sum, [, w]) => sum + w.usd_buy, 0);

    for (let i = 0; i < tokenWallets.length; i++) {
      for (let j = 0; j < tokenWallets.length; j++) {
        if (i !== j) {
          const [walletI, dataI] = tokenWallets[i];
          const [walletJ] = tokenWallets[j];

          const wi = walletIndex.get(walletI);
          const wj = walletIndex.get(walletJ);

          if (wi !== undefined && wj !== undefined && totalUSDBuy > 0) {
            const weight = dataI.usd_buy / totalUSDBuy;
            outLinks[wi].push({ target: wj, weight });
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
    if (maxDiff < 1e-5) break;
  }

  return walletList.map((wallet, i) => ({
    address: wallet,
    pagerank: pr[i],
    degree: graph.wallets[wallet].tokens.size
  })).sort((a, b) => b.pagerank - a.pagerank);
}

/**
 * 版本3: 份额占比加权PageRank
 * 权重 = 钱包的份额购买数量 / 该代币总份额购买数量
 * 同时考虑"控制权放大"：份额占比越高，影响力越大
 */
function pagerankShareWeighted(graph, maxIter = 50) {
  console.log('\n【版本3: 份额占比加权PageRank】\n');
  console.log('权重 = (钱包份额 / 代币总份额) × (1 + 份额占比放大系数)\n');

  const walletList = Object.keys(graph.wallets);
  const walletIndex = new Map(walletList.map((w, i) => [w, i]));
  const n = walletList.length;

  const activeWallets = new Set();
  Object.values(graph.wallets).forEach(w => {
    if (w.tokens.size >= 5) activeWallets.add(w.address);
  });

  const outLinks = new Array(n).fill(null).map(() => []);

  Object.values(graph.tokens).forEach(token => {
    const tokenWallets = Array.from(token.wallets.entries())
      .filter(([w]) => activeWallets.has(w));

    // 计算该代币的总份额购买数量
    const totalShareBuy = tokenWallets.reduce((sum, [, w]) => sum + w.share_buy, 0);

    // 计算总份额占供应量的比例
    const totalSupplyRatio = token.total_supply > 0 ? totalShareBuy / token.total_supply : 0;

    for (let i = 0; i < tokenWallets.length; i++) {
      for (let j = 0; j < tokenWallets.length; j++) {
        if (i !== j) {
          const [walletI, dataI] = tokenWallets[i];
          const [walletJ] = tokenWallets[j];

          const wi = walletIndex.get(walletI);
          const wj = walletIndex.get(walletJ);

          if (wi !== undefined && wj !== undefined && totalShareBuy > 0) {
            // 基础权重：该钱包的份额占比
            const shareRatio = dataI.share_buy / totalShareBuy;

            // 放大系数：如果该钱包控制的份额占供应量比例大，则放大其影响力
            const walletSupplyRatio = token.total_supply > 0 ? dataI.share_buy / token.total_supply : 0;
            const amplification = 1 + walletSupplyRatio * 1000; // 放大系数

            const weight = shareRatio * amplification;
            outLinks[wi].push({ target: wj, weight });
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
    if (maxDiff < 1e-5) break;
  }

  return walletList.map((wallet, i) => ({
    address: wallet,
    pagerank: pr[i],
    degree: graph.wallets[wallet].tokens.size
  })).sort((a, b) => b.pagerank - a.pagerank);
}

/**
 * 对比分析
 */
function compareAndReport(unweighted, usdWeighted, shareWeighted) {
  console.log('\n========================================');
  console.log('三种PageRank版本对比');
  console.log('========================================\n');

  // 创建排名映射
  const rank1 = new Map(unweighted.map((w, i) => [w.address, i]));
  const rank2 = new Map(usdWeighted.map((w, i) => [w.address, i]));
  const rank3 = new Map(shareWeighted.map((w, i) => [w.address, i]));

  // Top 30 对比表
  console.log('【Top 30 钱包排名对比】\n');
  console.log('钱包地址        | 无权重 | 美元加权 | 份额加权 | 差异');
  console.log('----------------|--------|----------|----------|------');

  const topWallets = new Set([
    ...unweighted.slice(0, 30).map(w => w.address),
    ...usdWeighted.slice(0, 30).map(w => w.address),
    ...shareWeighted.slice(0, 30).map(w => w.address)
  ]);

  Array.from(topWallets).slice(0, 40).forEach(address => {
    const r1 = rank1.get(address);
    const r2 = rank2.get(address);
    const r3 = rank3.get(address);

    if (r1 === undefined || r2 === undefined || r3 === undefined) return;

    const fmt = (r) => `#${r + 1}`.padStart(7);
    const maxDiff = Math.max(r1, r2, r3) - Math.min(r1, r2, r3);
    const diffMark = maxDiff > 100 ? ' ⚠️' : '';

    console.log(`${address.slice(0, 14)}... | ${fmt(r1)} | ${fmt(r2)} | ${fmt(r3)} | ±${maxDiff}${diffMark}`);
  });

  // 相关性分析
  console.log('\n【排名相关性分析（前100个钱包）】\n');

  const calcCorrelation = (rankA, rankB) => {
    const common = Array.from(rankA.keys())
      .filter(addr => rankB.has(addr))
      .slice(0, 100);

    if (common.length < 2) return 0;

    const n = common.length;
    const ra = common.map(addr => rankA.get(addr));
    const rb = common.map(addr => rankB.get(addr));

    const meanA = ra.reduce((a, b) => a + b, 0) / n;
    const meanB = rb.reduce((a, b) => a + b, 0) / n;

    let num = 0, denA = 0, denB = 0;
    for (let i = 0; i < n; i++) {
      const da = ra[i] - meanA;
      const db = rb[i] - meanB;
      num += da * db;
      denA += da * da;
      denB += db * db;
    }

    return num / Math.sqrt(denA * denB);
  };

  const corr_12 = calcCorrelation(rank1, rank2);
  const corr_13 = calcCorrelation(rank1, rank3);
  const corr_23 = calcCorrelation(rank2, rank3);

  console.log(`无权重 vs 美元加权: ${corr_12.toFixed(3)}`);
  console.log(`无权重 vs 份额加权: ${corr_13.toFixed(3)}`);
  console.log(`美元加权 vs 份额加权: ${corr_23.toFixed(3)}`);

  // 分析排名差异
  console.log('\n【美元加权 vs 份额加权：排名差异最大的钱包】\n');

  const rankDiff = Array.from(rank2.keys()).map(addr => {
    const r2 = rank2.get(addr) ?? 999;
    const r3 = rank3.get(addr) ?? 999;
    return { address: addr, diff: r2 - r3, r2, r3 };
  }).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  console.log('份额加权排名相对美元加权：');
  console.log('上升最多（份额加权更适合）:');
  rankDiff.filter(r => r.diff > 0).slice(0, 10).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.address.slice(0, 12)}...: #${r.r2 + 1} → #${r.r3 + 1} (↑${r.diff})`);
  });

  console.log('\n下降最多（美元加权更适合）:');
  rankDiff.filter(r => r.diff < 0).slice(0, 10).reverse().forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.address.slice(0, 12)}...: #${r.r2 + 1} → #${r.r3 + 1} (↓${Math.abs(r.diff)})`);
  });
}

/**
 * 保存结果
 */
function saveResults(unweighted, usdWeighted, shareWeighted) {
  const outputPath = path.join(OUTPUT_DIR, 'pagerank_weighted_comparison.json');

  const data = {
    generated_at: new Date().toISOString(),
    summary: {
      total_wallets: unweighted.length,
      correlation_unweighted_usd: 0,  // 需要计算
      correlation_unweighted_share: 0,
      correlation_usd_share: 0
    },
    unweighted_top_50: unweighted.slice(0, 50).map((w, i) => ({
      rank: i + 1,
      address: w.address,
      pagerank: w.pagerank,
      degree: w.degree
    })),
    usd_weighted_top_50: usdWeighted.slice(0, 50).map((w, i) => ({
      rank: i + 1,
      address: w.address,
      pagerank: w.pagerank,
      degree: w.degree
    })),
    share_weighted_top_50: shareWeighted.slice(0, 50).map((w, i) => ({
      rank: i + 1,
      address: w.address,
      pagerank: w.pagerank,
      degree: w.degree
    }))
  };

  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
  console.log(`\n✓ 结果已保存到: ${outputPath}`);
}

async function main() {
  console.log('========================================');
  console.log('修正版：加权PageRank对比分析');
  console.log('========================================\n');

  console.log('加载数据...');
  const rawData = loadRawData();
  const sequences = loadSequences();

  console.log(`✓ 原始数据: ${rawData.length} 个代币`);
  console.log(`✓ 序列数据: ${sequences.length} 个代币`);

  console.log('\n合并价格信息...');
  const sequencesWithPrices = mergeDataWithPrices(sequences, rawData);

  console.log('构建加权图...');
  const graph = buildWeightedGraph(sequencesWithPrices);

  console.log(`✓ 钱包数: ${Object.keys(graph.wallets).length}`);
  console.log(`✓ 代币数: ${Object.keys(graph.tokens).length}`);

  // 计算三种PageRank
  const unweighted = pagerankUnweighted(graph);
  const usdWeighted = pagerankUSDWeighted(graph);
  const shareWeighted = pagerankShareWeighted(graph);

  // 对比分析
  compareAndReport(unweighted, usdWeighted, shareWeighted);

  // 保存结果
  saveResults(unweighted, usdWeighted, shareWeighted);

  console.log('\n========================================');
  console.log('分析完成!');
  console.log('========================================\n');
}

main().catch(err => {
  console.error('失败:', err);
  process.exit(1);
});
