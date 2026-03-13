/**
 * Step 8: Strong Trader Purchase Analysis
 * Analyze how much tokens strong traders purchased during early trading window
 * Calculate % of total supply (1 billion) purchased by strong traders
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const TOTAL_SUPPLY = 1000000000; // 1 billion

async function main() {
  console.log('=== Step 8: Strong Trader Purchase Analysis ===\n');
  console.log('Total supply: 1,000,000,000 (1 billion tokens)\n');

  // Read data
  const strongTraderData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'step5_final_analysis.json'), 'utf8'));
  const earlyTrades = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'step2_early_trades.json'), 'utf8'));

  // Get strong trader addresses
  const strongTraderAddresses = new Set(
    strongTraderData.strong_traders.traders.map(t => t.address.toLowerCase())
  );

  console.log('============================================================');
  console.log('[1. Analyze Strong Trader Purchases per Token]');
  console.log('============================================================\n');

  const tokenPurchaseStats = [];

  for (const result of earlyTrades.results) {
    const tokenAddress = result.token_address.toLowerCase();
    const tokenSymbol = result.token_symbol;
    const quality = result.quality_label || 'unlabeled';

    // Analyze trades for this token
    let totalPurchaseAmount = 0; // Total tokens purchased by everyone
    let totalSellAmount = 0; // Total tokens sold by everyone
    let strongTraderBuyAmount = 0; // Total tokens bought by strong traders
    let strongTraderSellAmount = 0; // Total tokens sold by strong traders
    let strongTraderBuyUSD = 0;
    let strongTraderSellUSD = 0;
    let strongTraderTradeCount = 0;
    let strongTraderWallets = new Set();
    const tradesByStrongTrader = new Map(); // wallet -> {buy_amount, sell_amount, buy_usd, sell_usd, trades}

    for (const trade of result.trades || []) {
      const wallet = trade.wallet_address ? trade.wallet_address.toLowerCase() :
                     trade.from_address ? trade.from_address.toLowerCase() : '';

      if (!wallet) continue;

      const toToken = trade.to_token ? trade.to_token.toLowerCase() : '';
      const fromToken = trade.from_token ? trade.from_token.toLowerCase() : '';

      // Check if this trade involves the target token
      const isBuy = toToken === tokenAddress;
      const isSell = fromToken === tokenAddress;

      if (!isBuy && !isSell) continue;

      if (isBuy) {
        const amount = parseFloat(trade.to_amount) || 0;
        const usd = parseFloat(trade.to_usd) || 0;
        totalPurchaseAmount += amount;

        if (strongTraderAddresses.has(wallet)) {
          strongTraderBuyAmount += amount;
          strongTraderBuyUSD += usd;
          strongTraderTradeCount++;

          if (!tradesByStrongTrader.has(wallet)) {
            tradesByStrongTrader.set(wallet, { buy_amount: 0, sell_amount: 0, buy_usd: 0, sell_usd: 0, trades: 0 });
          }
          const stats = tradesByStrongTrader.get(wallet);
          stats.buy_amount += amount;
          stats.buy_usd += usd;
          stats.trades++;
          strongTraderWallets.add(wallet);
        }
      }

      if (isSell) {
        const amount = parseFloat(trade.from_amount) || 0;
        const usd = parseFloat(trade.from_usd) || 0;
        totalSellAmount += amount;

        if (strongTraderAddresses.has(wallet)) {
          strongTraderSellAmount += amount;
          strongTraderSellUSD += usd;

          if (!tradesByStrongTrader.has(wallet)) {
            tradesByStrongTrader.set(wallet, { buy_amount: 0, sell_amount: 0, buy_usd: 0, sell_usd: 0, trades: 0 });
          }
          const stats = tradesByStrongTrader.get(wallet);
          stats.sell_amount += amount;
          stats.sell_usd += usd;
          strongTraderWallets.add(wallet);
        }
      }
    }

    // Calculate net position
    const netAmount = strongTraderBuyAmount - strongTraderSellAmount;
    const netUSD = strongTraderBuyUSD - strongTraderSellUSD;

    const pctOfTotalSupply = (Math.abs(netAmount) / TOTAL_SUPPLY * 100);
    const pctOfEarlyPurchases = totalPurchaseAmount > 0 ? (strongTraderBuyAmount / totalPurchaseAmount * 100) : 0;

    tokenPurchaseStats.push({
      token_address: result.token_address,
      token_symbol: tokenSymbol,
      quality_label: quality,
      total_early_purchase_amount: totalPurchaseAmount,
      total_early_sell_amount: totalSellAmount,
      strong_trader_buy_amount: strongTraderBuyAmount,
      strong_trader_sell_amount: strongTraderSellAmount,
      strong_trader_net_amount: netAmount,
      strong_trader_buy_usd: strongTraderBuyUSD,
      strong_trader_sell_usd: strongTraderSellUSD,
      strong_trader_net_usd: netUSD,
      strong_trader_trade_count: strongTraderTradeCount,
      strong_trader_wallet_count: strongTraderWallets.size,
      pct_of_total_supply: pctOfTotalSupply,
      pct_of_early_purchases: pctOfEarlyPurchases,
      is_net_long: netAmount > 0,
      trades_by_strong_trader: Array.from(tradesByStrongTrader.entries()).map(([wallet, stats]) => ({
        wallet,
        buy_amount: stats.buy_amount,
        sell_amount: stats.sell_amount,
        net_amount: stats.buy_amount - stats.sell_amount,
        buy_usd: stats.buy_usd,
        sell_usd: stats.sell_usd,
        net_usd: stats.buy_usd - stats.sell_usd,
        trades: stats.trades
      }))
    });
  }

  // Sort by net amount
  tokenPurchaseStats.sort((a, b) => Math.abs(b.strong_trader_net_amount) - Math.abs(a.strong_trader_net_amount));

  console.log('Top 50 tokens by strong trader NET position (|Buy - Sell|):');
  console.log('');
  console.log('Token'.padEnd(22) + 'Quality'.padEnd(12) + 'Wallets'.padEnd(8) + 'NetAmount'.padEnd(18) + 'BuyUSD'.padEnd(10) + 'SellUSD'.padEnd(10) + 'NetUSD'.padEnd(10) + '%OfSupply');
  console.log('-'.repeat(125));

  let count = 0;
  for (const stats of tokenPurchaseStats) {
    if (Math.abs(stats.strong_trader_net_amount) <= 0) continue;

    const position = stats.strong_trader_net_amount > 0 ? 'LONG' : 'SHORT';
    const positionSign = stats.strong_trader_net_amount > 0 ? '+' : '';

    console.log(
      stats.token_symbol.padEnd(22) +
      stats.quality_label.padEnd(12) +
      stats.strong_trader_wallet_count.toString().padEnd(8) +
      positionSign + formatNumber(stats.strong_trader_net_amount).padEnd(17) +
      formatUSD(stats.strong_trader_buy_usd).padEnd(10) +
      formatUSD(stats.strong_trader_sell_usd).padEnd(10) +
      positionSign + formatUSD(stats.strong_trader_net_usd).padEnd(9) +
      `${stats.pct_of_total_supply.toFixed(4)}%`
    );

    count++;
    if (count >= 50) break;
  }

  console.log('\n============================================================');
  console.log('[2. Group by Quality Label]');
  console.log('============================================================\n');

  // Group by quality
  const qualityGroups = {
    high_quality: [],
    mid_quality: [],
    low_quality: [],
    unlabeled: []
  };

  tokenPurchaseStats.forEach(t => {
    const q = t.quality_label;
    if (qualityGroups[q]) {
      qualityGroups[q].push(t);
    }
  });

  console.log('Quality'.padEnd(15) + 'Tokens'.padEnd(8) + 'AvgWallets'.padEnd(12) + 'AvgNetAmount'.padEnd(18) + 'AvgBuyUSD'.padEnd(12) + 'AvgSellUSD');
  console.log('-'.repeat(95));

  for (const [quality, tokens] of Object.entries(qualityGroups)) {
    if (tokens.length === 0) continue;

    const tokensWithActivity = tokens.filter(t => Math.abs(t.strong_trader_net_amount) > 0);
    const avgWallets = (tokens.reduce((sum, t) => sum + t.strong_trader_wallet_count, 0) / tokens.length).toFixed(1);
    const avgNetAmount = (tokens.reduce((sum, t) => sum + t.strong_trader_net_amount, 0) / tokens.length);
    const avgBuyUSD = (tokens.reduce((sum, t) => sum + t.strong_trader_buy_usd, 0) / tokens.length);
    const avgSellUSD = (tokens.reduce((sum, t) => sum + t.strong_trader_sell_usd, 0) / tokens.length);

    console.log(
      quality.padEnd(15) +
      tokens.length.toString().padEnd(8) +
      avgWallets.padEnd(12) +
      formatNumber(avgNetAmount).padEnd(18) +
      formatUSD(avgBuyUSD).padEnd(12) +
      formatUSD(avgSellUSD)
    );
  }

  console.log('\n============================================================');
  console.log('[3. Top Strong Traders by Purchase Activity]');
  console.log('============================================================\n');

  // Calculate per strong trader stats
  const traderStats = new Map();

  for (const stats of tokenPurchaseStats) {
    for (const trade of stats.trades_by_strong_trader) {
      if (!traderStats.has(trade.wallet)) {
        traderStats.set(trade.wallet, {
          wallet: trade.wallet,
          total_buy_amount: 0,
          total_sell_amount: 0,
          total_net_amount: 0,
          total_buy_usd: 0,
          total_sell_usd: 0,
          total_net_usd: 0,
          total_trades: 0,
          tokens_traded: 0
        });
      }
      const trader = traderStats.get(trade.wallet);
      trader.total_buy_amount += trade.buy_amount;
      trader.total_sell_amount += trade.sell_amount;
      trader.total_net_amount += trade.net_amount;
      trader.total_buy_usd += trade.buy_usd;
      trader.total_sell_usd += trade.sell_usd;
      trader.total_net_usd += trade.net_usd;
      trader.total_trades += trade.trades;
      trader.tokens_traded++;
    }
  }

  const sortedTraders = Array.from(traderStats.values()).sort((a, b) => b.total_net_usd - a.total_net_usd);

  console.log('Top 15 strong traders by net USD position:');
  console.log('');
  console.log('Wallet'.padEnd(12) + 'Tokens'.padEnd(8) + 'Trades'.padEnd(8) + 'NetUSD'.padEnd(12) + 'BuyUSD'.padEnd(12) + 'SellUSD');
  console.log('-'.repeat(80));

  sortedTraders.slice(0, 15).forEach((t, i) => {
    const netSign = t.total_net_usd > 0 ? '+' : '';
    console.log(
      `${i+1}. ${t.wallet.slice(0, 10)}...`.padEnd(15) +
      t.tokens_traded.toString().padEnd(8) +
      t.total_trades.toString().padEnd(8) +
      netSign + formatUSD(t.total_net_usd).padEnd(11) +
      formatUSD(t.total_buy_usd).padEnd(12) +
      formatUSD(t.total_sell_usd)
    );
  });

  console.log('\n============================================================');
  console.log('[4. Large Purchase Analysis]');
  console.log('============================================================\n');

  console.log('Tokens where strong traders have NET position > 5% of total supply:');
  console.log('');

  let largePositionCount = 0;
  for (const stats of tokenPurchaseStats) {
    if (stats.pct_of_total_supply >= 5) {
      const position = stats.strong_trader_net_amount > 0 ? 'LONG' : 'SHORT';
      const positionSign = stats.strong_trader_net_amount > 0 ? '+' : '';
      console.log(`${stats.token_symbol} (${stats.quality_label}) - ${position}:`);
      console.log(`  Net: ${positionSign}${formatNumber(stats.strong_trader_net_amount)} = ${stats.pct_of_total_supply.toFixed(4)}% of supply`);
      console.log(`  Buy: ${formatNumber(stats.strong_trader_buy_amount)} (${formatUSD(stats.strong_trader_buy_usd)}), Sell: ${formatNumber(stats.strong_trader_sell_amount)} (${formatUSD(stats.strong_trader_sell_usd)})`);
      console.log(`  ${stats.strong_trader_wallet_count} strong traders, ${stats.strong_trader_trade_count} trades`);
      console.log('');
      largePositionCount++;
    }
  }

  if (largePositionCount === 0) {
    console.log('No tokens where strong traders have NET position > 5% of supply.');
    const maxPct = Math.max(...tokenPurchaseStats.map(t => t.pct_of_total_supply));
    const maxToken = tokenPurchaseStats.find(t => t.pct_of_total_supply === maxPct);
    const position = maxToken.strong_trader_net_amount > 0 ? 'LONG' : 'SHORT';
    console.log(`Highest: ${maxToken.token_symbol} (${position}): ${maxPct.toFixed(4)}% of supply`);
  }

  console.log('\n============================================================');
  console.log('[5. Summary]');
  console.log('============================================================\n');

  const totalStrongTraderBuyUSD = tokenPurchaseStats.reduce((sum, t) => sum + t.strong_trader_buy_usd, 0);
  const totalStrongTraderSellUSD = tokenPurchaseStats.reduce((sum, t) => sum + t.strong_trader_sell_usd, 0);
  const totalStrongTraderNetUSD = totalStrongTraderBuyUSD - totalStrongTraderSellUSD;
  const totalTokensBought = tokenPurchaseStats.reduce((sum, t) => sum + t.strong_trader_buy_amount, 0);
  const totalTokensSold = tokenPurchaseStats.reduce((sum, t) => sum + t.strong_trader_sell_amount, 0);
  const totalNetTokens = totalTokensBought - totalTokensSold;
  const tokensWithStrongTraderActivity = tokenPurchaseStats.filter(t => Math.abs(t.strong_trader_net_amount) > 0).length;

  console.log(`Total tokens in analysis: ${tokenPurchaseStats.length}`);
  console.log(`Tokens with strong trader activity: ${tokensWithStrongTraderActivity}`);
  console.log(`Total BUY USD: ${formatUSD(totalStrongTraderBuyUSD)}, SELL USD: ${formatUSD(totalStrongTraderSellUSD)}, NET USD: ${totalStrongTraderNetUSD > 0 ? '+' : ''}${formatUSD(totalStrongTraderNetUSD)}`);
  console.log(`Total BUY tokens: ${formatNumber(totalTokensBought)}, SELL tokens: ${formatNumber(totalTokensSold)}, NET tokens: ${totalNetTokens > 0 ? '+' : ''}${formatNumber(totalNetTokens)}`);
  console.log(`Strong trader net position as % of total supply: ${(totalNetTokens / TOTAL_SUPPLY * 100).toFixed(4)}%`);

  // Save results
  const output = {
    total_supply: TOTAL_SUPPLY,
    token_stats: tokenPurchaseStats,
    quality_groups: Object.fromEntries(
      Object.entries(qualityGroups).map(([q, tokens]) => [
        q,
        {
          token_count: tokens.length,
          tokens_with_activity: tokens.filter(t => Math.abs(t.strong_trader_net_amount) > 0).length,
          avg_strong_wallets: tokens.reduce((sum, t) => sum + t.strong_trader_wallet_count, 0) / tokens.length,
          total_buy_amount: tokens.reduce((sum, t) => sum + t.strong_trader_buy_amount, 0),
          total_sell_amount: tokens.reduce((sum, t) => sum + t.strong_trader_sell_amount, 0),
          total_net_amount: tokens.reduce((sum, t) => sum + t.strong_trader_net_amount, 0),
          total_buy_usd: tokens.reduce((sum, t) => sum + t.strong_trader_buy_usd, 0),
          total_sell_usd: tokens.reduce((sum, t) => sum + t.strong_trader_sell_usd, 0)
        }
      ])
    ),
    trader_stats: sortedTraders,
    summary: {
      total_tokens: tokenPurchaseStats.length,
      tokens_with_strong_trader_activity: tokensWithStrongTraderActivity,
      total_buy_usd: totalStrongTraderBuyUSD,
      total_sell_usd: totalStrongTraderSellUSD,
      total_net_usd: totalStrongTraderNetUSD,
      total_tokens_bought: totalTokensBought,
      total_tokens_sold: totalTokensSold,
      total_net_tokens: totalNetTokens,
      pct_of_total_supply: totalNetTokens / TOTAL_SUPPLY * 100
    }
  };

  fs.writeFileSync(
    path.join(DATA_DIR, 'step8_strong_trader_purchase_analysis.json'),
    JSON.stringify(output, null, 2)
  );

  console.log('\nStrong trader purchase analysis saved to data/step8_strong_trader_purchase_analysis.json');
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
