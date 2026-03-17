/**
 * 验证高PageRank钱包参与的代币表现
 * 使用修正后的加权PageRank重新分析
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data', 'raw');
const OUTPUT_DIR = path.join(__dirname, 'data', 'outputs');

/**
 * 加载数据
 */
function loadData() {
  // 加载原始数据（包含价格）
  const rawFiles = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(DATA_DIR, f));

  const rawData = [];
  const priceMap = new Map();

  for (const file of rawFiles) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const data = JSON.parse(content);
      if (data.tokens) {
        data.tokens.forEach(token => {
          rawData.push(token);
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
      }
    } catch (e) {
      // 忽略错误
    }
  }

  // 加载序列数据
  const sequencesPath = path.join(__dirname, 'data', 'processed', 'all_sequences.json');
  const content = fs.readFileSync(sequencesPath, 'utf-8');
  const seqData = JSON.parse(content);

  // 合并价格信息
  const sequences = seqData.sequences.map(seq => ({
    ...seq,
    price_info: priceMap.get(seq.token_address) || {
      launch_price: 0,
      current_price_usd: 0,
      total_supply: 1e9
    }
  }));

  return { sequences, priceMap };
}

/**
 * 计算份额加权的PageRank（简化版）
 */
function calculateShareWeightedPageRank(sequences) {
  // 构建钱包->代币图（包含份额信息）
  const walletTokens = new Map(); // wallet -> Map<token_addr, share_amount>

  sequences.forEach(seq => {
    const price = seq.price_info.current_price_usd;
    const supply = seq.price_info.total_supply;

    seq.sequence.forEach(([wallet, usdAmount]) => {
      if (!walletTokens.has(wallet)) {
        walletTokens.set(wallet, new Map());
      }

      const shareAmount = price > 0 ? usdAmount / price : 0;
      const existing = walletTokens.get(wallet).get(seq.token_address) || 0;
      walletTokens.get(wallet).set(seq.token_address, existing + shareAmount);
    });
  });

  // 计算每个钱包的"份额影响力分数"
  const walletScores = [];

  walletTokens.forEach((tokens, wallet) => {
    let score = 0;

    tokens.forEach((shareAmount, tokenAddr) => {
      // 找到该代币的价格和供应量
      const token = sequences.find(s => s.token_address === tokenAddr);
      if (token) {
        const price = token.price_info.current_price_usd;
        const supply = token.price_info.total_supply;

        // 份额占供应量的比例
        const shareRatio = supply > 0 ? shareAmount / supply : 0;

        // 放大系数：控制份额越大，影响力越大
        const amplification = 1 + shareRatio * 1000;

        score += shareRatio * amplification;
      }
    });

    walletScores.push({
      address: wallet,
      score,
      token_count: tokens.size
    });
  });

  // 按分数排序
  return walletScores.sort((a, b) => b.score - a.score);
}

/**
 * 分析高PageRank钱包参与的代币表现
 */
function analyzeHighPagerankWalletPerformance(sequences, walletScores) {
  console.log('========================================');
  console.log('高PageRank钱包参与的代币表现分析');
  console.log('========================================\n');

  // 定义高PageRank钱包（不同阈值）
  const thresholds = [1, 5, 10, 20]; // 百分比

  thresholds.forEach(threshold => {
    const topN = Math.floor(walletScores.length * threshold / 100);
    const topWallets = walletScores.slice(0, topN);
    const topWalletSet = new Set(topWallets.map(w => w.address));

    console.log(`【Top ${threshold}% 钱包 (${topN}个)】\n`);

    // 分析这些钱包参与的代币
    const tokenOverlap = [];
    const otherTokens = [];

    sequences.forEach(token => {
      const tokenWallets = new Set(token.sequence.map(([w]) => w));
      const overlap = Array.from(tokenWallets).filter(w => topWalletSet.has(w));

      if (overlap.length > 0) {
        tokenOverlap.push({
          symbol: token.token_symbol,
          change: token.max_change_percent,
          overlap_count: overlap.length,
          overlap_ratio: overlap.length / tokenWallets.size,
          total_wallets: tokenWallets.size
        });
      } else {
        otherTokens.push({
          symbol: token.token_symbol,
          change: token.max_change_percent
        });
      }
    });

    // 统计
    const avgChangeWith = tokenOverlap.reduce((sum, t) => sum + t.change, 0) / tokenOverlap.length;
    const avgChangeWithout = otherTokens.reduce((sum, t) => sum + t.change, 0) / otherTokens.length;
    const highReturnWith = tokenOverlap.filter(t => t.change >= 100).length / tokenOverlap.length;
    const highReturnWithout = otherTokens.filter(t => t.change >= 100).length / otherTokens.length;

    console.log(`包含高PageRank钱包的代币 (${tokenOverlap.length}个):`);
    console.log(`  平均涨幅: ${avgChangeWith.toFixed(1)}%`);
    console.log(`  高涨幅占比: ${(highReturnWith * 100).toFixed(1)}%`);

    console.log(`\n不包含高PageRank钱包的代币 (${otherTokens.length}个):`);
    console.log(`  平均涨幅: ${avgChangeWithout.toFixed(1)}%`);
    console.log(`  高涨幅占比: ${(highReturnWithout * 100).toFixed(1)}%`);

    const diff = avgChangeWith - avgChangeWithout;
    const diffSign = diff > 0 ? '+' : '';
    console.log(`\n差异: ${diffSign}${diff.toFixed(1)}%`);

    // 按重叠度分组分析
    console.log(`\n按重叠度分析:`);

    const overlapGroups = [
      { name: '高重叠 (≥20%)', min: 0.2 },
      { name: '中重叠 (5-20%)', min: 0.05, max: 0.2 },
      { name: '低重叠 (<5%)', min: 0, max: 0.05 }
    ];

    overlapGroups.forEach(group => {
      const groupTokens = tokenOverlap.filter(t => {
        if (group.max !== undefined) {
          return t.overlap_ratio >= group.min && t.overlap_ratio < group.max;
        }
        return t.overlap_ratio >= group.min;
      });

      if (groupTokens.length === 0) return;

      const avgChange = groupTokens.reduce((sum, t) => sum + t.change, 0) / groupTokens.length;
      const highReturnRate = groupTokens.filter(t => t.change >= 100).length / groupTokens.length;

      console.log(`  ${group.name}: ${groupTokens.length}个代币, 平均涨幅${avgChange.toFixed(1)}%, 高涨幅占比${(highReturnRate * 100).toFixed(1)}%`);
    });

    console.log('');
  });
}

