// 查 CD72 信号行实验归属（182 跑）
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager');
const ADDR = '0x5641aa3aae2bedc1565ff754b8a430a6abdf7777';
(async () => {
  const client = dbManager.getClient();
  const { data, error } = await client
    .from('strategy_signals')
    .select('experiment_id, signal_type, created_at')
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) { console.log('ERR', error.message); process.exit(1); }
  const exps = [...new Set((data || []).map(r => r.experiment_id))];
  console.log('CD72', ADDR);
  console.log('exps:', exps.join(','));
  console.log('rows:', (data || []).length, 'first:', data && data[0] ? data[0].created_at : '-');
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
