const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function check() {
  const SOURCE_EXP = "4101ee2e-6e9c-437b-a44f-6c7e96a32085";
  const BACKTEST_EXP = "9b5a1875-dcad-4376-83f0-647e991f6eb2";
  const TOKEN = "0xe079942b37bcfec88cea509bffbcf4d5365e4444";

  console.log("=== 检查loop_count范围 ===\n");

  // 1. 获取源实验所有时序数据的loop范围
  const { data: allTS } = await supabase
    .from('experiment_time_series_data')
    .select('loop_count')
    .eq('experiment_id', SOURCE_EXP);

  const loops = allTS.map(d => d.loop_count);
  const minLoop = Math.min(...loops);
  const maxLoop = Math.max(...loops);

  console.log(`源实验loop范围: ${minLoop} - ${maxLoop}`);

  // 2. 获取Habibi的loop范围
  const { data: habibiTS } = await supabase
    .from('experiment_time_series_data')
    .select('loop_count, timestamp')
    .eq('experiment_id', SOURCE_EXP)
    .eq('token_address', TOKEN)
    .order('loop_count', { ascending: true });

  if (habibiTS && habibiTS.length > 0) {
    const habibiLoops = habibiTS.map(d => d.loop_count);
    console.log(`\nHabibi loop范围: ${Math.min(...habibiLoops)} - ${Math.max(...habibiLoops)}`);
    console.log(`Habibi 数据点数: ${habibiTS.length}`);

    const firstTime = new Date(habibiTS[0].timestamp).toLocaleString();
    const lastTime = new Date(habibiTS[habibiTS.length - 1].timestamp).toLocaleString();
    console.log(`时间范围: ${firstTime} - ${lastTime}`);
  }

  // 3. 检查回测实验的交易记录，看看实际处理了哪些loop
  console.log("\n=== 回测实验的交易记录 ===");
  const { data: trades } = await supabase
    .from('trades')
    .select('token_address, type, loop_count')
    .eq('experiment_id', BACKTEST_EXP)
    .order('created_at', { ascending: true })
    .limit(20);

  if (trades && trades.length > 0) {
    const tradeLoops = trades.map(t => t.loop_count || 0);
    console.log(`交易loop范围: ${Math.min(...tradeLoops)} - ${Math.max(...tradeLoops)}`);

    console.log("\n前10笔交易:");
    trades.slice(0, 10).forEach(t => {
      console.log(`  loop=${t.loop_count} ${t.type} ${t.token_address.slice(0, 10)}...`);
    });
  }

  // 4. 检查回测实验是否有Habibi的交易
  const { data: habibiTrades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', BACKTEST_EXP)
    .eq('token_address', TOKEN);

  console.log(`\n=== Habibi在回测中的交易 ===`);
  console.log(`交易数量: ${habibiTrades?.length || 0}`);
}
check().catch(console.error);
