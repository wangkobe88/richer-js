require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

const EXPERIMENT_ID = '047f5277-9874-4636-9914-567a48a173a8';

async function verifyConfig() {
    // 获取实验配置
    const { data: experiment } = await supabase
        .from('experiments')
        .select('*')
        .eq('id', EXPERIMENT_ID)
        .single();

    const buyStrategy = experiment.config.strategiesConfig.buyStrategies[0];

    console.log('买入策略配置:');
    console.log('preBuyCheckCondition:', buyStrategy.preBuyCheckCondition);
    console.log('repeatBuyCheckCondition:', buyStrategy.repeatBuyCheckCondition);

    // 获取信号数据，检查第二次买入时 lastPairReturnRate 的值
    const { data: signals } = await supabase
        .from('strategy_signals')
        .select('*')
        .eq('experiment_id', EXPERIMENT_ID)
        .eq('action', 'buy')
        .order('created_at', { ascending: true });

    console.log('\n\n买入信号数:', signals.length);

    // 按代币分组
    const tokenSignals = {};
    signals.forEach(s => {
        const key = s.token_address;
        if (!tokenSignals[key]) {
            tokenSignals[key] = [];
        }
        tokenSignals[key].push(s);
    });

    // 查看有多次买入的代币
    Object.entries(tokenSignals).forEach(([addr, sigs]) => {
        if (sigs.length >= 2) {
            console.log(`\n${sigs[0].token_symbol} - ${sigs.length}次买入:`);
            sigs.forEach((s, i) => {
                const factors = s.metadata?.preBuyCheckFactors || {};
                console.log(`  第${i + 1}次买入:`);
                console.log(`    buyRound: ${factors.buyRound || 'N/A'}`);
                console.log(`    lastPairReturnRate: ${factors.lastPairReturnRate !== undefined ? factors.lastPairReturnRate : 'N/A'}`);
                console.log(`    canBuy: ${factors.canBuy || 'N/A'}`);
                if (factors.checkReason) {
                    console.log(`    reason: ${factors.checkReason.substring(0, 100)}...`);
                }
            });
        }
    });
}

verifyConfig().catch(console.error);
