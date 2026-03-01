const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function check() {
  const EXP_ID = "9b5a1875-dcad-4376-83f0-647e991f6eb2";
  const TOKEN = "0xe079942b37bcfec88cea509bffbcf4d5365e4444";
  const SOURCE_EXP = "4101ee2e-6e9c-437b-a44f-6c7e96a32085";

  console.log("=== 检查回测实验代币数据 ===\n");

  // 1. 检查回测实验的代币总数
  const { count } = await supabase
    .from('experiment_tokens')
    .select('*', { count: 'exact', head: true })
    .eq('experiment_id', EXP_ID);
  console.log(`回测实验代币总数: ${count}\n`);

  // 2. 检查Habibi代币
  const { data: habibi } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', EXP_ID)
    .eq('token_address', TOKEN)
    .maybeSingle();

  if (habibi) {
    console.log("=== Habibi 代币信息 ===");
    console.log("符号:", habibi.token_symbol);
    console.log("状态:", habibi.status);
    console.log("最大涨幅:", habibi.analysis_results?.max_change_percent + "%");
  } else {
    console.log("回测实验中没有Habibi代币数据");
  }

  // 3. 检查源实验中的Habibi
  console.log("\n=== 源实验中的Habibi ===");
  const { data: sourceHabibi } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', SOURCE_EXP)
    .eq('token_address', TOKEN)
    .maybeSingle();

  if (sourceHabibi) {
    console.log("符号:", sourceHabibi.token_symbol);
    console.log("状态:", sourceHabibi.status);
    console.log("最大涨幅:", sourceHabibi.analysis_results?.max_change_percent + "%");
    console.log("创建时间:", sourceHabibi.created_at);
  }

  // 4. 检查回测实验的交易记录
  console.log("\n=== 回测实验交易记录 ===");
  const { count: tradeCount } = await supabase
    .from('trades')
    .select('*', { count: 'exact', head: true })
    .eq('experiment_id', EXP_ID);
  console.log("交易数量:", tradeCount);

  // 5. 检查回测实验的策略信号
  console.log("\n=== 回测实验策略信号 ===");
  const { count: signalCount } = await supabase
    .from('strategy_signals')
    .select('*', { count: 'exact', head: true })
    .eq('experiment_id', EXP_ID);
  console.log("信号数量:", signalCount);

  // 6. 检查回测实验的时序数据
  console.log("\n=== 回测实验时序数据 ===");
  const { count: tsCount } = await supabase
    .from('experiment_time_series_data')
    .select('*', { count: 'exact', head: true })
    .eq('experiment_id', EXP_ID);
  console.log("时序数据点数量:", tsCount);
}
check().catch(console.error);
