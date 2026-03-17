/**
 * 因果分析与对比研究
 * 探索净流入的来源和影响
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
 * 分析净流入的构成
 */
function netFlowCompositionAnalysis(sequences) {
  console.log('========================================');
  console.log('净流入构成分析');
  console.log('========================================\n');

  // 将净流入分解为：
  // - 新钱包的首次买入
  // - 现有钱包的额外买入
  // - 卖出（负向贡献）

  const tokenFlowComposition = sequences.map(seq => {
    const walletFirstSeen = {};  // wallet -> first seen position
    const walletBuys = {};       // wallet -> total buy amount
    const walletSells = {};     // wallet -> total sell amount

    seq.sequence.forEach(([wallet, amount], idx) => {
      if (!(wallet in walletFirstSeen)) {
        walletFirstSeen[wallet] = idx;
      }

      if (amount > 0) {
        walletBuys[wallet] = (walletBuys[wallet] || 0) + amount;
      } else {
        walletSells[wallet] = (walletSells[wallet] || 0) + Math.abs(amount);
      }
    });

    // 计算各部分贡献
    let newWalletBuy = 0;
    let existingWalletBuy = 0;
    let totalSell = 0;

    Object.entries(walletBuys).forEach(([wallet, buyAmount]) => {
      const firstPos = walletFirstSeen[wallet];
      if (firstPos === 0) {
        newWalletBuy += buyAmount;
      } else {
        existingWalletBuy += buyAmount;
      }
    });

    Object.values(walletSells).forEach(sellAmount => {
      totalSell += sellAmount;
    });

    return {
      token: seq.token_symbol,
      change: seq.max_change_percent,
      total_buy: Object.values(walletBuys).reduce((a, b) => a + b, 0),
      total_sell: totalSell,
      net_flow: Object.values(walletBuys).reduce((a, b) => a + b, 0) - totalSell,
      new_wallet_buy: newWalletBuy,
      existing_wallet_buy: existingWalletBuy,
      new_wallet_ratio: newWalletBuy / (newWalletBuy + existingWalletBuy + totalSell),
      unique_wallets: Object.keys(walletFirstSeen).length
    };
  });

  // 分析各部分与涨幅的相关性
  console.log('净流入组成部分与涨幅的相关性:\n');

  const correlation = (xArr, yArr) => {
    const n = xArr.length;
    const meanX = xArr.reduce((a, b) => a + b, 0) / n;
    const meanY = yArr.reduce((a, b) => a + b, 0) / n;
    let num = 0, denX = 0, denY = 0;
    for (let i = 0; i < n; i++) {
      const dx = xArr[i] - meanX;
      const dy = yArr[i] - meanY;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }
    return num / Math.sqrt(denX * denY);
  };

  const changes = tokenFlowComposition.map(t => t.change);
  const netFlows = tokenFlowComposition.map(t => t.net_flow);
  const newWalletRatios = tokenFlowComposition.map(t => t.new_wallet_ratio);
  const uniqueWallets = tokenFlowComposition.map(t => t.unique_wallets);

  console.log(`净流入: ${correlation(netFlows, changes).toFixed(3)}`);
  console.log(`新钱包比例: ${correlation(newWalletRatios, changes).toFixed(3)}`);
  console.log(`唯一钱包数: ${correlation(uniqueWallets, changes).toFixed(3)}`);

  // 分组分析
  console.log('\n按新钱包比例分组:\n');

  const groups = {
    '< 30%': [],
    '30-50%': [],
    '50-70%': [],
    '> 70%': []
  };

  tokenFlowComposition.forEach(t => {
    if (t.new_wallet_ratio < 0.3) {
      groups['< 30%'].push(t);
    } else if (t.new_wallet_ratio < 0.5) {
      groups['30-50%'].push(t);
    } else if (t.new_wallet_ratio < 0.7) {
      groups['50-70%'].push(t);
    } else {
      groups['> 70%'].push(t);
    }
  });

  Object.entries(groups).forEach(([range, tokens]) => {
    if (tokens.length === 0) return;

    const avgChange = tokens.reduce((sum, t) => sum + t.change, 0) / tokens.length;
    const highReturnRate = tokens.filter(t => t.change >= 100).length / tokens.length;
    const avgNetFlow = tokens.reduce((sum, t) => sum + t.net_flow, 0) / tokens.length;

    console.log(`${range}:`);
    console.log(`  代币数: ${tokens.length}`);
    console.log(`  平均涨幅: ${avgChange.toFixed(1)}%`);
    console.log(`  高涨幅占比: ${(highReturnRate * 100).toFixed(1)}%`);
    console.log(`  平均净流入: $${avgNetFlow.toFixed(0)}`);
    console.log('');
  });

  return tokenFlowComposition;
}

