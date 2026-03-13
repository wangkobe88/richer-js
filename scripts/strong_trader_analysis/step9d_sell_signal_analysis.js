/**
 * Step 9d: Selling Signal Analysis
 * Identify tokens where strong traders are SELLING (harvesting) in the 1.5min window
 * This may be a stronger negative signal than buying
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const TOTAL_SUPPLY = 1000000000;

async function main() {
  console.log('=== Step 9d: Selling Signal Analysis ===\n');
  console.log('Focus: Strong traders who are SELLING (harvesting) in the 1.5min window\n');

  // Read data (using 90s window data)
  const strongTraderData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'step5_final_analysis.json'), 'utf8'));
  const earlyTrades = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'step2_early_trades_90s.json'), 'utf8'));

  const strongTraderAddresses = new Set(
    strongTraderData.strong_traders.traders.map(t => t.address.toLowerCase())
  );

  console.log(`Strong traders: ${strongTraderAddresses.size}`);
  console.log(`Time window: 90 seconds (1.5 minutes)\n`);

  // Analyze each token
  const tokenStats = [];

  for (const result of earlyTrades.results) {
    const tokenAddress = result.token_address.toLowerCase();
    const tokenSymbol = result.token_symbol;
    const quality = result.quality_label || 'unlabeled';

    let strongTraderBuyAmount = 0;
    let strongTraderSellAmount = 0;
    let strongTraderBuyUSD = 0;
    let strongTraderSellUSD = 0;
    let strongTraderWallets = new Set();
    let strongTraderTrades = 0;

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
        strongTraderTrades++;

        if (isBuy) {
          const amount = parseFloat(trade.to_amount) || 0;
          const usd = parseFloat(trade.to_usd) || 0;
          strongTraderBuyAmount += amount;
          strongTraderBuyUSD += usd;
        }
        if (isSell) {
          const amount = parseFloat(trade.from_amount) || 0;
          const usd = parseFloat(trade.from_usd) || 0;
          strongTraderSellAmount += amount;
          strongTraderSellUSD += usd;
        }
      }
    }

    const netAmount = strongTraderBuyAmount - strongTraderSellAmount;
    const netUSD = strongTraderBuyUSD - strongTraderSellUSD;
    const netBuyRatio = (Math.abs(netAmount) / TOTAL_SUPPLY * 100);
    const totalBuyRatio = (strongTraderBuyAmount / TOTAL_SUPPLY * 100);
    const totalSellRatio = (strongTraderSellAmount / TOTAL_SUPPLY * 100);

    // Selling ratio: how much they're selling relative to buying
    const sellToBuyRatio = strongTraderBuyAmount > 0 ? (strongTraderSellAmount / strongTraderBuyAmount) :
                           (strongTraderSellAmount > 0 ? Infinity : 0);

    // Selling intensity: sell % of total activity
    const totalVolume = strongTraderBuyAmount + strongTraderSellAmount;
    const sellIntensity = totalVolume > 0 ? (strongTraderSellAmount / totalVolume) : 0;

    tokenStats.push({
      token_symbol: tokenSymbol,
      quality: quality,
      quality_score: getQualityScore(quality),
      buy_amount: strongTraderBuyAmount,
      sell_amount: strongTraderSellAmount,
      net_amount: netAmount,
      buy_usd: strongTraderBuyUSD,
      sell_usd: strongTraderSellUSD,
      net_usd: netUSD,
      wallet_count: strongTraderWallets.size,
      trade_count: strongTraderTrades,
      net_buy_ratio: netBuyRatio,
      total_buy_ratio: totalBuyRatio,
      total_sell_ratio: totalSellRatio,
      sell_to_buy_ratio: sellToBuyRatio,
      sell_intensity: sellIntensity,
      is_net_short: netAmount < 0,
      has_buy: strongTraderBuyAmount > 0,
      has_sell: strongTraderSellAmount > 0
    });
  }

  console.log('============================================================');
  console.log('[1] Pure SELLING Tokens (No Buy Activity)');
  console.log('============================================================\n');
  console.log('These tokens show only SELLING from strong traders - possible harvesting!\n');

  const pureSelling = tokenStats.filter(t => t.has_sell && !t.has_buy);
  console.log(`Found ${pureSelling.length} tokens with pure selling activity\n`);

  console.log('Rank'.padEnd(5) + 'Token'.padEnd(20) + 'Quality'.padEnd(15) + 'SellAmount'.padEnd(15) + 'SellRatio');
  console.log('-'.repeat(75));

  const pureSellingQualityCount = { high_quality: 0, mid_quality: 0, low_quality: 0, unlabeled: 0 };

  pureSelling.sort((a, b) => b.sell_amount - a.sell_amount).forEach((t, i) => {
    console.log(
      (i + 1).toString().padEnd(5) +
      t.token_symbol.padEnd(20) +
      t.quality.padEnd(15) +
      formatAmount(t.sell_amount).padEnd(15) +
      t.total_sell_ratio.toFixed(2) + '%'
    );
    pureSellingQualityCount[t.quality]++;
  });

  console.log('\nQuality distribution (pure selling):');
  console.log(`  High quality: ${pureSellingQualityCount.high_quality}`);
  console.log(`  Mid quality: ${pureSellingQualityCount.mid_quality}`);
  console.log(`  Low quality: ${pureSellingQualityCount.low_quality}`);

  console.log('\n============================================================');
  console.log('[2] HEAVY SELLING Tokens (Sell > Buy)');
  console.log('============================================================\n');
  console.log('Tokens where strong traders are selling MORE than buying\n');

  const heavySelling = tokenStats.filter(t => t.has_sell && t.sell_to_buy_ratio > 1.5);
  console.log(`Found ${heavySelling.length} tokens with sell/buy > 1.5\n`);

  console.log('Rank'.padEnd(5) + 'Token'.padEnd(20) + 'Quality'.padEnd(15) + 'Sell/Buy'.padEnd(12) + 'SellInt'.padEnd(10) + 'NetPos');
  console.log('-'.repeat(85));

  const heavySellingQualityCount = { high_quality: 0, mid_quality: 0, low_quality: 0, unlabeled: 0 };

  heavySelling.sort((a, b) => b.sell_to_buy_ratio - a.sell_to_buy_ratio).slice(0, 30).forEach((t, i) => {
    const pos = t.net_amount > 0 ? 'LONG' : 'SHORT';
    console.log(
      (i + 1).toString().padEnd(5) +
      t.token_symbol.padEnd(20) +
      t.quality.padEnd(15) +
      t.sell_to_buy_ratio === Infinity ? 'Inf'.padEnd(12) : t.sell_to_buy_ratio.toFixed(2).padEnd(12) +
      (t.sell_intensity * 100).toFixed(0) + '%'.padEnd(10) +
      pos
    );
    heavySellingQualityCount[t.quality]++;
  });

  console.log('\nQuality distribution (heavy selling):');
  console.log(`  High quality: ${heavySellingQualityCount.high_quality}`);
  console.log(`  Mid quality: ${heavySellingQualityCount.mid_quality}`);
  console.log(`  Low quality: ${heavySellingQualityCount.low_quality}`);

  console.log('\n============================================================');
  console.log('[3] Correlation Analysis: Selling Metrics vs Quality');
  console.log('============================================================\n');

  const correlationData = tokenStats.filter(t => t.quality !== 'unlabeled' && t.has_sell);

  // Test different selling metrics
  const metrics = [
    { key: 'total_sell_ratio', name: 'Total Sell Ratio' },
    { key: 'sell_to_buy_ratio', name: 'Sell/Buy Ratio', filter: t => t.has_buy },
    { key: 'sell_intensity', name: 'Sell Intensity' },
    { key: 'net_buy_ratio', name: 'Net Buy Ratio (|buy-sell|)' }
  ];

  console.log('Metric'.padEnd(25) + 'Spearman'.padEnd(12) + 'Interpretation');
  console.log('-'.repeat(60));

  for (const metric of metrics) {
    const data = metric.filter ? correlationData.filter(metric.filter) : correlationData;
    if (data.length < 5) continue;

    const spearman = calculateSpearman(data, metric.key, 'quality_score');
    const signal = spearman < -0.3 ? 'NEGATIVE' : (spearman > 0.3 ? 'POSITIVE' : 'WEAK');
    console.log(metric.name.padEnd(25) + spearman.toFixed(4).padEnd(12) + signal);
  }

  console.log('\n============================================================');
  console.log('[4] Average Selling Metrics by Quality');
  console.log('============================================================\n');

  const groups = { high_quality: [], mid_quality: [], low_quality: [], unlabeled: [] };
  tokenStats.filter(t => t.has_sell).forEach(t => {
    if (groups[t.quality]) groups[t.quality].push(t);
  });

  console.log('Quality'.padEnd(15) + 'Count'.padEnd(8) + 'AvgSell%'.padEnd(12) + 'AvgSellInt'.padEnd(12) + 'PureSell%');
  console.log('-'.repeat(70));

  for (const [quality, tokens] of Object.entries(groups)) {
    if (tokens.length === 0) continue;

    const avgSellRatio = tokens.reduce((sum, t) => sum + t.total_sell_ratio, 0) / tokens.length;
    const avgSellIntensity = tokens.reduce((sum, t) => sum + t.sell_intensity, 0) / tokens.length;
    const pureSellCount = tokens.filter(t => !t.has_buy).length;
    const pureSellPct = pureSellCount / tokens.length * 100;

    console.log(
      quality.padEnd(15) +
      tokens.length.toString().padEnd(8) +
      avgSellRatio.toFixed(2) + '%'.padEnd(12) +
      (avgSellIntensity * 100).toFixed(0) + '%'.padEnd(12) +
      pureSellPct.toFixed(1) + '%'
    );
  }

  console.log('\n============================================================');
  console.log('[5] High Sell Ratio Analysis');
  console.log('============================================================\n');

  // Tokens where sell ratio >= 3%
  const highSellRatio = tokenStats.filter(t => t.total_sell_ratio >= 3);
  console.log(`Tokens with Sell Ratio >= 3%: ${highSellRatio.length}`);

  const highSellDist = {};
  highSellRatio.forEach(t => {
    highSellDist[t.quality] = (highSellDist[t.quality] || 0) + 1;
  });

  Object.entries(highSellDist).sort((a, b) => b[1] - a[1]).forEach(([q, c]) => {
    console.log(`  ${q}: ${c} (${(c/highSellRatio.length*100).toFixed(1)}%)`);
  });

  // Pure selling tokens with high sell ratio
  const pureSellingHigh = highSellRatio.filter(t => !t.has_buy);
  console.log(`\nPure selling (no buy) with Sell Ratio >= 3%: ${pureSellingHigh.length}`);

  if (pureSellingHigh.length > 0) {
    const pureSellingHighDist = {};
    pureSellingHigh.forEach(t => {
      pureSellingHighDist[t.quality] = (pureSellingHighDist[t.quality] || 0) + 1;
    });

    Object.entries(pureSellingHighDist).sort((a, b) => b[1] - a[1]).forEach(([q, c]) => {
      console.log(`  ${q}: ${c} (${(c/pureSellingHigh.length*100).toFixed(1)}%)`);
    });
  }

  console.log('\n============================================================');
  console.log('[6] CONCLUSION & INSIGHTS]');
  console.log('============================================================\n');

  // Calculate correlations for key metrics
  const sellIntensitySpearman = calculateSpearman(
    tokenStats.filter(t => t.quality !== 'unlabeled' && t.has_sell),
    'sell_intensity',
    'quality_score'
  );

  const pureSellTokens = tokenStats.filter(t => !t.has_buy && t.has_sell);
  const pureSellWithQuality = pureSellTokens.filter(t => t.quality !== 'unlabeled');
  const pureSellLowQuality = pureSellWithQuality.filter(t => t.quality === 'low_quality').length;
  const pureSellPctLow = pureSellWithQuality.length > 0 ? pureSellLowQuality / pureSellWithQuality.length * 100 : 0;

  console.log('Key findings:');
  console.log(`  1. Pure selling tokens: ${pureSellTokens.length}`);
  console.log(`     - Low quality ratio: ${pureSellPctLow.toFixed(1)}%`);
  console.log(`  2. Sell intensity correlation: ${sellIntensitySpearman.toFixed(4)}`);

  if (sellIntensitySpearman < -0.2) {
    console.log(`  3. ✓ Sell intensity is a NEGATIVE signal for quality`);
    console.log('     Higher sell intensity → Lower quality tokens');
  }

  if (pureSellPctLow > 50) {
    console.log(`  4. ✓ Pure selling (no buy) strongly indicates low quality`);
    console.log('     When strong traders only sell, it\'s likely a low-quality token');
  }

  // Save results
  const output = {
    pure_selling_tokens: pureSelling,
    heavy_selling_tokens: heavySelling,
    quality_distributions: {
      pure_selling: pureSellingQualityCount,
      heavy_selling: heavySellingQualityCount,
      high_sell_ratio: highSellDist
    },
    correlations: {
      sell_intensity: sellIntensitySpearman
    },
    averages_by_quality: Object.fromEntries(
      Object.entries(groups).map(([q, tokens]) => [
        q,
        {
          count: tokens.length,
          avg_sell_ratio: tokens.reduce((sum, t) => sum + t.total_sell_ratio, 0) / tokens.length,
          avg_sell_intensity: tokens.reduce((sum, t) => sum + t.sell_intensity, 0) / tokens.length,
          pure_sell_pct: tokens.filter(t => !t.has_buy).length / tokens.length * 100
        }
      ])
    )
  };

  fs.writeFileSync(
    path.join(DATA_DIR, 'step9d_sell_signal_analysis.json'),
    JSON.stringify(output, null, 2)
  );

  console.log('\n✅ Analysis saved to data/step9d_sell_signal_analysis.json');
}

function getQualityScore(quality) {
  const scores = { high_quality: 2, mid_quality: 1, low_quality: 0, unlabeled: 1 };
  return scores[quality] || 1;
}

function calculateSpearman(data, xKey, yKey) {
  const rankX = new Map();
  const rankY = new Map();

  const sortedX = [...data].sort((a, b) => {
    const ax = a[xKey] === Infinity ? 999999 : a[xKey];
    const bx = b[xKey] === Infinity ? 999999 : b[xKey];
    return ax - bx;
  });
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

function formatAmount(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(2) + 'K';
  return num.toFixed(2);
}

main().catch(console.error);
