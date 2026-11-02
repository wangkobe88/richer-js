const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
(async () => {
  const { dbManager } = require('../src/services/dbManager.js');
  const client = dbManager.getClient();
  const { data: trades } = await client.from('trades')
    .select('*').eq('experiment_id', '5298b7bd-8374-458d-b9e3-c5fe581e681d')
    .eq('token_address', '0x7ee7812e8b8de9c0d3411933216ef2004a627777').order('created_at');
  for (const t of trades) {
    console.log('=== trade', t.created_at, t.trade_direction, '===');
    console.log(JSON.stringify(t.metadata, null, 1).slice(0, 1500));
  }
  console.log('\n=== ticks 12:58:10-12:58:35 ===');
  const { data: ticks } = await client.from('wss_price_ticks')
    .select('block_time,trade_type,bnb_amount,price_bnb').eq('token_address', '0x7ee7812e8b8de9c0d3411933216ef2004a627777')
    .gte('block_time', '2026-10-29T12:58:10').lte('block_time', '2026-10-29T12:58:35')
    .order('block_time');
  for (const tk of ticks) console.log(' ', tk.block_time.slice(11, 23), tk.trade_type, tk.bnb_amount.toFixed(4), (tk.price_bnb * 1e9).toFixed(2) + 'e-9');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
