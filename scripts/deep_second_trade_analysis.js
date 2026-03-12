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

/**
 * 按第一次交易收益率分组，分析第二次交易表现
 */
function analyzeByFirstReturnRange(tokensWithMultiplePairs) {
    // 定义收益率区间
    const ranges = [
        { name: '大亏(<-30%)', min: -Infinity, max: -30 },
        { name: '中亏(-30%~-15%)', min: -30, max: -15 },
        { name: '小亏(-15%~0%)', min: -15, max: 0 },
        { name: '小盈(0%~30%)', min: 0, max: 30 },
        { name: '中盈(30%~80%)', min: 30, max: 80 },
        { name: '大盈(>80%)', min: 80, max: Infinity }
    ];

    const grouped = {};

    tokensWithMultiplePairs.forEach(token => {
        const firstReturn = token.firstReturnRate;
        const range = ranges.find(r => firstReturn > r.min && firstReturn <= r.max);

        if (!grouped[range.name]) {
            grouped[range.name] = [];
        }
        grouped[range.name].push(token);
    });

    console.log('\n' + '='.repeat(100));
    console.log('【按第一次交易收益率分组分析】');
    console.log('='.repeat(100));

    ranges.forEach(range => {
        const tokens = grouped[range.name] || [];
        if (tokens.length === 0) return;

        const count = tokens.length;
        const avgFirstReturn = tokens.reduce((sum, t) => sum + t.firstReturnRate, 0) / count;
        const avgSecondReturn = tokens.reduce((sum, t) => sum + t.secondReturnRate, 0) / count;
        const secondWinCount = tokens.filter(t => t.secondReturnRate > 0).length;
        const secondWinRate = (secondWinCount / count) * 100;

        const stopProfit = tokens.reduce((sum, t) => sum + t.firstPnL, 0);
        const continueProfit = tokens.reduce((sum, t) => sum + t.totalPnL, 0);
        const diff = continueProfit - stopProfit;

        console.log(`\n【${range.name}】(${count}个代币)`);
        console.log(`  第一次平均收益: ${avgFirstReturn.toFixed(2)}%`);
        console.log(`  第二次平均收益: ${avgSecondReturn.toFixed(2)}%`);
        console.log(`  第二次胜率: ${secondWinRate.toFixed(1)}% (${secondWinCount}/${count})`);
        console.log(`  停止交易收益: ${stopProfit.toFixed(4)} BNB`);
        console.log(`  继续交易收益: ${continueProfit.toFixed(4)} BNB`);
        console.log(`  差异: ${diff > 0 ? '+' : ''}${diff.toFixed(4)} BNB (${diff > 0 ? '继续更好' : '停止更好'})`);

        // 显示该组详细案例
        if (count > 0) {
            console.log(`  案例: ${tokens.map(t => `${t.symbol}(${t.firstReturnRate.toFixed(1)}%→${t.secondReturnRate.toFixed(1)}%)`).join(', ')}`);
        }
    });

    return grouped;
}

/**
 * 寻找最优的停止阈值
 */
function findOptimalThreshold(tokensWithMultiplePairs) {
    console.log('\n' + '='.repeat(100));
    console.log('【寻找最优停止阈值】');
    console.log('='.repeat(100));

    const profitTokens = tokensWithMultiplePairs.filter(t => t.firstReturnRate > 0);

    console.log('\n如果第一次盈利后设定阈值停止交易：\n');

    // 测试不同的阈值
    const thresholds = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

    console.log('阈值 | 停止数 | 继续数 | 停止收益 | 继续收益 | 总收益 | vs全部继续');
    console.log('-'.repeat(100));

    const baseline = profitTokens.reduce((sum, t) => sum + t.totalPnL, 0); // 全部继续

    thresholds.forEach(th => {
        const stop = profitTokens.filter(t => t.firstReturnRate >= th);
        const cont = profitTokens.filter(t => t.firstReturnRate < th);

        const stopProfit = stop.reduce((sum, t) => sum + t.firstPnL, 0);
        const contProfit = cont.reduce((sum, t) => sum + t.totalPnL, 0);
        const total = stopProfit + contProfit;
        const diff = total - baseline;

        console.log(`${th.toString().padStart(4)}% | ${stop.length.toString().padStart(6)} | ${cont.length.toString().padStart(6)} | ${stopProfit.toFixed(4).padStart(8)} | ${contProfit.toFixed(4).padStart(8)} | ${total.toFixed(4).padStart(8)} | ${diff > 0 ? '+' : ''}${diff.toFixed(4)}`);
    });

    // 寻找最优阈值
    let bestThreshold = 0;
    let bestProfit = -Infinity;

    thresholds.forEach(th => {
        const stop = profitTokens.filter(t => t.firstReturnRate >= th);
        const cont = profitTokens.filter(t => t.firstReturnRate < th);
        const total = stop.reduce((sum, t) => sum + t.firstPnL, 0) + cont.reduce((sum, t) => sum + t.totalPnL, 0);

        if (total > bestProfit) {
            bestProfit = total;
            bestThreshold = th;
        }
    });

    console.log(`\n最优阈值: ${bestThreshold}% (总收益 ${bestProfit.toFixed(4)} BNB，比全部继续多 ${(bestProfit - baseline).toFixed(4)} BNB)`);

    return bestThreshold;
}

