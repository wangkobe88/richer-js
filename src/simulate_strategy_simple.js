/**
 * 使用 API 获取数据并计算真实收益
 * 策略: age < 5 AND earlyReturn >= 50% AND earlyReturn < 150%
 */

const API_BASE = 'http://localhost:3010/api';
const EXPERIMENT_ID = 'db041ca0-dd20-434f-a49d-142aa0cf3826';

// 策略配置
const INITIAL_BNB = 100;
const TOTAL_CARDS = 4;
const PER_CARD_BNB = 0.25;
const AGE_LIMIT = 5;
const RETURN_MIN = 50;
const RETURN_MAX = 150;

async function fetchAPI(endpoint) {
    const response = await fetch(`${API_BASE}${endpoint}`);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
}

async function simulateStrategy() {
    console.log('🔍 模拟真实交易收益\n');
    console.log('📋 策略配置:');
    console.log(`  初始资金: ${INITIAL_BNB} BNB`);
    console.log(`  买入条件: age < ${AGE_LIMIT} AND ${RETURN_MIN}% <= earlyReturn < ${RETURN_MAX}%`);
    console.log(`  每次买入: ${TOTAL_CARDS} 卡 × ${PER_CARD_BNB} BNB = ${TOTAL_CARDS * PER_CARD_BNB} BNB\n`);

    // 获取所有代币的时序因子（每个代币取一条记录用于筛选）
    console.log('📊 1. 获取代币列表...');
    const factorsResult = await fetchAPI(`/experiment/time-series/factors?experimentId=${EXPERIMENT_ID}`);
    const tokenList = factorsResult.data || [];

    console.log(`有因子数据的代币数: ${tokenList.length}`);

    if (tokenList.length === 0) {
        console.log('❌ 没有数据');
        return;
    }

    // 对每个代币获取详细的时序数据
    console.log('\n📈 2. 分析每个代币...');

    const trades = [];
    let processed = 0;

    for (const tokenAddress of tokenList) {
        try {
            // 获取该代币的时序数据
            const tsResult = await fetchAPI(`/experiment/time-series/data?experimentId=${EXPERIMENT_ID}&tokenAddress=${tokenAddress}`);
            const tsData = tsResult.data || [];

            if (tsData.length === 0) continue;

            // 解析数据点
            const dataPoints = [];
            for (const ts of tsData) {
                const factors = ts.factor_values || {};
                const age = factors.age || 0;
                const earlyReturn = factors.earlyReturn || 0;
                const currentPrice = factors.currentPrice || 0;

                dataPoints.push({
                    loop: ts.loop_count,
                    age,
                    earlyReturn,
                    currentPrice
                });
            }

            // 按 loop 排序
            dataPoints.sort((a, b) => a.loop - b.loop);

            // 检查在 age < 5 窗口内是否有满足条件的点
            const windowData = dataPoints.filter(d => d.age < AGE_LIMIT && d.currentPrice > 0);

            if (windowData.length === 0) continue;

            const triggerPoint = windowData.find(d =>
                d.earlyReturn >= RETURN_MIN && d.earlyReturn < RETURN_MAX
            );

            if (!triggerPoint) continue;

            // 买入
            const buyPrice = triggerPoint.currentPrice;
            const investmentBNB = TOTAL_CARDS * PER_CARD_BNB;

            // 最终价格
            const validPrices = dataPoints.filter(d => d.currentPrice > 0);
            if (validPrices.length === 0) continue;

            const finalPrice = validPrices[validPrices.length - 1].currentPrice;

            // 计算收益
            const tokensReceived = investmentBNB / buyPrice;
            const finalValue = tokensReceived * finalPrice;
            const profit = finalValue - investmentBNB;
            const finalReturn = ((finalPrice - buyPrice) / buyPrice) * 100;

            trades.push({
                symbol: tsData[0].token_symbol || 'Unknown',
                address: tokenAddress,
                buyReturn: triggerPoint.earlyReturn,
                buyAge: triggerPoint.age,
                buyLoop: triggerPoint.loop,
                buyPrice,
                finalPrice,
                investmentBNB,
                finalValue,
                profit,
                finalReturn
            });

        } catch (e) {
            // 跳过错误
        }

        processed++;
        if (processed % 50 === 0) {
            console.log(`  已分析 ${processed}/${tokenList.length} 个代币...`);
        }
    }

    console.log(`\n分析完成: ${trades.length} 笔触发交易\n`);

    // 统计结果
    const profits = trades.filter(t => t.profit > 0);
    const losses = trades.filter(t => t.profit <= 0);
    const totalProfit = trades.reduce((sum, t) => sum + t.profit, 0);
    const totalInvested = trades.reduce((sum, t) => sum + t.investmentBNB, 0);
    const finalBalance = INITIAL_BNB + totalProfit;
    const overallReturn = ((finalBalance - INITIAL_BNB) / INITIAL_BNB) * 100;

    console.log('📊 收益统计:');
    console.log('─'.repeat(90));
    console.log(`总交易数: ${trades.length}`);
    console.log(`盈利交易: ${profits.length} (${trades.length > 0 ? (profits.length/trades.length*100).toFixed(1) : 0}%)`);
    console.log(`亏损交易: ${losses.length} (${trades.length > 0 ? (losses.length/trades.length*100).toFixed(1) : 0}%)`);
    console.log('');
    console.log(`总投入: ${totalInvested.toFixed(2)} BNB`);
    console.log(`总收益: ${totalProfit > 0 ? '+' : ''}${totalProfit.toFixed(2)} BNB`);
    console.log('');
    console.log(`💰 初始余额: ${INITIAL_BNB} BNB`);
    console.log(`💰 最终余额: ${finalBalance.toFixed(2)} BNB`);
    console.log(`📈 总回报率: ${overallReturn > 0 ? '+' : ''}${overallReturn.toFixed(1)}%`);

    // 显示每笔交易
    if (trades.length > 0) {
        console.log(`\n📋 所有交易详情 (按收益排序):`);
        console.log('─'.repeat(90));

        trades.sort((a, b) => b.profit - a.profit);

        trades.forEach((t, i) => {
            const status = t.profit > 0 ? '✅ 盈利' : '❌ 亏损';
            console.log(`[${i + 1}] ${t.symbol.padEnd(15)} ${status.padEnd(8)} 买入: ${t.buyReturn.toFixed(1)}%(age:${t.buyAge.toFixed(2)}min) → 收益: ${t.finalReturn.toFixed(1).padStart(6)}% | BNB: ${t.profit > 0 ? '+' : ''}${t.profit.toFixed(3)}`);
        });

        // 最大盈利和亏损
        console.log(`\n🏆 最大盈利: ${Math.max(...trades.map(t => t.profit)).toFixed(3)} BNB (${trades[0].symbol})`);
        console.log(`📉 最大亏损: ${Math.min(...trades.map(t => t.profit)).toFixed(3)} BNB (${trades[trades.length-1].symbol})`);
    }

    console.log(`\n✅ 模拟完成`);
}

simulateStrategy().catch(console.error);
