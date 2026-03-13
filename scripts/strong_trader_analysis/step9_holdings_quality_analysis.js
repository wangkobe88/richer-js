/**
 * Step 9: Quality Prediction Analysis (Corrected)
 * Focus on: Strong Trader Holdings % of Total Supply
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

async function main() {
  console.log('=== Step 9: Quality Prediction Analysis ===\n');
  console.log('Focus: Strong Trader Net Holdings % of Total Supply\n');

  // Read data
  const purchaseData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'step8_strong_trader_purchase_analysis.json'), 'utf8'));
  const tokens = purchaseData.token_stats.filter(t => Math.abs(t.strong_trader_net_amount) > 0);

  console.log(`Analyzing ${tokens.length} tokens with strong trader net position\n`);

  // Prepare data
  const analysisData = tokens.map(t => ({
    token_symbol: t.token_symbol,
    quality: t.quality_label,
    quality_score: getQualityScore(t.quality_label),
    // 持仓比例（这里使用绝对值，因为我们关心的是参与度）
    holdings_pct: Math.abs(t.pct_of_total_supply) || 0,
    is_long: t.strong_trader_net_amount > 0,
    net_amount: t.strong_trader_net_amount || 0,
    net_pct: t.pct_of_total_supply || 0,
    buy_usd: t.strong_trader_buy_usd || 0,
    sell_usd: t.strong_trader_sell_usd || 0,
    net_usd: t.strong_trader_net_usd || 0,
    wallet_count: t.strong_trader_wallet_count || 0,
    trade_count: t.strong_trader_trade_count || 0
  }));

  console.log('============================================================');
  console.log('[1] Top 30 by Holdings % of Total Supply');
  console.log('============================================================\n');

  const topByHoldings = [...analysisData].sort((a, b) => b.holdings_pct - a.holdings_pct).slice(0, 30);

  console.log('Rank'.padEnd(5) + 'Token'.padEnd(20) + 'Quality'.padEnd(15) + 'Holdings%'.padEnd(12) + 'Position');
  console.log('-'.repeat(70));

  const qualityCount = { high_quality: 0, mid_quality: 0, low_quality: 0, unlabeled: 0 };

  topByHoldings.forEach((t, i) => {
    const pos = t.net_pct > 0 ? 'LONG' : 'SHORT';
    console.log(
      (i + 1).toString().padEnd(5) +
      t.token_symbol.padEnd(20) +
      t.quality.padEnd(15) +
      t.holdings_pct.toFixed(2) + '%'.padEnd(12) +
      pos
    );
    qualityCount[t.quality]++;
  });

  console.log('\nQuality distribution in Top 30:');
  console.log(`  High quality: ${qualityCount.high_quality}`);
  console.log(`  Mid quality: ${qualityCount.mid_quality}`);
  console.log(`  Low quality: ${qualityCount.low_quality}`);
  console.log(`  Unlabeled: ${qualityCount.unlabeled}`);

  console.log('\n============================================================');
  console.log('[2] Average Holdings % by Quality Group');
  console.log('============================================================\n');

  const groups = { high_quality: [], mid_quality: [], low_quality: [], unlabeled: [] };
  analysisData.forEach(t => {
    if (groups[t.quality]) groups[t.quality].push(t);
  });

  console.log('Quality'.padEnd(15) + 'Count'.padEnd(8) + 'AvgHoldings%'.padEnd(15) + 'MedianHoldings%'.padEnd(15) + 'MaxHoldings%');
  console.log('-'.repeat(80));

  for (const [quality, tokens] of Object.entries(groups)) {
    if (tokens.length === 0) continue;

    const avg = tokens.reduce((sum, t) => sum + t.holdings_pct, 0) / tokens.length;
    const sorted = [...tokens].sort((a, b) => a.holdings_pct - b.holdings_pct);
    const median = sorted[Math.floor(sorted.length / 2)].holdings_pct;
    const max = Math.max(...tokens.map(t => t.holdings_pct));

    console.log(
      quality.padEnd(15) +
      tokens.length.toString().padEnd(8) +
      avg.toFixed(2) + '%'.padEnd(15) +
      median.toFixed(2) + '%'.padEnd(15) +
      max.toFixed(2) + '%'
    );
  }

  console.log('\n============================================================');
  console.log('[3] Correlation: Holdings % vs Quality Score');
  console.log('============================================================\n');

  // 排除 unlabeled
  const correlationData = analysisData.filter(t => t.quality !== 'unlabeled');

  // Spearman correlation
  const spearman = calculateSpearman(correlationData, 'holdings_pct', 'quality_score');
  const pearson = calculatePearson(correlationData, 'holdings_pct', 'quality_score');

  console.log(`Pearson correlation: ${pearson.toFixed(4)} ${interpretCorrelation(pearson)}`);
  console.log(`Spearman correlation: ${spearman.toFixed(4)} ${interpretCorrelation(spearman)}`);

  console.log('\nInterpretation:');
  if (spearman < -0.3) {
    console.log('  Negative correlation: High holdings % tends to be LOW quality tokens');
    console.log('  This suggests strong traders accumulate more in low quality tokens!');
  } else if (spearman > 0.3) {
    console.log('  Positive correlation: High holdings % tends to be HIGH quality tokens');
  } else {
    console.log('  Weak correlation: Holdings % does not strongly predict quality');
  }

  console.log('\n============================================================');
  console.log('[4] Distribution Analysis');
  console.log('============================================================\n');

  // 按持仓比例分段统计
  const segments = [
    { name: '> 10%', min: 10, max: Infinity },
    { name: '5-10%', min: 5, max: 10 },
    { name: '3-5%', min: 3, max: 5 },
    { name: '1-3%', min: 1, max: 3 },
    { name: '< 1%', min: 0, max: 1 }
  ];

  console.log('Holdings Range'.padEnd(15) + 'Total'.padEnd(8) + 'High'.padEnd(8) + 'Mid'.padEnd(8) + 'Low'.padEnd(8) + '%High');
  console.log('-'.repeat(65));

  for (const seg of segments) {
    const tokensInRange = correlationData.filter(t => t.holdings_pct >= seg.min && t.holdings_pct < seg.max);
    const high = tokensInRange.filter(t => t.quality === 'high_quality').length;
    const mid = tokensInRange.filter(t => t.quality === 'mid_quality').length;
    const low = tokensInRange.filter(t => t.quality === 'low_quality').length;
    const pctHigh = tokensInRange.length > 0 ? (high / tokensInRange.length * 100).toFixed(1) : '0';

    console.log(
      seg.name.padEnd(15) +
      tokensInRange.length.toString().padEnd(8) +
      high.toString().padEnd(8) +
      mid.toString().padEnd(8) +
      low.toString().padEnd(8) +
      pctHigh + '%'
    );
  }

  console.log('\n============================================================');
  console.log('[5] Key Insight: Where do Strong Traders Concentrate?');
  console.log('============================================================\n');

  // 统计高持仓代币的质量分布
  const highHoldings = correlationData.filter(t => t.holdings_pct >= 5);
  const veryHighHoldings = correlationData.filter(t => t.holdings_pct >= 10);

  console.log(`Tokens with holdings >= 5%: ${highHoldings.length}`);
  const highHoldingsDist = {};
  highHoldings.forEach(t => {
    highHoldingsDist[t.quality] = (highHoldingsDist[t.quality] || 0) + 1;
  });
  Object.entries(highHoldingsDist).sort((a, b) => b[1] - a[1]).forEach(([q, c]) => {
    console.log(`  ${q}: ${c} (${(c/highHoldings.length*100).toFixed(1)}%)`);
  });

  console.log(`\nTokens with holdings >= 10%: ${veryHighHoldings.length}`);
  const veryHighHoldingsDist = {};
  veryHighHoldings.forEach(t => {
    veryHighHoldingsDist[t.quality] = (veryHighHoldingsDist[t.quality] || 0) + 1;
  });
  Object.entries(veryHighHoldingsDist).sort((a, b) => b[1] - a[1]).forEach(([q, c]) => {
    console.log(`  ${q}: ${c} (${(c/veryHighHoldings.length*100).toFixed(1)}%)`);
  });

  console.log('\n============================================================');
  console.log('[6] Final Conclusion');
  console.log('============================================================\n');

  const avgByQuality = {};
  for (const [quality, tokens] of Object.entries(groups)) {
    if (tokens.length > 0) {
      avgByQuality[quality] = tokens.reduce((sum, t) => sum + t.holdings_pct, 0) / tokens.length;
    }
  }

  console.log('Average holdings % by quality:');
  Object.entries(avgByQuality).sort((a, b) => b[1] - a[1]).forEach(([q, avg]) => {
    console.log(`  ${q}: ${avg.toFixed(2)}%`);
  });

  console.log('\nConclusion:');
  const highestAvg = Object.entries(avgByQuality).sort((a, b) => b[1] - a[1])[0];
  console.log(`  Strong traders hold the HIGHEST % in ${highestAvg[0]} tokens (${highestAvg[1].toFixed(2)}%)`);

  if (highestAvg[0] === 'low_quality') {
    console.log('  This means: Strong traders accumulate MORE in low quality tokens!');
    console.log('  Possible reasons:');
    console.log('    1. Low quality tokens have higher volatility → more trading opportunities');
    console.log('    2. Strong traders chase short-term pumps in low quality tokens');
    console.log('    3. Strong traders exit quickly when they see problems (hence high sell activity)');
  } else if (highestAvg[0] === 'high_quality') {
    console.log('  Strong traders prefer to hold high quality tokens.');
  }

  // Save results
  const segmentAnalysis = [];
  for (const seg of segments) {
    const tokensInRange = correlationData.filter(t => t.holdings_pct >= seg.min && t.holdings_pct < seg.max);
    segmentAnalysis.push({
      segment: seg.name,
      count: tokensInRange.length,
      high_quality: tokensInRange.filter(t => t.quality === 'high_quality').length,
      mid_quality: tokensInRange.filter(t => t.quality === 'mid_quality').length,
      low_quality: tokensInRange.filter(t => t.quality === 'low_quality').length
    });
  }

  const output = {
    top_by_holdings: topByHoldings.slice(0, 50),
    quality_distribution_in_top: {
      top_10: qualityCount,
      top_5_gt_10pct: veryHighHoldingsDist,
      top_5_gt_5pct: highHoldingsDist
    },
    averages_by_quality: avgByQuality,
    correlation: { pearson, spearman },
    segment_analysis: segmentAnalysis
  };

  fs.writeFileSync(
    path.join(DATA_DIR, 'step9_holdings_quality_analysis.json'),
    JSON.stringify(output, null, 2)
  );

  console.log('\nHoldings vs Quality analysis saved to data/step9_holdings_quality_analysis.json');
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

function interpretCorrelation(r) {
  const abs = Math.abs(r);
  if (abs < 0.1) return '(very weak)';
  if (abs < 0.3) return '(weak)';
  if (abs < 0.5) return '(moderate)';
  if (abs < 0.7) return '(strong)';
  return '(very strong)';
}

main().catch(console.error);
