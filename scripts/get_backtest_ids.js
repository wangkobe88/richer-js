const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function getBacktestIds() {
    // 使用 rpc 直接查询
    const { data, error } = await supabase.rpc('get_backtest_experiments', {
        limit_count: 20
    });
    
    if (error) {
        console.error('RPC调用失败:', error.message);
        console.log('\n尝试直接查询数据库...');
        
        // 使用原始SQL查询
        const { data: sqlData, error: sqlError } = await supabase
            .from('experiments')
            .select('id, created_at, mode');
        
        if (sqlError) {
            console.error('SQL查询失败:', sqlError.message);
            return;
        }
        
        const backtests = (sqlData || []).filter(e => e.mode === 'backtest');
        console.log(`\n找到 ${backtests.length} 个回测实验:\n`);
        
        backtests.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        
        backtests.forEach((exp, i) => {
            const date = exp.created_at ? exp.created_at.substring(0, 16).replace('T', ' ') : 'N/A';
            console.log(`${i + 1}. ${exp.id}`);
            console.log(`   时间: ${date}\n`);
        });
        
        return;
    }
    
    console.log('找到回测实验:', data);
}

getBacktestIds().catch(console.error);
