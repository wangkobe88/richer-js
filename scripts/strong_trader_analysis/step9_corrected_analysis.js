/**
 * Step 9: Quality Prediction Analysis (Corrected)
 * Compare TWO metrics:
 * 1. Total Buy Ratio = 总买入量 / 总供应量
 * 2. Net Buy Ratio = (买入量 - 卖出量) / 总供应量
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const TOTAL_SUPPLY = 1000000000; // 1 billion

async function main() {
  console.log('=== Step 9: Quality Prediction Analysis (Corrected) ===\n');
  console.log('Comparing TWO metrics:\n');
  console.log('  1. Total Buy Ratio = 总买入量 / 总供应量');
  console.log('  2. Net Buy Ratio = (买入量 - 卖出量) / 总供应量\n');

  // Read data
  const purchaseData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'step8_strong_trader_purchase_analysis.json'), 'utf8'));
  const tokens = purchaseData.token_stats.filter(t => t.strong_trader_buy_amount > 0 || t.strong_trader_sell_amount > 0);

  console.log(`Analyzing ${tokens.length} tokens with strong trader activity\n`);

  // Prepare data
  const analysisData = tokens.map(t => ({
    token_symbol: t.token_symbol,
    quality: t.quality_label,
    quality_score: getQualityScore(t.quality_label),
    // 指标1: 总买入比例
    total_buy_ratio: (t.strong_trader_buy_amount || 0) / TOTAL_SUPPLY * 100,
    // 指标2: 净买入比例 (当前用的)
    net_buy_ratio: t.pct_of_total_supply || 0,
    // 原始数据
    buy_amount: t.strong_trader_buy_amount || 0,
    sell_amount: t.strong_trader_sell_amount || 0,
    net_amount: t.strong_trader_net_amount || 0,
    buy_usd: t.strong_trader_buy_usd || 0,
    sell_usd: t.strong_trader_sell_usd || 0,
    net_usd: t.strong_trader_net_usd || 0,
    wallet_count: t.strong_trader_wallet_count || 0,
    trade_count: t.strong_trader_trade_count || 0
  }));

  console.log('============================================================');
  console.log('[1] Top 30 by TOTAL BUY Ratio (总买入比例)');
  console.log('============================================================\n');

  const topByTotalBuy = [...analysisData].sort((a, b) => b.total_buy_ratio - a.total_buy_ratio).slice(0, 30);

  console.log('Rank'.padEnd(5) + 'Token'.padEnd(20) + 'Quality'.padEnd(15) + 'TotalBuy%'.padEnd(12) + 'NetBuy%');
  console.log('-'.repeat(65));

  const qualityCountTotalBuy = { high_quality: 0, mid_quality: 0, low_quality: 0, unlabeled: 0 };

  topByTotalBuy.forEach((t, i) => {
    console.log(
      (i + 1).toString().padEnd(5) +
      t.token_symbol.padEnd(20) +
      t.quality.padEnd(15) +
      t.total_buy_ratio.toFixed(2) + '%'.padEnd(12) +
      t.net_buy_ratio.toFixed(2) + '%'
    );
    qualityCountTotalBuy[t.quality]++;
  });

  console.log('\nQuality distribution in Top 30 (by Total Buy):');
  console.log(`  High quality: ${qualityCountTotalBuy.high_quality}`);
  console.log(`  Mid quality: ${qualityCountTotalBuy.mid_quality}`);
  console.log(`  Low quality: ${qualityCountTotalBuy.low_quality}`);

  console.log('\n============================================================');
  console.log('[2] Top 30 by NET BUY Ratio (净买入比例)');
  console.log('============================================================\n');

  const topByNetBuy = [...analysisData].sort((a, b) => b.net_buy_ratio - a.net_buy_ratio).slice(0, 30);

  console.log('Rank'.padEnd(5) + 'Token'.padEnd(20) + 'Quality'.padEnd(15) + 'TotalBuy%'.padEnd(12) + 'NetBuy%');
  console.log('-'.repeat(65));

  const qualityCountNetBuy = { high_quality: 0, mid_quality: 0, low_quality: 0, unlabeled: 0 };

  topByNetBuy.forEach((t, i) => {
    console.log(
      (i + 1).toString().padEnd(5) +
      t.token_symbol.padEnd(20) +
      t.quality.padEnd(15) +
      t.total_buy_ratio.toFixed(2) + '%'.padEnd(12) +
      t.net_buy_ratio.toFixed(2) + '%'
    );
    qualityCountNetBuy[t.quality]++;
  });

  console.log('\nQuality distribution in Top 30 (by Net Buy):');
  console.log(`  High quality: ${qualityCountNetBuy.high_quality}`);
  console.log(`  Mid quality: ${qualityCountNetBuy.mid_quality}`);
  console.log(`  Low quality: ${qualityCountNetBuy.low_quality}`);

  console.log('\n============================================================');
  console.log('[3] Average Ratios by Quality Group');
  console.log('============================================================\n');

  const groups = { high_quality: [], mid_quality: [], low_quality: [], unlabeled: [] };
  analysisData.forEach(t => {
    if (groups[t.quality]) groups[t.quality].push(t);
  });

  console.log('Quality'.padEnd(15) + 'Count'.padEnd(8) + 'AvgTotalBuy%'.padEnd(15) + 'AvgNetBuy%');
  console.log('-'.repeat(65));

  for (const [quality, tokens] of Object.entries(groups)) {
    if (tokens.length === 0) continue;

    const avgTotalBuy = tokens.reduce((sum, t) => sum + t.total_buy_ratio, 0) / tokens.length;
    const avgNetBuy = tokens.reduce((sum, t) => sum + t.net_buy_ratio, 0) / tokens.length;

    console.log(
      quality.padEnd(15) +
      tokens.length.toString().padEnd(8) +
      avgTotalBuy.toFixed(2) + '%'.padEnd(15) +
      avgNetBuy.toFixed(2) + '%'
    );
  }

  console.log('\n============================================================');
  console.log('[4] Correlation Analysis with Quality Score');
  console.log('============================================================\n');

  const correlationData = analysisData.filter(t => t.quality !== 'unlabeled');

  // For Total Buy Ratio
  const spearmanTotalBuy = calculateSpearman(correlationData, 'total_buy_ratio', 'quality_score');
  const pearsonTotalBuy = calculatePearson(correlationData, 'total_buy_ratio', 'quality_score');

  // For Net Buy Ratio
  const spearmanNetBuy = calculateSpearman(correlationData, 'net_buy_ratio', 'quality_score');
  const pearsonNetBuy = calculatePearson(correlationData, 'net_buy_ratio', 'quality_score');

  console.log('Metric'.padEnd(20) + 'Spearman'.padEnd(12) + 'Pearson'.padEnd(12) + 'Interpretation');
  console.log('-'.repeat(70));
  console.log('Total Buy Ratio'.padEnd(20) + spearmanTotalBuy.toFixed(4).padEnd(12) + pearsonTotalBuy.toFixed(4).padEnd(12) + interpretCorrelation(spearmanTotalBuy));
  console.log('Net Buy Ratio'.padEnd(20) + spearmanNetBuy.toFixed(4).padEnd(12) + pearsonNetBuy.toFixed(4).padEnd(12) + interpretCorrelation(spearmanNetBuy));

  console.log('\nInterpretation:');
  if (spearmanTotalBuy < -0.3) {
    console.log('  Total Buy Ratio: Negative correlation → Strong traders BUY MORE in low quality tokens');
  } else if (spearmanTotalBuy > 0.3) {
    console.log('  Total Buy Ratio: Positive correlation → Strong traders BUY MORE in high quality tokens');
  }

  if (spearmanNetBuy < -0.3) {
    console.log('  Net Buy Ratio: Negative correlation → Strong traders hold MORE net position in low quality tokens');
  } else if (spearmanNetBuy > 0.3) {
    console.log('  Net Buy Ratio: Positive correlation → Strong traders hold MORE net position in high quality tokens');
  }

  console.log('\n============================================================');
  console.log('[5] High Holdings Threshold Analysis');
  console.log('============================================================\n');

  // 分析高持仓比例（>5%）的代币质量分布
  const highTotalBuy = correlationData.filter(t => t.total_buy_ratio >= 5);
  const highNetBuy = correlationData.filter(t => t.net_buy_ratio >= 5);

  console.log('Total Buy Ratio >= 5%:');
  console.log(`  Total tokens: ${highTotalBuy.length}`);
  const highTotalBuyDist = {};
  highTotalBuy.forEach(t => {
    highTotalBuyDist[t.quality] = (highTotalBuyDist[t.quality] || 0) + 1;
  });
  Object.entries(highTotalBuyDist).sort((a, b) => b[1] - a[1]).forEach(([q, c]) => {
    console.log(`    ${q}: ${c} (${(c/highTotalBuy.length*100).toFixed(1)}%)`);
  });

  console.log('\nNet Buy Ratio >= 5%:');
  console.log(`  Total tokens: ${highNetBuy.length}`);
  const highNetBuyDist = {};
  highNetBuy.forEach(t => {
    highNetBuyDist[t.quality] = (highNetBuyDist[t.quality] || 0) + 1;
  });
  Object.entries(highNetBuyDist).sort((a, b) => b[1] - a[1]).forEach(([q, c]) => {
    console.log(`    ${q}: ${c} (${(c/highNetBuy.length*100).toFixed(1)}%)`);
  });

  console.log('\n============================================================');
  console.log('[6] Final Comparison: Which Metric Predicts Quality Better?');
  console.log('============================================================\n');

  // 计算AUC
  const aucTotalBuy = calculateAUC(correlationData, 'total_buy_ratio');
  const aucNetBuy = calculateAUC(correlationData, 'net_buy_ratio');

  console.log('AUC for distinguishing high_quality from others:');
  console.log(`  Total Buy Ratio: ${aucTotalBuy.toFixed(4)}`);
  console.log(`  Net Buy Ratio: ${aucNetBuy.toFixed(4)}`);

  console.log('\nAUC for distinguishing low_quality from others:');
  const aucTotalBuyLow = calculateAUCLow(correlationData, 'total_buy_ratio');
  const aucNetBuyLow = calculateAUCLow(correlationData, 'net_buy_ratio');
  console.log(`  Total Buy Ratio: ${aucTotalBuyLow.toFixed(4)}`);
  console.log(`  Net Buy Ratio: ${aucNetBuyLow.toFixed(4)}`);

  console.log('\n============================================================');
  console.log('[7] CONCLUSION');
  console.log('============================================================\n');

  console.log('Key finding:');
  console.log(`  Spearman(Total Buy vs Quality): ${spearmanTotalBuy.toFixed(4)}`);
  console.log(`  Spearman(Net Buy vs Quality): ${spearmanNetBuy.toFixed(4)}`);

  if (Math.abs(spearmanTotalBuy) > Math.abs(spearmanNetBuy)) {
    console.log('\n  → Total Buy Ratio has stronger correlation with quality');
    console.log('  → This means: Total BUY volume better predicts token quality');
  } else {
    console.log('\n  → Net Buy Ratio has stronger correlation with quality');
    console.log('  → This means: Net HOLDINGS position better predicts token quality');
  }

  // Save results
  const output = {
    comparison: {
      total_buy_ratio: {
        spearman: spearmanTotalBuy,
        pearson: pearsonTotalBuy,
        auc_high: aucTotalBuy,
        auc_low: aucTotalBuyLow
      },
      net_buy_ratio: {
        spearman: spearmanNetBuy,
        pearson: pearsonNetBuy,
        auc_high: aucNetBuy,
        auc_low: aucNetBuyLow
      }
    },
    top_by_total_buy: topByTotalBuy.slice(0, 30),
    top_by_net_buy: topByNetBuy.slice(0, 30),
    averages_by_quality: {
      high_quality: {
        count: groups.high_quality.length,
        avg_total_buy: groups.high_quality.reduce((s, t) => s + t.total_buy_ratio, 0) / groups.high_quality.length,
        avg_net_buy: groups.high_quality.reduce((s, t) => s + t.net_buy_ratio, 0) / groups.high_quality.length
      },
      mid_quality: {
        count: groups.mid_quality.length,
        avg_total_buy: groups.mid_quality.reduce((s, t) => s + t.total_buy_ratio, 0) / groups.mid_quality.length,
        avg_net_buy: groups.mid_quality.reduce((s, t) => s + t.net_buy_ratio, 0) / groups.mid_quality.length
      },
      low_quality: {
        count: groups.low_quality.length,
        avg_total_buy: groups.low_quality.reduce((s, t) => s + t.total_buy_ratio, 0) / groups.low_quality.length,
        avg_net_buy: groups.low_quality.reduce((s, t) => s + t.net_buy_ratio, 0) / groups.low_quality.length
      }
    }
  };

  fs.writeFileSync(
    path.join(DATA_DIR, 'step9_holdings_quality_analysis.json'),
    JSON.stringify(output, null, 2)
  );

  console.log('\nAnalysis saved to data/step9_holdings_quality_analysis.json');
}

function getQualityScore(quality) {
  const scores = { high_quality: 2, mid_quality: 1, low_quality: 0, unlabeled: 1 };
  return scores[quality] || 1;
}

function calculatePearson(data, xKey, yKey) {
  const n = data.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;

  for (const item of data) {
    const x = item[xKey];
    const y = item[yKey];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
    sumY2 += y * y;
  }

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  return denominator === 0 ? 0 : numerator / denominator;
}

function calculateSpearman(data, xKey, yKey) {
  const rankX = new Map();
  const rankY = new Map();

  const sortedX = [...data].sort((a, b) => a[xKey] - b[xKey]);
  const sortedY = [...data].sort((a, b) => a[yKey] - b[yKey]);

  sortedX.forEach((item, i) => rankX.set(item.token_symbol, i));
  sortedY.forEach((item, i) => rankY.set(item.token_symbol, i));

  let sumD2 = 0;
  for (const item of data) {
    const rx = rankX.get(item.token_symbol);
    const ry = rankY.get(item.token_symbol);
    const d = rx - ry;
    sumD2 += d * d;
  }

  const n = data.length;
  return 1 - (6 * sumD2) / (n * (n * n - 1));
}

function calculateAUC(data, key) {
  const highScores = data.filter(d => d.quality === 'high_quality').map(d => d[key]);
  const othersScores = data.filter(d => d.quality !== 'high_quality').map(d => d[key]);

  let count = 0;
  let total = 0;

  for (const high of highScores) {
    for (const other of othersScores) {
      total++;
      if (high > other) count++;
      else if (high === other) count += 0.5;
    }
  }

  return total > 0 ? count / total : 0.5;
}

function calculateAUCLow(data, key) {
  const lowScores = data.filter(d => d.quality === 'low_quality').map(d => d[key]);
  const othersScores = data.filter(d => d.quality !== 'low_quality').map(d => d[key]);

  let count = 0;
  let total = 0;

  for (const low of lowScores) {
    for (const other of othersScores) {
      total++;
      if (low > other) count++;
      else if (low === other) count += 0.5;
    }
  }

  return total > 0 ? count / total : 0.5;
}

function interpretCorrelation(r) {
  const abs = Math.abs(r);
  if (abs < 0.1) return '(very weak)';
  if (abs < 0.3) return '(weak)';
  if (abs < 0.5) return '(moderate)';
  if (abs < 0.7) return '(strong)';
  return '(very strong)';
}

main().catch(console.error);
