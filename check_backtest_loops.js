const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function check() {
  const BACKTEST_EXP = "9b5a1875-dcad-4376-83f0-647e991f6eb2";

  console.log("=== 回测实验处理的loop_count范围 ===\n");

  // 从strategy_signals表获取loop_count
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('loop_count')
    .eq('experiment_id', BACKTEST_EXP)
    .order('loop_count', { ascending: true });

  if (signals && signals.length > 0) {
    const loops = signals.map(s => s.loop_count).filter(l => l !== null);
    if (loops.length > 0) {
      const uniqueLoops = [...new Set(loops)].sort((a, b) => a - b);
      console.log(`信号数量: ${signals.length}`);
      console.log(`loop范围: ${Math.min(...loops)} - ${Math.max(...loops)}`);
      console.log(`不同loop数量: ${uniqueLoops.length}`);
      console.log(`前10个loop: ${uniqueLoops.slice(0, 10).join(', ')}`);
      console.log(`后10个loop: ${uniqueLoops.slice(-10).join(', ')}`);
    }
  }

  // 检查是否包含Habibi的loop 222-400
  const { data: habibiRange } = await supabase
    .from('strategy_signals')
    .select('loop_count')
    .eq('experiment_id', BACKTEST_EXP)
    .gte('loop_count', 220)
    .lte('loop_count', 230);

  console.log(`\n=== Habibi loop 220-230 的信号 ===`);
  console.log(`信号数量: ${habibiRange?.length || 0}`);
}
check().catch(console.error);
