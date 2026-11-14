import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const tok = '0x2591c5cbd66a0a532870f6ceef68f10d25bc7777';
const tr = await c.from('trades').select('trade_direction,trade_status,input_currency,output_currency,input_amount,output_amount,unit_price,success,created_at,executed_at,metadata')
  .eq('experiment_id','5390bbfa-0c86-48a2-b9e1-94537c54ac17')
  .ilike('token_address', tok).order('created_at',{ascending:true}).limit(10);
for (const t of (tr.data ?? [])) {
  console.log('trade', t.created_at, t.trade_direction, t.trade_status, 'in=' + t.input_amount + ' ' + (t.input_currency ?? ''), 'out=' + t.output_amount + ' ' + (t.output_currency ?? ''), 'px=' + t.unit_price, 'ok=' + t.success);
}
// 该钱包在这台票上的链上行为（wss_price_ticks 有限窗口取样：该钱包全部行）
const w = await c.from('wss_price_ticks').select('block_time,is_buy,bnb_amount,price_bnb,block_number')
  .eq('token_address', tok)
  .or('trader_address.eq.0xbf004bff64725914ee36d03b87d6965b0ced4903,sender_address.eq.0xbf004bff64725914ee36d03b87d6965b0ced4903')
  .order('block_time',{ascending:true}).limit(100);
console.log('wallet rows:', (w.data ?? []).length);
for (const r of (w.data ?? []).slice(0, 60)) console.log('  w', r.block_time, r.is_buy ? 'BUY ' : 'SELL', 'bnb=' + Number(r.bnb_amount).toFixed(4), 'px=' + Number(r.price_bnb).toExponential(3));
await dbManager.close?.();
