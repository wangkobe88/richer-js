/**
 * 模拟实验 28ee83a3 的策略在 db041ca0 数据上的真实收益
 * 策略: age < 5 AND earlyReturn >= 50% AND earlyReturn < 150%
 * 初始: 100 BNB
 * 卡牌: 4 张, 每张 0.25 BNB
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
    console.log(`  每次买入: ${TOTAL_CARDS} 卡 × ${PER_CARD_BNB} BNB = ${TOTAL_CARDS * PER_CARD_BNB} BNB`);
    console.log(`  每币最多: 1 次买入\n`);

    // 获取所有时序数据 - 分批获取
    console.log('📊 1. 获取代币列表...');
    let allTsData = [];
    let offset = 0;
    const limit = 1000;

    while (true) {
        const tsResult = await fetchAPI(`/experiment/time-series/data?experimentId=${EXPERIMENT_ID}&limit=${limit}&offset=${offset}`);
        const batch = tsResult.data || [];
        allTsData = allTsData.concat(batch);
        if (batch.length < limit) break;
        offset += limit;
        console.log(`  已获取 ${allTsData.length} 条记录...`);
    }

    // 按代币分组
    const tokenData = new Map();
    allTsData.forEach(ts => {
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

    console.log(`总代币数(有时序数据): ${tokenData.size}\n`);

    // 模拟交易
    const trades = [];
    let bnbBalance = INITIAL_BNB;
    let bnbCards = TOTAL_CARDS;
    let tokenCards = 0;

    for (const [addr, data] of tokenData) {
        if (bnbCards < TOTAL_CARDS) {
            // 之前买入的代币还没有卖出，跳过
            continue;
        }

        const windowData = data.dataPoints.filter(ts => {
            const age = ts.factor_values?.age || 0;
            return age < AGE_LIMIT;
        });

        if (windowData.length === 0) continue;

        // 找第一个触发买入的点
        const triggerPoint = windowData.find(ts => {
            const earlyReturn = ts.factor_values?.earlyReturn || 0;
            return earlyReturn >= RETURN_MIN && earlyReturn < RETURN_MAX;
        });

        if (!triggerPoint) continue;

        // 买入
        const buyPrice = triggerPoint.factor_values?.currentPrice || 0;
        const buyReturn = triggerPoint.factor_values?.earlyReturn || 0;
        const buyAge = triggerPoint.factor_values?.age || 0;
        const buyLoop = triggerPoint.loop_count;

        const investmentBNB = TOTAL_CARDS * PER_CARD_BNB;
        const tokensReceived = investmentBNB / buyPrice;

        bnbBalance -= investmentBNB;
        bnbCards = 0;
        tokenCards = TOTAL_CARDS;

        // 计算最终收益
        const collectionPrice = data.dataPoints[0].factor_values?.collectionPrice || 0;
        const finalPrice = data.dataPoints[data.dataPoints.length - 1].factor_values?.currentPrice || 0;

        let finalReturn = 0;
        if (buyPrice > 0 && finalPrice > 0) {
            finalReturn = ((finalPrice - buyPrice) / buyPrice) * 100;
        }

        const finalValue = tokensReceived * finalPrice;
        const profit = finalValue - investmentBNB;

        trades.push({
            symbol: data.symbol,
            address: addr,
            buyReturn: buyReturn,
            buyAge: buyAge,
            buyLoop: buyLoop,
            buyPrice: buyPrice,
            finalPrice: finalPrice,
            investmentBNB: investmentBNB,
            finalValue: finalValue,
            profit: profit,
            finalReturn: finalReturn
        });

        // 卖出后恢复卡牌
        bnbBalance += finalValue;
        bnbCards = TOTAL_CARDS;
        tokenCards = 0;
    }

    // 统计结果
    console.log('📈 2. 交易模拟完成\n');

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
    console.log(`总收益: ${totalProfit.toFixed(2)} BNB`);
    console.log('');
    console.log(`💰 初始余额: ${INITIAL_BNB} BNB`);
    console.log(`💰 最终余额: ${finalBalance.toFixed(2)} BNB`);
    console.log(`📈 总回报率: ${overallReturn.toFixed(1)}%`);

    // 显示每笔交易
    console.log(`\n📋 所有交易详情:`);
    console.log('─'.repeat(90));

    trades.sort((a, b) => b.profit - a.profit);

    trades.forEach((t, i) => {
        const status = t.profit > 0 ? '✅ 盈利' : '❌ 亏损';
        console.log(`[${i + 1}] ${t.symbol.padEnd(15)} ${status.padEnd(8)} 买入: ${t.buyReturn.toFixed(1)}%(age:${t.buyAge.toFixed(2)}min) → 收益: ${t.finalReturn.toFixed(1).padStart(6)}% | BNB: ${t.profit > 0 ? '+' : ''}${t.profit.toFixed(3)}`);
    });

    console.log(`\n✅ 模拟完成`);
}

simulateStrategy().catch(console.error);
