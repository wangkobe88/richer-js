/**
 * 直接分析已知代币的策略变化影响
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

async function analyzeKnownTokens() {
    console.log(`🔍 分析策略条件变化: ${EXPERIMENT_ID}\n`);

    // 从之前的分析，我们知道这些代币有数据和涨幅信息
    const knownTokens = [
        { address: '0xf12ae85aad73172d1e226637b0f5fe63e94fffff', symbol: 'TORCH', expectedReturn: 3199.5 },
        { address: '0x41b90e121ede96bd540424b108e435bc7524ffff', symbol: 'TORCH', expectedReturn: -11.9 },
        { address: '0xe5725fba1908077e72eabf64621c8d89e412ffff', symbol: '奇迹', expectedReturn: 101.5 },
    ];

    // 策略条件
    const CURRENT_AGE_LIMIT = 1.33;
    const NEW_AGE_LIMIT = 5;
    const RETURN_MIN = 80;
    const CURRENT_RETURN_MAX = 120;
    const NEW_RETURN_MAX = 150;

    console.log('🎯 策略条件对比:');
    console.log(`当前: age < ${CURRENT_AGE_LIMIT} AND earlyReturn >= ${RETURN_MIN} AND earlyReturn < ${CURRENT_RETURN_MAX}`);
    console.log(`新条件: age < ${NEW_AGE_LIMIT} AND earlyReturn >= ${RETURN_MIN} AND earlyReturn < ${NEW_RETURN_MAX}`);
    console.log('');

    const results = [];

    for (const token of knownTokens) {
        console.log(`分析 ${token.symbol} (${token.address.substring(0,10)}...)...`);

        try {
            const tsResult = await fetchAPI(`/experiment/time-series/data?experimentId=${EXPERIMENT_ID}&tokenAddress=${token.address}`);
            const tsData = tsResult.data || [];

            if (tsData.length === 0) {
                console.log(`  无时序数据\n`);
                continue;
            }

            // 找出峰值
            let maxEarlyReturn = -Infinity;
            let maxEarlyReturnAge = null;
            let maxEarlyReturnTime = null;
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
                    maxEarlyReturnTime = ts.timestamp;
                }

                finalPrice = currentPrice;
            });

            if (collectionPrice > 0 && finalPrice > 0) {
                finalReturn = ((finalPrice - collectionPrice) / collectionPrice) * 100;
            }

            // 检查是否触发策略
            const currentMatch = maxEarlyReturn >= RETURN_MIN && maxEarlyReturn < CURRENT_RETURN_MAX && maxEarlyReturnAge < CURRENT_AGE_LIMIT;
            const newMatch = maxEarlyReturn >= RETURN_MIN && maxEarlyReturn < NEW_RETURN_MAX && maxEarlyReturnAge < NEW_AGE_LIMIT;

            results.push({
                ...token,
                maxEarlyReturn,
                maxEarlyReturnAge,
                finalReturn,
                currentMatch,
                newMatch,
                dataPointCount: tsData.length
            });

            console.log(`  峰值涨幅: ${maxEarlyReturn.toFixed(1)}% (age: ${maxEarlyReturnAge.toFixed(2)}分钟)`);
            console.log(`  最终收益: ${finalReturn.toFixed(1)}%`);
            console.log(`  当前条件: ${currentMatch ? '✅ 触发' : '❌ 不触发'}`);
            console.log(`  新条件:   ${newMatch ? '✅ 触发' : '❌ 不触发'}`);
            console.log('');

        } catch (e) {
            console.error(`  错误: ${e.message}\n`);
        }
    }

    // 总结
    console.log('📊 总结:\n');
    console.log('─'.repeat(80));

    const currentTriggers = results.filter(r => r.currentMatch);
    const newTriggers = results.filter(r => r.newMatch);
    const additionalTriggers = results.filter(r => r.newMatch && !r.currentMatch);

    console.log(`当前条件触发: ${currentTriggers.length} 个交易`);
    currentTriggers.forEach(r => {
        console.log(`  ${r.symbol}: ${r.maxEarlyReturn.toFixed(1)}% → 最终 ${r.finalReturn.toFixed(1)}%`);
    });

    console.log(`\n新条件触发: ${newTriggers.length} 个交易`);
    newTriggers.forEach(r => {
        console.log(`  ${r.symbol}: ${r.maxEarlyReturn.toFixed(1)}% (age: ${r.maxEarlyReturnAge.toFixed(2)}min) → 最终 ${r.finalReturn.toFixed(1)}%`);
    });

    if (additionalTriggers.length > 0) {
        console.log(`\n新增触发: ${additionalTriggers.length} 个交易`);

        let profitCount = 0;
        let lossCount = 0;
        let totalFinalReturn = 0;

        additionalTriggers.forEach(r => {
            if (r.finalReturn > 0) profitCount++; else lossCount++;
            totalFinalReturn += r.finalReturn;
        });

        console.log(`  盈利: ${profitCount} | 亏损: ${lossCount}`);
        console.log(`  平均最终收益: ${(totalFinalReturn / additionalTriggers.length).toFixed(1)}%`);
    }

    // 详细风险分析
    console.log(`\n⚠️ 风险分析:`);
    console.log('─'.repeat(80));

    results.forEach(r => {
        if (r.newMatch) {
            const isProfit = r.finalReturn > 0;
            const risk = r.finalReturn < 0 ? Math.abs(r.finalReturn) : 0;
            console.log(`${r.symbol}:`);
            console.log(`  买入涨幅: ${r.maxEarlyReturn.toFixed(1)}%`);
            console.log(`  最终收益: ${r.finalReturn.toFixed(1)}%`);
            console.log(`  回撤风险: ${risk > 0 ? risk.toFixed(1) + '%' : '无'}`);
            console.log('');
        }
    });

    console.log('✅ 分析完成');
}

analyzeKnownTokens().catch(console.error);
