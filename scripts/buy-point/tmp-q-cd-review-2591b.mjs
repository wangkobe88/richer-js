import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const e = await c.from('experiments').select('id,name,status,platform,config,created_at').eq('id','5390bbfa-0c86-48a2-b9e1-94537c54ac17').maybeSingle();
console.log('experiment:', JSON.stringify({ id: e.data?.id, name: e.data?.name, status: e.data?.status, platform: e.data?.platform, created_at: e.data?.created_at }, null, 1));
const tok = '0x2591c5cbd66a0a532870f6ceef68f10d25bc7777';
// 该 token 的所有信号（不限实验）
const s = await c.from('strategy_signals').select('experiment_id,created_at,action,status,executed,metadata')
  .ilike('token_address', tok).order('created_at',{ascending:true}).limit(20);
console.log('signals for token (all exps):', (s.data ?? []).length);
for (const row of s.data ?? []) {
  const cc = (row.metadata ?? {}).cheatCheck ?? {};
  console.log('-', row.experiment_id?.slice(0,8), row.created_at, row.action, row.status, 'exec=' + row.executed,
    '| cheat:', cc.status, cc.grade, cc.exempt ? JSON.stringify(cc.exempt) : '', cc.exemptDenied ? 'denied=' + JSON.stringify(cc.exemptDenied) : '');
}
// token 是否在 ticks 里
const t = await c.from('wss_price_ticks').select('block_time,price_bnb,trader_address,sender_address,bnb_amount,is_buy').eq('token_address', tok).order('block_time',{ascending:true}).limit(3);
console.log('first ticks:', JSON.stringify(t.data ?? []));
await dbManager.close?.();
