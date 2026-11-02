// 查 07:59-09:18 窗口钱包在监控池内的交易（trader/sender=钱包）
const { dbManager } = require('../src/services/dbManager.js');
const WALLET = '0xc3c9a4f7fe43115d282d086610e9f21f2ed2cf20';
(async () => {
  const db = dbManager.getClient();
  const { data, error } = await db
    .from('wss_price_ticks')
    .select('token_address,trader_address,sender_address,bnb_amount,block_number,block_time')
    .or(`trader_address.eq.${WALLET},sender_address.eq.${WALLET}`)
    .gte('block_time', '2026-10-29T07:59:00Z')
    .lt('block_time', '2026-10-29T09:18:53Z')
    .order('block_time', { ascending: true })
    .limit(20);
  if (error) throw error;
  console.log('窗口内钱包 tick 行数:', data.length);
  for (const r of data) console.log('---', r.block_time, '| token:', r.token_address, '| block:', r.block_number, '| bnb:', r.bnb_amount);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
