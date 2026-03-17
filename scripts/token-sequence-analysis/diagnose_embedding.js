/**
 * 诊断脚本 - 检查数据分布和矩阵构建问题
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data', 'processed');

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
 * 诊断数据分布
 */
function diagnoseData(sequences) {
  console.log('========================================');
  console.log('数据分布诊断');
  console.log('========================================\n');

  // 1. 基本统计
  console.log('【基本统计】');
  console.log(`总代币数: ${sequences.length}`);

  const totalTrades = sequences.reduce((sum, s) => sum + s.sequence.length, 0);
  console.log(`总交易数: ${totalTrades}`);
  console.log(`平均每代币交易数: ${(totalTrades / sequences.length).toFixed(1)}\n`);

  // 2. 钱包分布
  const walletTokenCount = {}; // 钱包 -> 参与的代币数
  const walletTradeCount = {}; // 钱包 -> 总交易数

  sequences.forEach(seq => {
    const uniqueWallets = new Set();
    seq.sequence.forEach(([wallet, amount]) => {
      uniqueWallets.add(wallet);
      if (!walletTradeCount[wallet]) walletTradeCount[wallet] = 0;
      walletTradeCount[wallet]++;
    });
    uniqueWallets.forEach(wallet => {
      if (!walletTokenCount[wallet]) walletTokenCount[wallet] = 0;
      walletTokenCount[wallet]++;
    });
  });

  const uniqueWallets = Object.keys(walletTokenCount);
  console.log('【钱包分布】');
  console.log(`唯一钱包数: ${uniqueWallets.length}`);

  // 统计钱包参与的代币数分布
  const tokenCountDistribution = {};
  Object.values(walletTokenCount).forEach(count => {
    const bucket = count === 1 ? '1' : count === 2 ? '2' : count <= 5 ? '3-5' : count <= 10 ? '6-10' : '>10';
    tokenCountDistribution[bucket] = (tokenCountDistribution[bucket] || 0) + 1;
  });

  console.log('钱包参与代币数分布:');
  Object.entries(tokenCountDistribution)
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .forEach(([bucket, count]) => {
      console.log(`  ${bucket} 代币: ${count} 钱包 (${(count / uniqueWallets.length * 100).toFixed(1)}%)`);
    });

  // 3. 钱包交易活跃度
  const tradeBuckets = { '1': 0, '2-5': 0, '6-10': 0, '11-50': 0, '>50': 0 };
  Object.values(walletTradeCount).forEach(count => {
    if (count === 1) tradeBuckets['1']++;
    else if (count <= 5) tradeBuckets['2-5']++;
    else if (count <= 10) tradeBuckets['6-10']++;
    else if (count <= 50) tradeBuckets['11-50']++;
    else tradeBuckets['>50']++;
  });

  console.log('\n钱包交易活跃度:');
  Object.entries(tradeBuckets).forEach(([bucket, count]) => {
    console.log(`  ${bucket} 笔交易: ${count} 钱包 (${(count / uniqueWallets.length * 100).toFixed(1)}%)`);
  });

  // 4. 高涨幅代币分析
  console.log('\n【高涨幅代币分析】');

  const sortedByChange = [...sequences].sort((a, b) => b.max_change_percent - a.max_change_percent);

  console.log('\n涨幅前10的代币:');
  sortedByChange.slice(0, 10).forEach((s, i) => {
    const uniqueWallets = new Set(s.sequence.map(([w]) => w));
    console.log(`  ${i + 1}. ${s.token_symbol}: +${s.max_change_percent.toFixed(1)}% | 序列长度: ${s.sequence.length} | 唯一钱包: ${uniqueWallets.size}`);
  });

  console.log('\n涨幅后10的代币:');
  sortedByChange.slice(-10).reverse().forEach((s, i) => {
    const uniqueWallets = new Set(s.sequence.map(([w]) => w));
    console.log(`  ${i + 1}. ${s.token_symbol}: +${s.max_change_percent.toFixed(1)}% | 序列长度: ${s.sequence.length} | 唯一钱包: ${uniqueWallets.size}`);
  });

  // 5. 钱包重叠分析
  console.log('\n【钱包重叠分析】');

  // 高涨幅代币的钱包集合
  const topTokens = sortedByChange.slice(0, 10);
  const topWallets = new Set();
  topTokens.forEach(s => s.sequence.forEach(([w]) => topWallets.add(w)));

  // 低涨幅代币的钱包集合
  const bottomTokens = sortedByChange.slice(-10);
  const bottomWallets = new Set();
  bottomTokens.forEach(s => s.sequence.forEach(([w]) => bottomWallets.add(w)));

  const overlap = new Set([...topWallets].filter(w => bottomWallets.has(w)));
  console.log(`高涨幅前10代币的唯一钱包数: ${topWallets.size}`);
  console.log(`低涨幅后10代币的唯一钱包数: ${bottomWallets.size}`);
  console.log(`钱包重叠数: ${overlap.size}`);
  console.log(`重叠率: ${(overlap.size / Math.min(topWallets.size, bottomWallets.size) * 100).toFixed(1)}%`);

  // 6. 矩阵稀疏度
  console.log('\n【矩阵稀疏度】');
  const matrixSize = uniqueWallets.length * sequences.length;
  const nonZero = totalTrades; // 每个交易是一个非零元素
  console.log(`矩阵大小: ${uniqueWallets.length} × ${sequences.length} = ${matrixSize}`);
  console.log(`非零元素: ${nonZero}`);
  console.log(`稀疏度: ${((1 - nonZero / matrixSize) * 100).toFixed(2)}%`);

  // 7. 代币特征相关性分析
  console.log('\n【代币特征相关性】');

  const features = sequences.map(s => {
    const uniqueWallets = new Set(s.sequence.map(([w]) => w));
    const totalBuy = s.sequence.reduce((sum, [, a]) => a > 0 ? sum + a : sum, 0);
    const totalSell = s.sequence.reduce((sum, [, a]) => a < 0 ? sum + Math.abs(a) : sum, 0);
    return {
      symbol: s.token_symbol,
      change: s.max_change_percent,
      seqLength: s.sequence.length,
      uniqueWallets: uniqueWallets.size,
      totalBuy,
      totalSell,
      netFlow: totalBuy - totalSell
    };
  });

  // 计算相关系数
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

  const changes = features.map(f => f.change);
  const seqLengths = features.map(f => f.seqLength);
  const walletCounts = features.map(f => f.uniqueWallets);
  const netFlows = features.map(f => f.netFlow);

  console.log('涨幅与各特征的相关系数:');
  console.log(`  序列长度: ${correlation(changes, seqLengths).toFixed(3)}`);
  console.log(`  唯一钱包数: ${correlation(changes, walletCounts).toFixed(3)}`);
  console.log(`  净流入: ${correlation(changes, netFlows).toFixed(3)}`);

  // 8. 检查相似代币的钱包重叠
  console.log('\n【相似代币钱包重叠检查】');
  console.log('检查涨幅最高的代币与其"相似"代币的钱包重叠率:');

  const tokenWalletMap = {};
  sequences.forEach(s => {
    const wallets = new Set(s.sequence.map(([w]) => w));
    tokenWalletMap[s.token_address] = wallets;
  });

  // Fight 和它的"相似"代币
  const fight = sequences.find(s => s.token_symbol === 'Fight' && s.max_change_percent > 10000);
  if (fight) {
    const fightWallets = tokenWalletMap[fight.token_address];
    console.log(`\nFight (+${fight.max_change_percent.toFixed(1)}%) - ${fightWallets.size} 钱包`);

    // 找几个其他代币比较
    const compareTokens = [
      sequences.find(s => s.token_symbol === 'MOONDOGE'),
      sequences.find(s => s.token_symbol === 'Memehouse'),
      sequences.find(s => s.token_symbol === '一币安天下')
    ].filter(Boolean);

    compareTokens.forEach(token => {
      const tokenWallets = tokenWalletMap[token.token_address];
      const overlap = new Set([...fightWallets].filter(w => tokenWallets.has(w)));
      const overlapRate = overlap.size / fightWallets.size * 100;
      console.log(`  vs ${token.token_symbol} (+${token.max_change_percent.toFixed(1)}%): ${overlap.size}/${fightWallets.size} 钱包重叠 (${overlapRate.toFixed(1)}%)`);
    });

    // 找几个低涨幅代币比较
    console.log('\n vs 低涨幅代币:');
    const lowChangeTokens = sequences
      .filter(s => s.max_change_percent < 100)
      .slice(0, 3);

    lowChangeTokens.forEach(token => {
      const tokenWallets = tokenWalletMap[token.token_address];
      const overlap = new Set([...fightWallets].filter(w => tokenWallets.has(w)));
      const overlapRate = overlap.size / Math.min(fightWallets.size, tokenWallets.size) * 100;
      console.log(`  vs ${token.token_symbol} (+${token.max_change_percent.toFixed(1)}%): ${overlap.size}/${Math.min(fightWallets.size, tokenWallets.size)} 共同钱包 (${overlapRate.toFixed(1)}%)`);
    });
  }

  return {
    uniqueWallets: uniqueWallets.length,
    walletTokenCount,
    walletTradeCount
  };
}

