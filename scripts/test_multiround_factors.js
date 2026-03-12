require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });

const { PreBuyCheckService } = require('../src/trading-engine/pre-check/PreBuyCheckService');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

async function testMultiroundFactors() {
    console.log('测试多次交易因子...\n');

    const preBuyCheckService = new PreBuyCheckService(supabase, console);
    await preBuyCheckService.initialize();

    // 测试首次买入（第1轮）
    console.log('=== 测试首次买入（第1轮）===');
    const result1 = await preBuyCheckService.performAllChecks(
        '0x1234567890123456789012345678901234567890',  // 测试代币地址
        '0x0987654321098765432109876543210987654321',  // 创建者地址
        'test-experiment-id',
        'bsc',
        { innerPair: '0xtestpair' },
        'true',  // 总是通过
        {
            checkTime: Math.floor(Date.now() / 1000),
            skipHolderCheck: true,
            skipTwitterSearch: true,
            tokenBuyTime: null,  // 首次买入
            drawdownFromHighest: -5,
            buyRound: 1,
            lastPairReturnRate: 0
        }
    );

    console.log('buyRound:', result1.buyRound);
    console.log('lastPairReturnRate:', result1.lastPairReturnRate);
    console.log('');

    // 测试第二次买入（第2轮）
    console.log('=== 测试再次买入（第2轮，上一对收益率20%）===');
    const result2 = await preBuyCheckService.performAllChecks(
        '0x1234567890123456789012345678901234567890',
        '0x0987654321098765432109876543210987654321',
        'test-experiment-id',
        'bsc',
        { innerPair: '0xtestpair' },
        'lastPairReturnRate < 10 AND lastPairReturnRate > -15',  // 应该失败，因为20% > 10%
        {
            checkTime: Math.floor(Date.now() / 1000),
            skipHolderCheck: true,
            skipTwitterSearch: true,
            tokenBuyTime: Date.now() - 1000000,  // 有历史交易
            drawdownFromHighest: -5,
            buyRound: 2,
            lastPairReturnRate: 20  // 上一对赚了20%
        }
    );

    console.log('buyRound:', result2.buyRound);
    console.log('lastPairReturnRate:', result2.lastPairReturnRate);
    console.log('canBuy:', result2.canBuy);
    console.log('checkReason:', result2.checkReason);
    console.log('');

    // 测试第三次买入（第3轮，上一对亏损10%）
    console.log('=== 测试第三次买入（第3轮，上一对收益率-10%）===');
    const result3 = await preBuyCheckService.performAllChecks(
        '0x1234567890123456789012345678901234567890',
        '0x0987654321098765432109876543210987654321',
        'test-experiment-id',
        'bsc',
        { innerPair: '0xtestpair' },
        'lastPairReturnRate < 10 AND lastPairReturnRate > -15',  // 应该通过
        {
            checkTime: Math.floor(Date.now() / 1000),
            skipHolderCheck: true,
            skipTwitterSearch: true,
            tokenBuyTime: Date.now() - 1000000,
            drawdownFromHighest: -5,
            buyRound: 3,
            lastPairReturnRate: -10  // 上一对亏了10%
        }
    );

    console.log('buyRound:', result3.buyRound);
    console.log('lastPairReturnRate:', result3.lastPairReturnRate);
    console.log('canBuy:', result3.canBuy);
    console.log('checkReason:', result3.checkReason);
    console.log('');

    console.log('=== 测试完成 ===');
}

testMultiroundFactors().catch(console.error);
