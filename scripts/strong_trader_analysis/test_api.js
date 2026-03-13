/**
 * Quick test: Check if Ave API returns trades for a recent token
 */

const { AveTxAPI } = require('../../src/core/ave-api');
const config = require('../../config/default.json');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const { STRONG_TRADERS } = require('../../src/trading-engine/pre-check/STRONG_TRADERS');

async function test() {
  const txApi = new AveTxAPI(
    config.ave?.apiUrl || 'https://prod.ave-api.com',
    config.ave?.timeout || 30000,
    process.env.AVE_API_KEY
  );

  // Use a WBNB pair which should always have activity
  const pairId = '0x16b9a82891338f9ba80e2d6970fdda79d1eb0dae-bsc'; // WBNB pair
  const toTime = Math.floor(Date.now() / 1000);
  const fromTime = toTime - 90;

  console.log('Testing Ave API with WBNB pair...');
  console.log(`Pair: ${pairId}`);
  console.log(`Window: ${fromTime} to ${toTime}\n`);

  const trades = await txApi.getSwapTransactions(pairId, 100, fromTime, toTime, 'asc');

  console.log(`Got ${trades.length} trades`);

  if (trades.length > 0) {
    console.log('\nFirst trade:');
    const t = trades[0];
    console.log(`  time: ${t.time} (${new Date(t.time * 1000).toISOString()})`);
    console.log(`  from_token: ${t.from_token?.slice(0, 10)}...`);
    console.log(`  to_token: ${t.to_token?.slice(0, 10)}...`);
    console.log(`  wallet: ${t.from_address?.slice(0, 10)}...`);

    // Check if any wallet is a strong trader
    let foundStrongTrader = false;
    for (const trade of trades) {
      const wallet = trade.from_address?.toLowerCase();
      if (wallet && STRONG_TRADERS.has(wallet)) {
        console.log(`\n✓ Found strong trader: ${wallet.slice(0, 10)}...`);
        foundStrongTrader = true;
        break;
      }
    }

    if (!foundStrongTrader) {
      console.log('\n(No strong traders found in this sample, but API is working)');
    }
  }

  console.log('\n✓ API test completed');
}

test().catch(console.error);