/**
 * 主函数
 */
async function main() {
  console.log('========================================');
  console.log('嵌入分析诊断');
  console.log('========================================\n');

  const sequences = loadSequences();
  console.log(`✓ 读取 ${sequences.length} 个代币序列\n`);

  const stats = diagnoseData(sequences);

  console.log('\n========================================');
  console.log('诊断结论');
  console.log('========================================\n');

  console.log('主要问题:');
  const singleTokenWallets = Object.values(stats.walletTokenCount).filter(c => c === 1).length;
  console.log(`1. ${singleTokenWallets} 个钱包 (${(singleTokenWallets / stats.uniqueWallets.length * 100).toFixed(1)}%) 只在 1 个代币交易`);
  console.log('   → 这些钱包的向量只反映单个代币，无法捕获共性');

  const lowActivityWallets = Object.values(stats.walletTradeCount).filter(c => c <= 5).length;
  console.log(`2. ${lowActivityWallets} 个钱包 (${(lowActivityWallets / stats.uniqueWallets.length * 100).toFixed(1)}%) 交易次数 <= 5`);
  console.log('   → 数据稀疏，矩阵分解效果差');

  console.log('\n建议改进方向:');
  console.log('1. 过滤掉低频钱包（只保留交易次数 >= N 的钱包）');
  console.log('2. 使用 TF-IDF 加权，降低常见钱包的权重');
  console.log('3. 使用"钱包对"共现而非钱包-代币矩阵');
  console.log('4. 添加序列特征（交易顺序、时间间隔等）');
  console.log('5. 考虑使用 Node2Vec 等图嵌入方法');
}

// 运行
main().catch(err => {
  console.error('诊断失败:', err);
  process.exit(1);
});
