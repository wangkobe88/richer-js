// 验证：来财/ba5e 矛盾卡的 famous 大买是否 price_outlier 行（FA priceReliable 不计）
import { readFileSync } from 'node:fs';
import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const rosterV3 = new Set(JSON.parse(readFileSync('/home/ubuntu/richer-js/config/rosters/famous-copy-wallets.json', 'utf8')).wallets.map(w => w.toLowerCase()));
const CASES = [
  ['来财', '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777', '12:30:00', '12:34:30'],
  ['ba5e', '0xba5ed45b42479e0a75316de7bf990ec90a3e4444', '07:40:00', '07:43:00'],
];
for (const [tag, addr, t0, t1] of CASES) {
  const { data: ticks, error } = await c.from('wss_price_ticks')
    .select('block_time,trade_type,bnb_amount,sender_address,trader_address,price_outlier')
    .eq('token_address', addr).gte('block_time', `2026-11-05T${t0}Z`).lt('block_time', `2026-11-05T${t1}Z`)
    .order('block_time', { ascending: true }).limit(2000);
  if (error) throw new Error(error.message);
  console.log(`\n=== ${tag} famous 行（含 outlier 标记）===`);
  for (const t of ticks) {
    const w = ((t.sender_address || t.trader_address) || '').toLowerCase();
    if (!rosterV3.has(w)) continue;
    console.log(`  ${t.block_time.slice(11, 19)} ${t.trade_type} ${Number(t.bnb_amount).toFixed(3)}B ${w.slice(0, 10)} outlier=${t.price_outlier}`);
  }
}
process.exit(0);
