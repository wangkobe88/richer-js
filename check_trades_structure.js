/**
 * 检查 trades 表的实际数据结构
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkTradesStructure() {
  const experimentId = '5072373e-b79d-4d66-b471-03c7c72730ec';

  const { data: trades, error } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .limit(5);

  if (error) {
    console.log('Error:', error);
    return;
  }

  console.log('=== Trades 表结构 ===\n');
  console.log('前5条交易记录:');
  console.log(JSON.stringify(trades, null, 2));

  // 检查字段
  console.log('\n=== 字段列表 ===');
  if (trades.length > 0) {
    console.log('字段:', Object.keys(trades[0]).join(', '));
  }
}

checkTradesStructure().catch(console.error);
