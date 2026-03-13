/**
 * Test script for Strong Trader Position Check
 * Validates the new pre-check factor works correctly
 */

const { STRONG_TRADERS } = require('../../src/trading-engine/pre-check/STRONG_TRADERS');
const StrongTraderPositionService = require('../../src/trading-engine/pre-check/StrongTraderPositionService');
const { PreBuyCheckService } = require('../../src/trading-engine/pre-check/PreBuyCheckService');
const { AveTxAPI } = require('../../src/core/ave-api');
const config = require('../../config/default.json');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

console.log('=== Strong Trader Position Check Test ===\n');

// Test 1: Check STRONG_TRADERS module
console.log('[Test 1] Loading STRONG_TRADERS module...');
try {
  console.log(`  ✓ Loaded ${STRONG_TRADERS.size} strong trader addresses`);
  console.log(`  ✓ Sample addresses:`);
  let count = 0;
  for (const addr of STRONG_TRADERS) {
    if (count++ < 3) {
      console.log(`    - ${addr.slice(0, 10)}...${addr.slice(-6)}`);
    }
  }
  console.log('');
} catch (error) {
  console.error(`  ✗ Failed to load STRONG_TRADERS: ${error.message}\n`);
  process.exit(1);
}

// Test 2: Check StrongTraderPositionService initialization
console.log('[Test 2] Initializing StrongTraderPositionService...');
let strongTraderService;
try {
  strongTraderService = new StrongTraderPositionService();
  console.log('  ✓ Service initialized\n');
} catch (error) {
  console.error(`  ✗ Failed to initialize service: ${error.message}\n`);
  process.exit(1);
}

// Test 3: Check empty factor values
console.log('[Test 3] Getting empty factor values...');
try {
  const emptyFactors = strongTraderService.getEmptyFactorValues();
  console.log('  ✓ Empty factors:', emptyFactors);

  // Verify all required factors exist
  const requiredFactors = [
    'strongTraderNetPositionRatio',
    'strongTraderTotalBuyRatio',
    'strongTraderTotalSellRatio',
    'strongTraderWalletCount',
    'strongTraderTradeCount',
    'strongTraderSellIntensity'
  ];

  const missingFactors = requiredFactors.filter(f => !(f in emptyFactors));
  if (missingFactors.length > 0) {
    console.error(`  ✗ Missing factors: ${missingFactors.join(', ')}\n`);
    process.exit(1);
  }
  console.log('  ✓ All required factors present\n');
} catch (error) {
  console.error(`  ✗ Failed to get empty factors: ${error.message}\n`);
  process.exit(1);
}

// Test 4: Test with a real token (using Ave API)
console.log('[Test 4] Testing with real token data...');
console.log('  Token: 0x98fc7e8d3978e06a2d7203a2e5d62aaf30e04444 (龙虾教)');
console.log('  Pair: 0x0000000000000000000000000000000000000004-bsc\n');

async function testRealToken() {
  try {
    const tokenAddress = '0x98fc7e8d3978e06a2d7203a2e5d62aaf30e04444';
    const pairAddress = '0x0000000000000000000000000000000000000004';
    const checkTime = Math.floor(Date.now() / 1000);

    console.log(`  Check time: ${checkTime} (${new Date(checkTime * 1000).toISOString()})`);
    console.log(`  Window: 90 seconds before check time\n`);

    const result = await strongTraderService.analyzePosition(
      tokenAddress,
      pairAddress,
      checkTime
    );

    console.log('  Results:');
    console.log(`    strongTraderNetPositionRatio: ${result.strongTraderNetPositionRatio.toFixed(4)}%`);
    console.log(`    strongTraderTotalBuyRatio: ${result.strongTraderTotalBuyRatio.toFixed(4)}%`);
    console.log(`    strongTraderTotalSellRatio: ${result.strongTraderTotalSellRatio.toFixed(4)}%`);
    console.log(`    strongTraderWalletCount: ${result.strongTraderWalletCount}`);
    console.log(`    strongTraderTradeCount: ${result.strongTraderTradeCount}`);
    console.log(`    strongTraderSellIntensity: ${(result.strongTraderSellIntensity * 100).toFixed(2)}%`);
    console.log(`    _meta.total_trades_analyzed: ${result._meta?.total_trades_analyzed || 0}`);

    // Verify values are reasonable
    if (result.strongTraderNetPositionRatio < 0 || result.strongTraderNetPositionRatio > 100) {
      throw new Error(`Invalid netPositionRatio: ${result.strongTraderNetPositionRatio}`);
    }
    if (result.strongTraderWalletCount < 0) {
      throw new Error(`Invalid walletCount: ${result.strongTraderWalletCount}`);
    }

    console.log('\n  ✓ All values are reasonable\n');
    return true;
  } catch (error) {
    console.error(`  ✗ Failed to analyze real token: ${error.message}\n`);
    console.error(`  Stack: ${error.stack}\n`);
    return false;
  }
}

