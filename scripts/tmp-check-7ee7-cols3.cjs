const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
(async () => {
  const { dbManager } = require('../src/services/dbManager.js');
  const client = dbManager.getClient();
  // A: 无 limit 全量（原始脚本形状）
  const a = await client.from('wss_price_ticks')
    .select('block_time,trade_type,bnb_amount,price_bnb,sender_address,trader_address,token_amount')
    .eq('token_address', '0x7ee7812e8b8de9c0d3411933216ef2004a627777')
    .order('block_time', { ascending: true });
  console.log('A 无limit:', a.data ? a.data.length : 'null', a.error ? JSON.stringify(a.error).slice(0,120) : '');
  // B: 带 range 分页
  const b = await client.from('wss_price_ticks')
    .select('block_time,block_number,trade_type,bnb_amount,price_bnb,sender_address,trader_address,token_amount')
    .eq('token_address', '0x7ee7812e8b8de9c0d3411933216ef2004a627777')
    .order('block_time', { ascending: true }).range(0, 440);
  console.log('B range0-440:', b.data ? b.data.length : 'null', b.error ? JSON.stringify(b.error).slice(0,120) : '');
  process.exit(0);
})().catch(e => console.error(e));
