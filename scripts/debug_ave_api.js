/**
 * 调试 AVE API 多链支持
 */

require('dotenv').config({ path: 'config/.env' });
const { AveTokenAPI } = require('../src/core/ave-api/token-api');
const config = require('../config/default.json');

// 检查 API 密钥
console.log('=== AVE API 配置检查 ===');
console.log(`AVE_API_KEY 存在: ${!!process.env.AVE_API_KEY}`);
console.log(`AVE_API_KEY 长度: ${process.env.AVE_API_KEY?.length || 0}`);
console.log(`AVE_API_URL: ${config.ave.apiUrl}`);
console.log('');

// 初始化 API
const apiKey = process.env.AVE_API_KEY;
const aveApi = new AveTokenAPI(
    config.ave.apiUrl,
    config.ave.timeout,
    apiKey
);

// 测试用例
const testCases = [
    {
        name: 'Base bankr 代币',
        tokenAddress: '0x124a4ed43e2abf32b7e6a3d6dc1c8e47bbd1cba3',
        chain: 'base',
        tokenId: '0x124a4ed43e2abf32b7e6a3d6dc1c8e47bbd1cba3-base'
    },
    {
        name: 'Solana pumpfun 代币',
        tokenAddress: 'vnCnPd5qBTn383KbLvz6k7ZL83nJLbTqtbPjugjpump',
        chain: 'solana',
        tokenId: 'vnCnPd5qBTn383KbLvz6k7ZL83nJLbTqtbPjugjpump-solana'
    },
    {
        name: 'BSC fourmeme 代币',
        tokenAddress: '0xa991647e8a74aa07832843dd2f80e260200e4444',
        chain: 'bsc',
        tokenId: '0xa991647e8a74aa07832843dd2f80e260200e4444-bsc'
    }
];

async function testAveApi() {
    console.log('=== 测试 AVE API getTokenDetail ===\n');

    for (let i = 0; i < testCases.length; i++) {
        const testCase = testCases[i];
        console.log(`--- 测试 ${i + 1}/${testCases.length}: ${testCase.name} ---`);
        console.log(`代币地址: ${testCase.tokenAddress}`);
        console.log(`链: ${testCase.chain}`);
        console.log(`Token ID: ${testCase.tokenId}`);

        try {
            const tokenDetail = await aveApi.getTokenDetail(testCase.tokenId);

            console.log(`✅ API 调用成功`);
            console.log(`   代币: ${tokenDetail.token}`);
            console.log(`   符号: ${tokenDetail.symbol}`);
            console.log(`   链: ${tokenDetail.chain}`);
            console.log(`   Pairs 数量: ${tokenDetail.pairs?.length || 0}`);

            if (tokenDetail.pairs && tokenDetail.pairs.length > 0) {
                console.log(`   第一个 Pair: ${tokenDetail.pairs[0].pair}`);
            }

        } catch (error) {
            console.log(`❌ API 调用失败`);
            console.log(`   错误信息: ${error.message}`);
            console.log(`   错误代码: ${error.code || 'N/A'}`);

            // 详细错误信息
            if (error.message.includes('403')) {
                console.log(`   ⚠️  403 错误通常表示:`);
                console.log(`      1. API 密钥没有访问该链的权限`);
                console.log(`      2. Token ID 格式不正确`);
                console.log(`      3. 该链在 AVE API 中暂不支持`);
            }
        }

        console.log('');
    }

    // 测试 getPlatformTokens
    console.log('=== 测试 AVE API getPlatformTokens ===\n');

    const platformTests = [
        { tag: 'bankr_in_new', chain: 'base', name: 'Base bankr 新代币' },
        { tag: 'pump_in_new', chain: 'solana', name: 'Solana pumpfun 新代币' },
        { tag: 'fourmeme_in_new', chain: 'bsc', name: 'BSC fourmeme 新代币' }
    ];

    for (let i = 0; i < platformTests.length; i++) {
        const test = platformTests[i];
        console.log(`--- 测试: ${test.name} ---`);
        console.log(`Tag: ${test.tag}, Chain: ${test.chain}`);

        try {
            const tokens = await aveApi.getPlatformTokens(test.tag, test.chain, 5, 'created_at');
            console.log(`✅ API 调用成功`);
            console.log(`   获取到 ${tokens.length} 个代币`);

            if (tokens.length > 0) {
                console.log(`   第一个代币:`);
                console.log(`     地址: ${tokens[0].token}`);
                console.log(`     符号: ${tokens[0].symbol}`);
                console.log(`     创建时间: ${tokens[0].created_at}`);

                // 测试获取该代币的详情
                if (tokens[0].token) {
                    const tokenId = `${tokens[0].token}-${test.chain}`;
                    console.log(`   测试获取代币详情: ${tokenId}`);

                    try {
                        const detail = await aveApi.getTokenDetail(tokenId);
                        console.log(`   ✅ 代币详情获取成功`);
                        console.log(`     Pairs 数量: ${detail.pairs?.length || 0}`);
                        if (detail.pairs && detail.pairs.length > 0) {
                            console.log(`     第一个 Pair: ${detail.pairs[0].pair}`);
                        }
                    } catch (detailError) {
                        console.log(`   ❌ 代币详情获取失败: ${detailError.message}`);
                    }
                }
            }

        } catch (error) {
            console.log(`❌ API 调用失败: ${error.message}`);
        }

        console.log('');
    }
}

testAveApi()
    .then(() => {
        console.log('测试完成');
        process.exit(0);
    })
    .catch(error => {
        console.error('测试失败:', error);
        process.exit(1);
    });
