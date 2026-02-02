/**
 * 检查实验时序数据量
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

async function checkData() {
  const experimentId = '95042847-cccd-4316-be03-f172e2885993';

  // 先count总数据量
  const { count, error } = await supabase
    .from('experiment_time_series_data')
    .select('*', { count: 'exact', head: true })
    .eq('experiment_id', experimentId);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`实验 ${experimentId} 的时序数据总量:`, count);

  // 查询各代币的数据量
  const { data } = await supabase
    .from('experiment_time_series_data')
    .select('token_symbol, token_address')
    .eq('experiment_id', experimentId);

  const tokenCounts = {};
  for (const row of data || []) {
    const key = row.token_address;
    if (!tokenCounts[key]) {
      tokenCounts[key] = { symbol: row.token_symbol, count: 0 };
    }
    tokenCounts[key].count++;
  }

  console.log('\n各代币数据量:');
  for (const [addr, info] of Object.entries(tokenCounts)) {
    console.log(`  ${info.symbol}: ${info.count} 条`);
  }
}

checkData().catch(console.error);
