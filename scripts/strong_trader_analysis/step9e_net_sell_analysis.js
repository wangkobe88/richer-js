/**
 * Step 9e: Net Sell Ratio Analysis
 * Focus on: Net Sell Ratio = sell amount / total supply
 * This captures how much strong traders are selling relative to total supply
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const TOTAL_SUPPLY = 1000000000;

async function main() {
  console.log('=== Step 9e: Net Sell Ratio Analysis ===\n');
  console.log('Focus: How much strong traders are SELLING relative to total supply\n');

  // Read data (using 90s window)
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
        if (isBuy) {
          strongTraderBuyAmount += parseFloat(trade.to_amount) || 0;
        }
        if (isSell) {
          strongTraderSellAmount += parseFloat(trade.from_amount) || 0;
        }
      }
    }

    const netAmount = strongTraderBuyAmount - strongTraderSellAmount;

    // Key metrics
    const netSellRatio = (strongTraderSellAmount / TOTAL_SUPPLY * 100);  // 卖出占总供应量比例
    const netBuyRatio = (strongTraderBuyAmount / TOTAL_SUPPLY * 100);    // 买入占总供应量比例
    const netPositionRatio = (Math.abs(netAmount) / TOTAL_SUPPLY * 100); // 净持仓占总供应量比例
    const sellToTotalRatio = (strongTraderBuyAmount + strongTraderSellAmount) > 0 ?
                             (strongTraderSellAmount / (strongTraderBuyAmount + strongTraderSellAmount)) : 0;

    tokenStats.push({
      token_symbol: tokenSymbol,
      quality: quality,
      quality_score: getQualityScore(quality),
      net_sell_ratio: netSellRatio,           // 核心指标：净卖出占比
      net_buy_ratio_input: netBuyRatio,
      net_position_ratio: netPositionRatio,
      sell_to_total_ratio: sellToTotalRatio,  // 卖出占总交易量比例
      buy_amount: strongTraderBuyAmount,
      sell_amount: strongTraderSellAmount,
      net_amount: netAmount,
      is_net_short: netAmount < 0,
      has_activity: strongTraderBuyAmount > 0 || strongTraderSellAmount > 0
    });
  }

  // Filter tokens with activity
  const activeTokens = tokenStats.filter(t => t.has_activity);

  console.log('============================================================');
  console.log('[1] Top 30 by Net Sell Ratio (卖出占总供应量比例)');
  console.log('============================================================\n');

  const topBySellRatio = [...activeTokens]
    .sort((a, b) => b.net_sell_ratio - a.net_sell_ratio)
    .slice(0, 30);

  console.log('Rank'.padEnd(5) + 'Token'.padEnd(20) + 'Quality'.padEnd(15) + 'Sell%'.padEnd(10) + 'Buy%'.padEnd(10) + 'Net%');
  console.log('-'.repeat(75));

  const sellRatioQualityCount = { high_quality: 0, mid_quality: 0, low_quality: 0, unlabeled: 0 };

  topBySellRatio.forEach((t, i) => {
    console.log(
      (i + 1).toString().padEnd(5) +
      t.token_symbol.padEnd(20) +
      t.quality.padEnd(15) +
      t.net_sell_ratio.toFixed(2) + '%'.padEnd(10) +
      t.net_buy_ratio_input.toFixed(2) + '%'.padEnd(10) +
      t.net_position_ratio.toFixed(2) + '%'
    );
    sellRatioQualityCount[t.quality]++;
  });

  console.log('\nQuality distribution in Top 30 (by Sell Ratio):');
  console.log(`  High quality: ${sellRatioQualityCount.high_quality}`);
  console.log(`  Mid quality: ${sellRatioQualityCount.mid_quality}`);
  console.log(`  Low quality: ${sellRatioQualityCount.low_quality}`);

  console.log('\n============================================================');
  console.log('[2] Average Metrics by Quality Group');
  console.log('============================================================\n');

  const groups = { high_quality: [], mid_quality: [], low_quality: [], unlabeled: [] };
  activeTokens.filter(t => t.quality !== 'unlabeled').forEach(t => {
    if (groups[t.quality]) groups[t.quality].push(t);
  });

  console.log('Quality'.padEnd(15) + 'Count'.padEnd(8) + 'AvgSell%'.padEnd(12) + 'AvgBuy%'.padEnd(12) + 'AvgNet%');
  console.log('-'.repeat(70));

  for (const [quality, tokens] of Object.entries(groups)) {
    if (tokens.length === 0) continue;

    const avgSell = tokens.reduce((sum, t) => sum + t.net_sell_ratio, 0) / tokens.length;
    const avgBuy = tokens.reduce((sum, t) => sum + t.net_buy_ratio_input, 0) / tokens.length;
    const avgNet = tokens.reduce((sum, t) => sum + t.net_position_ratio, 0) / tokens.length;

    console.log(
      quality.padEnd(15) +
      tokens.length.toString().padEnd(8) +
      avgSell.toFixed(2) + '%'.padEnd(12) +
      avgBuy.toFixed(2) + '%'.padEnd(12) +
      avgNet.toFixed(2) + '%'
    );
  }

  console.log('\n============================================================');
  console.log('[3] Correlation Analysis: All Metrics vs Quality');
  console.log('============================================================\n');

  const correlationData = activeTokens.filter(t => t.quality !== 'unlabeled');

  const metrics = [
    { key: 'net_sell_ratio', name: 'Net Sell Ratio (卖出/总供应量)' },
    { key: 'net_buy_ratio_input', name: 'Net Buy Ratio (买入/总供应量)' },
    { key: 'net_position_ratio', name: 'Net Position Ratio (|买入-卖出|/总供应量)' },
    { key: 'sell_to_total_ratio', name: 'Sell/Total Ratio (卖出/总交易量)' }
  ];

  console.log('Metric'.padEnd(45) + 'Spearman'.padEnd(12) + 'Interpretation');
  console.log('-'.repeat(75));

  for (const metric of metrics) {
    const spearman = calculateSpearman(correlationData, metric.key, 'quality_score');
    const signal = spearman < -0.3 ? 'NEGATIVE (高值=低质量)' :
                   spearman > 0.3 ? 'POSITIVE (高值=高质量)' : 'WEAK';
    console.log(metric.name.padEnd(45) + spearman.toFixed(4).padEnd(12) + signal);
  }

  console.log('\n============================================================');
  console.log('[4] High Net Sell Ratio Analysis');
  console.log('============================================================\n');

  // Tokens with net sell ratio >= 5%
  const highSellRatio = correlationData.filter(t => t.net_sell_ratio >= 5);
  console.log(`Tokens with Net Sell Ratio >= 5%: ${highSellRatio.length}`);

  const highSellDist = {};
  highSellRatio.forEach(t => {
    highSellDist[t.quality] = (highSellDist[t.quality] || 0) + 1;
  });

  Object.entries(highSellDist).sort((a, b) => b[1] - a[1]).forEach(([q, c]) => {
    console.log(`  ${q}: ${c} (${(c/highSellRatio.length*100).toFixed(1)}%)`);
  });

  // Tokens with net sell ratio >= 3%
  const medSellRatio = correlationData.filter(t => t.net_sell_ratio >= 3);
  console.log(`\nTokens with Net Sell Ratio >= 3%: ${medSellRatio.length}`);

  const medSellDist = {};
  medSellRatio.forEach(t => {
    medSellDist[t.quality] = (medSellDist[t.quality] || 0) + 1;
  });

  Object.entries(medSellDist).sort((a, b) => b[1] - a[1]).forEach(([q, c]) => {
    console.log(`  ${q}: ${c} (${(c/medSellRatio.length*100).toFixed(1)}%)`);
  });

  console.log('\n============================================================');
  console.log('[5] Net Short Position Analysis (卖出 > 买入)');
  console.log('============================================================\n');

  const netShortTokens = correlationData.filter(t => t.net_amount < 0);
  console.log(`Tokens where strong traders are NET SHORT: ${netShortTokens.length}`);

  const netShortDist = {};
  netShortTokens.forEach(t => {
    netShortDist[t.quality] = (netShortDist[t.quality] || 0) + 1;
  });

  Object.entries(netShortDist).sort((a, b) => b[1] - a[1]).forEach(([q, c]) => {
    const pct = (c / netShortTokens.length * 100).toFixed(1);
    console.log(`  ${q}: ${c} (${pct}%)`);
  });

  if (netShortTokens.length > 0) {
    const avgNetShortSell = netShortTokens.reduce((sum, t) => sum + t.net_sell_ratio, 0) / netShortTokens.length;
    const avgNetShortBuy = netShortTokens.reduce((sum, t) => sum + t.net_buy_ratio_input, 0) / netShortTokens.length;
    console.log(`\nNet Short tokens average:`);
    console.log(`  Sell ratio: ${avgNetShortSell.toFixed(2)}%`);
    console.log(`  Buy ratio: ${avgNetShortBuy.toFixed(2)}%`);
  }

  console.log('\n============================================================');
  console.log('[6] FINAL COMPARISON: Which Metric Best Predicts Quality?');
  console.log('============================================================\n');

  console.log('Ranked by absolute correlation strength:\n');

  const correlationResults = metrics.map(m => ({
    ...m,
    spearman: calculateSpearman(correlationData, m.key, 'quality_score')
  })).sort((a, b) => Math.abs(b.spearman) - Math.abs(a.spearman));

  console.log('Rank'.padEnd(5) + 'Metric'.padEnd(45) + '|Spearman|'.padEnd(12) + 'Signal Type');
  console.log('-'.repeat(80));

  correlationResults.forEach((r, i) => {
    const signalType = r.spearman < 0 ? 'NEGATIVE' : 'POSITIVE';
    console.log(
      (i + 1).toString().padEnd(5) +
      r.name.padEnd(45) +
      Math.abs(r.spearman).toFixed(4).padEnd(12) +
      signalType
    );
  });

  console.log('\n============================================================');
  console.log('[7] CONCLUSION]');
  console.log('============================================================\n');

  const best = correlationResults[0];
  console.log(`Best predictor: ${best.name}`);
  console.log(`  Spearman correlation: ${best.spearman.toFixed(4)}`);

  if (best.spearman < -0.3) {
    console.log(`  ✓ Strong NEGATIVE correlation: Higher ${best.key.split('_').slice(0, 2).join(' ')} → LOWER quality`);
  } else if (best.spearman > 0.3) {
    console.log(`  ✓ Strong POSITIVE correlation: Higher ${best.key.split('_').slice(0, 2).join(' ')} → HIGHER quality`);
  }

  // Check net sell ratio specifically
  const netSellCorr = correlationResults.find(r => r.key === 'net_sell_ratio');
  console.log(`\nNet Sell Ratio specifically:`);
  console.log(`  Correlation: ${netSellCorr.spearman.toFixed(4)}`);

  if (netSellCorr.spearman < -0.2) {
    console.log(`  → Net Sell Ratio is a NEGATIVE signal for quality`);
    console.log(`  → Strong traders selling more = Lower quality token`);
    console.log(`  → This confirms the "harvesting" hypothesis`);
  } else if (netSellCorr.spearman > 0.2) {
    console.log(`  → Net Sell Ratio is a POSITIVE signal for quality`);
    console.log(`  → Strong traders sell MORE in high quality tokens`);
    console.log(`  → This suggests profit-taking in good tokens`);
  }

  // Save results
  const output = {
    best_predictor: best,
    all_correlations: correlationResults,
    top_by_sell_ratio: topBySellRatio,
    quality_distributions: {
      high_sell_ratio_5pct: highSellDist,
      high_sell_ratio_3pct: medSellDist,
      net_short: netShortDist
    },
    averages_by_quality: Object.fromEntries(
      Object.entries(groups).map(([q, tokens]) => [
        q,
        {
          count: tokens.length,
          avg_net_sell_ratio: tokens.reduce((sum, t) => sum + t.net_sell_ratio, 0) / tokens.length,
          avg_net_buy_ratio: tokens.reduce((sum, t) => sum + t.net_buy_ratio_input, 0) / tokens.length,
          avg_net_position_ratio: tokens.reduce((sum, t) => sum + t.net_position_ratio, 0) / tokens.length
        }
      ])
    )
  };

  fs.writeFileSync(
    path.join(DATA_DIR, 'step9e_net_sell_analysis.json'),
    JSON.stringify(output, null, 2)
  );

  console.log('\n✅ Analysis saved to data/step9e_net_sell_analysis.json');
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
