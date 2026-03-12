require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

async function checkRawTrades() {
    const { data: trades, error } = await supabase
        .from('trades')
        .select('*')
        .eq('success', true)
        .order('created_at', { ascending: true })
        .limit(20);

    console.log('原始交易数据:');
    console.log(JSON.stringify(trades, null, 2));
}

checkRawTrades().catch(console.error);
