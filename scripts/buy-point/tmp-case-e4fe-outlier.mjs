import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const { data: ticks, error } = await c.from('wss_price_ticks')
  .select('block_time,trade_type,bnb_amount,price_bnb,price_outlier')
  .eq('token_address','0xe4fe922f88c09cbe127cebfa25f84d2f00917777')
  .gte('block_time','2026-11-02T21:50:00Z')
  .lte('block_time','2026-11-03T08:00:00Z')
  .order('block_time', { ascending: true }).limit(200);
if (error) throw new Error(error.message);
const LAUNCH = 5.546337995470633e-9;
for (const t of ticks) {
  const curVs = Number(t.price_bnb) > 0 ? ((Number(t.price_bnb)/LAUNCH - 1)*100).toFixed(1) : '?';
  console.log(t.block_time, t.trade_type.padEnd(4), 'bnb=', Number(t.bnb_amount).toFixed(4), 'curVs=', String(curVs).padStart(6)+'%', 'outlier=', t.price_outlier);
}
process.exit(0);