/**
 * 分析第三次交易
 */
function analyzeThirdTrade(tokensWithThreePairs) {
    if (tokensWithThreePairs.length === 0) {
        console.log('\n' + '='.repeat(100));
        console.log('【第三次交易分析】');
    console.log('='.repeat(100));
        console.log('无数据（需要至少3对交易）');
        return;
    }

    console.log('\n' + '='.repeat(100));
    console.log('【第三次交易分析】(基于前两次的表现)');
    console.log('='.repeat(100));

    // 按前两次总收益分组
    const groups = {
        '前两次都盈利': tokensWithThreePairs.filter(t => t.firstReturnRate > 0 && t.secondReturnRate > 0),
        '第一次盈第二次亏': tokensWithThreePairs.filter(t => t.firstReturnRate > 0 && t.secondReturnRate <= 0),
        '第一次亏第二次盈': tokensWithThreePairs.filter(t => t.firstReturnRate <= 0 && t.secondReturnRate > 0),
        '前两次都亏损': tokensWithThreePairs.filter(t => t.firstReturnRate <= 0 && t.secondReturnRate <= 0)
    };

    Object.entries(groups).forEach(([name, tokens]) => {
        if (tokens.length === 0) return;

        const avgFirstTwoReturn = tokens.reduce((sum, t) => sum + t.firstReturnRate + t.secondReturnRate, 0) / tokens.length;
        const avgThirdReturn = tokens.reduce((sum, t) => sum + t.thirdReturnRate, 0) / tokens.length;
        const thirdWinCount = tokens.filter(t => t.thirdReturnRate > 0).length;

        const stopBeforeThird = tokens.reduce((sum, t) => sum + t.firstPnL + t.secondPnL, 0);
        const continueToThird = tokens.reduce((sum, t) => sum + t.totalPnL, 0);
        const diff = continueToThird - stopBeforeThird;

        console.log(`\n【${name}】(${tokens.length}个代币)`);
        console.log(`  前两次平均总收益: ${avgFirstTwoReturn.toFixed(2)}%`);
        console.log(`  第三次平均收益: ${avgThirdReturn.toFixed(2)}%`);
        console.log(`  第三次胜率: ${(thirdWinCount / tokens.length * 100).toFixed(1)}%`);
        console.log(`  停止收益: ${stopBeforeThird.toFixed(4)} BNB`);
        console.log(`  继续收益: ${continueToThird.toFixed(4)} BNB`);
        console.log(`  差异: ${diff > 0 ? '+' : ''}${diff.toFixed(4)} BNB`);
        console.log(`  案例: ${tokens.map(t => `${t.symbol}(${t.firstReturnRate.toFixed(1)}%,${t.secondReturnRate.toFixed(1)}%→${t.thirdReturnRate.toFixed(1)}%)`).join(', ')}`);
    });
}

