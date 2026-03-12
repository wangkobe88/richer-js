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

async function fullStrategyAnalysis() {
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

    console.log('\n' + '='.repeat(100));
    console.log(`实验 ${EXPERIMENT_ID} - 完整策略分析（包含所有代币）`);
    console.log('='.repeat(100));

    // 分析所有代币
    const allTokens = [];

    for (const [key, { symbol, trades: tokenTradeList }] of Object.entries(tokenTrades)) {
        const pairs = buildTradePairs(tokenTradeList);

        allTokens.push({
            symbol,
            pairs: pairs,
            pairCount: pairs.length,
            firstReturnRate: pairs.length > 0 ? pairs[0].returnRate : 0,
            firstPnL: pairs.length > 0 ? pairs[0].pnl : 0,
            secondReturnRate: pairs.length > 1 ? pairs[1].returnRate : null,
            secondPnL: pairs.length > 1 ? pairs[1].pnl : null,
            thirdReturnRate: pairs.length > 2 ? pairs[2].returnRate : null,
            thirdPnL: pairs.length > 2 ? pairs[2].pnl : null,
            totalPnL: pairs.reduce((sum, p) => sum + p.pnl, 0)
        });
    }

    // 实际收益（全部继续交易）
    const actualProfit = allTokens.reduce((sum, t) => sum + t.totalPnL, 0);
    console.log(`\n【实际收益】全部继续交易: ${actualProfit.toFixed(4)} BNB`);

    // 策略1: 第一次盈利>=X%后停止
    console.log('\n' + '-'.repeat(100));
    console.log('【策略1】第一次盈利后设定阈值停止');
    console.log('-'.repeat(100));

    const thresholds = [0, 5, 10, 15, 20, 30, 40, 50, 80];
    console.log('阈值 | 停止数 | 继续数 | 停止收益 | 继续收益 | 总收益 | vs实际');
    console.log('-'.repeat(100));

    thresholds.forEach(th => {
        let total = 0;

        allTokens.forEach(token => {
            if (token.pairCount === 0) {
                total += 0;
            } else if (token.firstReturnRate >= th) {
                // 第一次盈利>=阈值，只做第一次
                total += token.firstPnL;
            } else {
                // 继续全部交易
                total += token.totalPnL;
            }
        });

        const diff = total - actualProfit;
        console.log(`${th.toString().padStart(4)}% | ${allTokens.filter(t => t.pairCount > 0 && t.firstReturnRate >= th).length.toString().padStart(6)} | ${allTokens.filter(t => t.pairCount > 0 && t.firstReturnRate < th).length.toString().padStart(6)} | ${allTokens.filter(t => t.pairCount > 0 && t.firstReturnRate >= th).reduce((sum, t) => sum + t.firstPnL, 0).toFixed(4).padStart(8)} | ${allTokens.filter(t => t.pairCount > 0 && t.firstReturnRate < th).reduce((sum, t) => sum + t.totalPnL, 0).toFixed(4).padStart(8)} | ${total.toFixed(4).padStart(8)} | ${diff > 0 ? '+' : ''}${diff.toFixed(4)}`);
    });

    // 策略2: 第一次亏损后止损
    console.log('\n' + '-'.repeat(100));
    console.log('【策略2】第一次亏损后设定止损阈值');
    console.log('-'.repeat(100));

    const lossThresholds = [-5, -10, -15, -20, -25, -30];
    console.log('阈值 | 止损数 | 继续数 | 止损亏损 | 继续收益 | 总收益 | vs实际');
    console.log('-'.repeat(100));

    lossThresholds.forEach(th => {
        let total = 0;

        allTokens.forEach(token => {
            if (token.pairCount === 0) {
                total += 0;
            } else if (token.firstReturnRate <= th) {
                // 第一次亏损<=阈值，止损
                total += token.firstPnL;
            } else {
                // 继续全部交易
                total += token.totalPnL;
            }
        });

        const diff = total - actualProfit;
        const stopLossCount = allTokens.filter(t => t.pairCount > 0 && t.firstReturnRate <= th).length;
        const stopLossAmount = allTokens.filter(t => t.pairCount > 0 && t.firstReturnRate <= th).reduce((sum, t) => sum + t.firstPnL, 0);

        console.log(`${th.toString().padStart(5)}% | ${stopLossCount.toString().padStart(6)} | ${allTokens.filter(t => t.pairCount > 0 && t.firstReturnRate > th).length.toString().padStart(6)} | ${stopLossAmount.toFixed(4).padStart(9)} | ${allTokens.filter(t => t.pairCount > 0 && t.firstReturnRate > th).reduce((sum, t) => sum + t.totalPnL, 0).toFixed(4).padStart(8)} | ${total.toFixed(4).padStart(8)} | ${diff > 0 ? '+' : ''}${diff.toFixed(4)}`);
    });

    // 策略3: 组合策略
    console.log('\n' + '-'.repeat(100));
    console.log('【策略3】组合策略（盈利阈值 + 亏损止损）');
    console.log('-'.repeat(100));

    console.log('\n盈利阈值\\亏损止损 | -10% | -15% | -20% | -25%');
    console.log('-'.repeat(100));

    const profitThresholds = [10, 20, 30];
    const stopLossThresholds = [-10, -15, -20, -25];

    profitThresholds.forEach(pTh => {
        let line = `      ${pTh}%       |`;
        stopLossThresholds.forEach(lTh => {
            let total = 0;

            allTokens.forEach(token => {
                if (token.pairCount === 0) {
                    total += 0;
                } else if (token.firstReturnRate >= pTh) {
                    // 盈利>=阈值，停止
                    total += token.firstPnL;
                } else if (token.firstReturnRate <= lTh) {
                    // 亏损<=阈值，止损
                    total += token.firstPnL;
                } else {
                    // 继续全部交易
                    total += token.totalPnL;
                }
            });

            const diff = total - actualProfit;
            line += ` ${(total > 0 ? total.toFixed(3) + ' BNB' : '0').padStart(10)}`;
        });
        console.log(line);
    });

    console.log(`\n实际收益（全部继续）: ${actualProfit.toFixed(4)} BNB`);

    // 最优策略详细分析
    console.log('\n' + '='.repeat(100));
    console.log('【最优策略详情】');
    console.log('='.repeat(100));

    // 寻找最优组合
    let bestProfit = -Infinity;
    let bestConfig = null;

    profitThresholds.forEach(pTh => {
        stopLossThresholds.forEach(lTh => {
            let total = 0;
            allTokens.forEach(token => {
                if (token.pairCount === 0) {
                    total += 0;
                } else if (token.firstReturnRate >= pTh) {
                    total += token.firstPnL;
                } else if (token.firstReturnRate <= lTh) {
                    total += token.firstPnL;
                } else {
                    total += token.totalPnL;
                }
            });

            if (total > bestProfit) {
                bestProfit = total;
                bestConfig = { pTh, lTh };
            }
        });
    });

    console.log(`\n最优配置: 盈利>=${bestConfig.pTh}%停止，亏损<=${bestConfig.lTh}%止损`);
    console.log(`最优收益: ${bestProfit.toFixed(4)} BNB`);
    console.log(`vs实际: +${(bestProfit - actualProfit).toFixed(4)} BNB (${((bestProfit - actualProfit) / Math.abs(actualProfit) * 100).toFixed(1)}%)`);

    // 显示该策略下每个代币的处理
    console.log('\n代币处理明细:');
    const pTh = bestConfig.pTh;
    const lTh = bestConfig.lTh;

    allTokens.forEach(token => {
        if (token.pairCount === 0) return;

        let action;
        if (token.firstReturnRate >= pTh) {
            action = `✅ 停止（盈利${token.firstReturnRate.toFixed(1)}%）`;
        } else if (token.firstReturnRate <= lTh) {
            action = `⛔ 止损（亏损${token.firstReturnRate.toFixed(1)}%）`;
        } else {
            action = `→ 继续（${token.firstReturnRate.toFixed(1)}%）`;
        }

        const actual = token.totalPnL;
        const strategy = (token.firstReturnRate >= pTh || token.firstReturnRate <= lTh) ? token.firstPnL : token.totalPnL;
        const diff = strategy - actual;

        console.log(`  ${token.symbol.padEnd(15)} ${action.padEnd(25)} 实际:${actual.toFixed(4)} 策略:${strategy.toFixed(4)} 差异:${diff > 0 ? '+' : ''}${diff.toFixed(4)}`);
    });
}

fullStrategyAnalysis().catch(console.error);
