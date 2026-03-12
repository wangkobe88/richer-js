require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

const EXPERIMENT_ID = '047f5277-9874-4636-9914-567a48a173a8';

async function checkExperiment() {
    // 获取实验配置
    const { data: experiment } = await supabase
        .from('experiments')
        .select('*')
        .eq('id', EXPERIMENT_ID)
        .single();

    console.log('实验配置:');
    console.log('config:', JSON.stringify(experiment.config, null, 2));

    // 检查是否有 buyStrategies
    if (experiment.config) {
        if (experiment.config.strategy) {
            console.log('\nstrategy.buyStrategies:', JSON.stringify(experiment.config.strategy.buyStrategies, null, 2));
        }
        if (experiment.config.buyStrategies) {
            console.log('\nconfig.buyStrategies:', JSON.stringify(experiment.config.buyStrategies, null, 2));
        }
    }

    // 获取交易数据
    const { data: trades } = await supabase
        .from('trades')
        .select('*')
        .eq('experiment_id', EXPERIMENT_ID)
        .eq('success', true)
        .order('created_at', { ascending: true });

    console.log('\n\n交易数:', trades.length);

    // 按代币分组
    const tokenTrades = {};
    trades.forEach(trade => {
        const key = trade.token_address;
        if (!tokenTrades[key]) {
            tokenTrades[key] = {
                symbol: trade.token_symbol,
                trades: []
            };
        }
        tokenTrades[key].trades.push(trade);
    });

    console.log('\n代币数:', Object.keys(tokenTrades).length);

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

    console.log('\n交易对分布:');
    Object.keys(pairCounts).sort((a, b) => a - b).forEach(pairs => {
        console.log(`  ${pairs}对: ${pairCounts[pairs]}个代币`);
    });
}

checkExperiment().catch(console.error);
