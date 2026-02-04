/**
 * 分析策略条件变化的影响
 * 对比当前条件 vs 新条件的交易信号和结果
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

async function analyzeStrategyChange() {
    console.log(`🔍 分析策略条件变化: ${EXPERIMENT_ID}\n`);

    // 1. 获取时序数据
    console.log('📊 1. 获取时序数据...');
    const timeSeriesResult = await fetchAPI(`/experiment/time-series/data?experimentId=${EXPERIMENT_ID}`);
    const timeSeries = timeSeriesResult.data || [];
    console.log(`时序数据点数: ${timeSeries.length}`);

    // 2. 获取代币列表
    const tokensResult = await fetchAPI(`/experiment/${EXPERIMENT_ID}/tokens?limit=10000`);
    const tokens = tokensResult.tokens || [];

    // 创建代币地址到符号的映射
    const tokenSymbolMap = new Map();
    tokens.forEach(t => {
        tokenSymbolMap.set(t.token_address.toLowerCase(), t.token_symbol);
    });

    // 3. 分析每个代币的峰值时机
    console.log('\n📈 2. 分析每个代币的峰值时机...\n');

    // 按代币分组
    const tokenData = new Map();
    timeSeries.forEach(ts => {
        const addr = ts.token_address.toLowerCase();
        if (!tokenData.has(addr)) {
            tokenData.set(addr, {
                address: ts.token_address,
                symbol: ts.token_symbol,
                dataPoints: []
            });
        }
        tokenData.get(addr).dataPoints.push(ts);
    });

    // 分析结果
    const results = [];

    for (const [addr, data] of tokenData) {
        let maxEarlyReturn = -Infinity;
        let maxEarlyReturnAge = null;
        let maxEarlyReturnTime = null;
        let maxEarlyReturnPrice = null;

        let finalReturn = null;
        let finalPrice = null;
        let collectionPrice = null;

        data.dataPoints.forEach(ts => {
            const factors = ts.factor_values || {};
            const earlyReturn = factors.earlyReturn || 0;
            const age = factors.age || 0;
            const currentPrice = factors.currentPrice || 0;

            if (!collectionPrice && factors.collectionPrice) {
                collectionPrice = factors.collectionPrice;
            }

            // 记录最高 earlyReturn
            if (earlyReturn > maxEarlyReturn) {
                maxEarlyReturn = earlyReturn;
                maxEarlyReturnAge = age;
                maxEarlyReturnTime = ts.timestamp;
                maxEarlyReturnPrice = currentPrice;
            }

            // 记录最终价格和收益率
            finalPrice = currentPrice;
            if (collectionPrice > 0) {
                finalReturn = ((finalPrice - collectionPrice) / collectionPrice) * 100;
            }
        });

        results.push({
            address: data.address,
            symbol: data.symbol,
            maxEarlyReturn,
            maxEarlyReturnAge,
            maxEarlyReturnTime,
            maxEarlyReturnPrice,
            finalReturn,
            finalPrice,
            collectionPrice,
            dataPointCount: data.dataPoints.length
        });
    }

    // 4. 策略条件分析
    console.log('🎯 3. 策略条件对比分析\n');

    // 当前条件: age < 1.33 AND earlyReturn >= 80 AND earlyReturn < 120
    // 新条件: age < 5 AND earlyReturn >= 80 AND earlyReturn < 150

    const currentMatches = [];
    const newMatches = [];
    const additionalMatches = [];

    results.forEach(r => {
        const currentMatch = r.maxEarlyReturn >= 80 && r.maxEarlyReturn < 120 && r.maxEarlyReturnAge < 1.33;
        const newMatch = r.maxEarlyReturn >= 80 && r.maxEarlyReturn < 150 && r.maxEarlyReturnAge < 5;

        if (currentMatch) {
            currentMatches.push(r);
        }
        if (newMatch && !currentMatch) {
            additionalMatches.push(r);
        }
        if (newMatch) {
            newMatches.push(r);
        }
    });

    // 按 maxEarlyReturn 降序排序
    additionalMatches.sort((a, b) => b.maxEarlyReturn - a.maxEarlyReturn);

    console.log(`📋 策略条件对比:`);
    console.log(`─`.repeat(80));
    console.log(`当前条件 (age < 1.33, 80% <= earlyReturn < 120%): ${currentMatches.length} 个交易`);
    console.log(`新条件   (age < 5,     80% <= earlyReturn < 150%): ${newMatches.length} 个交易`);
    console.log(`新增交易: ${additionalMatches.length} 个\n`);

    if (additionalMatches.length > 0) {
        console.log(`🔍 新增的 ${additionalMatches.length} 个交易分析:`);
        console.log(`─`.repeat(80));

        let totalMaxReturn = 0;
        let totalFinalReturn = 0;
        let profitCount = 0;
        let lossCount = 0;

        additionalMatches.forEach((r, i) => {
            const isProfit = r.finalReturn > 0;
            if (isProfit) profitCount++; else lossCount++;
            totalMaxReturn += r.maxEarlyReturn;
            totalFinalReturn += r.finalReturn;

            const status = isProfit ? '✅ 盈利' : '❌ 亏损';
            console.log(`[${i + 1}] ${r.symbol.padEnd(15)} ${status}`);
            console.log(`     峰值: ${r.maxEarlyReturn.toFixed(1).padStart(6)}% (age: ${r.maxEarlyReturnAge.toFixed(2)}分钟)`);
            console.log(`     最终: ${r.finalReturn.toFixed(1).padStart(6)}%`);
            console.log(`     地址: ${r.address}`);
        });

        console.log(`\n📊 新增交易统计:`);
        console.log(`─`.repeat(50));
        console.log(`总交易数:   ${additionalMatches.length}`);
        console.log(`盈利交易:   ${profitCount} (${(profitCount/additionalMatches.length*100).toFixed(1)}%)`);
        console.log(`亏损交易:   ${lossCount} (${(lossCount/additionalMatches.length*100).toFixed(1)}%)`);
        console.log(`平均峰值涨幅: ${(totalMaxReturn/additionalMatches.length).toFixed(1)}%`);
        console.log(`平均最终收益: ${(totalFinalReturn/additionalMatches.length).toFixed(1)}%`);
        console.log(`峰值最大涨幅: ${Math.max(...additionalMatches.map(r => r.maxEarlyReturn)).toFixed(1)}%`);
        console.log(`峰值最小涨幅: ${Math.min(...additionalMatches.map(r => r.maxEarlyReturn)).toFixed(1)}%`);
        console.log(`最大亏损:     ${Math.min(...additionalMatches.map(r => r.finalReturn)).toFixed(1)}%`);
    }

    // 5. 详细列出当前条件漏掉但新条件能抓住的大牛币
    const bigWins = additionalMatches.filter(r => r.maxEarlyReturn >= 200);
    if (bigWins.length > 0) {
        console.log(`\n🔥 新增的大牛币 (涨幅 >= 200%):`);
        console.log(`─`.repeat(80));
        bigWins.forEach((r, i) => {
            console.log(`[${i + 1}] ${r.symbol.padEnd(15)} 峰值: ${r.maxEarlyReturn.toFixed(1).padStart(7)}% | 最终: ${r.finalReturn.toFixed(1).padStart(6)}% | age: ${r.maxEarlyReturnAge.toFixed(2)}分钟`);
        });
    }

    // 6. 列出新增的亏损交易
    const losses = additionalMatches.filter(r => r.finalReturn < 0);
    if (losses.length > 0) {
        console.log(`\n⚠️ 新增的亏损交易 (${losses.length} 个):`);
        console.log(`─`.repeat(80));
        losses.forEach((r, i) => {
            console.log(`[${i + 1}] ${r.symbol.padEnd(15)} 峰值: ${r.maxEarlyReturn.toFixed(1).padStart(7)}% | 最终: ${r.finalReturn.toFixed(1).padStart(6)}% | age: ${r.maxEarlyReturnAge.toFixed(2)}分钟`);
        });
    }

    // 7. 综合评估
    console.log(`\n📋 综合评估:`);
    console.log(`─`.repeat(50));
    console.log(`当前策略收益 (${currentMatches.length}个交易):`);
    if (currentMatches.length > 0) {
        const currentAvgFinal = currentMatches.reduce((sum, r) => sum + r.finalReturn, 0) / currentMatches.length;
        console.log(`  平均最终收益: ${currentAvgFinal.toFixed(1)}%`);
    } else {
        console.log(`  无交易`);
    }

    console.log(`\n新策略收益 (${newMatches.length}个交易):`);
    if (newMatches.length > 0) {
        const newAvgFinal = newMatches.reduce((sum, r) => sum + r.finalReturn, 0) / newMatches.length;
        console.log(`  平均最终收益: ${newAvgFinal.toFixed(1)}%`);
        console.log(`  增加交易数: ${additionalMatches.length}`);
        console.log(`  增加盈利率: ${(profitCount/additionalMatches.length*100).toFixed(1)}%`);
    } else {
        console.log(`  无交易`);
    }

    console.log('\n✅ 分析完成');
}

analyzeStrategyChange().catch(console.error);
