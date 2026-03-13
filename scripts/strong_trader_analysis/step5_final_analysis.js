/**
 * Step 5: Final Analysis
 * Identify strong short-term traders and analyze their relationship with token quality
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

// Configurable thresholds - Seller Focus (收割流动性者)
const THRESHOLDS = {
  profitAbs: 30000,     // |total_profit| >= $30000 USD
  soldPurchaseRatio: 0.8, // sold/purchase >= 0.8 (80%, 卖出次数达到买入次数的80%)
  totalTrades: 500      // total_trades >= 500
};

function isStrongTrader(wallet) {
  const profitAbsOK = Math.abs(wallet.total_profit || 0) >= THRESHOLDS.profitAbs;
  const purchase = wallet.total_purchase || 0;
  const sold = wallet.total_sold || 0;
  const ratioOK = purchase > 0 && (sold / purchase) >= THRESHOLDS.soldPurchaseRatio;
  const tradesOK = (wallet.total_trades || 0) >= THRESHOLDS.totalTrades;
  return profitAbsOK && ratioOK && tradesOK;
}

async function main() {
  console.log('=== Step 5: Final Analysis ===\n');
  console.log('Threshold settings:');
  console.log(`  |profit| >= $${THRESHOLDS.profitAbs}`);
  console.log(`  sold/purchase >= ${THRESHOLDS.soldPurchaseRatio}`);
  console.log(`  total_trades >= ${THRESHOLDS.totalTrades}\n`);

  // Read data
  const earlyTrades = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'step2_early_trades.json'), 'utf8'));
  const walletData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wallet_data_valid.json'), 'utf8'));

  console.log('============================================================');
  console.log('[1. Identify Strong Short-term Traders]');
  console.log('============================================================\n');

  // Build wallet map
  const walletMap = new Map();
  walletData.forEach(w => {
    walletMap.set(w.address.toLowerCase(), w);
  });

  // Identify strong traders
  const strongTraders = new Set();
  const strongTraderData = [];

  walletData.forEach(w => {
    if (isStrongTrader(w)) {
      strongTraders.add(w.address.toLowerCase());
      strongTraderData.push(w);
    }
  });

  console.log(`Strong traders: ${strongTraderData.length} / ${walletData.length} (${(strongTraderData.length/walletData.length*100).toFixed(1)}%)\n`);

  // Show examples
  console.log('Top 5 strong traders by |profit|:');
  strongTraderData
    .sort((a, b) => Math.abs(b.total_profit) - Math.abs(a.total_profit))
    .slice(0, 5)
    .forEach((w, i) => {
      const ratio = (w.total_sold / (w.total_purchase || 1)).toFixed(2);
      console.log(`  ${i+1}. ${w.address.slice(0,10)}... |profit|=$${Math.abs(w.total_profit).toFixed(0)} sold/purchase=${ratio} trades=${w.total_trades}`);
    });

  console.log(`\n============================================================`);
  console.log('[2. Calculate Strong Trader Participation per Token]');
  console.log('============================================================\n');

  const tokenStats = [];

  for (const result of earlyTrades.results) {
    const tokenWallets = result.wallets || [];
    const strongTraderCount = tokenWallets.filter(w => strongTraders.has(w.toLowerCase())).length;

    tokenStats.push({
      token_address: result.token_address,
      token_symbol: result.token_symbol,
      quality_label: result.quality_label || 'unlabeled',
      total_wallets: tokenWallets.length,
      strong_trader_count: strongTraderCount,
      strong_trader_ratio: tokenWallets.length > 0 ? strongTraderCount / tokenWallets.length : 0
    });
  }

  console.log('Token'.padEnd(20) + 'Quality'.padEnd(15) + 'Wallets'.padEnd(8) + 'Strong'.padEnd(10) + 'Ratio');
  console.log('-'.repeat(70));

  tokenStats
    .sort((a, b) => b.strong_trader_ratio - a.strong_trader_ratio)
    .forEach(t => {
      console.log(
        t.token_symbol.padEnd(20) +
        t.quality_label.padEnd(15) +
        t.total_wallets.toString().padEnd(8) +
        t.strong_trader_count.toString().padEnd(10) +
        `${(t.strong_trader_ratio * 100).toFixed(1)}%`
      );
    });

  console.log(`\n============================================================`);
  console.log('[3. Group by Quality Label]');
  console.log('============================================================\n');

  // Group by quality
  const qualityGroups = {
    high_quality: [],
    mid_quality: [],
    low_quality: [],
    fake_pump: [],
    no_user: [],
    unlabeled: []
  };

  tokenStats.forEach(t => {
    const q = t.quality_label;
    if (qualityGroups[q]) {
      qualityGroups[q].push(t);
    }
  });

  console.log('Quality'.padEnd(15) + 'Count'.padEnd(8) + 'AvgWallets'.padEnd(12) + 'AvgStrong'.padEnd(14) + 'AvgRatio');
  console.log('-'.repeat(70));

  const groupSummary = [];

  for (const [quality, tokens] of Object.entries(qualityGroups)) {
    if (tokens.length === 0) continue;

    const avgWallets = (tokens.reduce((sum, t) => sum + t.total_wallets, 0) / tokens.length).toFixed(1);
    const avgStrong = (tokens.reduce((sum, t) => sum + t.strong_trader_count, 0) / tokens.length).toFixed(1);
    const avgRatio = (tokens.reduce((sum, t) => sum + t.strong_trader_ratio, 0) / tokens.length * 100).toFixed(2);

    console.log(
      quality.padEnd(15) +
      tokens.length.toString().padEnd(8) +
      avgWallets.padEnd(12) +
      avgStrong.padEnd(14) +
      `${avgRatio}%`
    );

    groupSummary.push({
      quality,
      count: tokens.length,
      avgWallets: parseFloat(avgWallets),
      avgStrong: parseFloat(avgStrong),
      avgRatio: parseFloat(avgRatio)
    });
  }

  // Correlation analysis
  console.log(`\n============================================================`);
  console.log('[4. Correlation Analysis]');
  console.log('============================================================\n');

  const sortedByRatio = [...groupSummary].sort((a, b) => b.avgRatio - a.avgRatio);
  console.log('Sorted by average strong trader ratio:');

  sortedByRatio.forEach((g, i) => {
    if (g.count > 0) {
      console.log(`  ${i+1}. ${g.quality.padEnd(15)}: ${g.avgRatio}% (${g.count} tokens)`);
    }
  });

  // Conclusion
  console.log(`\n============================================================`);
  console.log('[5. Conclusion]');
  console.log('============================================================\n');

  if (sortedByRatio.length > 0) {
    const top = sortedByRatio[0];
    const bottom = sortedByRatio[sortedByRatio.length - 1];

    console.log(`- Highest strong trader participation: ${top.quality} (${top.avgRatio}%, ${top.count} tokens)`);
    console.log(`- Lowest strong trader participation: ${bottom.quality} (${bottom.avgRatio}%, ${bottom.count} tokens)`);

    if (top.quality === 'high_quality') {
      console.log(`\n=> High quality tokens have the highest strong trader participation, suggesting positive correlation.`);
    } else if (bottom.quality === 'high_quality') {
      console.log(`\n=> High quality tokens have lower strong trader participation, suggesting weak/no direct correlation.`);
    }
  }

  console.log(`\nNote: Analysis based on thresholds |profit|>=${THRESHOLDS.profitAbs}, sold/purchase>=${THRESHOLDS.soldPurchaseRatio}, trades>=${THRESHOLDS.totalTrades}`);
  console.log(`      Modify THRESHOLDS in step5_final_analysis.js to reanalyze with different values.`);

  // Save results
  const output = {
    thresholds: THRESHOLDS,
    strong_traders: {
      count: strongTraderData.length,
      ratio: strongTraderData.length / walletData.length,
      traders: strongTraderData.map(w => ({
        address: w.address,
        total_profit: w.total_profit,
        total_purchase: w.total_purchase,
        total_sold: w.total_sold,
        total_trades: w.total_trades
      }))
    },
    token_stats: tokenStats,
    quality_groups: groupSummary
  };

  fs.writeFileSync(
    path.join(DATA_DIR, 'step5_final_analysis.json'),
    JSON.stringify(output, null, 2)
  );

  console.log(`\n✅ Final analysis results saved to data/step5_final_analysis.json`);
}

main().catch(console.error);
