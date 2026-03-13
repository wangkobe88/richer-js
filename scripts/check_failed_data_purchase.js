const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkPurchaseWithFailedData() {
    // 检查实验 931f683f - 有早期交易数据=0的信号
    const { data: signals } = await supabase
        .from('strategy_signals')
        .select('*')
        .eq('experiment_id', '931f683f-c69b-499c-8368-2485244bc5eb')
        .eq('action', 'buy');
    
    console.log('=== 检查早期交易数据=0的信号购买情况 ===\n');
    
    // 筛选出 earlyTradesCountPerMin = 0 的信号
    const noDataSignals = signals.filter(s => {
        const f = s.metadata?.preBuyCheckFactors || {};
        return f.earlyTradesCountPerMin === 0;
    });
    
    console.log(`早期交易数据=0的信号: ${noDataSignals.length} 个`);
    
    // 检查这些信号是否被执行
    const executed = noDataSignals.filter(s => s.metadata?.executed);
    const notExecuted = noDataSignals.filter(s => !s.metadata?.executed);
    
    console.log(`  已执行: ${executed.length} 个`);
    console.log(`  未执行: ${notExecuted.length} 个`);
    
    // 显示未执行的原因
    const reasons = {};
    notExecuted.forEach(s => {
        const reason = s.metadata?.execution_reason || '未知';
        reasons[reason] = (reasons[reason] || 0) + 1;
    });
    
    console.log('\n未执行原因分类:');
    Object.entries(reasons).forEach(([reason, count]) => {
        console.log(`  ${reason.substring(0, 80)}...: ${count} 个`);
    });
    
    // 检查购买前检查条件中的具体要求
    console.log('\n=== 示例信号详情 ===');
    noDataSignals.slice(0, 3).forEach((s, i) => {
        const f = s.metadata?.preBuyCheckFactors || {};
        console.log(`\n${i + 1}. 代币: ${s.token_address?.substring(0, 10)}...`);
        console.log(`   earlyTradesCountPerMin: ${f.earlyTradesCountPerMin}`);
        console.log(`   earlyTradesHighValueCount: ${f.earlyTradesHighValueCount}`);
        console.log(`   earlyTradesHighValuePerMin: ${f.earlyTradesHighValuePerMin}`);
        console.log(`   canBuy: ${f.canBuy}`);
        console.log(`   executed: ${s.metadata?.executed}`);
        console.log(`   execution_reason: ${s.metadata?.execution_reason?.substring(0, 100) || 'N/A'}...`);
    });
    
    // 获取实验配置中的购买条件
    const { data: exp } = await supabase
        .from('experiments')
        .select('config')
        .eq('id', '931f683f-c69b-499c-8368-2485244bc5eb')
        .single();
    
    const condition = exp?.config?.strategiesConfig?.buyStrategies?.[0]?.preBuyCheckCondition;
    console.log('\n=== 购买前检查条件 ===');
    console.log(condition || '无');
    
    // 分析条件中关于早期交易的要求
    if (condition) {
        console.log('\n条件中关于早期交易的要求:');
        if (condition.includes('earlyTradesHighValueCount')) {
            const match = condition.match(/earlyTradesHighValueCount\s*>=\s*(\d+)/);
            if (match) console.log(`  earlyTradesHighValueCount >= ${match[1]}`);
        }
        if (condition.includes('earlyTradesHighValuePerMin')) {
            const match = condition.match(/earlyTradesHighValuePerMin\s*>=\s*([\d.]+)/);
            if (match) console.log(`  earlyTradesHighValuePerMin >= ${match[1]}`);
        }
        if (condition.includes('earlyTradesCountPerMin')) {
            const match = condition.match(/earlyTradesCountPerMin\s*>=\s*(\d+)/);
            if (match) console.log(`  earlyTradesCountPerMin >= ${match[1]}`);
        }
    }
}

checkPurchaseWithFailedData().catch(console.error);
