/**
 * Step 9: Quality Prediction Analysis
 * Focus on Low Quality vs (Mid + High Quality) binary classification
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

async function main() {
  console.log('=== Step 9: Quality Prediction Analysis ===\n');
  console.log('Focus: Low Quality vs (Mid + High Quality)\n');

  // Read data
  const purchaseData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'step8_strong_trader_purchase_analysis.json'), 'utf8'));
  const tokens = purchaseData.token_stats.filter(t => t.strong_trader_buy_usd > 0 || t.strong_trader_sell_usd > 0);

  // Binary classification: is_low_quality
  const analysisData = tokens.map(t => ({
    token_symbol: t.token_symbol,
    is_low: t.quality_label === 'low_quality' ? 1 : 0,
    quality: t.quality_label,
    buy_usd: t.strong_trader_buy_usd || 0,
    sell_usd: t.strong_trader_sell_usd || 0,
    net_usd: t.strong_trader_net_usd || 0,
    buy_amount: t.strong_trader_buy_amount || 0,
    sell_amount: t.strong_trader_sell_amount || 0,
    net_amount: t.strong_trader_net_amount || 0,
    wallet_count: t.strong_trader_wallet_count || 0,
    trade_count: t.strong_trader_trade_count || 0,
    pct_of_supply: t.pct_of_total_supply || 0,
    // Derived metrics
    sell_to_buy_ratio: t.strong_trader_buy_usd > 0 ? (t.strong_trader_sell_usd / t.strong_trader_buy_usd) : 0,
    net_to_buy_ratio: t.strong_trader_buy_usd > 0 ? (t.strong_trader_net_usd / t.strong_trader_buy_usd) : 0,
    participation_rate: t.strong_trader_wallet_count / (t.total_wallets || 1)
  }));

  const lowCount = analysisData.filter(t => t.is_low).length;
  const midHighCount = analysisData.filter(t => t.is_low === 0).length;

  console.log(`Total tokens: ${analysisData.length}`);
  console.log(`Low quality: ${lowCount}, Mid+High quality: ${midHighCount}\n`);

  console.log('============================================================');
  console.log('[1. Average Values by Quality Group]');
  console.log('============================================================\n');

  const lowData = analysisData.filter(t => t.is_low);
  const midHighData = analysisData.filter(t => t.is_low === 0);

  const avg = (arr, key) => arr.reduce((sum, t) => sum + t[key], 0) / arr.length;

  console.log('Metric'.padEnd(25) + 'Low Quality'.padEnd(15) + 'Mid+High'.padEnd(15) + 'Ratio (L/MH)');
  console.log('-'.repeat(70));

  const metrics = [
    { key: 'buy_usd', fmt: v => '$' + v.toFixed(0) },
    { key: 'sell_usd', fmt: v => '$' + v.toFixed(0) },
    { key: 'net_usd', fmt: v => (v > 0 ? '+' : '') + '$' + v.toFixed(0) },
    { key: 'buy_amount', fmt: v => (v/1000000).toFixed(1) + 'M' },
    { key: 'sell_amount', fmt: v => (v/1000000).toFixed(1) + 'M' },
    { key: 'net_amount', fmt: v => (v/1000000).toFixed(1) + 'M' },
    { key: 'wallet_count', fmt: v => v.toFixed(2) },
    { key: 'trade_count', fmt: v => v.toFixed(2) },
    { key: 'pct_of_supply', fmt: v => v.toFixed(2) + '%' },
    { key: 'sell_to_buy_ratio', fmt: v => v.toFixed(2) },
    { key: 'net_to_buy_ratio', fmt: v => v.toFixed(2) }
  ];

  for (const metric of metrics) {
    const lowAvg = avg(lowData, metric.key);
    const midHighAvg = avg(midHighData, metric.key);
    const ratio = lowAvg / (midHighAvg || 1);

    console.log(
      metric.key.padEnd(25) +
      metric.fmt(lowAvg).padEnd(15) +
      metric.fmt(midHighAvg).padEnd(15) +
      ratio.toFixed(2) + 'x'
    );
  }

  console.log('\n============================================================');
  console.log('[2. AUC Analysis (Low vs Mid+High Classification)]');
  console.log('============================================================\n');

  const aucResults = {};
  for (const metric of metrics) {
    const auc = calculateAUC(analysisData, metric.key);
    aucResults[metric.key] = auc;
  }

  console.log('Metric'.padEnd(25) + 'AUC'.padEnd(10) + 'Interpretation');
  console.log('-'.repeat(60));

  for (const metric of metrics) {
    const auc = aucResults[metric.key];
    console.log(metric.key.padEnd(25) + auc.toFixed(4).padEnd(10) + interpretAUC(auc));
  }

  console.log('\n============================================================');
  console.log('[3. Find Best Threshold for Each Metric]');
  console.log('============================================================\n');

  console.log('Finding optimal thresholds to identify Low Quality tokens...\n');

  const thresholdResults = {};
  for (const metric of ['buy_usd', 'sell_usd', 'net_usd', 'sell_to_buy_ratio', 'net_to_buy_ratio', 'pct_of_supply']) {
    const result = findBestThreshold(analysisData, metric, 'is_low', 1);
    thresholdResults[metric] = result;

    console.log(`${metric}:`);
    console.log(`  Best threshold: ${result.threshold.toFixed(2)}`);
    console.log(`  Precision: ${(result.precision * 100).toFixed(1)}%, Recall: ${(result.recall * 100).toFixed(1)}%, F1: ${(result.f1 * 100).toFixed(1)}%`);
    console.log(`  True positives: ${result.truePositives}, False positives: ${result.falsePositives}`);
    console.log('');
  }

  console.log('============================================================');
  console.log('[4. Top Predictors by F1 Score]');
  console.log('============================================================\n');

  const sortedByF1 = Object.entries(thresholdResults)
    .map(([key, val]) => ({ ...val, key }))
    .sort((a, b) => b.f1 - a.f1);

  console.log('Rank'.padEnd(5) + 'Metric'.padEnd(25) + 'F1'.padEnd(8) + 'Precision'.padEnd(12) + 'Recall'.padEnd(10) + 'Threshold');
  console.log('-'.repeat(80));

  sortedByF1.forEach((r, i) => {
    console.log(
      (i + 1).toString().padEnd(5) +
      r.key.padEnd(25) +
      (r.f1 * 100).toFixed(1) + '%'.padEnd(8) +
      (r.precision * 100).toFixed(1) + '%'.padEnd(12) +
      (r.recall * 100).toFixed(1) + '%'.padEnd(10) +
      r.threshold.toFixed(2)
    );
  });

  console.log('\n============================================================');
  console.log('[5. Summary and Insights]');
  console.log('============================================================\n');

  const best = sortedByF1[0];
  console.log(`Best single predictor: ${best.key}`);
  console.log(`  F1: ${(best.f1 * 100).toFixed(1)}%, Precision: ${(best.precision * 100).toFixed(1)}%, Recall: ${(best.recall * 100).toFixed(1)}%`);
  console.log(`  Threshold: ${best.threshold.toFixed(2)}`);
  console.log(`  Meaning: Low quality tokens tend to have ${getInterpretation(best.key, best.threshold)}`);

  console.log('\nKey findings:');

  // Analyze patterns
  const lowAvgSellToBuy = avg(lowData, 'sell_to_buy_ratio');
  const midHighAvgSellToBuy = avg(midHighData, 'sell_to_buy_ratio');
  console.log(`  - Low quality sell/buy ratio: ${lowAvgSellToBuy.toFixed(2)} vs Mid+High: ${midHighAvgSellToBuy.toFixed(2)}`);

  const lowAvgNetToBuy = avg(lowData, 'net_to_buy_ratio');
  const midHighAvgNetToBuy = avg(midHighData, 'net_to_buy_ratio');
  console.log(`  - Low quality net/buy ratio: ${lowAvgNetToBuy.toFixed(2)} vs Mid+High: ${midHighAvgNetToBuy.toFixed(2)}`);

  const bestAuc = Math.max(...Object.values(aucResults));
  const bestAucMetric = Object.keys(aucResults).find(k => aucResults[k] === bestAuc);
  console.log(`  - Best AUC: ${bestAucMetric} (${bestAuc.toFixed(4)})`);

  if (bestAuc < 0.6) {
    console.log('\nConclusion: Weak prediction power. Consider combining multiple features or using different approach.');
  } else if (bestAuc < 0.7) {
    console.log('\nConclusion: Moderate prediction power. Some signal but not strong enough alone.');
  } else {
    console.log('\nConclusion: Good prediction power found!');
  }

  // Save results
  const output = {
    classification: 'low vs (mid+high)',
    sample_counts: { low: lowCount, mid_high: midHighCount },
    averages: {
      low_quality: {
        buy_usd: avg(lowData, 'buy_usd'),
        sell_usd: avg(lowData, 'sell_usd'),
        net_usd: avg(lowData, 'net_usd'),
        sell_to_buy_ratio: avg(lowData, 'sell_to_buy_ratio'),
        net_to_buy_ratio: avg(lowData, 'net_to_buy_ratio'),
        pct_of_supply: avg(lowData, 'pct_of_supply')
      },
      mid_high_quality: {
        buy_usd: avg(midHighData, 'buy_usd'),
        sell_usd: avg(midHighData, 'sell_usd'),
        net_usd: avg(midHighData, 'net_usd'),
        sell_to_buy_ratio: avg(midHighData, 'sell_to_buy_ratio'),
        net_to_buy_ratio: avg(midHighData, 'net_to_buy_ratio'),
        pct_of_supply: avg(midHighData, 'pct_of_supply')
      }
    },
    auc_scores: aucResults,
    best_thresholds: thresholdResults,
    rankings: sortedByF1
  };

  fs.writeFileSync(
    path.join(DATA_DIR, 'step9_quality_prediction_analysis.json'),
    JSON.stringify(output, null, 2)
  );

  console.log('\nQuality prediction analysis saved to data/step9_quality_prediction_analysis.json');
}

function calculateAUC(data, key) {
  const posScores = data.filter(d => d.is_low === 1).map(d => d[key]);
  const negScores = data.filter(d => d.is_low === 0).map(d => d[key]);

  let count = 0;
  let total = 0;

  for (const pos of posScores) {
    for (const neg of negScores) {
      total++;
      if (pos > neg) count++;
      else if (pos === neg) count += 0.5;
    }
  }

  return total > 0 ? count / total : 0.5;
}

function findBestThreshold(data, key, targetKey, targetValue) {
  let bestF1 = 0;
  let bestResult = null;

  const uniqueValues = [...new Set(data.map(d => d[key]))].sort((a, b) => a - b);

  for (const threshold of uniqueValues) {
    const tp = data.filter(d => d[targetKey] === targetValue && d[key] >= threshold).length;
    const fp = data.filter(d => d[targetKey] !== targetValue && d[key] >= threshold).length;
    const fn = data.filter(d => d[targetKey] === targetValue && d[key] < threshold).length;

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

    if (f1 > bestF1) {
      bestF1 = f1;
      bestResult = { threshold, precision, recall, f1, truePositives: tp, falsePositives: fp, falseNegatives: fn };
    }
  }

  return bestResult || { threshold: 0, precision: 0, recall: 0, f1: 0, truePositives: 0, falsePositives: 0, falseNegatives: 0 };
}

function interpretAUC(auc) {
  if (auc < 0.5) return `Poor (inverse: ${(1-auc).toFixed(4)})`;
  if (auc < 0.6) return 'Poor';
  if (auc < 0.7) return 'Fair';
  if (auc < 0.8) return 'Good';
  return 'Excellent';
}

function getInterpretation(metric, threshold) {
  const interpretations = {
    'buy_usd': `higher buy USD (> $${threshold.toFixed(0)})`,
    'sell_usd': `higher sell USD (> $${threshold.toFixed(0)})`,
    'net_usd': `higher net USD (> $${threshold.toFixed(0)})`,
    'sell_to_buy_ratio': `higher sell-to-buy ratio (> ${threshold.toFixed(2)})`,
    'net_to_buy_ratio': `higher net-to-buy ratio (> ${threshold.toFixed(2)})`,
    'pct_of_supply': `higher % of supply (> ${threshold.toFixed(2)}%)`
  };
  return interpretations[metric] || `higher ${metric}`;
}

main().catch(console.error);
