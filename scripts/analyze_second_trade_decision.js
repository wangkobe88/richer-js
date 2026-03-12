/**
 * 分析第一次买卖盈利后是否应该继续第二次买卖
 *
 * 核心问题：第一次买卖盈利后，停止 vs 继续第二次买卖，哪个更好？
 */

require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

/**
 * FIFO匹配算法，构建交易对
 *
 * 数据结构：
 * - buy: input_currency=BNB, output_currency=代币, input_amount=BNB成本, output_amount=代币数量
 * - sell: input_currency=代币, output_currency=BNB, input_amount=代币数量, output_amount=BNB收入
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
            // 买入: 花费 input_amount BNB, 获得 output_amount 代币
            const cost = parseFloat(trade.input_amount || 0);
            const amount = parseFloat(trade.output_amount || 0);
            const pricePerToken = cost > 0 ? cost / amount : 0; // 每代币的 BNB 价格

            buyQueue.push({
                amount: amount,
                cost: cost,
                pricePerToken: pricePerToken,
                trade: trade,
                buyTime: tradeTime
            });
        } else {
            // 卖出: 卖出 input_amount 代币, 获得 output_amount BNB
            const sellAmount = parseFloat(trade.input_amount || 0);
            const received = parseFloat(trade.output_amount || 0);
            const pricePerToken = sellAmount > 0 ? received / sellAmount : 0; // 每代币的 BNB 价格

            let remainingSell = sellAmount;

            while (remainingSell > 0.00000001 && buyQueue.length > 0) {
                const buyInfo = buyQueue[0];
                const matchAmount = Math.min(remainingSell, buyInfo.amount);

                // 按比例计算成本和收入
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

/**
 * 分析交易对序列的决策影响
 */
