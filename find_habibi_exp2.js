const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function check() {
  const TOKEN = "0xe079942b37bcfec88cea509bffbcf4d5365e4444";

  // 使用聚合查询
  const { data, error } = await supabase
    .from('experiment_time_series_data')
    .select('experiment_id')
    .eq('token_address', TOKEN);

  console.log("=== Habibi时序数据 ===\n");
  if (error) {
    console.log("查询错误:", error);
    return;
  }

  if (!data || data.length === 0) {
    console.log("没有数据");
    return;
  }

  const expCounts = {};
  for (const d of data) {
    expCounts[d.experiment_id] = (expCounts[d.experiment_id] || 0) + 1;
  }

  console.log("所属实验及数据点数:");
  for (const [expId, count] of Object.entries(expCounts)) {
    console.log(`  ${expId}: ${count} 条数据`);
  }
}
check().catch(console.error);
