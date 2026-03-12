require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

const EXPERIMENT_ID = '6980f98c-4bb8-4f9e-aeeb-141783fda314';

/**
 * FIFO匹配算法，构建交易对
 */
function buildTradePairs(trades) {
    const sortedTrades = [...trades].sort((a, b) =>
        new Date(a.created_at) - new Date(b.created_at)
    );

    const buyQueue = [];
    const tradePairs = [];

    sortedTrades.forEach(trade => {
        const isBuy = trade.trade_direction === 'buy';
        const tradeTime = new Date(trade.created_at);

        if (isBuy) {
            const cost = parseFloat(trade.input_amount || 0);
            const amount = parseFloat(trade.output_amount || 0);
            const pricePerToken = cost > 0 ? cost / amount : 0;

            buyQueue.push({
                amount: amount,
                cost: cost,
                pricePerToken: pricePerToken,
                trade: trade,
                buyTime: tradeTime
            });
        } else {
            const sellAmount = parseFloat(trade.input_amount || 0);
            const received = parseFloat(trade.output_amount || 0);
            const pricePerToken = sellAmount > 0 ? received / sellAmount : 0;

            let remainingSell = sellAmount;

            while (remainingSell > 0.00000001 && buyQueue.length > 0) {
                const buyInfo = buyQueue[0];
                const matchAmount = Math.min(remainingSell, buyInfo.amount);

                const pairCost = (matchAmount / buyInfo.amount) * buyInfo.cost;
                const pairReceived = (matchAmount / sellAmount) * received;
                const pairPnL = pairReceived - pairCost;
                const pairReturnRate = pairCost > 0 ? (pairPnL / pairCost) * 100 : 0;

                tradePairs.push({
                    pairIndex: tradePairs.length + 1,
                    buyTime: buyInfo.buyTime,
                    sellTime: tradeTime,
                    buyPrice: buyInfo.pricePerToken,
                    sellPrice: pricePerToken,
                    amount: matchAmount,
                    cost: pairCost,
                    received: pairReceived,
                    returnRate: pairReturnRate,
                    pnl: pairPnL
                });

                buyInfo.amount -= matchAmount;
                remainingSell -= matchAmount;

                if (buyInfo.amount < 0.00000001) {
                    buyQueue.shift();
                }
            }
        }
    });

    return tradePairs;
}