async function deepAnalysis() {
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

    // 分析每个代币的交易对
    const twoPairsTokens = [];
    const threePairsTokens = [];

    for (const [key, { symbol, trades: tokenTradeList }] of Object.entries(tokenTrades)) {
        const pairs = buildTradePairs(tokenTradeList);

        if (pairs.length >= 2) {
            twoPairsTokens.push({
                symbol,
                firstReturnRate: pairs[0].returnRate,
                firstPnL: pairs[0].pnl,
                secondReturnRate: pairs[1].returnRate,
                secondPnL: pairs[1].pnl,
                totalPnL: pairs[0].pnl + pairs[1].pnl,
                pairCount: pairs.length
            });
        }

        if (pairs.length >= 3) {
            threePairsTokens.push({
                symbol,
                firstReturnRate: pairs[0].returnRate,
                firstPnL: pairs[0].pnl,
                secondReturnRate: pairs[1].returnRate,
                secondPnL: pairs[1].pnl,
                thirdReturnRate: pairs[2].returnRate,
                thirdPnL: pairs[2].pnl,
                totalPnL: pairs[0].pnl + pairs[1].pnl + pairs[2].pnl,
                pairCount: pairs.length
            });
        }
    }

    console.log('\n' + '='.repeat(100));
    console.log(`实验 ${EXPERIMENT_ID} - 多次交易深度分析`);
    console.log('='.repeat(100));
    console.log(`有2对以上交易的代币: ${twoPairsTokens.length}个`);
    console.log(`有3对以上交易的代币: ${threePairsTokens.length}个`);

    // 1. 按第一次收益率分组分析
    analyzeByFirstReturnRange(twoPairsTokens);

    // 2. 寻找最优停止阈值
    findOptimalThreshold(twoPairsTokens);

    // 3. 分析第三次交易
    analyzeThirdTrade(threePairsTokens);

    // 4. 综合策略建议
    console.log('\n' + '='.repeat(100));
    console.log('【综合策略建议】');
    console.log('='.repeat(100));

    const bestThreshold = findOptimalThreshold(twoPairsTokens);
    const lossTokens = twoPairsTokens.filter(t => t.firstReturnRate <= 0);
    const smallLossTokens = lossTokens.filter(t => t.firstReturnRate > -20);
    const bigLossTokens = lossTokens.filter(t => t.firstReturnRate <= -20);

    const smallLossSecondWinRate = (smallLossTokens.filter(t => t.secondReturnRate > 0).length / smallLossTokens.length * 100).toFixed(1);
    const bigLossSecondWinRate = (bigLossTokens.length > 0) ? (bigLossTokens.filter(t => t.secondReturnRate > 0).length / bigLossTokens.length * 100).toFixed(1) : 'N/A';

    console.log(`\n基于数据的策略建议:`);
    console.log(`\n1️⃣ 第一次盈利后:`);
    console.log(`   - 收益率 >= ${bestThreshold}%: 停止交易 (落袋为安)`);
    console.log(`   - 收益率 < ${bestThreshold}%: 可以考虑继续交易`);

    console.log(`\n2️⃣ 第一次亏损后:`);
    console.log(`   - 亏损 > 20%: 第二次胜率 ${bigLossSecondWinRate}%, 建议止损`);
    console.log(`   - 亏损 <= 20%: 第二次胜率 ${smallLossWinRate}%, 可考虑继续`);

    // 模拟策略效果
    console.log(`\n3️⃣ 策略模拟效果:`);
    const applyStrategy = () => {
        let profit = 0;
        twoPairsTokens.forEach(t => {
            if (t.firstReturnRate >= bestThreshold) {
                profit += t.firstPnL; // 停止
            } else if (t.firstReturnRate <= -20) {
                profit += t.firstPnL; // 止损
            } else {
                profit += t.totalPnL; // 继续
            }
        });
        return profit;
    };

    const strategyProfit = applyStrategy();
    const allContinueProfit = twoPairsTokens.reduce((sum, t) => sum + t.totalPnL, 0);
    const allStopAfterFirstProfit = twoPairsTokens.reduce((sum, t) => sum + t.firstPnL, 0);

    console.log(`   - 全部继续交易: ${allContinueProfit.toFixed(4)} BNB`);
    console.log(`   - 全部第一次后停止: ${allStopAfterFirstProfit.toFixed(4)} BNB`);
    console.log(`   - 应用智能策略: ${strategyProfit.toFixed(4)} BNB`);
    console.log(`   - 策略优势: ${((strategyProfit - Math.max(allContinueProfit, allStopAfterFirstProfit)) / Math.abs(Math.max(allContinueProfit, allStopAfterFirstProfit)) * 100).toFixed(2)}%`);
}

deepAnalysis().catch(console.error);
