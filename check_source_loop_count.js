/**
 * 从源实验数据中检查新增代币的 loop_count
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkSourceLoopCount() {
  const sourceExpId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';
  const oldExpId = '933be40d-1056-463f-b629-aa226a2ea064';

  console.log('=== 从源实验数据检查新增代币的 loop_count ===\n');

  // 新增代币
  const addedTokens = [
    '0x6b0fd53e4676b99dd80051b73cb7260d926c4444',
    '0x32b1792f9e34b5f9b83324fd34802a102791ffff'
  ];

  // 对比：老回测处理的代币
  const { data: oldSignals } = await supabase
    .from('strategy_signals')
    .select('token_address')
    .eq('experiment_id', oldExpId);

  const oldProcessedTokens = new Set();
  oldSignals.forEach(s => oldProcessedTokens.add(s.token_address));

  // 随机选一个老回测处理的代币
  const sampleOldToken = Array.from(oldProcessedTokens)[0];

  console.log('1. 老回测处理的代币（样本）的 loop_count:\n');

  const { data: oldTokenData } = await supabase
    .from('experiment_time_series_data')
    .select('loop_count, timestamp')
    .eq('experiment_id', sourceExpId)
    .eq('token_address', sampleOldToken)
    .order('timestamp', { ascending: true })
    .limit(20);

  console.log(`${sampleOldToken.substring(0, 10)}... :`);
  oldTokenData?.forEach((d, i) => {
    console.log(`  ${i + 1}. loop_count=${d.loop_count}, timestamp=${d.timestamp}`);
  });

  // 统计老回测处理的代币的 loop_count 范围
  const { data: allOldData } = await supabase
    .from('experiment_time_series_data')
    .select('loop_count')
    .eq('experiment_id', sourceExpId)
    .eq('token_address', sampleOldToken);

  const loops = new Set();
  allOldData?.forEach(d => {
    if (d.loop_count !== undefined && d.loop_count !== null) {
      loops.add(d.loop_count);
    }
  });

  const sortedLoops = Array.from(loops).sort((a, b) => a - b);
  console.log(`  loop_count 范围: ${sortedLoops[0]} - ${sortedLoops[sortedLoops.length - 1]}`);

  console.log('\n2. 新增代币的 loop_count:\n');

  for (const token of addedTokens) {
    const { data: tokenData } = await supabase
      .from('experiment_time_series_data')
      .select('loop_count, timestamp')
      .eq('experiment_id', sourceExpId)
      .eq('token_address', token)
      .order('timestamp', { ascending: true })
      .limit(20);

    console.log(`${token.substring(0, 10)}... :`);
    tokenData?.forEach((d, i) => {
      console.log(`  ${i + 1}. loop_count=${d.loop_count}, timestamp=${d.timestamp}`);
    });

    // 统计 loop_count 范围
    const { data: allTokenData } = await supabase
      .from('experiment_time_series_data')
      .select('loop_count')
      .eq('experiment_id', sourceExpId)
      .eq('token_address', token);

    const tokenLoops = new Set();
    allTokenData?.forEach(d => {
      if (d.loop_count !== undefined && d.loop_count !== null) {
        tokenLoops.add(d.loop_count);
      }
    });

    const sortedTokenLoops = Array.from(tokenLoops).sort((a, b) => a - b);
    console.log(`  loop_count 范围: ${sortedTokenLoops[0]} - ${sortedTokenLoops[sortedTokenLoops.length - 1]}`);
    console.log('');
  }
}

checkSourceLoopCount().catch(console.error);
