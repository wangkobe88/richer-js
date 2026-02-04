/**
 * 分析哪些代币暴涨但被策略漏掉
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

async function analyzeMissedPumps() {
    console.log(`🔍 分析暴涨但被漏掉的代币: ${EXPERIMENT_ID}\n`);

    // 1. 获取代币列表
    console.log('📊 1. 获取代币列表...');
    const tokensResult = await fetchAPI(`/experiment/${EXPERIMENT_ID}/tokens?limit=10000`);
    const tokens = tokensResult.tokens || [];
    console.log(`总代币数: ${tokens.length}`);

    // 2. 获取时序数据
    console.log('\n📈 2. 获取时序数据...');
    const timeSeriesResult = await fetchAPI(`/experiment/time-series/data?experimentId=${EXPERIMENT_ID}`);
    const timeSeries = timeSeriesResult.data || [];
    console.log(`时序数据点数: ${timeSeries.length}`);

    // 3. 分析每个代币的最高 earlyReturn
    console.log('\n🔥 3. 分析暴涨代币...\n');

    // 按代币分组时序数据
    const tokenData = new Map();
    timeSeries.forEach(ts => {
        const addr = ts.token_address;
        if (!tokenData.has(addr)) {
            tokenData.set(addr, {
                address: addr,
                symbol: ts.token_symbol,
                dataPoints: []
            });
        }
        tokenData.get(addr).dataPoints.push(ts);
    });

    // 分析每个代币的最高 earlyReturn 和最高价格涨幅
    const pumpAnalysis = [];

    for (const [addr, data] of tokenData.entries()) {
        let maxEarlyReturn = -Infinity;
        let maxEarlyReturnAge = null;
        let maxEarlyReturnTime = null;

        let maxPriceIncrease = -Infinity;
        let maxPriceIncreaseAge = null;
        let maxPriceIncreaseTime = null;

        const collectionPrice = data.dataPoints[0]?.factor_values?.collectionPrice || 0;

        data.dataPoints.forEach(ts => {
            const factors = ts.factor_values || {};
            const earlyReturn = factors.earlyReturn || 0;
            const age = factors.age || 0;

            // 记录最高 earlyReturn
            if (earlyReturn > maxEarlyReturn) {
                maxEarlyReturn = earlyReturn;
                maxEarlyReturnAge = age;
                maxEarlyReturnTime = ts.timestamp;
            }

            // 计算价格涨幅（从collectionPrice）
            if (collectionPrice > 0 && factors.currentPrice > 0) {
                const priceIncrease = ((factors.currentPrice - collectionPrice) / collectionPrice) * 100;
                if (priceIncrease > maxPriceIncrease) {
                    maxPriceIncrease = priceIncrease;
                    maxPriceIncreaseAge = age;
                    maxPriceIncreaseTime = ts.timestamp;
                }
            }
        });

        pumpAnalysis.push({
            address: addr,
            symbol: data.symbol,
            maxEarlyReturn,
            maxEarlyReturnAge,
            maxEarlyReturnTime,
            maxPriceIncrease,
            maxPriceIncreaseAge,
            maxPriceIncreaseTime,
            dataPointCount: data.dataPoints.length
        });
    }

    // 策略条件: age < 1.33 AND earlyReturn >= 80 AND earlyReturn < 120
    console.log('📋 策略条件: age < 1.33 AND earlyReturn >= 80 AND earlyReturn < 120\n');

    // 分类结果
    const missedPumps = [];       // 暴涨但漏掉（age 超过 1.33）
    const wrongRange = [];        // earlyReturn 在 120% 以上
    const matched = [];           // 符合条件
    const lowReturn = [];         // earlyReturn 不足 80%

    pumpAnalysis.forEach(p => {
        if (p.maxEarlyReturn >= 80 && p.maxEarlyReturn < 120 && p.maxEarlyReturnAge < 1.33) {
            matched.push(p);
        } else if (p.maxEarlyReturn >= 80) {
            if (p.maxEarlyReturnAge >= 1.33) {
                missedPumps.push(p);
            }
            if (p.maxEarlyReturn >= 120) {
                wrongRange.push(p);
            }
        }
    });

    // 按 maxEarlyReturn 降序排序
    missedPumps.sort((a, b) => b.maxEarlyReturn - a.maxEarlyReturn);
    wrongRange.sort((a, b) => b.maxEarlyReturn - a.maxEarlyReturn);
    matched.sort((a, b) => b.maxEarlyReturn - a.maxEarlyReturn);

    console.log(`🔴 暴涨但因 age 超过 1.33 分钟而漏掉 (${missedPumps.length} 个):`);
    console.log('─'.repeat(100));
    missedPumps.slice(0, 20).forEach((p, i) => {
        console.log(`[${i + 1}] ${p.symbol.padEnd(15)} 最高涨幅: ${p.maxEarlyReturn.toFixed(1).padStart(6)}%  |  age: ${p.maxEarlyReturnAge.toFixed(2)}分钟`);
        console.log(`       时间: ${p.maxEarlyReturnTime} | 数据点: ${p.dataPointCount}`);
    });

    if (missedPumps.length > 20) {
        console.log(`       ... 还有 ${missedPumps.length - 20} 个`);
    }

    console.log(`\n🟠 暴涨但 earlyReturn >= 120% 超出范围 (${wrongRange.length} 个):`);
    console.log('─'.repeat(100));
    wrongRange.slice(0, 20).forEach((p, i) => {
        console.log(`[${i + 1}] ${p.symbol.padEnd(15)} 最高涨幅: ${p.maxEarlyReturn.toFixed(1).padStart(6)}%  |  age: ${p.maxEarlyReturnAge.toFixed(2)}分钟`);
        console.log(`       时间: ${p.maxEarlyReturnTime} | 数据点: ${p.dataPointCount}`);
    });

    if (wrongRange.length > 20) {
        console.log(`       ... 还有 ${wrongRange.length - 20} 个`);
    }

    console.log(`\n✅ 符合策略条件的 (${matched.length} 个):`);
    console.log('─'.repeat(100));
    matched.forEach((p, i) => {
        console.log(`[${i + 1}] ${p.symbol.padEnd(15)} 最高涨幅: ${p.maxEarlyReturn.toFixed(1).padStart(6)}%  |  age: ${p.maxEarlyReturnAge.toFixed(2)}分钟`);
        console.log(`       时间: ${p.maxEarlyReturnTime}`);
    });

    // 统计摘要
    console.log('\n📊 统计摘要:');
    console.log('─'.repeat(50));
    console.log(`暴涨因 age 超时而漏掉: ${missedPumps.length} 个`);
    console.log(`暴涨因超过 120% 漏掉: ${wrongRange.length} 个`);
    console.log(`符合策略条件:        ${matched.length} 个`);

    // 找出最典型的漏掉案例
    if (missedPumps.length > 0) {
        const topMissed = missedPumps[0];
        console.log('\n🎯 最典型的漏掉案例:');
        console.log(`   代币: ${topMissed.symbol}`);
        console.log(`   最高涨幅: ${topMissed.maxEarlyReturn.toFixed(1)}%`);
        console.log(`   当时 age: ${topMissed.maxEarlyReturnAge.toFixed(2)} 分钟`);
        console.log(`   如果策略是 age < ${Math.ceil(topMissed.maxEarlyReturnAge)} 就能抓住`);
    }

    console.log('\n✅ 分析完成');
}

analyzeMissedPumps().catch(console.error);
