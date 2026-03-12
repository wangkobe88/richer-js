require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

// 使用用户指定的实验ID
const EXPERIMENT_ID = process.env.EXPERIMENT_ID || '8b6408cd-c555-4a98-b9a7-19a5f0925a00';

async function verifyMultiRoundFactors() {
    console.log(`检查实验: ${EXPERIMENT_ID}`);
    console.log('');

    // 获取实验配置
    const { data: experiment } = await supabase
        .from('experiments')
        .select('*')
        .eq('id', EXPERIMENT_ID)
        .single();

    if (!experiment) {
        console.error('实验不存在');
        return;
    }

    const buyStrategy = experiment.config.strategiesConfig?.buyStrategies?.[0];
    console.log('=== 实验配置 ===');
    if (buyStrategy) {
        console.log('首次购买检查:', buyStrategy.preBuyCheckCondition || '(无)');
        console.log('再次购买检查:', buyStrategy.repeatBuyCheckCondition || '(无)');
    } else {
        console.log('未找到买入策略配置');
    }
    console.log('');

    // 获取信号数据
    const { data: signals } = await supabase
        .from('strategy_signals')
        .select('*')
        .eq('experiment_id', EXPERIMENT_ID)
        .eq('action', 'buy')
        .order('created_at', { ascending: true });

    console.log(`=== 买入信号总数: ${signals.length} ===`);
    console.log('');

    // 按代币分组
    const tokenSignals = {};
    signals.forEach(s => {
        const key = s.token_address;
        if (!tokenSignals[key]) {
            tokenSignals[key] = [];
        }
        tokenSignals[key].push(s);
    });

    // 查看所有多次买入的代币
    const multiBuyTokens = Object.entries(tokenSignals).filter(([addr, sigs]) => sigs.length >= 2);

    console.log(`=== 多次买入的代币数: ${multiBuyTokens.length} ===`);
    console.log('');

    if (multiBuyTokens.length === 0) {
        console.log('没有多次买入的代币，显示所有代币的因子值...');
        Object.entries(tokenSignals).forEach(([addr, sigs]) => {
            const s = sigs[0];
            const factors = s.metadata?.preBuyCheckFactors || {};
            console.log(`${s.token_symbol} (1次买入):`);
            console.log(`  buyRound: ${factors.buyRound !== undefined ? factors.buyRound : 'N/A'}`);
            console.log(`  lastPairReturnRate: ${factors.lastPairReturnRate !== undefined ? factors.lastPairReturnRate : 'N/A'}`);
            console.log(`  canBuy: ${factors.canBuy !== undefined ? factors.canBuy : 'N/A'}`);
            console.log('');
        });
    } else {
        multiBuyTokens.forEach(([addr, sigs]) => {
            console.log(`${sigs[0].token_symbol} - ${sigs.length}次买入:`);
            sigs.forEach((s, i) => {
                const factors = s.metadata?.preBuyCheckFactors || {};
                const time = new Date(s.created_at).toLocaleTimeString();
                console.log(`  第${i + 1}次买入 (${time}):`);
                console.log(`    buyRound: ${factors.buyRound !== undefined ? factors.buyRound : 'N/A'}`);
                console.log(`    lastPairReturnRate: ${factors.lastPairReturnRate !== undefined ? factors.lastPairReturnRate : 'N/A'}`);
                console.log(`    canBuy: ${factors.canBuy !== undefined ? factors.canBuy : 'N/A'}`);

                if (factors.checkReason) {
                    console.log(`    reason: ${factors.checkReason.substring(0, 60)}...`);
                }
                console.log('');
            });
        });
    }

    // 获取交易数据，分析是否有完成的交易对
    const { data: trades } = await supabase
        .from('trades')
        .select('*')
        .eq('experiment_id', EXPERIMENT_ID)
        .eq('success', true)
        .order('created_at', { ascending: true });

    console.log(`=== 交易总数: ${trades.length} ===`);

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

    // 统计完成的交易对
    let completedPairsCount = 0;
    Object.entries(tokenTrades).forEach(([symbol, data]) => {
        let buyCount = 0;
        let sellCount = 0;
        data.trades.forEach(t => {
            if (t.trade_direction === 'buy') buyCount++;
            if (t.trade_direction === 'sell') sellCount++;
        });
        const pairs = Math.min(buyCount, sellCount);
        if (pairs > 0) {
            completedPairsCount++;
        }
    });

    console.log(`完成的交易对数: ${completedPairsCount}`);
    console.log('');
}

verifyMultiRoundFactors().catch(console.error);
