const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function check() {
  const SOURCE_EXP = "4101ee2e-6e9c-437b-a44f-6c7e96a32085";
  const TOKEN = "0xe079942b37bcfec88cea509bffbcf4d5365e4444";

  // 获取源实验中loop 222附近的时序数据
  const { data: loop222Data } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', SOURCE_EXP)
    .gte('loop_count', 220)
    .lte('loop_count', 230)
    .order('loop_count', { ascending: true })
    .limit(50);

  console.log("=== loop 220-230 的时序数据 ===\n");
  if (loop222Data && loop222Data.length > 0) {
    const uniqueTokens = [...new Set(loop222Data.map(d => d.token_address))];
    console.log(`涉及代币数量: ${uniqueTokens.length}`);
    console.log(`代币列表:`);
    for (const addr of uniqueTokens) {
      const symbol = loop222Data.find(d => d.token_address === addr)?.token_symbol;
      console.log(`  - ${symbol} (${addr.slice(0, 10)}...)`);
    }

    // 检查Habibi是否存在
    const habibiData = loop222Data.filter(d => d.token_address === TOKEN);
    console.log(`\nHabibi数据点数: ${habibiData.length}`);

    // 检查时间
    const times = loop222Data.map(d => d.timestamp);
    console.log(`时间范围: ${new Date(Math.min(...times)).toLocaleString()} - ${new Date(Math.max(...times)).toLocaleString()}`);
  } else {
    console.log("没有loop 220-230的数据");
  }

  // 检查回测日志中显示的第一个loop（loop 5）的数据
  console.log("\n=== loop 5 的时序数据 ===\n");
  const { data: loop5Data } = await supabase
    .from('experiment_time_series_data')
    .select('token_address, token_symbol, timestamp')
    .eq('experiment_id', SOURCE_EXP)
    .eq('loop_count', 5)
    .limit(10);

  if (loop5Data && loop5Data.length > 0) {
    console.log(`loop 5 的代币:`);
    loop5Data.forEach(d => {
      console.log(`  - ${d.token_symbol} (${d.token_address.slice(0, 10)}...) ${new Date(d.timestamp).toLocaleString()}`);
    });
  }
}
check().catch(console.error);
