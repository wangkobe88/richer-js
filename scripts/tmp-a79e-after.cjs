require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const TOKEN = '0xa79e736482f55c89e42000151e04af630f2b7777';
async function main() {
  const sb = dbManager.getClient();
  const { data: rows } = await sb.from('wss_price_ticks')
    .select('block_time,trade_type,bnb_amount,price_bnb')
    .eq('token_address', TOKEN)
    .gt('block_time', '2026-10-04T12:15:19+00:00')
    .lte('block_time', '2026-10-04T12:40:00+00:00')
    .order('block_time', { ascending: true }).limit(2000);
  console.log('after-anchor ticks:', rows.length);
  if (rows.length) {
    const rel = rows.filter(r => r.price_bnb > 0);
    const prices = rel.map(r => r.price_bnb);
    console.log('window:', rows[0].block_time, '->', rows[rows.length-1].block_time);
    console.log('anchor-exit price ~6.43e-9 / 6.15e-9; after min:', Math.min(...prices).toExponential(4), 'max:', Math.max(...prices).toExponential(4));
    console.log('last3:');
    for (const r of rows.slice(-3)) console.log(' ', r.block_time, r.trade_type, Number(r.bnb_amount).toFixed(4), r.price_bnb ? r.price_bnb.toExponential(3) : '-');
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
