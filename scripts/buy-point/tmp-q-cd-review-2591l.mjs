import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const tok = '0x2591c5cbd66a0a532870f6ceef68f10d25bc7777';
const W = '0xbf004bff64725914ee36d03b87d6965b0ced4903';
const s = await c.from('strategy_signals').select('created_at,metadata')
  .eq('experiment_id','5390bbfa-0c86-48a2-b9e1-94537c54ac17')
  .ilike('token_address', tok).eq('action','buy').order('created_at',{ascending:true}).limit(5);
for (const row of s.data ?? []) {
  const raw = JSON.stringify(row.metadata ?? {});
  console.log('=== BUY', row.created_at, 'len=' + raw.length, 'contains wallet:', raw.toLowerCase().includes(W));
}
// 大小写不敏感再查 ticks
const w2 = await c.from('wss_price_ticks').select('block_time', { count: 'exact', head: true })
  .eq('token_address', tok)
  .or(`trader_address.ilike.${W},sender_address.ilike.${W}`);
console.log('ticks wallet rows (ilike):', w2.count, JSON.stringify(w2.error?.message ?? null));
// 票的总行数与时间范围
const tot = await c.from('wss_price_ticks').select('block_time', { count: 'exact', head: true }).eq('token_address', tok);
console.log('token total ticks:', tot.count);
await dbManager.close?.();
