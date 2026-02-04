/**
 * 分析策略条件变化的影响 - 使用分页查询
 */

const API_BASE = 'http://localhost:3010/api';
const EXPERIMENT_ID = 'db041ca0-dd20-434f-a49d-142aa0cf3826';

async function fetchAPI(endpoint) {
    const response = await fetch(`${API_BASE}${endpoint}`);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
}

async function analyzeWithPagination() {
    console.log(`🔍 分析策略条件变化: ${EXPERIMENT_ID}\n`);

    // 获取有时序数据的代币列表（从之前的分析我们知道有哪些代币有数据）
    console.log('📊 1. 获取代币列表...');

    // 方法：直接从 time-series/factors API 获取所有有数据的代币
    // 先获取前1000个，然后分析
    const factorsResult = await fetchAPI(`/experiment/time-series/factors?experimentId=${EXPERIMENT_ID}`);
    const uniqueTokens = factorsResult.data || [];

    console.log(`有因子数据的代币数: ${uniqueTokens.length}`);

    if (uniqueTokens.length === 0) {
        console.log('没有找到因子数据，使用备用方案...');

        // 备用方案：使用之前分析中已知的代币
        const knownTokens = [
            { address: '0xf12ae85aad73172d1e226637b0f5fe63e94fffff', symbol: 'TORCH' },
            { address: '0x41b90e121ede96bd540424b108e435bc7524ffff', symbol: 'TORCH' },
            // 添加更多已知有数据的代币...
        ];
    }

    // 对每个代币获取详细的时序数据来分析峰值
    console.log('\n📈 2. 分析每个代币的峰值...');

    const results = [];
    let processed = 0;

    // 限制分析的代币数量（避免太多请求）
    const maxTokens = Math.min(uniqueTokens.length, 100);

    for (let i = 0; i < maxTokens; i++) {
        const tokenAddress = uniqueTokens[i];
        console.log(`分析代币 ${i + 1}/${maxTokens}...`);

        try {
            // 获取这个代币的时序数据
            const tsResult = await fetchAPI(`/experiment/time-series/data?experimentId=${EXPERIMENT_ID}&tokenAddress=${tokenAddress}`);
            const tsData = tsResult.data || [];

            if (tsData.length === 0) continue;

            // 分析峰值
            let maxEarlyReturn = -Infinity;
            let maxEarlyReturnAge = null;
            let finalReturn = null;
            let collectionPrice = null;
            let finalPrice = null;

            tsData.forEach(ts => {
                const factors = ts.factor_values || {};
                const earlyReturn = factors.earlyReturn || 0;
                const age = factors.age || 0;
                const currentPrice = factors.currentPrice || 0;

                if (!collectionPrice && factors.collectionPrice) {
                    collectionPrice = factors.collectionPrice;
                }

                if (earlyReturn > maxEarlyReturn) {
                    maxEarlyReturn = earlyReturn;
                    maxEarlyReturnAge = age;
                }

                finalPrice = currentPrice;
            });

            if (collectionPrice > 0 && finalPrice > 0) {
                finalReturn = ((finalPrice - collectionPrice) / collectionPrice) * 100;
            }

            results.push({
                address: tokenAddress,
                symbol: tsData[0].token_symbol,
                maxEarlyReturn,
                maxEarlyReturnAge,
                finalReturn,
                dataPointCount: tsData.length
            });

            processed++;
        } catch (e) {
            console.error(`  错误: ${e.message}`);
        }
    }

    console.log(`\n成功分析 ${processed} 个代币\n`);

    // 策略条件对比
    console.log('🎯 3. 策略条件对比\n');

    const currentMatches = [];
    const newMatches = [];
    const additionalMatches = [];

    results.forEach(r => {
        const currentMatch = r.maxEarlyReturn >= 80 && r.maxEarlyReturn < 120 && r.maxEarlyReturnAge < 1.33;
        const newMatch = r.maxEarlyReturn >= 80 && r.maxEarlyReturn < 150 && r.maxEarlyReturnAge < 5;

        if (currentMatch) currentMatches.push(r);
        if (newMatch) newMatches.push(r);
        if (newMatch && !currentMatch) additionalMatches.push(r);
    });

    console.log(`📋 策略条件对比:`);
    console.log(`─`.repeat(80));
    console.log(`当前条件 (age < 1.33, 80% <= earlyReturn < 120%): ${currentMatches.length} 个交易`);
    console.log(`新条件   (age < 5,     80% <= earlyReturn < 150%): ${newMatches.length} 个交易`);
    console.log(`新增交易: ${additionalMatches.length} 个\n`);

    if (additionalMatches.length > 0) {
        // 按峰值降序排序
        additionalMatches.sort((a, b) => b.maxEarlyReturn - a.maxEarlyReturn);

        let profitCount = 0;
        let lossCount = 0;

        console.log(`📊 新增的 ${additionalMatches.length} 个交易详情:`);
        console.log(`─`.repeat(90));
        additionalMatches.forEach((r, i) => {
            const isProfit = r.finalReturn > 0;
            if (isProfit) profitCount++; else lossCount++;

            const status = isProfit ? '✅ 盈利' : '❌ 亏损';
            console.log(`[${i + 1}] ${r.symbol.padEnd(12)} ${status} | 峰值: ${r.maxEarlyReturn.toFixed(1).padStart(6)}% | 最终: ${r.finalReturn.toFixed(1).padStart(6)}% | age: ${r.maxEarlyReturnAge.toFixed(2)}分钟`);
        });

        console.log(`\n统计:`);
        console.log(`  盈利: ${profitCount} | 亏损: ${lossCount} | 盈利率: ${(profitCount/additionalMatches.length*100).toFixed(1)}%`);
    }

    // 查找已知的大牛币
    console.log(`\n🔍 检查已知大牛币:\n`);

    const knownPumps = [
        { address: '0xf12ae85aad73172d1e226637b0f5fe63e94fffff', symbol: 'TORCH', expectedReturn: 3199.5 },
    ];

    knownPumps.forEach(pump => {
        const r = results.find(r => r.address.toLowerCase() === pump.address.toLowerCase());
        if (r) {
            const currentMatch = r.maxEarlyReturn >= 80 && r.maxEarlyReturn < 120 && r.maxEarlyReturnAge < 1.33;
            const newMatch = r.maxEarlyReturn >= 80 && r.maxEarlyReturn < 150 && r.maxEarlyReturnAge < 5;

            console.log(`${pump.symbol} (${pump.address.substring(0,10)}...):`);
            console.log(`  峰值涨幅: ${r.maxEarlyReturn.toFixed(1)}% (age: ${r.maxEarlyReturnAge.toFixed(2)}分钟)`);
            console.log(`  最终收益: ${r.finalReturn.toFixed(1)}%`);
            console.log(`  当前条件: ${currentMatch ? '✅ 触发' : '❌ 不触发'}`);
            console.log(`  新条件:   ${newMatch ? '✅ 触发' : '❌ 不触发'}`);
            console.log();
        }
    });

    console.log('✅ 分析完成');
}

analyzeWithPagination().catch(console.error);