async function analyzeExperiment() {
    const { data: trades, error } = await supabase
        .from('trades')
        .select('*')
        .eq('experiment_id', EXPERIMENT_ID)
        .eq('success', true)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('查询失败:', error);
        return;
    }

    // 按代币分组
    const tokenTrades = {};
    trades.forEach(trade => {
        const key = trade.token_address;
        if (!tokenTrades[key]) {
            tokenTrades[key] = {
                symbol: trade.token_symbol,
                address: trade.token_address,
                trades: []
            };
        }
        tokenTrades[key].trades.push(trade);
    });

    console.log('\n' + '='.repeat(80));
    console.log(`实验 ${EXPERIMENT_ID} - 第一次买卖后是否继续第二次交易分析`);
    console.log('='.repeat(80));

    // 分析每个代币的交易对
    const results = [];

    for (const [key, { symbol, trades: tokenTradeList }] of Object.entries(tokenTrades)) {
        const pairs = buildTradePairs(tokenTradeList);

        if (pairs.length < 2) continue;

        const firstPair = pairs[0];
        const secondPair = pairs[1];

        results.push({
            symbol,
            firstReturnRate: firstPair.returnRate,
            firstPnL: firstPair.pnl,
            secondReturnRate: secondPair.returnRate,
            secondPnL: secondPair.pnl,
            totalPnL: firstPair.pnl + secondPair.pnl,
            pairCount: pairs.length
        });
    }

    const firstProfitThenSecond = results.filter(r => r.firstReturnRate > 0);
    const firstLossThenSecond = results.filter(r => r.firstReturnRate <= 0);

    console.log(`\n【总体情况】`);
    console.log(`有2对以上交易的代币: ${results.length}个`);

    console.log('\n' + '-'.repeat(80));
    console.log('【第一次盈利后的情况】');
    console.log('-'.repeat(80));

    if (firstProfitThenSecond.length > 0) {
        const avgFirstReturn = firstProfitThenSecond.reduce((sum, r) => sum + r.firstReturnRate, 0) / firstProfitThenSecond.length;
        const avgSecondReturn = firstProfitThenSecond.reduce((sum, r) => sum + r.secondReturnRate, 0) / firstProfitThenSecond.length;

        const secondProfitCount = firstProfitThenSecond.filter(r => r.secondReturnRate > 0).length;
        const secondLossCount = firstProfitThenSecond.filter(r => r.secondReturnRate <= 0).length;

        const stopAfterFirstProfit = firstProfitThenSecond.reduce((sum, r) => sum + r.firstPnL, 0);
        const continueToSecondProfit = firstProfitThenSecond.reduce((sum, r) => sum + r.totalPnL, 0);
        const diff = continueToSecondProfit - stopAfterFirstProfit;

        console.log(`样本数: ${firstProfitThenSecond.length}个代币`);
        console.log(`第一次平均收益率: ${avgFirstReturn.toFixed(2)}%`);
        console.log(`第二次平均收益率: ${avgSecondReturn.toFixed(2)}%`);
        console.log(`第二次盈利次数: ${secondProfitCount}/${firstProfitThenSecond.length} (${(secondProfitCount / firstProfitThenSecond.length * 100).toFixed(1)}%)`);
        console.log(`第二次亏损次数: ${secondLossCount}/${firstProfitThenSecond.length} (${(secondLossCount / firstProfitThenSecond.length * 100).toFixed(1)}%)`);
        console.log('');
        console.log(`如果第一次盈利后停止: ${stopAfterFirstProfit.toFixed(4)} BNB`);
        console.log(`如果继续第二次交易: ${continueToSecondProfit.toFixed(4)} BNB`);
        console.log(`差异: ${diff > 0 ? '+' : ''}${diff.toFixed(4)} BNB (${diff > 0 ? '继续交易更好' : '停止交易更好'})`);

        console.log('\n详细案例:');
        firstProfitThenSecond.forEach(r => {
            const status = r.secondReturnRate > 0 ? '✅' : '❌';
            const ifStop = r.firstPnL.toFixed(4);
            const ifContinue = r.totalPnL.toFixed(4);
            const diff = (r.totalPnL - r.firstPnL).toFixed(4);
            console.log(`  ${status} ${r.symbol}: 第1次 ${r.firstReturnRate.toFixed(1)}% → 第2次 ${r.secondReturnRate.toFixed(1)}% | 停止:${ifStop} 继续:${ifContinue} (差异:${diff})`);
        });
    } else {
        console.log('无数据');
    }

    console.log('\n' + '-'.repeat(80));
    console.log('【第一次亏损后的情况】');
    console.log('-'.repeat(80));

    if (firstLossThenSecond.length > 0) {
        const avgFirstReturn = firstLossThenSecond.reduce((sum, r) => sum + r.firstReturnRate, 0) / firstLossThenSecond.length;
        const avgSecondReturn = firstLossThenSecond.reduce((sum, r) => sum + r.secondReturnRate, 0) / firstLossThenSecond.length;

        const secondProfitCount = firstLossThenSecond.filter(r => r.secondReturnRate > 0).length;

        const firstLossTotal = firstLossThenSecond.reduce((sum, r) => sum + r.firstPnL, 0);
        const continueToSecondTotal = firstLossThenSecond.reduce((sum, r) => sum + r.totalPnL, 0);
        const diff = continueToSecondTotal - firstLossTotal;

        console.log(`样本数: ${firstLossThenSecond.length}个代币`);
        console.log(`第一次平均亏损: ${avgFirstReturn.toFixed(2)}%`);
        console.log(`第二次平均收益率: ${avgSecondReturn.toFixed(2)}%`);
        console.log(`第二次盈利次数: ${secondProfitCount}/${firstLossThenSecond.length} (${(secondProfitCount / firstLossThenSecond.length * 100).toFixed(1)}%)`);
        console.log('');
        console.log(`第一次总亏损: ${firstLossTotal.toFixed(4)} BNB`);
        console.log(`继续第二次交易后: ${continueToSecondTotal.toFixed(4)} BNB`);
        console.log(`差异: ${diff > 0 ? '+' : ''}${diff.toFixed(4)} BNB (${diff > 0 ? '回本有效' : '越亏越多'})`);

        console.log('\n详细案例:');
        firstLossThenSecond.forEach(r => {
            const status = r.secondReturnRate > 0 ? '✅回本' : '❌扩大亏损';
            const ifStop = r.firstPnL.toFixed(4);
            const ifContinue = r.totalPnL.toFixed(4);
            const diff = (r.totalPnL - r.firstPnL).toFixed(4);
            console.log(`  ${status} ${r.symbol}: 第1次 ${r.firstReturnRate.toFixed(1)}% → 第2次 ${r.secondReturnRate.toFixed(1)}% | 停止:${ifStop} 继续:${ifContinue} (差异:${diff})`);
        });
    } else {
        console.log('无数据');
    }

    // 结论
    console.log('\n' + '='.repeat(80));
    console.log('【结论与建议】');
    console.log('='.repeat(80));

    if (firstProfitThenSecond.length > 0) {
        const stopProfit = firstProfitThenSecond.reduce((sum, r) => sum + r.firstPnL, 0);
        const continueProfit = firstProfitThenSecond.reduce((sum, r) => sum + r.totalPnL, 0);
        const secondWinRate = firstProfitThenSecond.filter(r => r.secondReturnRate > 0).length / firstProfitThenSecond.length;

        if (continueProfit > stopProfit) {
            console.log(`✅ 第一次盈利后继续交易总收益更高 (+${(continueProfit - stopProfit).toFixed(4)} BNB)`);
        } else {
            console.log(`❌ 第一次盈利后停止交易更好 (避免损失 ${(stopProfit - continueProfit).toFixed(4)} BNB)`);
        }
        console.log(`   但第二次胜率仅 ${(secondWinRate * 100).toFixed(1)}%`);
    }

    if (firstLossThenSecond.length > 0) {
        const secondWinRate = firstLossThenSecond.filter(r => r.secondReturnRate > 0).length / firstLossThenSecond.length;
        console.log(`\n第一次亏损后第二次胜率 ${(secondWinRate * 100).toFixed(1)}%`);
        if (secondWinRate < 0.3) {
            console.log(`建议: 第一次亏损后立即止损`);
        }
    }
}

analyzeExperiment().catch(console.error);
