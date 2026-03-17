/**
 * 导出PageRank钱包排名列表
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
 * 计算钱包的PageRank
 */
function calculateWalletPagerank(sequences) {
  // 构建钱包-代币图
  const wallets = {};
  const tokens = {};

  sequences.forEach(seq => {
    if (!tokens[seq.token_address]) {
      tokens[seq.token_address] = {
        address: seq.token_address,
        symbol: seq.token_symbol,
        change: seq.max_change_percent,
        wallets: new Set()
      };
    }

    seq.sequence.forEach(([wallet]) => {
      if (!wallets[wallet]) {
        wallets[wallet] = {
          address: wallet,
          tokens: new Set(),
          total_amount: 0
        };
      }
      wallets[wallet].tokens.add(seq.token_address);
      tokens[seq.token_address].wallets.add(wallet);
    });
  });

  const walletList = Object.keys(wallets);
  const walletIndex = new Map(walletList.map((w, i) => [w, i]));
  const n = walletList.length;

  // 使用稀疏邻接表
  const outLinks = new Array(n).fill(null).map(() => []);

  // 只处理度 >= 5 的钱包
  const activeWallets = new Set();
  Object.values(wallets).forEach(w => {
    if (w.tokens.size >= 5) {
      activeWallets.add(w.address);
    }
  });

  // 构建稀疏邻接表
  Object.values(tokens).forEach(token => {
    const tokenWallets = Array.from(token.wallets).filter(w => activeWallets.has(w));

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
  const maxIter = 50;
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
      console.log(`PageRank 在 ${iter + 1} 次迭代后收敛`);
      break;
    }
  }

  return walletList.map((wallet, i) => ({
    address: wallet,
    pagerank: pr[i],
    degree: wallets[wallet].tokens.size
  })).sort((a, b) => b.pagerank - a.pagerank);
}

/**
 * 分析钱包参与代币的表现
 */
function analyzeWalletPerformance(sequences, walletRankings) {
  const walletPerformance = {};

  sequences.forEach(seq => {
    seq.sequence.forEach(([wallet, amount]) => {
      if (!walletPerformance[wallet]) {
        walletPerformance[wallet] = {
          tokens: [],
          total_return: 0
        };
      }
      walletPerformance[wallet].tokens.push({
        symbol: seq.token_symbol,
        return: seq.max_change_percent,
        amount: Math.abs(amount)
      });
    });
  });

  // 计算每个钱包的平均成功率
  Object.values(walletPerformance).forEach(w => {
    w.avg_return = w.tokens.reduce((sum, t) => sum + t.return, 0) / w.tokens.length;
    w.high_return_rate = w.tokens.filter(t => t.return >= 100).length / w.tokens.length;
    w.token_count = w.tokens.length;
    w.total_amount = w.tokens.reduce((sum, t) => sum + t.amount, 0);
  });

  return walletPerformance;
}

async function main() {
  console.log('========================================');
  console.log('导出PageRank钱包排名');
  console.log('========================================\n');

  const sequences = loadSequences();
  console.log(`✓ 读取 ${sequences.length} 个代币序列\n`);

  // 计算PageRank
  console.log('计算PageRank...');
  const walletRankings = calculateWalletPagerank(sequences);

  // 分析钱包表现
  console.log('分析钱包表现...');
  const walletPerformance = analyzeWalletPerformance(sequences, walletRankings);

  // 合并数据
  const enrichedRankings = walletRankings.map(w => {
    const perf = walletPerformance[w.address] || {
      avg_return: 0,
      high_return_rate: 0,
      token_count: 0,
      total_amount: 0
    };
    return {
      rank: 0, // 稍后填充
      address: w.address,
      pagerank: w.pagerank,
      degree: w.degree,
      avg_return: perf.avg_return,
      high_return_rate: perf.high_return_rate,
      token_count: perf.token_count,
      total_amount: perf.total_amount
    };
  });

  // 填充排名
  enrichedRankings.forEach((w, i) => w.rank = i + 1);

  // 打印Top 50
  console.log('\n【PageRank Top 50 钱包】\n');
  console.log('排名 | 地址 | PageRank | 度 | 平均涨幅 | 成功率 | 参与代币数 | 总金额');
  console.log('-----|--------|----------|-----|----------|--------|------------|--------');

  enrichedRankings.slice(0, 50).forEach(w => {
    console.log(
      `${w.rank.toString().padStart(4)} | ${w.address.slice(0, 10)}... | ${w.pagerank.toFixed(6)} | ` +
      `${w.degree} | ${w.avg_return.toFixed(1)}% | ${(w.high_return_rate * 100).toFixed(1)}% | ` +
      `${w.token_count} | $${w.total_amount.toFixed(0)}`
    );
  });

  // 打印Top 10%（高PageRank钱包）的统计
  console.log('\n【Top 10% 钱包统计】\n');
  const top10Percent = enrichedRankings.slice(0, Math.floor(enrichedRankings.length * 0.1));
  const avgReturn = top10Percent.reduce((sum, w) => sum + w.avg_return, 0) / top10Percent.length;
  const avgHighReturnRate = top10Percent.reduce((sum, w) => sum + w.high_return_rate, 0) / top10Percent.length;

  console.log(`钱包数: ${top10Percent.length}`);
  console.log(`平均参与涨幅: ${avgReturn.toFixed(1)}%`);
  console.log(`平均成功率: ${(avgHighReturnRate * 100).toFixed(1)}%`);

  // 保存完整列表
  const outputPath = path.join(OUTPUT_DIR, 'pagerank_wallets.json');
  fs.writeFileSync(outputPath, JSON.stringify(enrichedRankings, null, 2));

  console.log(`\n✓ 完整列表已保存到: ${outputPath}`);

  // 也保存CSV格式
  const csvPath = path.join(OUTPUT_DIR, 'pagerank_wallets.csv');
  const csvHeader = 'rank,address,pagerank,degree,avg_return,high_return_rate,token_count,total_amount\n';
  const csvRows = enrichedRankings.map(w =>
    `${w.rank},${w.address},${w.pagerank.toFixed(8)},${w.degree},${w.avg_return.toFixed(2)},${w.high_return_rate.toFixed(4)},${w.token_count},${w.total_amount.toFixed(2)}`
  ).join('\n');
  fs.writeFileSync(csvPath, csvHeader + csvRows);

  console.log(`✓ CSV格式已保存到: ${csvPath}\n`);

  console.log('========================================');
  console.log('完成!');
  console.log('========================================\n');
}

main().catch(err => {
  console.error('失败:', err);
  process.exit(1);
});
