const { dbManager } = require('../src/services/dbManager.js');
const fs = require('fs');
(async () => {
  const roster = new Set(JSON.parse(fs.readFileSync('config/rosters/famous-copy-wallets.json','utf8')).wallets.map(w=>String(w).toLowerCase()));
  const c = await dbManager.getClient();
  const ADDR='0x13ccc4b96a0561201211e7d37b1352d03ed37777';
  const anchor = new Date('2026-11-03T11:16:06+00:00').getTime();
  const { data: ticks } = await c.from('wss_price_ticks')
    .select('block_time,sender_address,trader_address,trade_type')
    .eq('token_address', ADDR).order('block_time').limit(5000);
  let rank = 0, famRank = null;
  for (const t of ticks.filter(x=>new Date(x.block_time).getTime()<=anchor)) {
    if (t.trade_type !== 'buy') continue;
    rank++;
    const w = (t.sender_address || t.trader_address || '').toLowerCase();
    if (famRank === null && roster.has(w)) famRank = rank;
  }
  console.log('SI 0x13cc 锚窗 BUY 总数:', rank, '| famous 首买顺位:', famRank);
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
