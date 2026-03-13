/**
 * Step 9b: Strong Trader Threshold Analysis
 * Test different threshold combinations to find optimal definition
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const TOTAL_SUPPLY = 1000000000;

// Test different threshold combinations
const THRESHOLD_CONFIGS = [
  {
    name: 'Current (Very Strict)',
    profitAbs: 50000,
    soldPurchaseRatio: 0.5,
    totalTrades: 2000
  },
  {
    name: 'High Profit Focus',
    profitAbs: 100000,
    soldPurchaseRatio: 0.3,
    totalTrades: 1000
  },
  {
    name: 'High Frequency Focus',
    profitAbs: 30000,
    soldPurchaseRatio: 0.5,
    totalTrades: 5000
  },
  {
    name: 'Balanced (Medium)',
    profitAbs: 30000,
    soldPurchaseRatio: 0.5,
    totalTrades: 1000
  },
  {
    name: 'Relaxed',
    profitAbs: 20000,
    soldPurchaseRatio: 0.4,
    totalTrades: 500
  },
  {
    name: 'Seller Focus (High sold/purchase)',
    profitAbs: 30000,
    soldPurchaseRatio: 0.8,
    totalTrades: 500
  },
  {
    name: 'Very Relaxed',
    profitAbs: 10000,
    soldPurchaseRatio: 0.3,
    totalTrades: 200
  }
];

function isStrongTrader(wallet, config) {
  const profitAbsOK = Math.abs(wallet.total_profit || 0) >= config.profitAbs;
  const purchase = wallet.total_purchase || 0;
  const sold = wallet.total_sold || 0;
  const ratioOK = purchase > 0 && (sold / purchase) >= config.soldPurchaseRatio;
  const tradesOK = (wallet.total_trades || 0) >= config.totalTrades;
  return profitAbsOK && ratioOK && tradesOK;
}

async function main() {
  console.log('=== Step 9b: Strong Trader Threshold Analysis ===\n');
  console.log('Testing different threshold combinations...\n');

  // Read data
  const walletData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wallet_data_valid.json'), 'utf8'));
  const earlyTrades = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'step2_early_trades.json'), 'utf8'));

  const results = [];

  for (const config of THRESHOLD_CONFIGS) {
    console.log('============================================================');
    console.log(`Testing: ${config.name}`);
    console.log('============================================================');
    console.log(`  |profit| >= $${config.profitAbs}`);
    console.log(`  sold/purchase >= ${config.soldPurchaseRatio}`);
    console.log(`  trades >= ${config.totalTrades}\n`);

    // Identify strong traders
    const strongTraders = new Set();
    walletData.forEach(w => {
      if (isStrongTrader(w, config)) {
        strongTraders.add(w.address.toLowerCase());
      }
    });

    const traderCount = strongTraders.size;
    const traderRatio = traderCount / walletData.length;

    console.log(`Strong traders: ${traderCount} / ${walletData.length} (${(traderRatio*100).toFixed(2)}%)\n`);

    // Calculate participation for each token
    const tokenStats = [];

    for (const result of earlyTrades.results) {
      const tokenAddress = result.token_address.toLowerCase();
      const tokenSymbol = result.token_symbol;
      const quality = result.quality_label || 'unlabeled';

      let strongTraderBuyAmount = 0;
      let strongTraderSellAmount = 0;
      let strongTraderNetAmount = 0;
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

        if (strongTraders.has(wallet)) {
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

      strongTraderNetAmount = strongTraderBuyAmount - strongTraderSellAmount;
      const netBuyRatio = (Math.abs(strongTraderNetAmount) / TOTAL_SUPPLY * 100);

      tokenStats.push({
        token_symbol: tokenSymbol,
        quality: quality,
        quality_score: getQualityScore(quality),
        strong_wallet_count: strongTraderWallets.size,
        net_buy_ratio: netBuyRatio
      });
    }

    // Group by quality
    const groups = { high_quality: [], mid_quality: [], low_quality: [], unlabeled: [] };
    tokenStats.forEach(t => {
      if (groups[t.quality]) groups[t.quality].push(t);
    });

    // Calculate averages
    const avgByQuality = {};
    for (const [quality, tokens] of Object.entries(groups)) {
      if (tokens.length > 0) {
        const avgNetBuy = tokens.reduce((sum, t) => sum + t.net_buy_ratio, 0) / tokens.length;
        avgByQuality[quality] = avgNetBuy;
      }
    }

    // Calculate correlation (excluding unlabeled)
    const correlationData = tokenStats.filter(t => t.quality !== 'unlabeled');
    const spearman = calculateSpearman(correlationData, 'net_buy_ratio', 'quality_score');

    // Calculate AUC for distinguishing high_quality from low_quality
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

    console.log('Average Net Buy Ratio by Quality:');
    for (const [quality, avg] of Object.entries(avgByQuality)) {
      console.log(`  ${quality}: ${avg.toFixed(2)}%`);
    }

    console.log(`\nSpearman correlation: ${spearman.toFixed(4)}`);
    console.log(`AUC (high vs low): ${auc.toFixed(4)}`);

    // If high quality has lower avg, it's negative signal
    const signal = avgByQuality.high_quality < avgByQuality.low_quality ? 'NEGATIVE' : 'POSITIVE';
    console.log(`Signal: ${signal} (high quality avg: ${avgByQuality.high_quality?.toFixed(2)}%, low: ${avgByQuality.low_quality?.toFixed(2)}%)\n`);

    results.push({
      config_name: config.name,
      thresholds: config,
      trader_count: traderCount,
      trader_ratio: traderRatio,
      spearman_correlation: spearman,
      auc_high_vs_low: auc,
      signal: signal,
      avg_by_quality: avgByQuality
    });
  }

  // Summary comparison
  console.log('\n============================================================');
  console.log('[FINAL COMPARISON]');
  console.log('============================================================\n');

  console.log('Config'.padEnd(25) + 'Traders'.padEnd(10) + 'Spearman'.padEnd(10) + 'AUC'.padEnd(10) + 'Signal');
  console.log('-'.repeat(70));

  results.sort((a, b) => b.auc_high_vs_low - a.auc_high_vs_low).forEach(r => {
    console.log(
      r.config_name.padEnd(25) +
      r.trader_count.toString().padEnd(10) +
      r.spearman_correlation.toFixed(4).padEnd(10) +
      r.auc_high_vs_low.toFixed(4).padEnd(10) +
      r.signal
    );
  });

  // Find best config for distinguishing quality
  console.log('\n============================================================');
  console.log('[INSIGHTS]');
  console.log('============================================================\n');

  const bestAuc = results.sort((a, b) => b.auc_high_vs_low - a.auc_high_vs_low)[0];
  const mostNegative = results.sort((a, b) => a.spearman_correlation - b.spearman_correlation)[0];

  console.log('Best AUC (high vs low):');
  console.log(`  ${bestAuc.config_name}: AUC = ${bestAuc.auc_high_vs_low.toFixed(4)}`);
  console.log(`  Thresholds: profit>=${bestAuc.thresholds.profitAbs}, sold/purchase>=${bestAuc.thresholds.soldPurchaseRatio}, trades>=${bestAuc.thresholds.totalTrades}`);

  console.log('\nStrongest negative correlation:');
  console.log(`  ${mostNegative.config_name}: Spearman = ${mostNegative.spearman_correlation.toFixed(4)}`);
  console.log(`  Thresholds: profit>=${mostNegative.thresholds.profitAbs}, sold/purchase>=${mostNegative.thresholds.soldPurchaseRatio}, trades>=${mostNegative.thresholds.totalTrades}`);

  console.log('\nInterpretation:');
  if (mostNegative.spearman_correlation < -0.5) {
    console.log('  - Strong negative correlation confirms: High strong-trader participation = LOW quality');
    console.log('  - This supports your insight: Strong traders harvest liquidity, scaring away smart散户');
  }

  // Save results
  fs.writeFileSync(
    path.join(DATA_DIR, 'step9b_threshold_analysis.json'),
    JSON.stringify(results, null, 2)
  );

  console.log('\n✅ Analysis saved to data/step9b_threshold_analysis.json');
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
