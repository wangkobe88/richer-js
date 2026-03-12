require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

async function checkTokenTrades() {
    // 获取某个具体代币的交易
    const { data: trades } = await supabase
        .from('trades')
        .select('*')
        .eq('success', true)
        .eq('token_address', '0x89a37b5aaca57c907840e425e776c7b00feaffff')
        .order('created_at', { ascending: true });

    console.log('CLAWFOUR 代币的交易:');
    trades.forEach((t, i) => {
        console.log(`\n${i + 1}. ${t.trade_direction} @ ${t.created_at}`);
        console.log(`   输入: ${t.input_amount} ${t.input_currency}`);
        console.log(`   输出: ${t.output_amount} ${t.output_currency}`);
        console.log(`   单价: ${t.unit_price}`);
    });
}

checkTokenTrades().catch(console.error);
