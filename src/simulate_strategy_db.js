/**
 * 使用数据库直接计算实验 28ee83a3 的策略在 db041ca0 数据上的真实收益
 * 策略: age < 5 AND earlyReturn >= 50% AND earlyReturn < 150%
 */

const { DB } = require('../src/db');
const path = require('path');

// 策略配置
const INITIAL_BNB = 100;
const TOTAL_CARDS = 4;
const PER_CARD_BNB = 0.25;
const AGE_LIMIT = 5;
const RETURN_MIN = 50;
const RETURN_MAX = 150;

async function simulateFromDB() {
    console.log('🔍 从数据库模拟真实交易收益\n');
    console.log('📋 策略配置:');
    console.log(`  初始资金: ${INITIAL_BNB} BNB`);
    console.log(`  买入条件: age < ${AGE_LIMIT} AND ${RETURN_MIN}% <= earlyReturn < ${RETURN_MAX}%`);
    console.log(`  每次买入: ${TOTAL_CARDS} 卡 × ${PER_CARD_BNB} BNB = ${TOTAL_CARDS * PER_CARD_BNB} BNB\n`);

    const dbPath = path.join(__dirname, '../trading.db');
    const db = new DB(dbPath);

    try {
        // 获取所有有时序数据的代币地址
        const tokensQuery = `
            SELECT DISTINCT token_address, token_symbol
            FROM experiment_time_series_data
            WHERE experiment_id = 'db041ca0-dd20-434f-a49d-142aa0cf3826'
        `;

        const tokens = await db.all(tokensQuery);
        console.log(`📊 总代币数(有时序数据): ${tokens.length}\n`);

        const trades = [];
        let processed = 0;

        for (const token of tokens) {
            // 获取该代币的所有时序数据，按 loop 排序
            const tsQuery = `
                SELECT loop_count, timestamp, factor_values, token_address, token_symbol
                FROM experiment_time_series_data
                WHERE experiment_id = 'db041ca0-dd20-434f-a49d-142aa0cf3826'
                  AND token_address = ?
                ORDER BY loop_count ASC
            `;

            const timeSeriesData = await db.all(tsQuery, [token.token_address]);

            if (timeSeriesData.length === 0) continue;

            // 解析 factor_values
            const dataPoints = [];
            let collectionPrice = null;

            for (const ts of timeSeriesData) {
                let factors = {};
                try {
                    if (typeof ts.factor_values === 'string') {
                        factors = JSON.parse(ts.factor_values);
                    } else if (typeof ts.factor_values === 'object') {
                        factors = ts.factor_values || {};
                    }
                } catch (e) {
                    continue;
                }

                const age = factors.age || 0;
                const earlyReturn = factors.earlyReturn || 0;
                const currentPrice = factors.currentPrice || 0;

                if (!collectionPrice && factors.collectionPrice) {
                    collectionPrice = factors.collectionPrice;
                }

                dataPoints.push({
                    loop: ts.loop_count,
                    age,
                    earlyReturn,
                    currentPrice,
                    factors
                });
            }

            if (dataPoints.length === 0 || !collectionPrice) continue;

            // 检查在 age < 5 分钟窗口内是否有数据点在 50%-150% 范围内
            const windowData = dataPoints.filter(d => d.age < AGE_LIMIT);
            if (windowData.length === 0) continue;

            const triggerPoint = windowData.find(d =>
                d.earlyReturn >= RETURN_MIN && d.earlyReturn < RETURN_MAX
            );

            if (!triggerPoint) continue;

            // 买入
            const buyPrice = triggerPoint.currentPrice;
            const investmentBNB = TOTAL_CARDS * PER_CARD_BNB;

            if (buyPrice <= 0) continue;

            // 最终价格
            const finalPoint = dataPoints[dataPoints.length - 1];
            const finalPrice = finalPoint.currentPrice || 0;

            if (finalPrice <= 0) continue;

            // 计算收益
            const tokensReceived = investmentBNB / buyPrice;
            const finalValue = tokensReceived * finalPrice;
            const profit = finalValue - investmentBNB;
            const finalReturn = ((finalPrice - buyPrice) / buyPrice) * 100;

            trades.push({
                symbol: token.token_symbol || 'Unknown',
                address: token.token_address,
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

            processed++;
            if (processed % 100 === 0) {
                console.log(`已分析 ${processed}/${tokens.length} 个代币...`);
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
        console.log(`\n📋 所有交易详情 (按收益排序):`);
        console.log('─'.repeat(90));

        trades.sort((a, b) => b.profit - a.profit);

        trades.forEach((t, i) => {
            const status = t.profit > 0 ? '✅ 盈利' : '❌ 亏损';
            console.log(`[${i + 1}] ${t.symbol.padEnd(15)} ${status.padEnd(8)} 买入: ${t.buyReturn.toFixed(1)}%(age:${t.buyAge.toFixed(2)}min) → 收益: ${t.finalReturn.toFixed(1).padStart(6)}% | BNB: ${t.profit > 0 ? '+' : ''}${t.profit.toFixed(3)}`);
        });

        // 最大盈利和亏损
        if (trades.length > 0) {
            console.log(`\n🏆 最大盈利: ${Math.max(...trades.map(t => t.profit)).toFixed(3)} BNB (${trades[0].symbol})`);
            console.log(`📉 最大亏损: ${Math.min(...trades.map(t => t.profit)).toFixed(3)} BNB (${trades[trades.length-1].symbol})`);
        }

        console.log(`\n✅ 模拟完成`);

    } finally {
        await db.close();
    }
}

simulateFromDB().catch(console.error);
