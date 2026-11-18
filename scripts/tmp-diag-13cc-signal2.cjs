const { dbManager } = require('../src/services/dbManager.js');
(async () => {
  const c = await dbManager.getClient();
  const { data: s1, error } = await c.from('strategy_signals')
    .select('id,created_at,strategy_id,signal_type,execution_status,token_address')
    .eq('experiment_id','3916fb15-66a1-45f0-bde1-1c145513817a')
    .eq('token_address','0x13ccc4b96a0561201211e7d37b1352d03ed37777');
  console.log('SI 信号行:', (s1||[]).length, error?.message||'');
  for (const s of s1||[]) console.log(' ', s.created_at, s.strategy_id, s.signal_type, s.execution_status);
  // 成交行的 signal_id 回查
  const { data: tr } = await c.from('trades')
    .select('signal_id,created_at,trade_direction')
    .eq('experiment_id','3916fb15-66a1-45f0-bde1-1c145513817a')
    .eq('token_address','0x13ccc4b96a0561201211e7d37b1352d03ed37777')
    .eq('trade_direction','buy');
  console.log('SI 买单 signalId:', tr?.[0]?.signal_id, 'at', tr?.[0]?.created_at);
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
