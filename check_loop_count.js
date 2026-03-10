/**
 * 检查 loop_count 信息
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkLoopCount() {
  const sourceExpId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';
  const newExpId = '5072373e-b79d-4d66-b471-03c7c72730ec';

  console.log('=== 检查 loop_count ===\n');

  // 1. 检查源实验的 time_series_data 中是否有 loop_count
  console.log('1. 源实验 time_series_data 中的 loop_count:\n');

  const { data: sourceData } = await supabase
    .from('experiment_time_series_data')
    .select('loop_count, timestamp')
    .eq('experiment_id', sourceExpId)
    .order('timestamp', { ascending: true })
    .limit(10);

  console.log('前10条数据的 loop_count:');
  sourceData?.forEach((d, i) => {
    console.log(`  ${i + 1}. loop_count=${d.loop_count}, timestamp=${d.timestamp}`);
  });

  // 2. 检查新回测的所有信号的 loop_count 分布
  console.log('\n2. 新回测信号的 loop_count 分布:\n');

  const { data: newSignals } = await supabase
    .from('strategy_signals')
    .select('metadata')
    .eq('experiment_id', newExpId);

  const loopCounts = {};
  const noLoopCount = 0;

  newSignals.forEach(s => {
    const lc = s.metadata?.loop_count;
    if (lc !== undefined) {
      loopCounts[lc] = (loopCounts[lc] || 0) + 1;
    } else {
      noLoopCount++;
    }
  });

  console.log('有 loop_count 的信号:');
  Object.entries(loopCounts).sort((a, b) => a[0] - b[0]).forEach(([loop, count]) => {
    console.log(`  第 ${loop} 轮: ${count} 个信号`);
  });

  console.log(`\n无 loop_count 的信号: ${noLoopCount} 个`);
  console.log(`总信号数: ${newSignals.length} 个`);

  // 3. 检查新回测中"新增代币"的信号详情
  console.log('\n3. 新增代币在新回测中的信号详情:\n');

  const addedTokens = [
    '0x6b0fd53e4676b99dd80051b73cb7260d926c4444',
    '0x32b1792f9e34b5f9b83324fd34802a102791ffff'
  ];

  for (const token of addedTokens) {
    const tokenSignals = newSignals
      .filter(s => s.token_address === token)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    if (tokenSignals.length > 0) {
      const first = tokenSignals[0];
      console.log(`代币: ${token.substring(0, 10)}...`);
      console.log(`  第一个信号时间: ${first.created_at}`);
      console.log(`  loop_count: ${first.metadata?.loop_count || 'N/A'}`);
      console.log(`  数据时间戳: ${first.metadata?.timestamp}`);
      console.log('');
    }
  }
}

checkLoopCount().catch(console.error);
