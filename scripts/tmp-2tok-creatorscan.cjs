require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const CREATORS = [
  ['0x6ce58d1fa9c7b1d8ea29245bf9cb19dd1250f408', 'CI-creator'],
  ['0xb27ef25921e535aea8f2a626d0d8232ecccb43f3', 'MOLLY-creator'],
];
const WALLET_LABEL = new Map([
  ['0x975c7c048e028b4b5a9ccf508a8d308ea5d7d881', '重叠尘埃bot'],
  ['0x6ce58d1fa9c7b1d8ea29245bf9cb19dd1250f408', 'CI-creator'],
  ['0xb27ef25921e535aea8f2a626d0d8232ecccb43f3', 'MOLLY-creator'],
  ['0x04d7cae549', 'MOLLY-出货户'], ['0x97a1f8a927', 'MOLLY-快闪'],
  ['0x46f76803fc', 'MOLLY-三胞胎A'], ['0x37e7b8367b', 'MOLLY-三胞胎B'], ['0x4eebe13b5e', 'MOLLY-三胞胎C'],
  ['0xa1426c6f65', 'CI-双胞胎A'], ['0x02c6818691', 'CI-双胞胎B'],
  ['0x7f282a3313', 'CI-对倒1'], ['0xb87cbdb785', 'CI-末棒'], ['0xf539901b4c', 'CI-首波跟1'], ['0x81eab38f83', 'CI-首波跟2'],
]);
const WIN = ['2026-10-02T00:00:00Z', '2026-10-06T23:59:59Z'];

async function main() {
  const sb = dbManager.getClient();
  // 1) token_create 扫 creator 连环发币
  let afterId = 0, pages = 0, hits = [];
  const cset = new Set(CREATORS.map(c => c[0].toLowerCase()));
  while (pages < 250) {
    const { data: rows, error } = await sb.from('wss_events')
      .select('id,block_time,token_address,payload->creator,payload->symbol,payload->name,platform')
      .eq('kind', 'token_create')
      .gte('block_time', WIN[0]).lte('block_time', WIN[1])
      .gt('id', afterId).limit(1000);
    if (error) throw new Error(error.message);
    if (!rows.length) break;
    pages++;
    afterId = Math.max(...rows.map(r => r.id));
    for (const r of rows) {
      const c = (r.creator || '').toLowerCase();
      if (cset.has(c)) hits.push(r);
    }
    if (rows.length < 1000) break;
  }
  console.log(`窗口 token_create 扫描完成（${pages} 页），creator 复现：`);
  for (const h of hits) console.log(`  ${h.block_time?.slice(5, 19)} ${h.symbol} ${h.token_address} creator=${h.creator} plat=${h.platform}`);

  // 2) GMGN 画像
  const probe = [...WALLET_LABEL.keys()];
  // 补全长地址（从两票 ticks）
  const TOK = ['0xf818ac2c5545a3d4b7c643efa18aca7237927777', '0xd657ad14ec75dec1882e5a2a8d019079766a7777'];
  const labels = new Map();
  for (const [pre, name] of WALLET_LABEL) labels.set(pre.toLowerCase(), name);
  for (const t of TOK) {
    const { data: rows } = await sb.from('wss_price_ticks').select('sender_address').eq('token_address', t).limit(500);
    for (const r of rows || []) {
      const s = (r.sender_address || '').toLowerCase();
      for (const [pre, name] of labels) if (s.startsWith(pre)) labels.set(s, name);
    }
  }
  const addrs = [...labels.keys()].filter(a => a.length === 42);
  const { data: profs } = await sb.from('gmgn_wallet_profiles')
    .select('address,buy_count,sell_count,token_num,realized_profit,winrate,last_active_sec')
    .in('address', addrs).limit(50);
  console.log(`\nGMGN 画像（${profs?.length || 0}/${addrs.length} 命中）：`);
  for (const p of profs || []) {
    console.log(`  ${labels.get(p.address) || p.address.slice(0, 10)} buy=${p.buy_count} sell=${p.sell_count} token=${p.token_num} realized=${p.realized_profit} win=${p.winrate}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