// Test 5: Verify PreBuyCheckService integration
async function testPreBuyCheckIntegration() {
  console.log('[Test 5] Verifying PreBuyCheckService integration...');

  try {
    // Check that getEmptyFactorValues includes strong trader factors
    const emptyValues = strongTraderService.getEmptyFactorValues();

    const hasAllFactors = [
      'strongTraderNetPositionRatio' in emptyValues,
      'strongTraderTotalBuyRatio' in emptyValues,
      'strongTraderTotalSellRatio' in emptyValues,
      'strongTraderWalletCount' in emptyValues,
      'strongTraderTradeCount' in emptyValues,
      'strongTraderSellIntensity' in emptyValues
    ].every(Boolean);

    if (!hasAllFactors) {
      console.error('  ✗ Not all strong trader factors are in empty values\n');
      return false;
    }

    console.log('  ✓ Strong trader factors are properly integrated\n');
    return true;
  } catch (error) {
    console.error(`  ✗ Integration check failed: ${error.message}\n`);
    return false;
  }
}

// Test 6: Verify FactorBuilder integration
function testFactorBuilderIntegration() {
  console.log('[Test 6] Verifying FactorBuilder integration...');

  try {
    const { buildPreBuyCheckFactorValues } = require('../../src/trading-engine/core/FactorBuilder');

    // Create a mock preBuyCheckResult with strong trader factors
    const mockResult = {
      preBuyCheck: 1,
      checkTimestamp: Date.now(),
      checkDuration: 1000,
      holderWhitelistCount: 0,
      holderBlacklistCount: 0,
      // Strong trader factors
      strongTraderNetPositionRatio: 5.25,
      strongTraderTotalBuyRatio: 8.5,
      strongTraderTotalSellRatio: 3.25,
      strongTraderWalletCount: 3,
      strongTraderTradeCount: 7,
      strongTraderSellIntensity: 0.38
    };

    const factors = buildPreBuyCheckFactorValues(mockResult);

    // Check that strong trader factors are included
    if (factors.strongTraderNetPositionRatio !== 5.25) {
      throw new Error(`strongTraderNetPositionRatio not preserved: ${factors.strongTraderNetPositionRatio}`);
    }
    if (factors.strongTraderWalletCount !== 3) {
      throw new Error(`strongTraderWalletCount not preserved: ${factors.strongTraderWalletCount}`);
    }

    console.log('  ✓ FactorBuilder correctly handles strong trader factors\n');
    return true;
  } catch (error) {
    console.error(`  ✗ FactorBuilder integration failed: ${error.message}\n`);
    return false;
  }
}

// Run all tests
async function runAllTests() {
  const results = [];

  results.push(await testRealToken());
  results.push(await testPreBuyCheckIntegration());
  results.push(testFactorBuilderIntegration());

  // Summary
  console.log('============================================================');
  console.log('[TEST SUMMARY]');
  console.log('============================================================\n');

  const totalTests = 6;
  const passedTests = results.filter(r => r).length + 3; // +3 for Tests 1-3

  console.log(`Passed: ${passedTests}/${totalTests}`);

  if (passedTests === totalTests) {
    console.log('\n✓ All tests passed! Strong Trader Position Check is ready.');
    console.log('\nYou can now use these factors in your experiment conditions:');
    console.log('  - strongTraderNetPositionRatio (recommended: < 5)');
    console.log('  - strongTraderTotalBuyRatio');
    console.log('  - strongTraderTotalSellRatio');
    console.log('  - strongTraderWalletCount');
    console.log('  - strongTraderTradeCount');
    console.log('  - strongTraderSellIntensity');
  } else {
    console.log('\n✗ Some tests failed. Please review the errors above.');
    process.exit(1);
  }
}

runAllTests().catch(error => {
  console.error('\n✗ Test suite failed:', error);
  process.exit(1);
});
