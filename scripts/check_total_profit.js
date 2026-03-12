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

async function checkTotalProfit() {
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

    console.log(`总代币数: ${Object.keys(tokenTrades).length}`);
    console.log(`总交易数: ${trades.length}`);

    // 计算所有代币的总收益
    let totalProfit = 0;
    let totalSpent = 0;
    let totalReceived = 0;
    const tokenProfits = [];

    for (const [key, { symbol, trades: tokenTradeList }] of Object.entries(tokenTrades)) {
        const pairs = buildTradePairs(tokenTradeList);

        const tokenProfit = pairs.reduce((sum, p) => sum + p.pnl, 0);
        const tokenCost = pairs.reduce((sum, p) => sum + p.cost, 0);
        const tokenReceived = pairs.reduce((sum, p) => sum + p.received, 0);

        totalProfit += tokenProfit;
        totalSpent += tokenCost;
        totalReceived += tokenReceived;

        tokenProfits.push({
            symbol,
            pairs: pairs.length,
            profit: tokenProfit,
            cost: tokenCost,
            received: tokenReceived
        });
    }

    console.log(`\n总花费: ${totalSpent.toFixed(4)} BNB`);
    console.log(`总收入: ${totalReceived.toFixed(4)} BNB`);
    console.log(`净收益: ${totalProfit.toFixed(4)} BNB`);

    console.log(`\n按交易对数分类:`);
    const byPairs = {};
    tokenProfits.forEach(t => {
        byPairs[t.pairs] = byPairs[t.pairs] || [];
        byPairs[t.pairs].push(t);
    });

    Object.keys(byPairs).sort((a, b) => a - b).forEach(pairs => {
        const tokens = byPairs[pairs];
        const profit = tokens.reduce((sum, t) => sum + t.profit, 0);
        console.log(`  ${pairs}对: ${tokens.length}个代币, 收益 ${profit.toFixed(4)} BNB`);
    });

    // 只看有多对交易的代币
    const multiPairTokens = tokenProfits.filter(t => t.pairs >= 2);
    const multiPairProfit = multiPairTokens.reduce((sum, t) => sum + t.profit, 0);

    console.log(`\n有多对交易的代币: ${multiPairTokens.length}个`);
    console.log(`多对交易代币收益: ${multiPairProfit.toFixed(4)} BNB`);

    console.log(`\n所有代币收益明细:`);
    tokenProfits
        .sort((a, b) => b.profit - a.profit)
        .forEach(t => {
            console.log(`  ${t.symbol}: ${t.pairs}对, ${t.profit.toFixed(4)} BNB`);
        });
}

checkTotalProfit().catch(console.error);
