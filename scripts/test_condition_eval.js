require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });

const { PreBuyCheckService } = require('../src/trading-engine/pre-check/PreBuyCheckService');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

async function testConditionEvaluation() {
    console.log('=== 测试条件评估逻辑 ===\n');

    const preBuyCheckService = new PreBuyCheckService(supabase, console);
    await preBuyCheckService.initialize();

    const testToken = '0x1234567890123456789012345678901234567890';
    const testCreator = '0x0987654321098765432109876543210987654321';
    const testInfo = { innerPair: '0xtestpair' };

    // 场景1: 首次买入（空条件，应通过）
    console.log('场景1: 首次买入，条件为空');
    const r1 = await preBuyCheckService.performAllChecks(
        testToken, testCreator, 'test-exp', 'bsc', testInfo, null,
        { checkTime: Math.floor(Date.now() / 1000), skipHolderCheck: true, skipTwitterSearch: true, buyRound: 1, lastPairReturnRate: 0 }
    );
    console.log(`  canBuy: ${r1.canBuy}, buyRound: ${r1.buyRound}, lastPairReturnRate: ${r1.lastPairReturnRate}`);
    console.log(`  预期: canBuy=true, buyRound=1, lastPairReturnRate=0`);
    console.log(r1.canBuy && r1.buyRound === 1 && r1.lastPairReturnRate === 0 ? '  ✅ 通过\n' : '  ❌ 失败\n');

    // 场景2: 首次买入，有条件
    console.log('场景2: 首次买入，条件为 devHoldingRatio < 20');
    const r2 = await preBuyCheckService.performAllChecks(
        testToken, testCreator, 'test-exp', 'bsc', testInfo, 'devHoldingRatio < 20',
        { checkTime: Math.floor(Date.now() / 1000), skipHolderCheck: true, skipTwitterSearch: true, buyRound: 1, lastPairReturnRate: 0 }
    );
    console.log(`  canBuy: ${r2.canBuy}, reason: ${r2.checkReason}`);
    console.log(`  预期: canBuy=true (因为 devHoldingRatio=0 < 20)`);
    console.log(r2.canBuy ? '  ✅ 通过\n' : '  ❌ 失败\n');

    // 场景3: 再次买入，lastPairReturnRate=20，条件为 lastPairReturnRate < 10
    console.log('场景3: 再次买入，lastPairReturnRate=20，条件为 lastPairReturnRate < 10');
    const r3 = await preBuyCheckService.performAllChecks(
        testToken, testCreator, 'test-exp', 'bsc', testInfo, 'lastPairReturnRate < 10',
        { checkTime: Math.floor(Date.now() / 1000), skipHolderCheck: true, skipTwitterSearch: true, buyRound: 2, lastPairReturnRate: 20 }
    );
    console.log(`  canBuy: ${r3.canBuy}, buyRound: ${r3.buyRound}, lastPairReturnRate: ${r3.lastPairReturnRate}`);
    console.log(`  预期: canBuy=false (因为 20 < 10 为假)`);
    console.log(!r3.canBuy && r3.buyRound === 2 && r3.lastPairReturnRate === 20 ? '  ✅ 通过\n' : '  ❌ 失败\n');

    // 场景4: 再次买入，lastPairReturnRate=-10，条件为 lastPairReturnRate < 10 AND lastPairReturnRate > -15
    console.log('场景4: 再次买入，lastPairReturnRate=-10，条件为 lastPairReturnRate < 10 AND lastPairReturnRate > -15');
    const r4 = await preBuyCheckService.performAllChecks(
        testToken, testCreator, 'test-exp', 'bsc', testInfo, 'lastPairReturnRate < 10 AND lastPairReturnRate > -15',
        { checkTime: Math.floor(Date.now() / 1000), skipHolderCheck: true, skipTwitterSearch: true, buyRound: 2, lastPairReturnRate: -10 }
    );
    console.log(`  canBuy: ${r4.canBuy}, buyRound: ${r4.buyRound}, lastPairReturnRate: ${r4.lastPairReturnRate}`);
    console.log(`  预期: canBuy=true (因为 -10 < 10 且 -10 > -15)`);
    console.log(r4.canBuy && r4.buyRound === 2 && r4.lastPairReturnRate === -10 ? '  ✅ 通过\n' : '  ❌ 失败\n');

    // 场景5: 再次买入，lastPairReturnRate=-20，条件为 lastPairReturnRate > -15
    console.log('场景5: 再次买入，lastPairReturnRate=-20，条件为 lastPairReturnRate > -15');
    const r5 = await preBuyCheckService.performAllChecks(
        testToken, testCreator, 'test-exp', 'bsc', testInfo, 'lastPairReturnRate > -15',
        { checkTime: Math.floor(Date.now() / 1000), skipHolderCheck: true, skipTwitterSearch: true, buyRound: 2, lastPairReturnRate: -20 }
    );
    console.log(`  canBuy: ${r5.canBuy}, buyRound: ${r5.buyRound}, lastPairReturnRate: ${r5.lastPairReturnRate}`);
    console.log(`  预期: canBuy=false (因为 -20 > -15 为假)`);
    console.log(!r5.canBuy && r5.buyRound === 2 && r5.lastPairReturnRate === -20 ? '  ✅ 通过\n' : '  ❌ 失败\n');

    console.log('=== 测试完成 ===');
}

testConditionEvaluation().catch(console.error);