/**
 * 分析"核心钱包"的影响
 */
function coreWalletAnalysis(sequences) {
  console.log('\n========================================');
  console.log('核心钱包分析');
  console.log('========================================\n');

  // 找出在不同代币中都出现的高价值钱包
  const walletTokens = {}; // wallet -> { tokens: [], avg_return: 0, total_amount: 0 }

  sequences.forEach(seq => {
    const tokenReturn = seq.max_change_percent;

    seq.sequence.forEach(([wallet, amount]) => {
      if (!walletTokens[wallet]) {
        walletTokens[wallet] = { tokens: [], total_amount: 0 };
      }
      walletTokens[wallet].tokens.push({
        symbol: seq.token_symbol,
        return: tokenReturn,
        amount: Math.abs(amount)
      });
      walletTokens[wallet].total_amount += Math.abs(amount);
    });
  });

  // 找出"多代币钱包"（参与 >= 5 个代币）
  const multiTokenWallets = Object.entries(walletTokens)
    .filter(([addr, data]) => data.tokens.length >= 5)
    .map(([addr, data]) => ({
      address: addr,
      token_count: data.tokens.length,
      total_amount: data.total_amount,
      avg_return: data.tokens.reduce((sum, t) => sum + t.return, 0) / data.tokens.length,
      tokens: data.tokens
    }))
    .sort((a, b) => b.avg_return - a.avg_return);

  console.log(`参与 >= 5 个代币的钱包: ${multiTokenWallets.length}\n`);

  // 分析这些钱包的特征
  console.log('多代币钱包的特征:\n');

  const topMultiTokenWallets = multiTokenWallets.slice(0, 20);

  topMultiTokenWallets.forEach((wallet, i) => {
    const highCount = wallet.tokens.filter(t => t.return >= 100).length;
    console.log(`${i + 1}. ${wallet.address.slice(0, 10)}...`);
    console.log(`   参与: ${wallet.token_count} 个代币`);
    console.log(`   总金额: $${wallet.total_amount.toFixed(0)}`);
    console.log(`   平均涨幅: ${wallet.avg_return.toFixed(1)}%`);
    console.log(`   高涨幅代币: ${highCount} 个 (${(highCount / wallet.token_count * 100).toFixed(1)}%)`);
    console.log('');
  });

  // 分析：如果两个代币共享同一个"多代币钱包"，它们的涨幅是否相似？
  console.log('共现钱包的涨幅相关性:\n');

  const tokenCooccurrence = {}; // token1 -> { token2 -> shared_wallets_count }

  sequences.forEach(seq => {
    tokenCooccurrence[seq.token_address] = {};

    seq.sequence.forEach(([wallet]) => {
      if (!walletTokens[wallet] || walletTokens[wallet].tokens.length < 5) return;

      walletTokens[wallet].tokens.forEach(otherToken => {
        if (otherToken.symbol === seq.token_symbol) return;

        if (!tokenCooccurrence[seq.token_address][otherToken.symbol]) {
          tokenCooccurrence[seq.token_address][otherToken.symbol] = new Set();
        }
        tokenCooccurrence[seq.token_address][otherToken.symbol].add(wallet);
      });
    });
  });

  // 计算共现代币的涨幅相关性
  const correlations = [];

  Object.entries(tokenCooccurrence).forEach(([token1, tokens1]) => {
    Object.entries(tokens1).forEach(([token2, wallets]) => {
      if (wallets.size < 2) return; // 至少共享2个钱包

      // 找到这两个代币的涨幅
      const t1 = sequences.find(s => s.token_address === token1);
      const t2 = sequences.find(s => s.token_symbol === token2);

      if (t1 && t2) {
        correlations.push({
          token1: t1.token_symbol,
          token2: token2,
          change1: t1.max_change_percent,
          change2: t2.max_change_percent,
          shared_wallets: wallets.size
        });
      }
    });
  });

  console.log(`共现 >= 2 个多代币钱包的代币对: ${correlations.length}\n`);

  if (correlations.length > 0) {
    const changes1 = correlations.map(c => c.change1);
    const changes2 = correlations.map(c => c.change2);

    // 计算相关性
    let num = 0, denX = 0, denY = 0;
    const meanX = changes1.reduce((a, b) => a + b, 0) / changes1.length;
    const meanY = changes2.reduce((a, b) => a + b, 0) / changes2.length;

    for (let i = 0; i < changes1.length; i++) {
      const dx = changes1[i] - meanX;
      const dy = changes2[i] - meanY;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }

    const corr = num / Math.sqrt(denX * denY);
    console.log(`共现代币的涨幅相关性: ${corr.toFixed(3)}`);

    // 找出高相关性的代币对
    const highCorrPairs = correlations.filter(c => Math.abs(c.change1 - c.change2) < 50); // 涨幅差 < 50%

    console.log(`\n涨幅接近的共现代币对（涨幅差 < 50%）: ${highCorrPairs.length}\n`);

    highCorrPairs.slice(0, 10).forEach(pair => {
      console.log(`  ${pair.token1} (+${pair.change1.toFixed(1)}%) <-> ${pair.token2} (+${pair.change2.toFixed(1)}%) | 共享 ${pair.shared_wallets} 钱包`);
    });
  }
}

