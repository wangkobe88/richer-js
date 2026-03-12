require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

const EXPERIMENT_ID = '8b6408cd-c555-4a98-b9a7-19a5f0925a00';

async function checkNewExperiment() {
    // 获取实验配置
    const { data: experiment } = await supabase
        .from('experiments')
        .select('*')
        .eq('id', EXPERIMENT_ID)
        .single();

    console.log('实验配置:');
    const buyStrategy = experiment.config.strategiesConfig?.buyStrategies?.[0];
    if (buyStrategy) {
        console.log('preBuyCheckCondition:', buyStrategy.preBuyCheckCondition?.substring(0, 100) + '...');
        console.log('repeatBuyCheckCondition:', buyStrategy.repeatBuyCheckCondition);
    } else {
        console.log('未找到买入策略配置');
    }

    // 获取信号数据
    const { data: signals } = await supabase
        .from('strategy_signals')
        .select('*')
        .eq('experiment_id', EXPERIMENT_ID)
        .eq('action', 'buy')
        .order('created_at', { ascending: true });

    console.log('\n买入信号数:', signals.length);

    // 按代币分组
    const tokenSignals = {};
    signals.forEach(s => {
        const key = s.token_address;
        if (!tokenSignals[key]) {
            tokenSignals[key] = [];
        }
        tokenSignals[key].push(s);
    });

    // 查看有多次买入的代币的因子数据
    Object.entries(tokenSignals).forEach(([addr, sigs]) => {
        if (sigs.length >= 2) {
            console.log(`\n${sigs[0].token_symbol} - ${sigs.length}次买入:`);
            sigs.forEach((s, i) => {
                const factors = s.metadata?.preBuyCheckFactors || {};
                console.log(`  第${i + 1}次买入 (${new Date(s.created_at).toLocaleTimeString()}):`);
                console.log(`    buyRound: ${factors.buyRound !== undefined ? factors.buyRound : 'N/A'}`);
                console.log(`    lastPairReturnRate: ${factors.lastPairReturnRate !== undefined ? factors.lastPairReturnRate : 'N/A'}`);
                console.log(`    canBuy: ${factors.canBuy !== undefined ? factors.canBuy : 'N/A'}`);
                if (factors.checkReason) {
                    console.log(`    reason: ${factors.checkReason.substring(0, 80)}...`);
                }
            });
        }
    });

    // 获取交易数据
    const { data: trades } = await supabase
        .from('trades')
        .select('*')
        .eq('experiment_id', EXPERIMENT_ID)
        .eq('success', true)
        .order('created_at', { ascending: true });

    console.log('\n\n交易数:', trades.length);

    // 按代币分组交易
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

    // 分析一个有多对交易的代币
    for (const [symbol, data] of Object.entries(tokenTrades)) {
        if (data.trades.length >= 4) {
            console.log(`\n${symbol} 交易详情:`);
            data.trades.forEach((t, i) => {
                const dir = t.trade_direction === 'buy' ? '买入' : '卖出';
                const input = parseFloat(t.input_amount || 0).toFixed(4);
                const output = parseFloat(t.output_amount || 0).toFixed(2);
                console.log(`  ${i + 1}. ${dir}: ${input} ${t.input_currency} -> ${output} ${t.output_currency}`);
            });
            break; // 只看第一个
        }
    }
}

checkNewExperiment().catch(console.error);
