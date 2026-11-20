require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const W = [
  ['0x975c7c048e028b4b5a9ccf508a8d308ea5d7d881', '重叠尘埃bot'],
  ['0x6ce58d1fa9c7b1d8ea29245bf9cb19dd1250f408', 'CI-creator'],
  ['0x7f282a3313', 'CI-对倒1'], // 前缀补全在运行时
  ['0xb27ef25921e535aea8f2a626d0d8232ecccb43f3', 'MOLLY-creator'],
  ['0x04d7cae549', 'MOLLY-出货户'],
  ['0x97a1f8a927', 'MOLLY-快闪'],
  ['0x46f76803fc', 'MOLLY-三胞胎A'],
  ['0x37e7b8367b', 'MOLLY-三胞胎B'],
  ['0x4eebe13b5e', 'MOLLY-三胞胎C'],
  ['0xa1426c6f65', 'CI-双胞胎A'],
  ['0x02c6818691', 'CI-双胞胎B'],
];
const WIN = ['2026-10-03T00:00:00Z', '2026-10-05T23:59:59Z'];

async function main() {
  const sb = dbManager.getClient();
  // 先从两票 ticks 补全长地址
  const TOK = ['0xf818ac2c5545a3d4b7c643efa18aca7237927777', '0xd657ad14ec75dec1882e5a2a8d019079766a7777'];
  const full = new Map(W.map(([a, n]) => [a.toLowerCase(), n]));
  for (const t of TOK) {
    const { data: rows } = await sb.from('wss_price_ticks').select('sender_address').eq('token_address', t).limit(500);
    for (const r of rows || []) {
      const s = (r.sender_address || '').toLowerCase();
      for (const [pre] of W) if (s.startsWith(pre.toLowerCase())) full.set(s, full.get(pre.toLowerCase()) || '');
    }
  }
  const addrs = [...full.keys()].filter(a => a.length === 42);
  console.log(`扫描 ${addrs.length} 个钱包在 ${WIN[0].slice(0, 10)}~${WIN[1].slice(0, 10)} 窗口的全部成交`);

  // 窗口内这些钱包的成交 → 票分布（keyset 分页）
  const perTok = new Map(); // token → wallet → {buy,sell,n}
  let afterId = 0, total = 0;
  while (true) {
    const { data: rows, error } = await sb.from('wss_price_ticks')
      .select('id,token_address,block_time,trade_type,bnb_amount,sender_address')
      .in('sender_address', addrs)
      .gte('block_time', WIN[0]).lte('block_time', WIN[1])
      .gt('id', afterId).order('id', { ascending: true }).limit(1000);
    if (error) throw new Error(error.message);
    if (!rows.length) break;
    total += rows.length;
    afterId = rows[rows.length - 1].id;
    for (const r of rows) {
      const tk = perTok.get(r.token_address) || new Map();
      const w = (r.sender_address || '').toLowerCase();
      const e = tk.get(w) || { buy: 0, sell: 0, n: 0, first: r.block_time };
      if (r.trade_type === 'buy') e.buy += Number(r.bnb_amount); else e.sell += Number(r.bnb_amount);
      e.n++;
      tk.set(w, e); perTok.set(r.token_address, tk);
    }
    if (rows.length < 1000) break;
  }
  console.log(`命中 ${total} 笔，分布 ${perTok.size} 票：`);
  const arr = [...perTok.entries()].sort((a, b) => b[1].size - a[1].size);
  for (const [tok, ws] of arr) {
    const names = [...ws.entries()].map(([w, e]) => `${(full.get(w) || w.slice(0, 8)).replace(/^.*-/, '')}买${e.buy.toFixed(2)}卖${e.sell.toFixed(2)}`).slice(0, 6);
    console.log(`  ${tok.slice(0, 10)}… 钱包${ws.size} [${names.join(' | ')}]`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
