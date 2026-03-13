/**
 * Step 7: Strong Trader Holdings Analysis
 * Analyze strong trader token holdings and their % of total supply
 * fourmeme total supply = 1,000,000,000 (1 billion)
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const TOTAL_SUPPLY = 1000000000; // 1 billion

async function main() {
  console.log('=== Step 7: Strong Trader Holdings Analysis ===\n');
  console.log('Total supply: 1,000,000,000 (1 billion tokens)\n');

  // Read data
  const strongTraderData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'step5_final_analysis.json'), 'utf8'));
  const walletData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'step3_wallet_data.json'), 'utf8'));
  const signalsData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'step1_signals_and_tokens.json'), 'utf8'));

  // Get strong trader addresses
  const strongTraderAddresses = new Set(
    strongTraderData.strong_traders.traders.map(t => t.address.toLowerCase())
  );

  console.log('============================================================');
  console.log('[1. Strong Trader Token Holdings]');
  console.log('============================================================\n');

  // Build token address -> token info map
  const tokenInfoMap = new Map();
  for (const signal of signalsData.signals) {
    const info = signal.token_info;
    if (info && info.main_pair) {
      tokenInfoMap.set(info.main_pair.toLowerCase(), {
        address: info.main_pair,
        symbol: info.symbol || 'Unknown',
        quality: signal.quality_label || 'unlabeled'
      });
    }
  }

  // Analyze strong trader holdings
  const holdingsByToken = new Map(); // token_address -> {holders, total_amount, total_usd}

  for (const wallet of walletData) {
    if (!strongTraderAddresses.has(wallet.address.toLowerCase())) continue;
    if (!wallet.raw_data || !wallet.raw_data.tokens) continue;

    for (const token of wallet.raw_data.tokens) {
      const tokenAddr = token.token.toLowerCase();
      const amount = parseFloat(token.balance_amount) || 0;
      const usd = parseFloat(token.balance_usd) || 0;

      // Filter out anomalies
      if (amount <= 0) continue;
      if (usd > 10000) continue; // Filter out unrealistic USD values (> $10K)
      if (amount > 10000000) continue; // Filter out unrealistic token amounts (> 10M)
      if (amount > TOTAL_SUPPLY / 100) continue; // Cannot hold more than 1% of total supply

      if (!holdingsByToken.has(tokenAddr)) {
        holdingsByToken.set(tokenAddr, {
          token_address: tokenAddr,
          symbol: token.symbol || 'Unknown',
          holders: 0,
          total_amount: 0,
          total_usd: 0,
          holder_details: []
        });
      }

      const holdings = holdingsByToken.get(tokenAddr);
      holdings.holders++;
      holdings.total_amount += amount;
      holdings.total_usd += usd;
      holdings.holder_details.push({
        wallet: wallet.address,
        amount: amount,
        usd: usd
      });
    }
  }

  // Sort by total USD value
  const sortedHoldings = [...holdingsByToken.values()].sort((a, b) => b.total_usd - a.total_usd);

  console.log('Top 30 tokens by strong trader holdings (USD value):');
  console.log('');
  console.log('Token'.padEnd(20) + 'Quality'.padEnd(15) + 'Holders'.padEnd(8) + 'TotalAmount'.padEnd(15) + 'TotalUSD'.padEnd(12) + 'PctOfSupply');
  console.log('-'.repeat(100));

  let count = 0;
  for (const holdings of sortedHoldings) {
    const tokenInfo = tokenInfoMap.get(holdings.token_address.toLowerCase());
    const quality = tokenInfo ? tokenInfo.quality : 'unknown';
    const pctOfSupply = (holdings.total_amount / TOTAL_SUPPLY * 100).toFixed(6);

    console.log(
      holdings.symbol.padEnd(20) +
      quality.padEnd(15) +
      holdings.holders.toString().padEnd(8) +
      formatNumber(holdings.total_amount).padEnd(15) +
      formatUSD(holdings.total_usd).padEnd(12) +
      `${pctOfSupply}%`
    );

    count++;
    if (count >= 30) break;
  }

  console.log('\n============================================================');
  console.log('[2. Holdings Distribution by Quality]');
  console.log('============================================================\n');

  // Group by quality
  const qualityGroups = {
    high_quality: { tokens: [], total_usd: 0, total_amount: 0 },
    mid_quality: { tokens: [], total_usd: 0, total_amount: 0 },
    low_quality: { tokens: [], total_usd: 0, total_amount: 0 },
    unlabeled: { tokens: [], total_usd: 0, total_amount: 0 },
    unknown: { tokens: [], total_usd: 0, total_amount: 0 }
  };

  for (const holdings of sortedHoldings) {
    const tokenInfo = tokenInfoMap.get(holdings.token_address.toLowerCase());
    const quality = tokenInfo ? tokenInfo.quality : 'unknown';

    if (qualityGroups[quality]) {
      qualityGroups[quality].tokens.push(holdings);
      qualityGroups[quality].total_usd += holdings.total_usd;
      qualityGroups[quality].total_amount += holdings.total_amount;
    }
  }

  console.log('Quality'.padEnd(15) + 'Tokens'.padEnd(8) + 'TotalUSD'.padEnd(15) + 'AvgUSD/Token');
  console.log('-'.repeat(60));

  for (const [quality, data] of Object.entries(qualityGroups)) {
    if (data.tokens.length === 0) continue;
    const avgUSD = (data.total_usd / data.tokens.length).toFixed(0);
    console.log(
      quality.padEnd(15) +
      data.tokens.length.toString().padEnd(8) +
      formatUSD(data.total_usd).padEnd(15) +
      `$${avgUSD}`
    );
  }

  console.log('\n============================================================');
  console.log('[3. Individual Strong Trader Holdings]');
  console.log('============================================================\n');

  // Analyze per strong trader
  const traderHoldings = [];

  for (const wallet of walletData) {
    if (!strongTraderAddresses.has(wallet.address.toLowerCase())) continue;
    if (!wallet.raw_data || !wallet.raw_data.tokens) continue;

    let totalUSD = 0;
    let totalAmount = 0;
    let tokenCount = 0;

    for (const token of wallet.raw_data.tokens) {
      const amount = parseFloat(token.balance_amount) || 0;
      const usd = parseFloat(token.balance_usd) || 0;

      // Apply same filtering as above
      if (amount > 0 && usd > 0 && usd <= 10000 && amount <= 10000000 && amount <= TOTAL_SUPPLY / 100) {
        totalUSD += usd;
        totalAmount += amount;
        tokenCount++;
      }
    }

    traderHoldings.push({
      wallet: wallet.address,
      total_usd: totalUSD,
      total_amount: totalAmount,
      token_count: tokenCount,
      total_profit: wallet.total_profit
    });
  }

  traderHoldings.sort((a, b) => b.total_usd - a.total_usd);

  console.log('Top 10 strong traders by current holdings value:');
  console.log('');
  console.log('Wallet'.padEnd(12) + 'HoldingsUSD'.padEnd(15) + 'Tokens'.padEnd(8) + 'TotalProfit');
  console.log('-'.repeat(60));

  traderHoldings.slice(0, 10).forEach((t, i) => {
    console.log(
      `${i+1}. ${t.wallet.slice(0, 10)}...`.padEnd(15) +
      formatUSD(t.total_usd).padEnd(15) +
      t.token_count.toString().padEnd(8) +
      formatUSD(t.total_profit)
    );
  });

  console.log('\n============================================================');
  console.log('[4. Large Position Analysis]');
  console.log('============================================================\n');

  console.log('Positions where strong traders hold > 0.01% of total supply:');
  console.log('');

  let largePositionCount = 0;
  for (const holdings of sortedHoldings) {
    const pctOfSupply = holdings.total_amount / TOTAL_SUPPLY;
    if (pctOfSupply >= 0.0001) { // 0.01%
      const tokenInfo = tokenInfoMap.get(holdings.token_address.toLowerCase());
      const quality = tokenInfo ? tokenInfo.quality : 'unknown';

      console.log(`${holdings.symbol} (${quality}): ${(pctOfSupply * 100).toFixed(4)}% of supply`);
      console.log(`  ${holdings.holders} holders, ${formatUSD(holdings.total_usd)} USD, ${formatNumber(holdings.total_amount)} tokens`);
      largePositionCount++;
    }
  }

  if (largePositionCount === 0) {
    console.log('None found. Strong traders do not hold > 0.01% of any single token supply.');
  }

  console.log('\n============================================================');
  console.log('[5. Summary]');
  console.log('============================================================\n');

  const grandTotalUSD = traderHoldings.reduce((sum, t) => sum + t.total_usd, 0);
  const avgHoldingsPerTrader = traderHoldings.reduce((sum, t) => sum + t.total_usd, 0) / traderHoldings.length;
  const totalTokensWithHoldings = sortedHoldings.length;

  console.log(`Strong traders with holdings: ${traderHoldings.length}`);
  console.log(`Total tokens held by strong traders: ${totalTokensWithHoldings}`);
  console.log(`Total USD value of all holdings: ${formatUSD(grandTotalUSD)}`);
  console.log(`Average holdings per trader: ${formatUSD(avgHoldingsPerTrader)}`);
  console.log(`Total supply percentage: ${(traderHoldings.reduce((sum, t) => sum + t.total_amount, 0) / TOTAL_SUPPLY * 100).toFixed(8)}%`);

  // Save results
  const output = {
    total_supply: TOTAL_SUPPLY,
    holdings_by_token: sortedHoldings.map(h => ({
      token_address: h.token_address,
      symbol: h.symbol,
      holders: h.holders,
      total_amount: h.total_amount,
      total_usd: h.total_usd,
      percent_of_supply: h.total_amount / TOTAL_SUPPLY * 100
    })),
    quality_summary: Object.fromEntries(
      Object.entries(qualityGroups).map(([q, data]) => [
        q,
        {
          token_count: data.tokens.length,
          total_usd: data.total_usd,
          total_amount: data.total_amount
        }
      ])
    ),
    trader_holdings: traderHoldings,
    summary: {
      traders_with_holdings: traderHoldings.length,
      total_tokens_held: totalTokensWithHoldings,
      total_usd_value: grandTotalUSD,
      avg_holdings_per_trader: avgHoldingsPerTrader,
      total_supply_percent: traderHoldings.reduce((sum, t) => sum + t.total_amount, 0) / TOTAL_SUPPLY * 100
    }
  };

  fs.writeFileSync(
    path.join(DATA_DIR, 'step7_strong_trader_holdings.json'),
    JSON.stringify(output, null, 2)
  );

  console.log('\nStrong trader holdings analysis saved to data/step7_strong_trader_holdings.json');
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(2) + 'K';
  return num.toFixed(2);
}

function formatUSD(num) {
  if (Math.abs(num) >= 1000) return '$' + (num / 1000).toFixed(1) + 'K';
  return '$' + num.toFixed(2);
}

main().catch(console.error);
