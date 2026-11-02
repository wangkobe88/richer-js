const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
(async () => {
  const { dbManager } = require('../src/services/dbManager.js');
  const client = dbManager.getClient();
  const combos = [
    'block_time,block_number',
    'block_time,block_number,trade_type',
    'block_time,block_number,trade_type,bnb_amount,price_bnb,sender_address',
    'block_time,block_number,trade_type,bnb_amount,price_bnb,sender_address,trader_address',
    'block_time,block_number,trade_type,bnb_amount,price_bnb,sender_address,trader_address,token_amount',
  ];
  for (const sel of combos) {
    const r = await client.from('wss_price_ticks').select(sel)
      .eq('token_address', '0x7ee7812e8b8de9c0d3411933216ef2004a627777')
      .order('block_time', { ascending: true }).limit(1);
    console.log(sel.split(',').length, 'fields →', r.data ? r.data.length : 'null', r.error ? 'ERR:' + JSON.stringify(r.error).slice(0, 150) : '');
  }
  process.exit(0);
})().catch(e => console.error(e));
