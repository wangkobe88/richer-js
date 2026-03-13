const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function compareExperiments() {
    // 获取两个实验的配置
    const { data: exp1 } = await supabase
        .from('experiments')
        .select('*')
        .eq('id', '931f683f-c69b-499c-8368-2485244bc5eb')
        .single();
    
    const { data: exp2 } = await supabase
        .from('experiments')
        .select('*')
        .eq('id', '015db965-0b33-4d98-88b1-386203886381')
        .single();
    
    console.log('=== 实验 931f683f (回测) 配置 ===');
    console.log(JSON.stringify(exp1?.config?.strategiesConfig?.buyStrategies, null, 2));
    console.log('\n=== 实验 015db965 (虚拟) 配置 ===');
    console.log(JSON.stringify(exp2?.config?.strategiesConfig?.buyStrategies, null, 2));
    
    // 获取信号数据
    const { data: signals1 } = await supabase
        .from('strategy_signals')
        .select('*')
        .eq('experiment_id', '931f683f-c69b-499c-8368-2485244bc5eb')
        .eq('action', 'buy')
        .order('created_at', { ascending: false });
    
    console.log(`\n=== 实验 931f683f 的买入信号统计 ===`);
    console.log(`总信号数: ${signals1?.length || 0}`);
    
    const executed = signals1?.filter(s => s.metadata?.executed) || [];
    const notExecuted = signals1?.filter(s => !s.metadata?.executed) || [];
    console.log(`已执行: ${executed.length}`);
    console.log(`未执行: ${notExecuted.length}`);
    
    // 分析未执行的原因
    const reasonGroups = {};
    notExecuted.forEach(s => {
        const reason = s.metadata?.execution_reason || '未知';
        reasonGroups[reason] = (reasonGroups[reason] || 0) + 1;
    });
    console.log('\n未执行原因分类:');
    Object.entries(reasonGroups).forEach(([reason, count]) => {
        console.log(`  ${reason}: ${count}`);
    });
    
    // 查看未执行的信号详情
    console.log('\n=== 未执行的买入信号详情 (前15条) ===');
    notExecuted.slice(0, 15).forEach((s, i) => {
        const factors = s.metadata?.preBuyCheckFactors || {};
        const trendFactors = s.metadata?.trendFactors || {};
        console.log(`\n${i + 1}. 代币: ${s.token_address?.substring(0, 10)}...`);
        console.log(`   时间: ${s.created_at}`);
        console.log(`   原因: ${s.metadata?.execution_reason || '未知'}`);
        console.log(`   buyRound: ${factors.buyRound}`);
        console.log(`   lastPairReturnRate: ${factors.lastPairReturnRate}`);
        console.log(`   canBuy: ${factors.canBuy}`);
        console.log(`   checkReason: ${factors.checkReason}`);
        console.log(`   earlyReturn: ${trendFactors.earlyReturn}`);
    });
}

compareExperiments().catch(console.error);
