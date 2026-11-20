require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const TOK = [
  ['CI', '0xf818ac2c5545a3d4b7c643efa18aca7237927777', '2026-10-03T15:44:53'],
  ['MOLLY', '0xd657ad14ec75dec1882e5a2a8d019079766a7777', '2026-10-04T07:30:52'],
];
const KEY_WALLETS = [
  '0x975c7c048e028b4b5a9ccf508a8d308ea5d7d881', // 两票重叠尘埃钱包
  '0x6ce58d1fa9', '0x7f282a3313', '0xb87cbdb785', '0xa1426c6f65', '0x02c6818691', // CI 主力
  '0xb27ef25921', '0x04d7cae549', '0x97a1f8a927', '0x46f76803fc', '0x37e7b8367b', '0x4eebe13b5e', // MOLLY 主力
];

async function main() {
  const sb = dbManager.getClient();
  // creator
  const { data: evs } = await sb.from('wss_events').select('token_address,payload').in('token_address', TOK.map(t => t[1])).eq('kind', 'token_create');
  for (const e of evs || []) {
    const p = e.payload || {};
    console.log(`${e.token_address.slice(0, 8)} creator=${p.creator || p.creatorAddress || JSON.stringify(Object.keys(p))}`);
  }

  // 两票逐笔时序（带块号）
  for (const [sym, t, created] of TOK) {
    const { data: rows } = await sb.from('wss_price_ticks')
      .select('block_time,trade_type,sender_address,trader_address,bnb_amount,block_number,token_amount')
      .eq('token_address', t).order('block_time', { ascending: true }).limit(200);
    console.log(`\n===== ${sym} 逐笔（创建 ${created}）=====`);
    for (const r of rows) {
      const w = (r.sender_address || r.trader_address || '').toLowerCase();
      console.log(`  ${r.block_time?.slice(11, 19)} blk${r.block_number} ${r.trade_type === 'buy' ? '买' : '卖'} ${Number(r.bnb_amount).toFixed(3)}B ${w.slice(0, 10)}… tok=${Number(r.token_amount).toFixed(0)}`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
