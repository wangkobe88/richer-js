/**
 * 检查 trades 表的结构
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function main() {
  console.log('=== 检查 trades 表结构 ===\n');

  // 使用 RPC 调用获取表结构
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .limit(1);

  if (error) {
    console.error('Error:', error);
    return;
  }

  if (data && data.length > 0) {
    console.log('trades 表的列:');
    Object.keys(data[0]).forEach(key => {
      console.log(`  - ${key}: ${typeof data[0][key]}`);
    });
  }

  // 获取实验2的 trades
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【获取实验2的 trades】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const exp2Id = '2522cab9-721f-4922-86f9-7484d644e7cc';

  const { data: exp2Trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', exp2Id)
    .order('created_at', { ascending: true })
    .limit(5);

  if (exp2Trades && exp2Trades.length > 0) {
    console.log(`实验2共有 trades，前5条:`);
    exp2Trades.forEach(t => {
      console.log(`  ${t.token_symbol} - ${t.direction} - ${t.created_at || t.executed_at || 'N/A'}`);
    });
  }
}

main().catch(console.error);
