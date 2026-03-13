/**
 * Step 9c: Time Window Comparison
 * Compare 1.5min (90s) vs 3min (180s) backtest window
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const TOTAL_SUPPLY = 1000000000;

// Current thresholds (seller focus)
const THRESHOLDS = {
  profitAbs: 30000,
  soldPurchaseRatio: 0.8,
  totalTrades: 500
};

async function analyzeWithWindow(windowSeconds, dataFile, label) {
  console.log(`\n============================================================`);
  console.log(`Analyzing: ${label} (${windowSeconds}s window)`);
  console.log(`============================================================\n`);

  // Read data
  const strongTraderData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'step5_final_analysis.json'), 'utf8'));
  const earlyTrades = JSON.parse(fs.readFileSync(path.join(DATA_DIR, dataFile), 'utf8'));

  const strongTraderAddresses = new Set(
    strongTraderData.strong_traders.traders.map(t => t.address.toLowerCase())
  );

  console.log(`Strong traders: ${strongTraderAddresses.size}`);
  console.log(`Tokens: ${earlyTrades.results.length}`);

  // Analyze each token
  const tokenStats = [];

  for (const result of earlyTrades.results) {
    const tokenAddress = result.token_address.toLowerCase();
    const tokenSymbol = result.token_symbol;
    const quality = result.quality_label || 'unlabeled';

    let strongTraderBuyAmount = 0;
    let strongTraderSellAmount = 0;
    let strongTraderWallets = new Set();

    for (const trade of result.trades || []) {
      const wallet = trade.wallet_address ? trade.wallet_address.toLowerCase() :
                     trade.from_address ? trade.from_address.toLowerCase() : '';
      if (!wallet) continue;

      const toToken = trade.to_token ? trade.to_token.toLowerCase() : '';
      const fromToken = trade.from_token ? trade.from_token.toLowerCase() : '';

      const isBuy = toToken === tokenAddress;
      const isSell = fromToken === tokenAddress;

      if (!isBuy && !isSell) continue;

      if (strongTraderAddresses.has(wallet)) {
        strongTraderWallets.add(wallet);

        if (isBuy) {
          const amount = parseFloat(trade.to_amount) || 0;
          strongTraderBuyAmount += amount;
        }
        if (isSell) {
          const amount = parseFloat(trade.from_amount) || 0;
          strongTraderSellAmount += amount;
        }
      }
    }

    const netAmount = strongTraderBuyAmount - strongTraderSellAmount;
    const netBuyRatio = (Math.abs(netAmount) / TOTAL_SUPPLY * 100);
    const totalBuyRatio = (strongTraderBuyAmount / TOTAL_SUPPLY * 100);

    tokenStats.push({
      token_symbol: tokenSymbol,
      quality: quality,
      quality_score: getQualityScore(quality),
      net_buy_ratio: netBuyRatio,
      total_buy_ratio: totalBuyRatio,
      buy_amount: strongTraderBuyAmount,
      sell_amount: strongTraderSellAmount,
      net_amount: netAmount,
      wallet_count: strongTraderWallets.size
    });
  }

  // Group by quality
  const groups = { high_quality: [], mid_quality: [], low_quality: [], unlabeled: [] };
  tokenStats.forEach(t => {
    if (groups[t.quality]) groups[t.quality].push(t);
  });

  // Calculate averages
  console.log('Average Net Buy Ratio by Quality:');
  const avgByQuality = {};
  for (const [quality, tokens] of Object.entries(groups)) {
    if (tokens.length > 0) {
      const avg = tokens.reduce((sum, t) => sum + t.net_buy_ratio, 0) / tokens.length;
      avgByQuality[quality] = avg;
      console.log(`  ${quality}: ${avg.toFixed(2)}% (${tokens.length} tokens)`);
    }
  }

  // Calculate correlation
  const correlationData = tokenStats.filter(t => t.quality !== 'unlabeled');
  const spearman = calculateSpearman(correlationData, 'net_buy_ratio', 'quality_score');

  console.log(`\nSpearman correlation: ${spearman.toFixed(4)}`);

  // High holdings analysis
  const highHoldings = correlationData.filter(t => t.net_buy_ratio >= 5);
  console.log(`\nTokens with Net Buy Ratio >= 5%: ${highHoldings.length}`);
  const highDist = {};
  highHoldings.forEach(t => {
    highDist[t.quality] = (highDist[t.quality] || 0) + 1;
  });
  Object.entries(highDist).forEach(([q, c]) => {
    console.log(`  ${q}: ${c} (${(c/highHoldings.length*100).toFixed(1)}%)`);
  });

  // AUC for high vs low quality
  const highScores = correlationData.filter(d => d.quality === 'high_quality').map(d => d.net_buy_ratio);
  const lowScores = correlationData.filter(d => d.quality === 'low_quality').map(d => d.net_buy_ratio);

  let auc = 0.5;
  let count = 0;
  let total = 0;

  for (const high of highScores) {
    for (const low of lowScores) {
      total++;
      if (high > low) count++;
      else if (high === low) count += 0.5;
    }
  }
  if (total > 0) auc = count / total;

  console.log(`AUC (high vs low quality): ${auc.toFixed(4)}`);

  return {
    label,
    window_seconds: windowSeconds,
    spearman_correlation: spearman,
    auc_high_vs_low: auc,
    avg_by_quality: avgByQuality,
    high_holdings_5pct: {
      total: highHoldings.length,
      distribution: highDist
    },
    total_tokens: tokenStats.length,
    tokens_with_activity: correlationData.length
  };
}

async function main() {
  console.log('=== Step 9c: Time Window Comparison ===\n');
  console.log(`Thresholds: |profit|>=${THRESHOLDS.profitAbs}, sold/purchase>=${THRESHOLDS.soldPurchaseRatio}, trades>=${THRESHOLDS.totalTrades}\n`);

  const results = [];

  // Analyze 1.5min window
  const result90s = await analyzeWithWindow(90, 'step2_early_trades_90s.json', '1.5分钟 (90秒)');
  results.push(result90s);

  // Analyze 3min window
  const result180s = await analyzeWithWindow(180, 'step2_early_trades.json', '3分钟 (180秒)');
  results.push(result180s);

  // Comparison
  console.log('\n============================================================');
  console.log('[COMPARISON SUMMARY]');
  console.log('============================================================\n');

  console.log('Window'.padEnd(20) + 'Tokens'.padEnd(10) + 'Spearman'.padEnd(12) + 'AUC(H/L)'.padEnd(12) + 'HighAvg'.padEnd(10) + 'MidAvg'.padEnd(10) + 'LowAvg');
  console.log('-'.repeat(100));

  for (const r of results) {
    console.log(
      r.label.padEnd(20) +
      r.tokens_with_activity.toString().padEnd(10) +
      r.spearman_correlation.toFixed(4).padEnd(12) +
      r.auc_high_vs_low.toFixed(4).padEnd(12) +
      (r.avg_by_quality.high_quality || 0).toFixed(2) + '%'.padEnd(10) +
      (r.avg_by_quality.mid_quality || 0).toFixed(2) + '%'.padEnd(10) +
      (r.avg_by_quality.low_quality || 0).toFixed(2) + '%'
    );
  }

  console.log('\n============================================================');
  console.log('[INSIGHTS]');
  console.log('============================================================\n');

  const betterCorrelation = results.sort((a, b) => b.spearman_correlation - a.spearman_correlation)[0];
  const betterAuc = results.sort((a, b) => b.auc_high_vs_low - a.auc_high_vs_low)[0];

  console.log(`Strongest correlation: ${betterCorrelation.label} (Spearman = ${betterCorrelation.spearman_correlation.toFixed(4)})`);
  console.log(`Best AUC (high vs low): ${betterAuc.label} (AUC = ${betterAuc.auc_high_vs_low.toFixed(4)})`);

  const r90 = results[0];
  const r180 = results[1];

  console.log('\nKey differences:');
  console.log(`  Tokens with activity: ${r90.tokens_with_activity} (1.5min) vs ${r180.tokens_with_activity} (3min)`);
  console.log(`  Spearman: ${r90.spearman_correlation.toFixed(4)} (1.5min) vs ${r180.spearman_correlation.toFixed(4)} (3min)`);
  console.log(`  AUC: ${r90.auc_high_vs_low.toFixed(4)} (1.5min) vs ${r180.auc_high_vs_low.toFixed(4)} (3min)`);

  // Recommendation
  console.log('\n============================================================');
  console.log('[RECOMMENDATION]');
  console.log('============================================================\n');

  if (Math.abs(r180.spearman_correlation) > Math.abs(r90.spearman_correlation)) {
    console.log('Recommendation: Use 3分钟 (180秒) window');
    console.log('  - Stronger correlation with token quality');
    console.log('  - Better signal for quality prediction');
  } else {
    console.log('Recommendation: Use 1.5分钟 (90秒) window');
    console.log('  - Stronger correlation with token quality');
    console.log('  - More focused on early trading behavior');
  }

  // Save results
  fs.writeFileSync(
    path.join(DATA_DIR, 'step9c_window_comparison.json'),
    JSON.stringify(results, null, 2)
  );

  console.log('\n✅ Comparison saved to data/step9c_window_comparison.json');
}

function getQualityScore(quality) {
  const scores = { high_quality: 2, mid_quality: 1, low_quality: 0, unlabeled: 1 };
  return scores[quality] || 1;
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

main().catch(console.error);
