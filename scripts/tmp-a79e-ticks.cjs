require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const TOKEN = '0xa79e736482f55c89e42000151e04af630f2b7777';
const ANCHOR = '2026-10-04T12:15:19+00:00';
async function main() {
  const sb = dbManager.getClient();
  const { data: ticks, error } = await sb.from('wss_price_ticks')
    .select('block_time,block_number,log_index,trade_type,bnb_amount,sender_address,price_bnb')
    .eq('token_address', TOKEN).lte('block_time', ANCHOR)
    .order('block_time', { ascending: true }).limit(1000);
  if (error) throw new Error(JSON.stringify(error));
  console.log('total ticks <= anchor:', ticks.length);
  const walletMap = new Map(); let wi = 0; let prevTs = null;
  for (const t of ticks) {
    const w = (t.sender_address || '?').toLowerCase();
    if (!walletMap.has(w)) walletMap.set(w, 'W' + (++wi));
    const d = new Date(t.block_time);
    const ts = d.toISOString().slice(11, 23);
    const gap = prevTs ? ((d - prevTs) / 1000).toFixed(1) : '-';
    prevTs = d;
    console.log(ts, 'gap+' + gap + 's', t.trade_type === 'buy' ? 'BUY ' : 'SELL', Number(t.bnb_amount).toFixed(4), walletMap.get(w), 'blk', t.block_number, 'li', t.log_index);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
