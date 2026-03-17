/**
 * 基于5个种子样本，找出更多"短拉快砸"代币
 * 方法：序列形状相似度分析
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
 * 获取代币的净流入序列形状
 */
function getNetFlowShape(sequence, windows = 5) {
  const trades = sequence.sequence;
  const shape = [];

  for (let i = 0; i < windows; i++) {
    const start = i * 10;
    const end = Math.min((i + 1) * 10, trades.length);
    const window = trades.slice(start, end);
    const netFlow = window.reduce((sum, [, a]) => sum + a, 0);
    shape.push(netFlow);
  }

  return shape;
}

/**
 * 获取代币的买入占比序列形状
 */
function getBuyRatioShape(sequence, windows = 5) {
  const trades = sequence.sequence;
  const shape = [];

  for (let i = 0; i < windows; i++) {
    const start = i * 10;
    const end = Math.min((i + 1) * 10, trades.length);
    const window = trades.slice(start, end);
    const buys = window.filter(([, a]) => a > 0).length;
    const ratio = window.length > 0 ? buys / window.length : 0;
    shape.push(ratio);
  }

  return shape;
}

/**
 * 计算两个序列的相似度（使用余弦相似度）
 */
function cosineSimilarity(vec1, vec2) {
  if (vec1.length !== vec2.length) return 0;

  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }

  if (norm1 === 0 || norm2 === 0) return 0;
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

/**
 * 计算序列形状相似度（归一化后）
 */
function shapeSimilarity(shape1, shape2) {
  // 归一化到[0,1]
  const normalize = (vec) => {
    const max = Math.max(...vec.map(Math.abs));
    if (max === 0) return vec.map(() => 0);
    return vec.map(v => v / max);
  };

  const norm1 = normalize(shape1);
  const norm2 = normalize(shape2);

  return cosineSimilarity(norm1, norm2);
}

/**
 * 计算"上升后下降"模式得分
 * "短拉快砸"的核心模式：先上升，然后下降
 */
function calculateRiseAndFallScore(sequence) {
  const shape = getNetFlowShape(sequence, 5);

  // 找到峰值位置
  let maxIndex = 0;
  let maxValue = -Infinity;
  shape.forEach((v, i) => {
    if (v > maxValue) {
      maxValue = v;
      maxIndex = i;
    }
  });

  // 计算上升幅度
  const riseAmount = maxValue - shape[0];

  // 计算峰值后的下降幅度
  let fallAmount = 0;
  if (maxIndex < shape.length - 1) {
    const minValueAfterPeak = Math.min(...shape.slice(maxIndex));
    fallAmount = maxValue - minValueAfterPeak;
  }

  // 上升后下降的比例
  const fallRatio = maxValue > 0 ? fallAmount / maxValue : 0;

  // 峰值位置（越早越好，表示快速拉盘后砸盘）
  const peakPosition = maxIndex / (shape.length - 1);

  return {
    riseAmount,
    fallAmount,
    fallRatio,
    peakPosition,
    // 综合得分：快速拉盘(peakPosition小) + 大幅下降(fallRatio大)
    score: fallRatio * (1 - peakPosition * 0.5)
  };
}

/**
 * 找出与种子样本相似的代币
 */
