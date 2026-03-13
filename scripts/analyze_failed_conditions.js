const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeSignals() {
    // 获取信号及其完整metadata
    const { data: signals } = await supabase
        .from('strategy_signals')
        .select('*')
        .eq('experiment_id', '931f683f-c69b-499c-8368-2485244bc5eb')
        .eq('action', 'buy')
        .order('created_at', { ascending: false })
        .limit(5);
    
    console.log('=== 信号 Metadata 结构分析 ===\n');
    
    signals.forEach((s, i) => {
        console.log(`${i + 1}. 代币: ${s.token_address?.substring(0, 10)}...`);
        console.log(`   Metadata keys: ${Object.keys(s.metadata || {}).join(', ')}`);
        
        if (s.metadata) {
            console.log(`   executed: ${s.metadata.executed}`);
            console.log(`   execution_reason: ${s.metadata.execution_reason}`);
            
            if (s.metadata.preBuyCheckFactors) {
                console.log(`   preBuyCheckFactors 存在: 是`);
                console.log(`   keys: ${Object.keys(s.metadata.preBuyCheckFactors).join(', ')}`);
            } else {
                console.log(`   preBuyCheckFactors 存在: 否`);
            }
            
            if (s.metadata.trendFactors) {
                console.log(`   trendFactors.earlyReturn: ${s.metadata.trendFactors.earlyReturn}`);
            }
        }
        console.log('');
    });
    
    // 获取虚拟实验的信号对比
    const { data: virtualSignals } = await supabase
        .from('strategy_signals')
        .select('*')
        .eq('experiment_id', '015db965-0b33-4d98-88b1-386203886381')
        .eq('action', 'buy')
        .order('created_at', { ascending: false })
        .limit(3);
    
    console.log('\n=== 虚拟实验信号对比 (前3条) ===\n');
    
    virtualSignals.forEach((s, i) => {
        console.log(`${i + 1}. 代币: ${s.token_address?.substring(0, 10)}...`);
        console.log(`   executed: ${s.metadata?.executed}`);
        console.log(`   execution_reason: ${s.metadata?.execution_reason}`);
        
        if (s.metadata?.preBuyCheckFactors) {
            console.log(`   preBuyCheckFactors 存在: 是`);
            const f = s.metadata.preBuyCheckFactors;
            console.log(`   strongTraderNetPositionRatio: ${f.strongTraderNetPositionRatio}`);
            console.log(`   strongTraderWalletCount: ${f.strongTraderWalletCount}`);
        }
        console.log('');
    });
}

analyzeSignals().catch(console.error);
