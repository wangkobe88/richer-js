const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function check() {
  const TOKEN = "0xe079942b37bcfec88cea509bffbcf4d5365e4444";

  // 检查Habibi的时序数据属于哪些实验
  const { data: exps } = await supabase
    .from('experiment_time_series_data')
    .select('experiment_id')
    .eq('token_address', TOKEN);

  if (exps && exps.length > 0) {
    const uniqueExps = [...new Set(exps.map(e => e.experiment_id))];
    console.log("Habibi时序数据属于的实验:");
    uniqueExps.forEach(e => console.log("  -", e));
  }

  // 检查4101ee2e-6e9c-437b-a44f-6c7e96a32085实验中是否有Habibi数据
  const { data: sourceData } = await supabase
    .from('experiment_time_series_data')
    .select('experiment_id, loop_count')
    .eq('experiment_id', '4101ee2e-6e9c-437b-a44f-6c7e96a32085')
    .eq('token_address', TOKEN)
    .limit(1);

  if (sourceData && sourceData.length > 0) {
    console.log("\n源实验4101ee2e中确实有Habibi数据，loop_count:", sourceData[0].loop_count);
  } else {
    console.log("\n源实验4101ee2e中没有Habibi数据！");
  }
}
check().catch(console.error);
