/**
 * 检查 loop_count 信息
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkLoopCount() {
  const newExpId = '5072373e-b79d-4d66-b471-03c7c72730ec';

  console.log('=== 检查 loop_count ===\n');

  const { data: newSignals } = await supabase
    .from('strategy_signals')
    .select('metadata')
    .eq('experiment_id', newExpId);

  const loopCounts = {};
  let noLoopCount = 0;

  newSignals.forEach(s => {
    const lc = s.metadata?.loop_count;
    if (lc !== undefined) {
      loopCounts[lc] = (loopCounts[lc] || 0) + 1;
    } else {
      noLoopCount++;
    }
  });

  console.log('新回测信号的 loop_count 分布:\n');
  console.log('有 loop_count 的信号:');
  Object.entries(loopCounts).sort((a, b) => a[0] - b[0]).forEach(([loop, count]) => {
    console.log(`  第 ${loop} 轮: ${count} 个信号`);
  });

  console.log(`\n无 loop_count 的信号: ${noLoopCount} 个`);
  console.log(`总信号数: ${newSignals.length} 个`);
}

checkLoopCount().catch(console.error);
