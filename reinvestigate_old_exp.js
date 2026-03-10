/**
 * 重新调查旧实验中这些代币的情况
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function reinvestigateOldExp() {
  const oldExpId = '933be40d-1056-463f-b629-aa226a2ea064';
  
  // 新增代币（在新实验中执行但在旧实验中没执行）
  const addedTokens = [
    '0x6b0fd53e4676b99dd80051b73cb7260d926c4444', // 1$
    '0x32b1792f9e34b5f9b83324fd34802a102791ffff',
    '0xa322f68af1dd4078d0e72998921f546391274444',
    '0xc3ca235bb3ac1bb951ce2833a9c8525f524e4444'
  ];

  console.log('=== 重新调查旧实验 ===\n');

  // 1. 检查旧实验的所有信号（不只是已执行的）
  const { data: oldSignals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', oldExpId);

  console.log('1. 旧实验总信号数:', oldSignals.length);

  const uniqueTokens = new Set();
  oldSignals.forEach(s => uniqueTokens.add(s.token_address));
  console.log('   有信号的代币数:', uniqueTokens.size);
  console.log('');

  // 2. 检查这些"新增"代币在旧实验中的信号
  console.log('2. "新增"代币在旧实验中的信号:\n');
  console.log('代币                                  | 信号数 | 状态           | 拒绝原因');
  console.log('-------------------------------------|--------|----------------|----------');

  for (const token of addedTokens) {
    const tokenSignals = oldSignals.filter(s => s.token_address === token);
    
    if (tokenSignals.length > 0) {
      const firstSignal = tokenSignals[0];
      const status = firstSignal.metadata?.execution_status || 'unknown';
      const reason = firstSignal.metadata?.execution_reason || 
                    firstSignal.metadata?.preBuyCheckResult?.reason || '';
      
      console.log(`${token} | ${tokenSignals.length.toString().padStart(6)} | ${status.padEnd(14)} | ${reason.substring(0, 40)}`);
    } else {
      console.log(`${token} | ${'无'.padStart(6)} | 无信号          | -`);
    }
  }

  // 3. 检查旧实验所有已执行的代币
  console.log('\n3. 旧实验已执行的代币（确认列表）:\n');

  const { data: oldTrades } = await supabase
    .from('trades')
    .select('token_address')
    .eq('experiment_id', oldExpId)
    .eq('trade_direction', 'sell');

  const oldExecutedTokens = new Set();
  oldTrades.forEach(t => oldExecutedTokens.add(t.token_address));

  console.log('   旧实验已执行的代币数:', oldExecutedTokens.size);
  console.log('');

  // 4. 对比
  console.log('4. 对比分析:\n');
  
  const reallyAdded = addedTokens.filter(t => !oldExecutedTokens.has(t));
  console.log('   真正在新实验中"新增"的代币数:', reallyAdded.length);
  console.log('');

  for (const token of reallyAdded) {
    const tokenSignals = oldSignals.filter(s => s.token_address === token);
    console.log(`   ${token.substring(0, 10)}... : 有信号=${tokenSignals.length > 0 ? '是' : '否'}, 信号数=${tokenSignals.length}`);
  }
}

reinvestigateOldExp().catch(console.error);