/**
 * 分析"两极分化"现象
 */
function polarizationAnalysis(sequences) {
  console.log('\n========================================');
  console.log('两极分化分析');
  console.log('========================================\n');

  // 按涨幅排序
  const sorted = [...sequences].sort((a, b) => b.max_change_percent - a.max_change_percent);

  // 顶部10%
  const top10 = sorted.slice(0, Math.floor(sorted.length * 0.1));
  const bottom10 = sorted.slice(-Math.floor(sorted.length * 0.1));

  // 对比顶部和底部的特征
  const avgStats = (tokens) => {
    const avgChange = tokens.reduce((sum, t) => sum + t.max_change_percent, 0) / tokens.length;
    const avgLength = tokens.reduce((sum, t) => sum + t.sequence.length, 0) / tokens.length;
    const avgWallets = tokens.reduce((sum, t) => sum + new Set(t.sequence.map(([w]) => w)).size, 0) / tokens.length;

    let totalBuy = 0, totalSell = 0;
    tokens.forEach(t => {
      t.sequence.forEach(([, amount]) => {
        if (amount > 0) totalBuy += amount;
        else totalSell += Math.abs(amount);
      });
    });

    return {
      avgChange,
      avgLength,
      avgWallets,
      avgNetFlow: (totalBuy - totalSell) / tokens.length
    };
  };

  const topStats = avgStats(top10);
  const bottomStats = avgStats(bottom10);

  console.log('顶部 10% vs 底部 10% 对比:\n');

  console.log('顶部 10%:');
  console.log(`  平均涨幅: ${topStats.avgChange.toFixed(1)}%`);
  console.log(`  平均序列长度: ${topStats.avgLength.toFixed(1)}`);
  console.log(`  平均钱包数: ${topStats.avgWallets.toFixed(1)}`);
  console.log(`  平均净流入: $${topStats.avgNetFlow.toFixed(0)}`);

  console.log('\n底部 10%:');
  console.log(`  平均涨幅: ${bottomStats.avgChange.toFixed(1)}%`);
  console.log(`  平均序列长度: ${bottomStats.avgLength.toFixed(1)}`);
  console.log(`  平均钱包数: ${bottomStats.avgWallets.toFixed(1)}`);
  console.log(`  平均净流入: $${bottomStats.avgNetFlow.toFixed(0)}`);

  // 分析"赢家通吃"现象
  console.log('\n"赢家通吃"现象分析:\n');

  // 计算基尼系数
  const allChanges = sorted.map(t => t.max_change_percent);
  const sortedChanges = [...allChanges].sort((a, b) => a - b);

  let n = sortedChanges.length;
  let gini = 0;
  for (let i = 0; i < n; i++) {
    gini += (2 * i - n + 1) * sortedChanges[i];
  }
  gini = gini / (n * sortedChanges[n - 1]);

  console.log(`涨幅基尼系数: ${gini.toFixed(3)} (0 = 完全平等, 1 = 完全不平等)`);

  // Top 1%, 5%, 10%, 25% 占据的涨幅份额
  const totalChange = allChanges.reduce((a, b) => a + b, 0);

  for (const percentile of [0.01, 0.05, 0.10, 0.25]) {
    const topN = Math.floor(sortedChanges.length * percentile);
    const topSum = sortedChanges.slice(-topN).reduce((a, b) => a + b, 0);
    console.log(`  顶部 ${(percentile * 100).toFixed(0)}% 的代币占据 ${(topSum / totalChange * 100).toFixed(1)}% 的涨幅`);
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('========================================');
  console.log('因果分析与对比研究');
  console.log('========================================\n');

  const sequences = loadSequences();
  console.log(`✓ 读取 ${sequences.length} 个代币序列\n`);

  // 1. 净流入构成分析
  netFlowCompositionAnalysis(sequences);

  // 2. 核心钱包分析
  coreWalletAnalysis(sequences);

  // 3. 两极分化分析
  polarizationAnalysis(sequences);

  console.log('\n========================================');
  console.log('✓ 分析完成!');
  console.log('========================================\n');
}

main().catch(err => {
  console.error('分析失败:', err);
  process.exit(1);
});
