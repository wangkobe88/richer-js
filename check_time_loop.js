const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function check() {
  const SOURCE_EXP = "4101ee2e-6e9c-437b-a44f-6c7e96a32085";

  // 获取按时间排序的第一条和最后一条数据
  console.log("=== 时间与loop_count关系 ===\n");

  // 第一条数据（时间最早）
  const { data: first } = await supabase
    .from('experiment_time_series_data')
    .select('token_symbol, loop_count, timestamp')
    .eq('experiment_id', SOURCE_EXP)
    .order('timestamp', { ascending: true })
    .range(0, 0)
    .single();

  // 最后一条数据（时间最晚）
  const { data: last } = await supabase
    .from('experiment_time_series_data')
    .select('token_symbol, loop_count, timestamp')
    .eq('experiment_id', SOURCE_EXP)
    .order('timestamp', { ascending: false })
    .range(0, 0)
    .single();

  if (first) {
    console.log(`时间最早的数据:`);
    console.log(`  时间: ${new Date(first.timestamp).toLocaleString()}`);
    console.log(`  loop_count: ${first.loop_count}`);
    console.log(`  代币: ${first.token_symbol}`);
  }

  if (last) {
    console.log(`\n时间最晚的数据:`);
    console.log(`  时间: ${new Date(last.timestamp).toLocaleString()}`);
    console.log(`  loop_count: ${last.loop_count}`);
    console.log(`  代币: ${last.token_symbol}`);
  }

  // 检查Habibi数据的实际时间位置
  const { data: habibiFirst } = await supabase
    .from('experiment_time_series_data')
    .select('loop_count, timestamp')
    .eq('experiment_id', SOURCE_EXP)
    .eq('token_address', '0xe079942b37bcfec88cea509bffbcf4d5365e4444')
    .order('timestamp', { ascending: true })
    .range(0, 0)
    .single();

  if (habibiFirst) {
    console.log(`\nHabibi数据:`);
    console.log(`  时间: ${new Date(habibiFirst.timestamp).toLocaleString()}`);
    console.log(`  loop_count: ${habibiFirst.loop_count}`);
  }

  // 计算Habibi数据在所有数据中的位置
  const { data: beforeHabibi } = await supabase
    .from('experiment_time_series_data')
    .select('id', { count: 'exact', head: true })
    .eq('experiment_id', SOURCE_EXP)
    .lt('timestamp', habibiFirst.timestamp);

  console.log(`\nHabibi数据位置:`);
  console.log(`  在Habibi之前有 ${beforeHabibi.length} 条数据`);
  console.log(`  如果分页大小是100，Habibi数据在第 ${Math.floor(beforeHabibi.length / 100) + 1} 页`);
}
check().catch(console.error);
