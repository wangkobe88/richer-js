const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function check() {
  const SOURCE_EXP = "4101ee2e-6e9c-437b-a44f-6c7e96a32085";
  const TOKEN = "0xe079942b37bcfec88cea509bffbcf4d5365e4444";

  // 模拟回测引擎的数据加载（不筛选代币）
  console.log("=== 模拟回测引擎加载数据 ===\n");

  // 获取所有时序数据的前100条
  const { data: sampleData } = await supabase
    .from('experiment_time_series_data')
    .select('token_address, token_symbol, loop_count, timestamp')
    .eq('experiment_id', SOURCE_EXP)
    .order('timestamp', { ascending: true })
    .limit(100);

  if (sampleData && sampleData.length > 0) {
    const loops = sampleData.map(d => d.loop_count);
    console.log(`前100条数据loop范围: ${Math.min(...loops)} - ${Math.max(...loops)}`);

    const tokens = [...new Set(sampleData.map(d => d.token_symbol))];
    console.log(`前100条数据涉及代币: ${tokens.slice(0, 10).join(', ')}...`);
  }

  // 获取Habibi的数据
  const { data: habibiData } = await supabase
    .from('experiment_time_series_data')
    .select('token_address, token_symbol, loop_count, timestamp')
    .eq('experiment_id', SOURCE_EXP)
    .eq('token_address', TOKEN)
    .order('timestamp', { ascending: true })
    .limit(10);

  if (habibiData && habibiData.length > 0) {
    console.log(`\n=== Habibi数据 ===`);
    console.log(`符号: ${habibiData[0].token_symbol}`);
    console.log(`loop范围: ${habibiData[0].loop_count} - ${habibiData[habibiData.length - 1].loop_count}`);
    console.log(`时间范围: ${habibiData[0].timestamp} - ${habibiData[habibiData.length - 1].timestamp}`);
  }

  // 检查整个时序数据的loop范围
  const { data: allLoops } = await supabase
    .from('experiment_time_series_data')
    .select('loop_count')
    .eq('experiment_id', SOURCE_EXP);

  if (allLoops) {
    const loops = allLoops.map(d => d.loop_count);
    const uniqueLoops = [...new Set(loops)].sort((a, b) => a - b);
    console.log(`\n=== 源实验时序数据loop范围 ===`);
    console.log(`总数据点: ${allLoops.length}`);
    console.log(`loop范围: ${Math.min(...loops)} - ${Math.max(...loops)}`);
    console.log(`不同loop值数量: ${uniqueLoops.length}`);
    console.log(`前10个loop: ${uniqueLoops.slice(0, 10).join(', ')}`);
    console.log(`后10个loop: ${uniqueLoops.slice(-10).join(', ')}`);
  }
}
check().catch(console.error);
