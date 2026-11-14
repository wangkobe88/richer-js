import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const tok = '0x2591c5cbd66a0a532870f6ceef68f10d25bc7777';
const W = 'bf004bff64725914ee36d03b87d6965b0ced4903';
const q = await c.from('wss_price_ticks')
  .select('block_time,block_number,trade_type,bnb_amount,price_bnb,trader_address,sender_address')
  .eq('token_address', tok).order('block_time',{ascending:true}).limit(500);
const rows = q.data ?? [];
console.log('total rows:', rows.length, 'span:', rows[0]?.block_time, '→', rows.at(-1)?.block_time);
for (const r of rows) {
  const w = (r.sender_address || r.trader_address || '').toLowerCase();
  if (w.endsWith(W)) console.log('W-row:', r.block_time, 'blk=' + r.block_number, r.trade_type, 'bnb=' + Number(r.bnb_amount).toFixed(4), 'px=' + Number(r.price_bnb).toExponential(3), 'trader=' + (r.trader_address ?? '').slice(0,10), 'sender=' + (r.sender_address ?? '').slice(0,10));
}
const agg = new Map();
for (const r of rows) {
  const w = (r.sender_address || r.trader_address || '?').toLowerCase();
  const a = agg.get(w) ?? { buy: 0, sell: 0, n: 0, first: r.block_time, last: r.block_time };
  if (r.trade_type === 'buy') a.buy += Number(r.bnb_amount); else a.sell += Number(r.bnb_amount);
  a.n++; a.last = r.block_time;
  agg.set(w, a);
}
const totBuy = rows.filter(r=>r.trade_type==='buy').reduce((s,r)=>s+Number(r.bnb_amount),0);
const totSell = rows.filter(r=>r.trade_type!=='buy').reduce((s,r)=>s+Number(r.bnb_amount),0);
console.log('总买=' + totBuy.toFixed(3) + ' 总卖=' + totSell.toFixed(3) + ' 行数=' + rows.length);
const top = [...agg.entries()].sort((x,y) => (y[1].buy + y[1].sell) - (x[1].buy + x[1].sell)).slice(0, 12);
for (const [w,a] of top) console.log('  ', w.slice(0,12), 'buy=' + a.buy.toFixed(3), 'sell=' + a.sell.toFixed(3), 'n=' + a.n, 'first=' + a.first?.slice(11,19), 'last=' + a.last?.slice(11,19), '买占=' + (totBuy ? (a.buy/totBuy*100).toFixed(1) : '-') + '%');
await dbManager.close?.();
