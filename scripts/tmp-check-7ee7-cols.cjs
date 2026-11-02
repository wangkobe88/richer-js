const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
(async () => {
  const { dbManager } = require('../src/services/dbManager.js');
  const client = dbManager.getClient();
  const q1 = await client.from('wss_price_ticks')
    .select('block_time,block_number').eq('token_address', '0x7ee7812e8b8de9c0d3411933216ef2004a627777')
    .order('block_time', { ascending: true }).limit(2);
  console.log('with block_number:', JSON.stringify(q1).slice(0, 400));
})().catch(e => console.error(e));
