import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const tok = '0x2591c5cbd66a0a532870f6ceef68f10d25bc7777';
const q = await c.from('wss_price_ticks')
  .select('block_time,block_number,is_buy,bnb_amount,price_bnb,trader_address,sender_address')
  .eq('token_address', tok).order('block_time',{ascending:true}).limit(500);
console.log('err:', JSON.stringify(q.error ?? null));
console.log('rows:', (q.data ?? []).length);
if (q.data?.[0]) console.log('sample:', JSON.stringify(q.data[0]));
await dbManager.close?.();
