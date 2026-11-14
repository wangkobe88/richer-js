// 一次性（182 跑）：c84a v100 六信号锚时刻盘面快照（笔位/curVs/买额/holders）+ 开盘段逐笔。
const { dbManager } = require('../../src/services/dbManager.js');
const T = '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777';
const FM = 4496173469e-18;
const ANCHORS = [
  ['12:31:26', 'buy_0_1 t0(7笔/1B/h4)'],
  ['12:31:32', 'buy_1_2 t0a(9笔/1B/h6)'],
  ['12:31:38', 'buy_2_3 t0b(12笔/1B/h6)'],
  ['12:31:49', 'buy_3_4 t2(16笔/1B/h9)'],
  ['12:31:52', 'buy_4_5 t3(20笔/1.2B/h12)'],
  ['12:32:07', 'buy_5_6 t4(24笔/1.5B/h12)'],
];
async function main() {
  const sb = await dbManager.getClient();
  const rows = [];
  let fromId = 0;
  for (;;) {
    const { data, error } = await sb.from('wss_price_ticks')
      .select('id,block_time,trade_type,bnb_amount,token_amount,price_bnb,trader_address,sender_address')
      .eq('token_address', T).gt('id', fromId).order('id', { ascending: true }).limit(1000);
    if (error) throw error;
    if (!data || !data.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
    fromId = data[data.length - 1].id;
  }
  const launch = FM;
  const dust = 0.015 / launch;
  const net = new Map();
  let n = 0, buyVol = 0, lastVs = null;
  const snaps = new Map(ANCHORS.map(([t]) => [t, null]));
  const detail = [];
  for (const r of rows) {
    n++;
    if (r.trade_type === 'buy') buyVol += r.bnb_amount || 0;
    const w = ((r.sender_address || r.trader_address || '') + '').toLowerCase();
    net.set(w, (net.get(w) || 0) + (r.trade_type === 'buy' ? (r.token_amount || 0) : -(r.token_amount || 0)));
    let holders = 0; for (const v of net.values()) if (v >= dust) holders++;
    const vs = r.price_bnb > 0 ? (r.price_bnb / launch - 1) * 100 : lastVs;
    if (vs !== null && vs !== undefined) lastVs = vs;
    const hm = r.block_time.slice(11, 19);
    for (const [a] of ANCHORS) if (!snaps.get(a) && hm > a) snaps.set(a, { n, buyVol, holders, vs: lastVs });
    if (n <= 30) detail.push(`n=${n} ${hm} ${r.trade_type === 'buy' ? '买' : '卖'} ${(r.bnb_amount || 0).toFixed(4)}B ${w.slice(0, 8)} curVs=${lastVs !== null ? lastVs.toFixed(1) + '%' : '-'} h=${holders}`);
  }
  console.log('开盘段逐笔（前 30 笔，创建 12:31:10）：');
  for (const d of detail) console.log('  ' + d);
  console.log('\n各信号锚时刻盘面（该时刻已累计）：');
  for (const [a, leg] of ANCHORS) {
    const s = snaps.get(a);
    console.log(`  ${a} ${leg} → ${s ? `第${s.n}笔 买额${s.buyVol.toFixed(2)}B holders≈${s.holders} curVs=${s.vs !== null ? s.vs.toFixed(1) + '%' : '-'}` : '（无截窗）'}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
