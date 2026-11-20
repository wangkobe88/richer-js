require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const TOK = '0x4fe71b03ed8be235fb2b7671f8b84caecad57777';
const WHALE = '0x800d29493d67e2f5bc0b1eadc59de412f7bd1d73';
const ANCHOR = Date.parse('2026-10-03T08:29:56Z');
async function main() {
  const sb = dbManager.getClient();
  const { data } = await sb.from('wss_price_ticks')
    .select('block_time, trade_type, bnb_amount, sender_address, trader_address')
    .eq('token_address', TOK)
    .lte('block_time', '2026-10-03T08:29:56Z')
    .gte('block_time', '2026-10-03T08:28:00Z')
    .order('block_time').limit(100);
  const rows = (data || []).map(r => ({
    t: Date.parse(r.block_time), type: r.trade_type, bnb: Number(r.bnb_amount),
    w: ((r.sender_address || r.trader_address) || '').toLowerCase()
  }));
  const win = rows.filter(r => ANCHOR - r.t <= 30000); // 锚前 30s
  console.log('window ticks:', win.length, 'first/last:', new Date(win[0].t).toISOString(), new Date(win[win.length-1].t).toISOString());
  function stats(list, label) {
    const buys = list.filter(r => r.type === 'buy'), sells = list.filter(r => r.type === 'sell');
    const span = (list[list.length-1].t - list[0].t) / 1000;
    const vol = list.reduce((s, r) => s + r.bnb, 0);
    const wallets = new Set(list.map(r => r.w).filter(Boolean));
    // 最大间隙
    let maxGap = 0; for (let i = 1; i < list.length; i++) maxGap = Math.max(maxGap, (list[i].t - list[i-1].t) / 1000);
    // 最密 5s 买窗
    let b5 = 0, b5n = 0;
    for (let i = 0; i < buys.length; i++) {
      let v = 0, n = 0;
      for (let j = i; j < buys.length && buys[j].t - buys[i].t <= 5000; j++) { v += buys[j].bnb; n++; }
      if (v > b5) { b5 = v; b5n = n; }
    }
    console.log(`[${label}] ticks=${list.length} span=${span.toFixed(0)}s 密度=${(list.length/span*60).toFixed(1)}/min 吞吐=${(vol/span*60).toFixed(2)}B/min`,
      `买${buys.length}笔${buys.reduce((s,r)=>s+r.bnb,0).toFixed(4)}B 卖${sells.length}笔${sells.reduce((s,r)=>s+r.bnb,0).toFixed(4)}B`,
      `avg=${(vol/list.length).toFixed(3)} maxGap=${maxGap.toFixed(0)}s 钱包=${wallets.size} burst5=${b5.toFixed(3)}B/${b5n}笔`);
  }
  stats(win, '含庄 ');
  stats(win.filter(r => r.w !== WHALE), '扣庄 ');
  // 尾段证据（本来就无庄）
  const tEnd = win[win.length-1].t;
  const t5 = win.filter(r => tEnd - r.t <= 5000), t10 = win.filter(r => tEnd - r.t <= 10000);
  console.log('尾5s:', t5.map(r=>`${r.type}:${r.bnb.toFixed(4)}`).join(' '), '| 尾10s B/min =', (t10.reduce((s,r)=>s+r.bnb,0)/10*60).toFixed(2), '| 庄在尾段?', t5.some(r=>r.w===WHALE)||t10.some(r=>r.w===WHALE));
  // 半开窗边界核对
  console.log('win30 半开窗 (tEnd-30,tEnd] 是否含庄:', win.filter(r=>r.w===WHALE).map(r=>new Date(r.t).toISOString()));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
