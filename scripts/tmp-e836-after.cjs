require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const TOKEN = '0xe83626c404ee63b68ae2a7cdb17fd7d4d2c77777';
async function main() {
  const sb = dbManager.getClient();
  const { data: rows } = await sb.from('wss_price_ticks')
    .select('block_time,trade_type,bnb_amount,price_bnb')
    .eq('token_address', TOKEN)
    .gt('block_time', '2026-10-04T11:01:51+00:00')
    .lte('block_time', '2026-10-04T11:20:00+00:00')
    .order('block_time', { ascending: true }).limit(2000);
  console.log('after-anchor ticks:', rows.length);
  if (rows.length) {
    const rel = rows.filter(r => r.price_bnb > 0).map(r => r.price_bnb);
    const p0 = 0.000000005546; // flap 常量发行价近似
    console.log('first:', rows[0].block_time, 'last:', rows[rows.length-1].block_time);
    console.log('min price:', Math.min(...rel).toExponential(4), 'max price:', Math.max(...rel).toExponential(4));
    console.log('last5:');
    for (const r of rows.slice(-5)) console.log(' ', r.block_time, r.trade_type, Number(r.bnb_amount).toFixed(4), r.price_bnb ? r.price_bnb.toExponential(3) : '-');
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
