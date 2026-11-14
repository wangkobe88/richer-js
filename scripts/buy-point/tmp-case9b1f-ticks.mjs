import { dbManager } from '../../src/services/dbManager.js';
const TOKEN = '0x9b1fb6a662e2b1e5a521ea1dd5147f13184b7777';
const c = await dbManager.getClient();
const rows = []; let from = 0;
while (true) {
  const { data, error } = await c.from('wss_price_ticks')
    .select('id,block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,trader_address,sender_address')
    .eq('token_address', TOKEN).order('id', { ascending: true }).range(from, from + 999);
  if (error) throw new Error(error.message);
  rows.push(...data); if (data.length < 1000) break; from += 1000;
}
console.log('total ticks:', rows.length);
const sorted = [...rows].sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
const t0 = new Date(sorted[0]?.block_time).getTime();
let prev = null;
for (const r of sorted) {
  const ts = new Date(r.block_time).getTime();
  const gap = prev === null ? 0 : ((ts - prev) / 1000).toFixed(1);
  const w = (r.sender_address || r.trader_address || '').slice(0, 10);
  console.log(`t+${((ts - t0) / 1000).toFixed(1)}s blk=${r.block_number} gap=${gap}s ${r.trade_type} bnb=${Number(r.bnb_amount).toFixed(4)} price=${Number(r.price_bnb).toExponential(4)} w=${w}`);
  prev = ts;
}
await dbManager.destroy?.();
