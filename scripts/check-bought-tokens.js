/**
 * 检查哪些实验有持仓（已买入的代币）
 */
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://jbhgrhwcznukmsprimlx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpiaGdyaHdjem51a21zcHJpbWx4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEwNTU5ODEsImV4cCI6MjA1NjYzMTk4MX0.A_P9jMctmr-apy32S_fljjtCmWBrQfIr6iSppVCEMm8';

async function main() {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // 获取有'bought'状态的代币的实验
    const { data } = await supabase
        .from('experiment_tokens')
        .select('experiment_id, token_symbol, token_address, status')
        .eq('status', 'bought')
        .limit(50);

    console.log('Experiments with bought tokens:');
    if (data && data.length > 0) {
        // 按experiment_id分组
        const byExp = {};
        data.forEach(t => {
            if (!byExp[t.experiment_id]) byExp[t.experiment_id] = [];
            byExp[t.experiment_id].push(t.token_symbol);
        });

        // 获取实验名称
        for (const expId of Object.keys(byExp)) {
            const { data: exp } = await supabase
                .from('experiments')
                .select('experiment_name, status')
                .eq('id', expId)
                .single();

            console.log(`  ${expId.substring(0, 8)}... | ${exp?.experiment_name || 'unknown'} | Status: ${exp?.status || 'unknown'} | ${byExp[expId].length} token(s): ${byExp[expId].slice(0, 3).join(', ')}${byExp[expId].length > 3 ? ',...' : ''}`);
        }
    } else {
        console.log('  (none)');
    }
}

main().catch(console.error);
