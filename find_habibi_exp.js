const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function check() {
  const TOKEN = "0xe079942b37bcfec88cea509bffbcf4d5365e4444";

  // 直接查询，不加实验过滤
  const { data, error } = await supabase
    .from('experiment_time_series_data')
    .select('experiment_id, loop_count, timestamp')
    .eq('token_address', TOKEN)
    .order('loop_count', { ascending: true })
    .limit(50);

  console.log("=== Habibi时序数据 ===\n");
  if (error) {
    console.log("查询错误:", error);
    return;
  }

  if (!data || data.length === 0) {
    console.log("没有数据");
    return;
  }

  const exps = {};
  for (const d of data) {
    if (!exps[d.experiment_id]) {
      exps[d.experiment_id] = { count: 0, minLoop: d.loop_count, maxLoop: d.loop_count, firstTime: d.timestamp };
    }
    exps[d.experiment_id].count++;
    exps[d.experiment_id].maxLoop = d.loop_count;
  }

  console.log("所属实验:");
  for (const [expId, info] of Object.entries(exps)) {
    console.log(`  ${expId}:`);
    console.log(`    数据点: ${info.count}`);
    console.log(`    loop范围: ${info.minLoop} - ${info.maxLoop}`);
    console.log(`    首条时间: ${new Date(info.firstTime).toLocaleString()}`);
  }
}
check().catch(console.error);
