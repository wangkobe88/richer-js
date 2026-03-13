const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function getRecentBacktests() {
    // 使用 rpc 直接查询
    const { data: experiments, error } = await supabase
        .from('experiments')
        .select('id, created_at, status')
        .eq('mode', 'backtest')
        .limit(20);
    
    if (error) {
        console.error('获取实验失败:', error);
        return;
    }
    
    console.log(`找到 ${experiments?.length || 0} 个回测实验\n`);
    console.log('序号\tID前8位\t\t创建时间\t\t状态');
    console.log(''.padEnd(80, '-'));
    
    for (let i = 0; i < (experiments || []).length; i++) {
        const exp = experiments[i];
        const date = exp.created_at ? exp.created_at.substring(0, 16).replace('T', ' ') : 'N/A';
        console.log(`${i + 1}\t${exp.id.substring(0, 8)}\t${date}\t\t${exp.status || 'N/A'}`);
    }
    
    console.log('\n\n实验ID列表（供复制）:');
    experiments.forEach((exp, i) => {
        console.log(`${i + 1}. ${exp.id}`);
    });
}

getRecentBacktests().catch(console.error);
