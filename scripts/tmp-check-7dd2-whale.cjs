const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
(async () => {
  const { dbManager } = require('../src/services/dbManager.js');
  const client = dbManager.getClient();
  const { data } = await client.from('wss_price_ticks')
    .select('block_time,bnb_amount,price_bnb,sender_address,trader_address')
    .eq('token_address', '0x7dd2a5251abd97f2059db318a0b9851786617777')
    .gte('bnb_amount', 0.05).order('block_time', { ascending: true }).limit(15);
  console.log('creator = 0xcbdc438821268dd90f23b205d08bd68d8153b6ab\n>=0.05 BNB 大单：');
  for (const t of data) console.log(' ', t.block_time, t.bnb_amount, 'sender:', t.sender_address, 'trader:', (t.trader_address||'').slice(0,10));
  const sender0 = data[0].sender_address;
  const { data: sells } = await client.from('wss_price_ticks')
    .select('block_time,bnb_amount').eq('token_address', '0x7dd2a5251abd97f2059db318a0b9851786617777')
    .eq('trade_type', 'sell').eq('sender_address', sender0);
  console.log('\nt0 大单钱包卖出笔数:', (sells||[]).length, JSON.stringify(sells||[]).slice(0,300));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
