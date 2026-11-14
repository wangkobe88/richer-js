import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const tok = '0x2591c5cbd66a0a532870f6ceef68f10d25bc7777';
const one = await c.from('strategy_signals').select('*')
  .eq('experiment_id','5390bbfa-0c86-48a2-b9e1-94537c54ac17')
  .ilike('token_address', tok).order('created_at',{ascending:true}).limit(1);
if (one.error) { console.log('err:', JSON.stringify(one.error)); }
else {
  const row = one.data?.[0];
  if (!row) console.log('no rows');
  else {
    console.log('columns:', Object.keys(row).join(','));
    console.log('id:', row.id, 'created_at:', row.created_at, 'action:', row.action, 'result:', row.result, 'executed:', row.executed, 'strategy_id:', row.strategy_id);
  }
}
await dbManager.close?.();
