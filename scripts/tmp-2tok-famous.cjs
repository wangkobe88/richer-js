require('dotenv').config({ path: 'config/.env' });
const fs = require('fs');
const { dbManager } = require('../src/services/dbManager');
const TOK = [
  ['CI', '0xf818ac2c5545a3d4b7c643efa18aca7237927777', '2026-10-03T15:46:08'],
  ['MOLLY', '0xd657ad14ec75dec1882e5a2a8d019079766a7777', '2026-10-04T07:31:54'],
];
const smart = new Set(Object.keys(JSON.parse(fs.readFileSync('data/kol-study/smartmoney-accum.json', 'utf8')).sources.smartmoney || {}));
const famous = new Set(JSON.parse(fs.readFileSync('config/rosters/famous-copy-wallets.json', 'utf8')).wallets.map(w => (typeof w === 'string' ? w : w.address).toLowerCase()));
console.log(`famous roster ${famous.size} 个, smart ${smart.size} 个`);
async function main() {
  const sb = dbManager.getClient();
  for (const [sym, t, buyAt] of TOK) {
    const { data: rows } = await sb.from('wss_price_ticks')
      .select('block_time,trade_type,sender_address,bnb_amount,block_number')
      .eq('token_address', t).order('block_time').limit(200);
    console.log(`\n===== ${sym} 全程 famous/smart 标记 =====`);
    for (const r of rows || []) {
      const w = (r.sender_address || '').toLowerCase();
      const tag = famous.has(w) ? 'FAMOUS' : smart.has(w) ? 'SMART' : '';
      if (tag) console.log(`  ${r.block_time?.slice(11, 19)} ${r.trade_type === 'buy' ? '买' : '卖'} ${Number(r.bnb_amount).toFixed(4)}B ${w} [${tag}]${r.block_time > buyAt ? ' ←买点后' : ''}`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
