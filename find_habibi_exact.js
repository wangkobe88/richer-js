const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function check() {
  const SOURCE_EXP = "4101ee2e-6e9c-437b-a44f-6c7e96a32085";
  const TOKEN = "0xe079942b37bcfec88cea509bffbcf4d5365e4444";

  // 1. 检查Habibi在这个实验中的总数据量
  console.log("=== 检查Habibi在源实验中的数据 ===\n");

  const { data: habibiAll, error: err1 } = await supabase
    .from('experiment_time_series_data')
    .select('id', { count: 'exact', head: false })
    .eq('experiment_id', SOURCE_EXP)
    .eq('token_address', TOKEN);

  if (err1) {
    console.log("查询错误:", err1.message);
    return;
  }

  console.log(`Habibi数据点数: ${habibiAll?.length || 0}`);

  // 2. 获取Habibi的第一条和最后一条数据
  const { data: firstLast, error: err2 } = await supabase
    .from('experiment_time_series_data')
    .select('loop_count, timestamp')
    .eq('experiment_id', SOURCE_EXP)
    .eq('token_address', TOKEN)
    .order('loop_count', { ascending: true });

  if (err2) {
    console.log("查询错误:", err2.message);
    return;
  }

  if (firstLast && firstLast.length > 0) {
    const loops = firstLast.map(d => d.loop_count);
    const uniqueLoops = [...new Set(loops)].sort((a, b) => a - b);
    console.log(`loop范围: ${uniqueLoops[0]} - ${uniqueLoops[uniqueLoops.length - 1]}`);
    console.log(`不同loop数量: ${uniqueLoops.length}`);
    console.log(`时间: ${new Date(firstLast[0].timestamp).toLocaleString()}`);
  }

  // 3. 检查源实验的loop范围（取样查询）
  console.log("\n=== 源实验整体数据概况 ===\n");
  const { data: sample, error: err3 } = await supabase
    .from('experiment_time_series_data')
    .select('loop_count')
    .eq('experiment_id', SOURCE_EXP)
    .not('loop_count', 'is', null)
    .limit(1000);

  if (err3) {
    console.log("查询错误:", err3.message);
  } else if (sample) {
    const loops = sample.map(d => d.loop_count);
    const uniqueLoops = [...new Set(loops)].sort((a, b) => a - b);
    console.log(`前1000条数据的loop范围: ${Math.min(...loops)} - ${Math.max(...loops)}`);
    console.log(`不同loop数量: ${uniqueLoops.length}`);
  }
}
check().catch(console.error);
