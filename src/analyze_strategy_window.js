/**
 * 分析策略条件变化 - 正确的时间窗口分析
 * 检查在 age < 5 分钟窗口内，earlyReturn 是否曾经达到目标范围
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

async function analyzeTimeWindow() {
    console.log(`🔍 正确分析策略时间窗口: ${EXPERIMENT_ID}\n`);

    // 策略参数
    const CURRENT_AGE_LIMIT = 1.33;
    const NEW_AGE_LIMIT = 5;
    const RETURN_MIN = 80;
    const CURRENT_RETURN_MAX = 120;
    const NEW_RETURN_MAX = 150;

    console.log('🎯 策略条件:');
    console.log(`当前: age < ${CURRENT_AGE_LIMIT} 分钟 AND ${RETURN_MIN}% <= earlyReturn < ${CURRENT_RETURN_MAX}%`);
    console.log(`新条件: age < ${NEW_AGE_LIMIT} 分钟 AND ${RETURN_MIN}% <= earlyReturn < ${NEW_RETURN_MAX}%`);
    console.log('');

    // 分析已知代币
    const knownTokens = [
        { address: '0xf12ae85aad73172d1e226637b0f5fe63e94fffff', symbol: 'TORCH' },
        { address: '0x41b90e121ede96bd540424b108e435bc7524ffff', symbol: 'TORCH' },
        { address: '0xe5725fba1908077e72eabf64621c8d89e412ffff', symbol: '奇迹' },
        // 从之前分析中的其他高涨幅代币
        { address: '0x41b90e121ede96bd540424b108e435bc7524ffff', symbol: 'AgentCZ' }, // 需要确认地址
    ];

    const results = [];

    for (const token of knownTokens) {
        console.log(`分析 ${token.symbol}...`);

        try {
            const tsResult = await fetchAPI(`/experiment/time-series/data?experimentId=${EXPERIMENT_ID}&tokenAddress=${token.address}`);
            const tsData = tsResult.data || [];

            if (tsData.length === 0) {
                console.log(`  无时序数据\n`);
                continue;
            }

            // 分析时间窗口内的数据
            const currentWindowData = [];
            const newWindowData = [];
            const allData = [];

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

                // 记录所有数据
                allData.push({ age, earlyReturn, timestamp: ts.timestamp });

                // 当前条件窗口: age < 1.33
                if (age < CURRENT_AGE_LIMIT) {
                    currentWindowData.push({ age, earlyReturn });
                }

                // 新条件窗口: age < 5
                if (age < NEW_AGE_LIMIT) {
                    newWindowData.push({ age, earlyReturn });
                }

                finalPrice = currentPrice;
            });

            if (collectionPrice > 0 && finalPrice > 0) {
                finalReturn = ((finalPrice - collectionPrice) / collectionPrice) * 100;
            }

            // 检查窗口内是否触发条件
            const currentWindowMax = currentWindowData.length > 0 ? Math.max(...currentWindowData.map(d => d.earlyReturn)) : -Infinity;
            const newWindowMax = newWindowData.length > 0 ? Math.max(...newWindowData.map(d => d.earlyReturn)) : -Infinity;
            const overallMax = allData.length > 0 ? Math.max(...allData.map(d => d.earlyReturn)) : -Infinity;

            // 当前条件: 窗口内有数据点在 80-120% 范围内
            const currentTrigger = currentWindowData.some(d => d.earlyReturn >= RETURN_MIN && d.earlyReturn < CURRENT_RETURN_MAX);
            const currentInRange = currentWindowMax >= RETURN_MIN && currentWindowMax < CURRENT_RETURN_MAX;

            // 新条件: 窗口内有数据点在 80-150% 范围内
            const newTrigger = newWindowData.some(d => d.earlyReturn >= RETURN_MIN && d.earlyReturn < NEW_RETURN_MAX);
            const newInRange = newWindowMax >= RETURN_MIN && newWindowMax < NEW_RETURN_MAX;

            results.push({
                ...token,
                currentWindowMax,
                newWindowMax,
                overallMax,
                finalReturn,
                currentTrigger,
                newTrigger,
                currentInRange,
                newInRange,
                dataPointCount: tsData.length,
                currentWindowPoints: currentWindowData.length,
                newWindowPoints: newWindowData.length
            });

            console.log(`  当前窗口(age<${CURRENT_AGE_LIMIT}): 最高 ${currentWindowMax.toFixed(1)}% (${currentWindowData.length}个点)`);
            console.log(`  新窗口(age<${NEW_AGE_LIMIT}):     最高 ${newWindowMax.toFixed(1)}% (${newWindowData.length}个点)`);
            console.log(`  整体最高:                    ${overallMax.toFixed(1)}%`);
            console.log(`  最终收益:                    ${finalReturn.toFixed(1)}%`);
            console.log(`  当前条件触发: ${currentTrigger ? '✅' : '❌'}`);
            console.log(`  新条件触发:   ${newTrigger ? '✅' : '❌'}`);
            console.log('');

        } catch (e) {
            console.error(`  错误: ${e.message}\n`);
        }
    }

    // 总结
    console.log('📊 总结:\n');
    console.log('─'.repeat(90));

    const currentTriggers = results.filter(r => r.currentTrigger);
    const newTriggers = results.filter(r => r.newTrigger);
    const additionalTriggers = results.filter(r => r.newTrigger && !r.currentTrigger);

    console.log(`当前条件触发: ${currentTriggers.length} 个`);
    currentTriggers.forEach(r => {
        console.log(`  ${r.symbol}: 窗口内最高 ${r.currentWindowMax.toFixed(1)}% → 最终 ${r.finalReturn.toFixed(1)}%`);
    });

    console.log(`\n新条件触发: ${newTriggers.length} 个`);
    newTriggers.forEach(r => {
        console.log(`  ${r.symbol}: 窗口内最高 ${r.newWindowMax.toFixed(1)}% → 最终 ${r.finalReturn.toFixed(1)}%`);
    });

    if (additionalTriggers.length > 0) {
        console.log(`\n新增触发: ${additionalTriggers.length} 个`);
        additionalTriggers.forEach(r => {
            const isProfit = r.finalReturn > 0;
            console.log(`  ${r.symbol}: 窗口内最高 ${r.newWindowMax.toFixed(1)}% → 最终 ${r.finalReturn.toFixed(1)}% ${isProfit ? '✅' : '❌'}`);
        });
    }

    // 检查 TORCH 在 5 分钟内的情况
    const torch = results.find(r => r.symbol === 'TORCH' && r.address.includes('f12ae85a'));
    if (torch) {
        console.log(`\n🔥 TORCH (大牛币) 详细分析:`);
        console.log('─'.repeat(90));
        console.log(`在 age < 5 分钟窗口内，最高 earlyReturn: ${torch.newWindowMax.toFixed(1)}%`);
        console.log(`目标范围: 80%-150%`);
        console.log(`是否触发: ${torch.newWindowMax >= 80 && torch.newWindowMax < 150 ? '✅ 是' : '❌ 否'}`);

        if (!torch.newTrigger) {
            if (torch.newWindowMax < 80) {
                console.log(`原因: 窗口内最高涨幅 ${torch.newWindowMax.toFixed(1)}% 低于 80%`);
            } else if (torch.newWindowMax >= 150) {
                console.log(`原因: 窗口内最高涨幅 ${torch.newWindowMax.toFixed(1)}% 超过 150% (直接暴涨)`);
            }
        }
    }

    console.log('\n✅ 分析完成');
}

analyzeTimeWindow().catch(console.error);