function findSimilarDumpTokens(sequences) {
  console.log('========================================');
  console.log('基于种子样本查找更多"短拉快砸"代币');
  console.log('========================================\n');

  // 种子样本
  const seedAddresses = [
    '0x8c647898fef0ac142db4c20135abdc125de94444', // Trump
    '0x8f879a49d193fe67dc5bf2d4fe3039dd92434444', // 打工圣体
    '0xb249a5e86d95d62cfdb2344fcebf7c99250c4444', // 再不吃就老了
    '0xee162f9f8c7695940cbc62a73006aeb4b0284444', // Duck you
    '0xd583de96dd227184f7abc2a33ebc6cbead044444'  // simulation
  ];

  const seeds = sequences.filter(s => seedAddresses.includes(s.token_address));

  console.log(`【种子样本分析】(${seeds.length}个)\n`);

  seeds.forEach(seed => {
    const shape = getNetFlowShape(seed, 5);
    const buyRatioShape = getBuyRatioShape(seed, 5);
    const score = calculateRiseAndFallScore(seed);

    console.log(`${seed.token_symbol} (+${seed.max_change_percent.toFixed(1)}%):`);
    console.log(`  净流入形状: [${shape.map(v => `$${v.toFixed(0)}`).join(', ')}]`);
    console.log(`  买入占比: [${buyRatioShape.map(v => `${(v * 100).toFixed(0)}%`).join(', ')}]`);
    console.log(`  上升后下降得分: ${score.score.toFixed(3)} (上升$${score.riseAmount.toFixed(0)}, 下降$${score.fallAmount.toFixed(0)}, 比例${(score.fallRatio * 100).toFixed(1)}%, 峰值位置${(score.peakPosition * 100).toFixed(0)}%)`);
    console.log('');
  });

  // 计算种子样本的平均模式
  const avgSeedShape = [];
  const avgSeedBuyRatio = [];
  for (let i = 0; i < 5; i++) {
    const sumFlow = seeds.reduce((sum, s) => sum + getNetFlowShape(s, 5)[i], 0);
    const sumBuy = seeds.reduce((sum, s) => sum + getBuyRatioShape(s, 5)[i], 0);
    avgSeedShape.push(sumFlow / seeds.length);
    avgSeedBuyRatio.push(sumBuy / seeds.length);
  }

  console.log(`【种子样本平均模式】`);
  console.log(`  净流入: [${avgSeedShape.map(v => `$${v.toFixed(0)}`).join(', ')}]`);
  console.log(`  买入占比: [${avgSeedBuyRatio.map(v => `${(v * 100).toFixed(0)}%`).join(', ')}]`);
  console.log('');

  // 方法1：基于序列形状相似度
  console.log('【方法1：序列形状相似度】\n');

  const shapeSimilarities = sequences
    .filter(s => !seedAddresses.includes(s.token_address))
    .map(seq => {
      const shape = getNetFlowShape(seq, 5);
      const buyRatioShape = getBuyRatioShape(seq, 5);
      const flowSim = shapeSimilarity(avgSeedShape, shape);
      const buySim = shapeSimilarity(avgSeedBuyRatio, buyRatioShape);
      const combinedSim = flowSim * 0.7 + buySim * 0.3;

      return {
        ...seq,
        shape,
        buyRatioShape,
        flowSim,
        buySim,
        combinedSim
      };
    })
    .sort((a, b) => b.combinedSim - a.combinedSim);

  console.log('与种子样本最相似的代币（Top 30）:');
  console.log('代币 | 涨幅 | 净流入序列 | 相似度');
  console.log('-----|------|-----------|--------');

  shapeSimilarities.slice(0, 30).forEach(s => {
    console.log(`${s.token_symbol} | +${s.max_change_percent.toFixed(1)}% | [${s.shape.map(v => v.toFixed(0)).join(', ')}] | ${s.combinedSim.toFixed(3)}`);
  });

  // 方法2：基于"上升后下降"模式得分
  console.log('\n【方法2："上升后下降"模式分析】\n');

  const riseAndFallScores = sequences
    .filter(s => !seedAddresses.includes(s.token_address))
    .map(seq => {
      const score = calculateRiseAndFallScore(seq);
      return {
        ...seq,
        ...score
      };
    })
    .filter(s => s.fallRatio > 0.3 && s.riseAmount > 100) // 过滤条件：有明显上升和下降
    .sort((a, b) => b.score - a.score);

  console.log('具有"先升后降"模式的代币（Top 30）:');
  console.log('代币 | 涨幅 | 上升$ | 下降$ | 下降比例 | 峰值位置 | 得分');
  console.log('-----|------|-------|-------|----------|----------|------');

  riseAndFallScores.slice(0, 30).forEach(s => {
    console.log(`${s.token_symbol} | +${s.max_change_percent.toFixed(1)}% | $${s.riseAmount.toFixed(0)} | $${s.fallAmount.toFixed(0)} | ${(s.fallRatio * 100).toFixed(1)}% | ${(s.peakPosition * 100).toFixed(0)}% | ${s.score.toFixed(3)}`);
  });

  // 方法3：综合两种方法
  console.log('\n【方法3：综合分析（相似度 + 上升下降模式）】\n');

  // 标准化得分
  const maxSim = Math.max(...shapeSimilarities.map(s => s.combinedSim));
  const maxScore = Math.max(...riseAndFallScores.map(s => s.score));

  const combinedRankings = sequences
    .filter(s => !seedAddresses.includes(s.token_address))
    .map(seq => {
      const simData = shapeSimilarities.find(s => s.token_address === seq.token_address);
      const scoreData = riseAndFallScores.find(s => s.token_address === seq.token_address);

      const normSim = simData ? simData.combinedSim / maxSim : 0;
      const normScore = scoreData ? scoreData.score / maxScore : 0;

      // 综合得分：相似度40% + 上升下降模式60%
      const combinedScore = normSim * 0.4 + normScore * 0.6;

      return {
        ...seq,
        normSim,
        normScore,
        combinedScore,
        shape: simData?.shape || getNetFlowShape(seq, 5),
        fallRatio: scoreData?.fallRatio || 0,
        riseAmount: scoreData?.riseAmount || 0
      };
    })
    .filter(s => s.combinedScore > 0.3) // 过滤低分
    .sort((a, b) => b.combinedScore - a.combinedScore);

  console.log('最可能"短拉快砸"的代币（Top 50）:');
  console.log('代币 | 涨幅 | 综合得分 | 相似度 | 模式得分 | 净流入序列 | 下降比例');
  console.log('-----|------|----------|--------|----------|-----------|----------');

  combinedRankings.slice(0, 50).forEach((s, i) => {
    console.log(`${i + 1}. ${s.token_symbol} | +${s.max_change_percent.toFixed(1)}% | ${s.combinedScore.toFixed(3)} | ${s.normSim.toFixed(3)} | ${s.normScore.toFixed(3)} | [${s.shape.map(v => v.toFixed(0)).join(', ')}] | ${(s.fallRatio * 100).toFixed(1)}%`);
  });

  // 统计分析
  console.log('\n【统计分析】\n');

  const top50 = combinedRankings.slice(0, 50);
  const top100 = combinedRankings.slice(0, 100);

  const avgChangeTop50 = top50.reduce((sum, s) => sum + s.max_change_percent, 0) / top50.length;
  const avgChangeTop100 = top100.reduce((sum, s) => sum + s.max_change_percent, 0) / top100.length;
  const avgChangeAll = sequences.reduce((sum, s) => sum + s.max_change_percent, 0) / sequences.length;

  console.log(`平均涨幅:`);
  console.log(`  Top 50候选: ${avgChangeTop50.toFixed(1)}%`);
  console.log(`  Top 100候选: ${avgChangeTop100.toFixed(1)}%`);
  console.log(`  全部代币: ${avgChangeAll.toFixed(1)}%`);

  const highReturnTop50 = top50.filter(s => s.max_change_percent >= 100).length;
  const highReturnTop100 = top100.filter(s => s.max_change_percent >= 100).length;
  const highReturnAll = sequences.filter(s => s.max_change_percent >= 100).length;

  console.log(`\n高涨幅占比 (≥100%):`);
  console.log(`  Top 50候选: ${highReturnTop50}/50 (${(highReturnTop50 / 50 * 100).toFixed(1)}%)`);
  console.log(`  Top 100候选: ${highReturnTop100}/100 (${(highReturnTop100 / 100 * 100).toFixed(1)}%)`);
  console.log(`  全部代币: ${highReturnAll}/${sequences.length} (${(highReturnAll / sequences.length * 100).toFixed(1)}%)`);

  // 导出候选列表
  const candidates = combinedRankings.slice(0, 100).map(s => ({
    rank: combinedRankings.indexOf(s) + 1,
    symbol: s.token_symbol,
    address: s.token_address,
    change: s.max_change_percent,
    combinedScore: s.combinedScore,
    netFlowShape: s.shape,
    fallRatio: s.fallRatio
  }));

  const outputPath = path.join(__dirname, 'data', 'outputs', 'dump_token_candidates.json');
  fs.writeFileSync(outputPath, JSON.stringify(candidates, null, 2));
  console.log(`\n✓ 候选列表已导出到: ${outputPath}`);

  return { candidates, combinedRankings };
}

async function main() {
  console.log('========================================');
  console.log('基于种子样本查找更多"短拉快砸"代币');
  console.log('========================================\n');

  const sequences = loadSequences();
  console.log(`✓ 读取 ${sequences.length} 个代币序列\n`);

  const { candidates, combinedRankings } = findSimilarDumpTokens(sequences);

  console.log('\n========================================');
  console.log('下一步建议');
  console.log('========================================\n');

  console.log('请查看Top 50候选代币，确认：');
  console.log('1. 这些代币是否真的是"短拉快砸"？');
  console.log('2. 如果发现误判，请告诉我哪些不是');
  console.log('3. 如果发现漏掉的，请提供地址以便优化算法');
  console.log('');
  console.log('这样我可以迭代优化检测模型，提高准确率。');
}

main().catch(err => {
  console.error('失败:', err);
  process.exit(1);
});
