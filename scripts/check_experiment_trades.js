require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

const EXPERIMENT_ID = '6980f98c-4bb8-4f9e-aeeb-141783fda314';

async function checkExperimentTrades() {
    // 获取这个实验的所有交易
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

    console.log(`实验 ${EXPERIMENT_ID} 的交易数据:`);
    console.log(`总交易数: ${trades.length}`);

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

    console.log(`\n代币数: ${Object.keys(tokenTrades).length}`);

    // 统计每个代币的交易对数
    const pairCounts = {};
    Object.values(tokenTrades).forEach(({ symbol, trades }) => {
        let buyCount = 0;
        let sellCount = 0;
        trades.forEach(t => {
            if (t.trade_direction === 'buy') buyCount++;
            if (t.trade_direction === 'sell') sellCount++;
        });
        const pairs = Math.min(buyCount, sellCount);
        pairCounts[pairs] = (pairCounts[pairs] || 0) + 1;

        if (pairs >= 2) {
            console.log(`\n${symbol} - ${pairs}对交易:`);
            trades.forEach((t, i) => {
                const dir = t.trade_direction === 'buy' ? '买入' : '卖出';
                const input = parseFloat(t.input_amount || 0).toFixed(4);
                const output = parseFloat(t.output_amount || 0).toFixed(2);
                console.log(`  ${i + 1}. ${dir}: ${input} ${t.input_currency} -> ${output} ${t.output_currency}`);
            });
        }
    });

    console.log(`\n\n交易对分布:`);
    Object.keys(pairCounts).sort((a, b) => a - b).forEach(pairs => {
        console.log(`  ${pairs}对: ${pairCounts[pairs]}个代币`);
    });

    // 统计有多少代币有多次买卖
    const multiTradeTokens = Object.values(tokenTrades).filter(
        ({ trades }) => trades.filter(t => t.trade_direction === 'buy').length >= 2
    );
    console.log(`\n有2次以上买入的代币: ${multiTradeTokens.length}个`);
}

checkExperimentTrades().catch(console.error);
