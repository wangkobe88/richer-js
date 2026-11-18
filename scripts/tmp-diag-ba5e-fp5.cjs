const { dbManager } = require('../src/services/dbManager.js');
(async () => {
  const c = await dbManager.getClient();
  const EXP = 'e5941591-df22-4434-ae29-1a93ced0f841';
  const TOK = '0xba5ed45b42479e0a75316de7bf990ec90a3e4444';
  const { data: exp } = await c.from('experiments').select('id,name,trading_mode,status,created_at').eq('id', EXP).single();
  console.log('实验:', JSON.stringify(exp));
  const { data: sigs } = await c.from('strategy_signals')
    .select('id,signal_type,action,execution_status,created_at,metadata,strategy_id')
    .eq('experiment_id', EXP).eq('token_address', TOK).order('created_at');
  console.log('信号行数:', (sigs||[]).length);
  for (const s of sigs || []) {
    const md = s.metadata || {};
    const fc = md.factorCheck || md.signalGate?.factorCheck;
    console.log('---', s.created_at, s.strategy_id, s.execution_status, s.signal_type);
    if (fc) console.log('factorCheck:', JSON.stringify(fc, null, 1).slice(0, 3000));
    else console.log('metadata keys:', Object.keys(md).join(','));
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