async function analyzeSecondTradeDecision() {
    // 获取所有实验的交易数据
    const { data: trades, error } = await supabase
        .from('trades')
        .select('*')
        .not('input_amount', 'is', null)
        .not('output_amount', 'is', null)
        .eq('success', true)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('查询交易数据失败:', error);
        return;
    }

    // 按代币分组
    const tokenTrades = {};
    trades.forEach(trade => {
        const key = `${trade.token_address}_${trade.chain}`;
        if (!tokenTrades[key]) {
            tokenTrades[key] = [];
        }
        tokenTrades[key].push(trade);
    });

    // 分析每个代币的交易对
    const results = [];

    for (const [key, tokenTradeList] of Object.entries(tokenTrades)) {
        const pairs = buildTradePairs(tokenTradeList);

        if (pairs.length < 2) continue; // 至少需要2对交易才有分析价值

        const firstPair = pairs[0];
        const secondPair = pairs[1];

        const result = {
            tokenAddress: key.split('_')[0],
            chain: key.split('_')[1],
            symbol: tokenTradeList[0]?.token_symbol || 'UNKNOWN',
            firstReturnRate: firstPair.returnRate,
            firstPnL: firstPair.pnl,
            secondReturnRate: secondPair.returnRate,
            secondPnL: secondPair.pnl,
            totalReturnRate: firstPair.returnRate + secondPair.returnRate, // 近似
            totalPnL: firstPair.pnl + secondPair.pnl,
            pairCount: pairs.length
        };

        results.push(result);
    }

    // 分类统计
    const firstProfitThenSecond = results.filter(r => r.firstReturnRate > 0);
    const firstLossThenSecond = results.filter(r => r.firstReturnRate <= 0);

    console.log('\n' + '='.repeat(80));
    console.log('第一次买卖后再进行第二次买卖的分析');
    console.log('='.repeat(80));

    console.log('\n【总体情况】');
    console.log(`总代币数: ${results.length}`);
    console.log(`平均每代币交易对数: ${(results.reduce((sum, r) => sum + r.pairCount, 0) / results.length).toFixed(2)}`);

    console.log('\n' + '-'.repeat(80));
    console.log('【第一次盈利后的情况】');
    console.log('-'.repeat(80));

    if (firstProfitThenSecond.length > 0) {
        const avgFirstReturn = firstProfitThenSecond.reduce((sum, r) => sum + r.firstReturnRate, 0) / firstProfitThenSecond.length;
        const avgSecondReturn = firstProfitThenSecond.reduce((sum, r) => sum + r.secondReturnRate, 0) / firstProfitThenSecond.length;
        const avgTotalReturn = firstProfitThenSecond.reduce((sum, r) => sum + r.totalPnL, 0) / firstProfitThenSecond.length;

        const secondProfitCount = firstProfitThenSecond.filter(r => r.secondReturnRate > 0).length;
        const secondLossCount = firstProfitThenSecond.filter(r => r.secondReturnRate <= 0).length;

        const stopAfterFirstProfit = firstProfitThenSecond.reduce((sum, r) => sum + r.firstPnL, 0);
        const continueToSecondProfit = firstProfitThenSecond.reduce((sum, r) => sum + r.totalPnL, 0);
        const diff = continueToSecondProfit - stopAfterFirstProfit;

        console.log(`样本数: ${firstProfitThenSecond.length}`);
        console.log(`第一次平均收益率: ${avgFirstReturn.toFixed(2)}%`);
        console.log(`第二次平均收益率: ${avgSecondReturn.toFixed(2)}%`);
        console.log(`第二次盈利次数: ${secondProfitCount} (${(secondProfitCount / firstProfitThenSecond.length * 100).toFixed(1)}%)`);
        console.log(`第二次亏损次数: ${secondLossCount} (${(secondLossCount / firstProfitThenSecond.length * 100).toFixed(1)}%)`);
        console.log('');
        console.log(`如果第一次盈利后停止，总收益: ${stopAfterFirstProfit.toFixed(6)} BNB`);
        console.log(`如果继续第二次交易，总收益: ${continueToSecondProfit.toFixed(6)} BNB`);
        console.log(`差异: ${diff > 0 ? '+' : ''}${diff.toFixed(6)} BNB (${diff > 0 ? '继续交易更好' : '停止交易更好'})`);
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
        const secondLossCount = firstLossThenSecond.filter(r => r.secondReturnRate <= 0).length;

        const firstLossTotal = firstLossThenSecond.reduce((sum, r) => sum + r.firstPnL, 0);
        const continueToSecondTotal = firstLossThenSecond.reduce((sum, r) => sum + r.totalPnL, 0);
        const diff = continueToSecondTotal - firstLossTotal;

        console.log(`样本数: ${firstLossThenSecond.length}`);
        console.log(`第一次平均收益率: ${avgFirstReturn.toFixed(2)}%`);
        console.log(`第二次平均收益率: ${avgSecondReturn.toFixed(2)}%`);
        console.log(`第二次盈利次数: ${secondProfitCount} (${(secondProfitCount / firstLossThenSecond.length * 100).toFixed(1)}%)`);
        console.log(`第二次亏损次数: ${secondLossCount} (${(secondLossCount / firstLossThenSecond.length * 100).toFixed(1)}%)`);
        console.log('');
        console.log(`第一次总亏损: ${firstLossTotal.toFixed(6)} BNB`);
        console.log(`继续第二次交易后总收益: ${continueToSecondTotal.toFixed(6)} BNB`);
        console.log(`差异: ${diff > 0 ? '+' : ''}${diff.toFixed(6)} BNB (${diff > 0 ? '回本有效' : '越亏越多'})`);
    } else {
        console.log('无数据');
    }

    // 详细案例
    console.log('\n' + '-'.repeat(80));
    console.log('【第一次盈利后第二次表现最差的5个案例】');
    console.log('-'.repeat(80));

    const worstSecondTrades = [...firstProfitThenSecond]
        .sort((a, b) => a.secondReturnRate - b.secondReturnRate)
        .slice(0, 5);

    worstSecondTrades.forEach((r, i) => {
        console.log(`\n${i + 1}. ${r.symbol}`);
        console.log(`   第一次: +${r.firstReturnRate.toFixed(2)}% (${r.firstPnL.toFixed(6)} BNB)`);
        console.log(`   第二次: ${r.secondReturnRate.toFixed(2)}% (${r.secondPnL.toFixed(6)} BNB)`);
        console.log(`   如果停止: ${r.firstPnL.toFixed(6)} BNB`);
        console.log(`   继续交易: ${r.totalPnL.toFixed(6)} BNB`);
        console.log(`   损失: ${(r.firstPnL - r.totalPnL).toFixed(6)} BNB`);
    });

    console.log('\n' + '-'.repeat(80));
    console.log('【第一次亏损后第二次表现最好的5个案例】');
    console.log('-'.repeat(80));

    const bestRecoveryTrades = [...firstLossThenSecond]
        .sort((a, b) => b.secondReturnRate - a.secondReturnRate)
        .slice(0, 5);

    bestRecoveryTrades.forEach((r, i) => {
        console.log(`\n${i + 1}. ${r.symbol}`);
        console.log(`   第一次: ${r.firstReturnRate.toFixed(2)}% (${r.firstPnL.toFixed(6)} BNB)`);
        console.log(`   第二次: ${r.secondReturnRate.toFixed(2)}% (${r.secondPnL.toFixed(6)} BNB)`);
        console.log(`   第一次亏损: ${r.firstPnL.toFixed(6)} BNB`);
        console.log(`   继续交易: ${r.totalPnL.toFixed(6)} BNB`);
        console.log(`   回本: ${(r.totalPnL - r.firstPnL).toFixed(6)} BNB`);
    });

    // 结论
    console.log('\n' + '='.repeat(80));
    console.log('【结论】');
    console.log('='.repeat(80));

    if (firstProfitThenSecond.length > 0) {
        const stopProfit = firstProfitThenSecond.reduce((sum, r) => sum + r.firstPnL, 0);
        const continueProfit = firstProfitThenSecond.reduce((sum, r) => sum + r.totalPnL, 0);
        const secondWinRate = firstProfitThenSecond.filter(r => r.secondReturnRate > 0).length / firstProfitThenSecond.length;

        console.log(``);
        if (continueProfit > stopProfit) {
            console.log(`✅ 继续第二次交易总收益更高 (+${(continueProfit - stopProfit).toFixed(6)} BNB)`);
            console.log(`   但第二次胜率仅 ${ (secondWinRate * 100).toFixed(1) }%，风险较高`);
        } else {
            console.log(`❌ 第一次盈利后停止交易更好 (避免损失 ${(stopProfit - continueProfit).toFixed(6)} BNB)`);
            console.log(`   第二次胜率仅 ${ (secondWinRate * 100).toFixed(1) }%`);
        }
    }

    console.log(`\n建议：`);
    const secondProfitRate = firstProfitThenSecond.length > 0
        ? firstProfitThenSecond.filter(r => r.secondReturnRate > 0).length / firstProfitThenSecond.length
        : 0;

    if (secondProfitRate < 0.5) {
        console.log(`• 第一次盈利后，建议停止交易 (第二次胜率 ${(secondProfitRate * 100).toFixed(1)}% < 50%)`);
    } else {
        console.log(`• 第一次盈利后，可以考虑继续交易 (第二次胜率 ${(secondProfitRate * 100).toFixed(1)}% >= 50%)`);
    }

    const firstLossSecondProfitRate = firstLossThenSecond.length > 0
        ? firstLossThenSecond.filter(r => r.secondReturnRate > 0).length / firstLossThenSecond.length
        : 0;

    console.log(`• 第一次亏损后，第二次胜率 ${(firstLossSecondProfitRate * 100).toFixed(1)}%`);
    if (firstLossSecondProfitRate < 0.4) {
        console.log(`  建议止损，不要回本心理`);
    } else {
        console.log(`  可以考虑继续交易，有回本机会`);
    }
}

analyzeSecondTradeDecision().catch(console.error);
