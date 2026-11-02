const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const TOKEN = '0x5ca91444c8ab56f50a4117232c06ed4eff7d7777';
(async () => {
  const { dbManager } = require('../src/services/dbManager.js');
  const client = dbManager.getClient();
  const { data: ev } = await client.from('wss_events')
    .select('payload').eq('token_address', TOKEN).eq('kind', 'token_create').limit(1);
  const p = ev?.[0]?.payload || {};
  console.log('token_create payload keys:', Object.keys(p).join(','));
  console.log('totalSupply:', p.totalSupply, '| symbol:', p.symbol || p.name);
  const { count } = await client.from('wss_price_ticks')
    .select('*', { count: 'exact', head: true }).eq('token_address', TOKEN);
  console.log('全表 tick 数:', count);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
