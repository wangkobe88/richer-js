/**
 * Step 6: Diamond Hands Analysis
 * Identify profitable traders with low trade count (long-term holders)
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

// Diamond Hands thresholds
const THRESHOLDS = {
  profitMin: 20000,    // total_profit >= $20000 USD (profitable)
  maxTrades: 500       // total_trades < 500 (low trade count, long-term holders)
};

function isDiamondHand(wallet) {
  const profitOK = (wallet.total_profit || 0) >= THRESHOLDS.profitMin;
  const tradesOK = (wallet.total_trades || 0) < THRESHOLDS.maxTrades;
  return profitOK && tradesOK;
}

async function main() {
  console.log('=== Step 6: Diamond Hands Analysis ===\n');
  console.log('Threshold settings:');
  console.log(`  profit >= $${THRESHOLDS.profitMin} USD`);
  console.log(`  trades < ${THRESHOLDS.maxTrades}\n`);

  // Read data
  const earlyTrades = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'step2_early_trades.json'), 'utf8'));
  const walletData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wallet_data_valid.json'), 'utf8'));

  console.log('============================================================');
  console.log('[1. Identify Diamond Hands Traders]');
  console.log('============================================================\n');

  // Build wallet map
  const walletMap = new Map();
  walletData.forEach(w => {
    walletMap.set(w.address.toLowerCase(), w);
  });

  // Identify diamond hands
  const diamondHands = new Set();
  const diamondHandData = [];

  walletData.forEach(w => {
    if (isDiamondHand(w)) {
      diamondHands.add(w.address.toLowerCase());
      diamondHandData.push(w);
    }
  });

  console.log(`Diamond hands traders: ${diamondHandData.length} / ${walletData.length} (${(diamondHandData.length/walletData.length*100).toFixed(2)}%)\n`);

  // Show examples
  console.log('Top 10 diamond hands by profit:');
  diamondHandData
    .sort((a, b) => b.total_profit - a.total_profit)
    .slice(0, 10)
    .forEach((w, i) => {
      const ratio = w.total_purchase > 0 ? (w.total_sold / w.total_purchase).toFixed(2) : '0.00';
      console.log(`  ${i+1}. ${w.address.slice(0,10)}... profit=$${w.total_profit.toFixed(0)} sold/purchase=${ratio} trades=${w.total_trades}`);
    });

  console.log('\\n============================================================');
  console.log('[2. Calculate Diamond Hands Participation per Token]');
  console.log('============================================================\\n');

  const tokenStats = [];

  for (const result of earlyTrades.results) {
    const tokenWallets = result.wallets || [];
    const diamondHandCount = tokenWallets.filter(w => diamondHands.has(w.toLowerCase())).length;

    tokenStats.push({
      token_address: result.token_address,
      token_symbol: result.token_symbol,
      quality_label: result.quality_label || 'unlabeled',
      total_wallets: tokenWallets.length,
      diamond_hand_count: diamondHandCount,
      diamond_hand_ratio: tokenWallets.length > 0 ? diamondHandCount / tokenWallets.length : 0
    });
  }

  console.log('Token'.padEnd(20) + 'Quality'.padEnd(15) + 'Wallets'.padEnd(8) + 'Diamond'.padEnd(10) + 'Ratio');
  console.log('-'.repeat(70));

  tokenStats
    .sort((a, b) => b.diamond_hand_ratio - a.diamond_hand_ratio)
    .slice(0, 30)
    .forEach(t => {
      if (t.diamond_hand_count > 0) {
        console.log(
          t.token_symbol.padEnd(20) +
          t.quality_label.padEnd(15) +
          t.total_wallets.toString().padEnd(8) +
          t.diamond_hand_count.toString().padEnd(10) +
          `${(t.diamond_hand_ratio * 100).toFixed(1)}%`
        );
      }
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

  console.log('Quality'.padEnd(15) + 'Count'.padEnd(8) + 'AvgWallets'.padEnd(12) + 'AvgDiamond'.padEnd(14) + 'AvgRatio');
  console.log('-'.repeat(70));

  const groupSummary = [];

  for (const [quality, tokens] of Object.entries(qualityGroups)) {
    if (tokens.length === 0) continue;

    const avgWallets = (tokens.reduce((sum, t) => sum + t.total_wallets, 0) / tokens.length).toFixed(1);
    const avgDiamond = (tokens.reduce((sum, t) => sum + t.diamond_hand_count, 0) / tokens.length).toFixed(1);
    const avgRatio = (tokens.reduce((sum, t) => sum + t.diamond_hand_ratio, 0) / tokens.length * 100).toFixed(2);

    console.log(
      quality.padEnd(15) +
      tokens.length.toString().padEnd(8) +
      avgWallets.padEnd(12) +
      avgDiamond.padEnd(14) +
      `${avgRatio}%`
    );

    groupSummary.push({
      quality,
      count: tokens.length,
      avgWallets: parseFloat(avgWallets),
      avgDiamond: parseFloat(avgDiamond),
      avgRatio: parseFloat(avgRatio)
    });
  }

  // Correlation analysis
  console.log(`\n============================================================`);
  console.log('[4. Correlation Analysis]');
  console.log('============================================================\n');

  const sortedByRatio = [...groupSummary].sort((a, b) => b.avgRatio - a.avgRatio);
  console.log('Sorted by average diamond hand ratio:');

  sortedByRatio.forEach((g, i) => {
    if (g.count > 0) {
      console.log(`  ${i+1}. ${g.quality.padEnd(15)}: ${g.avgRatio}% (${g.count} tokens)`);
    }
  });

  // Comparison with strong traders
  console.log(`\n============================================================`);
  console.log('[5. Comparison: Diamond Hands vs Strong Traders]');
  console.log('============================================================\n');

  const strongTraderData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'step5_final_analysis.json'), 'utf8'));
  const strongTraderQualityGroups = strongTraderData.quality_groups;

  console.log('Quality'.padEnd(15) + 'DiamondHands%'.padEnd(15) + 'StrongTraders%');
  console.log('-'.repeat(50));

  for (const diamondGroup of groupSummary) {
    const strongGroup = strongTraderQualityGroups.find(g => g.quality === diamondGroup.quality);
    if (strongGroup) {
      console.log(
        diamondGroup.quality.padEnd(15) +
        `${diamondGroup.avgRatio}%`.padEnd(15) +
        `${strongGroup.avgRatio.toFixed(2)}%`
      );
    }
  }

  // Conclusion
  console.log(`\n============================================================`);
  console.log('[6. Conclusion]');
  console.log('============================================================\\n');

  if (sortedByRatio.length > 0) {
    const top = sortedByRatio[0];
    const bottom = sortedByRatio[sortedByRatio.length - 1];

    console.log(`- Highest diamond hand participation: ${top.quality} (${top.avgRatio}%, ${top.count} tokens)`);
    console.log(`- Lowest diamond hand participation: ${bottom.quality} (${bottom.avgRatio}%, ${bottom.count} tokens)`);

    console.log(`\n=> Which quality do diamond hands prefer?`);
    if (top.quality === 'high_quality') {
      console.log(`   High quality tokens have highest diamond hand participation.`);
    } else if (top.quality === 'low_quality') {
      console.log(`   Low quality tokens have highest diamond hand participation.`);
    }
  }

  console.log(`\nNote: Analysis based on thresholds profit>=${THRESHOLDS.profitMin}, trades<${THRESHOLDS.maxTrades}`);

  // Save results
  const output = {
    thresholds: THRESHOLDS,
    diamond_hands: {
      count: diamondHandData.length,
      ratio: diamondHandData.length / walletData.length,
      traders: diamondHandData.map(w => ({
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
    path.join(DATA_DIR, 'step6_diamond_hands_analysis.json'),
    JSON.stringify(output, null, 2)
  );

  console.log(`\nDiamond hands analysis saved to data/step6_diamond_hands_analysis.json`);
}

main().catch(console.error);