/**
 * 对比无权重vs加权PageRank的差异
 */
function compareWeightedVsUnweighted(sequences) {
  console.log('\n========================================');
  console.log('无权重 vs 份额加权 PageRank 对比');
  console.log('========================================\n');

  // 无权重：只看参与代币数量
  const walletTokenCount = new Map();
  sequences.forEach(seq => {
    seq.sequence.forEach(([wallet]) => {
      walletTokenCount.set(wallet, (walletTokenCount.get(wallet) || 0) + 1);
    });
  });

  const unweightedRankings = Array.from(walletTokenCount.entries())
    .map(([addr, count]) => ({ address: addr, count }))
    .sort((a, b) => b.count - a.count);

  // 份额加权：考虑份额占比
  const weightedRankings = calculateShareWeightedPageRank(sequences);

  // 找出Top 10%钱包
  const top10Percent = Math.floor(unweightedRankings.length * 0.1);

  const unweightedTop = new Set(unweightedRankings.slice(0, top10Percent).map(w => w.address));
  const weightedTop = new Set(weightedRankings.slice(0, top10Percent).map(w => w.address));

  // 交集
  const intersection = Array.from(unweightedTop).filter(addr => weightedTop.has(addr));
  const onlyUnweighted = Array.from(unweightedTop).filter(addr => !weightedTop.has(addr));
  const onlyWeighted = Array.from(weightedTop).filter(addr => !unweightedTop.has(addr));

  console.log(`Top 10% 钱包数: ${top10Percent}\n`);
  console.log(`同时在两个版本中: ${intersection.length}个`);
  console.log(`只在无权重中: ${onlyUnweighted.length}个`);
  console.log(`只在加权中: ${onlyWeighted.length}个\n`);

  // 分析只在加权Top 10%的钱包特征
  if (onlyWeighted.length > 0) {
    console.log('【只在份额加权Top 10%的钱包特征】\n');

    const walletTokenData = new Map();
    sequences.forEach(seq => {
      const price = seq.price_info.current_price_usd;
      const supply = seq.price_info.total_supply;

      seq.sequence.forEach(([wallet, usdAmount]) => {
        if (!onlyWeighted.includes(wallet)) return;

        if (!walletTokenData.has(wallet)) {
          walletTokenData.set(wallet, {
            tokens: [],
            total_usd: 0,
            total_shares: 0
          });
        }

        const shareAmount = price > 0 ? usdAmount / price : 0;
        const data = walletTokenData.get(wallet);
        data.tokens.push({
          symbol: seq.token_symbol,
          usd: usdAmount,
          shares: shareAmount,
          share_ratio: supply > 0 ? shareAmount / supply : 0,
          price: price
        });
        data.total_usd += Math.abs(usdAmount);
        data.total_shares += shareAmount;
      });
    });

    onlyWeighted.slice(0, 10).forEach(wallet => {
      const data = walletTokenData.get(wallet);
      if (!data) return;

      // 计算平均价格
      const avgPrice = data.tokens.reduce((sum, t) => sum + t.price, 0) / data.tokens.length;
      const maxShareRatio = Math.max(...data.tokens.map(t => t.share_ratio));

      console.log(`${wallet.slice(0, 12)}...:`);
      console.log(`  参与代币: ${data.tokens.length}个`);
      console.log(`  总美元: $${data.total_usd.toFixed(0)}`);
      console.log(`  平均价格: $${avgPrice.toFixed(6)}`);
      console.log(`  最大份额占比: ${(maxShareRatio * 100).toFixed(4)}%`);
      console.log('');
    });
  }
}

async function main() {
  console.log('========================================');
  console.log('验证高PageRank钱包的代币表现');
  console.log('========================================\n');

  const { sequences } = loadData();
  console.log(`✓ 加载 ${sequences.length} 个代币序列\n`);

  // 计算份额加权PageRank
  const walletScores = calculateShareWeightedPageRank(sequences);

  // 分析高PageRank钱包参与的代币表现
  analyzeHighPagerankWalletPerformance(sequences, walletScores);

  // 对比无权重vs加权
  compareWeightedVsUnweighted(sequences);

  console.log('========================================');
  console.log('分析完成!');
  console.log('========================================\n');
}

main().catch(err => {
  console.error('失败:', err);
  process.exit(1);
});
