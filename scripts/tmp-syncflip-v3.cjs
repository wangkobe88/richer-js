require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const WINDOWS = [
  ['w1003热', 'd29420e7-9d5a-48b4-9e72-0b3dfe00c22f'],
  ['w1019中', '7ae8e398-c875-454a-942b-bc1accfacd53'],
  ['w1012中', '8ebaccce-62c6-4209-a2a0-40f361c49bf9'],
  ['w1103冷', '2448116a-bebe-457d-9d8a-b4556c9a8e0d'],
];
const ROUTERS = require('../src/trading-engine/pre-check/aggregator-routers').AGGREGATOR_ROUTER_ADDRS;
const W_DUST = 0.05;
function wallet(r) { return (r.sender_address || r.trader_address || '').toLowerCase(); }
function extractShapes(rows) {
  const wstat = new Map(); const byBlock = new Map();
  const sellRows = [], buyRows = [];
  for (const r of rows) {
    const w = wallet(r); if (!w || ROUTERS.has(w)) continue;
    const b = Number(r.bnb_amount);
    const e = wstat.get(w) || { buy: 0, sell: 0 };
    if (r.trade_type === 'buy') { e.buy += b; buyRows.push({ w, b, blk: r.block_number, t: r.block_time }); const m = byBlock.get(r.block_number) || new Map(); const c = m.get(w) || { buy: 0 }; c.buy += b; m.set(w, c); byBlock.set(r.block_number, m); }
    else { e.sell += b; sellRows.push({ w, b, blk: r.block_number, t: r.block_time }); }
    wstat.set(w, e);
  }
  const oversellers = [...wstat.entries()].filter(([w, e]) => e.sell >= 0.3 && e.sell > e.buy * 1.5).map(([w, e]) => ({ w: w.slice(0, 10), buy: e.buy, sell: e.sell }));
  const oversellBnb = oversellers.reduce((s, o) => s + o.sell, 0);
  // 等额同块买入簇（买点前可见：仅买入端）eq<=1.5 合计>=0.3
  let eqCrewBest = null;
  for (const [blk, m] of byBlock) {
    const members = [...m.entries()].filter(([, e]) => e.buy >= W_DUST);
    if (members.length < 2) continue;
    const buvs = members.map(([, e]) => e.buy); const tot = buvs.reduce((s, v) => s + v, 0);
    const eq = Math.max(...buvs) / Math.min(...buvs);
    if (eq <= 1.5 && tot >= 0.3 && (!eqCrewBest || tot > eqCrewBest.tot)) eqCrewBest = { n: members.length, tot, eq, wallets: members.map(([w, e]) => ({ w: w.slice(0, 10), buy: e.buy })) };
  }
  // self-wash：同钱包 <=120s 先卖(>=0.1)后买(>=0.1)
  let selfWashN = 0; const selfWashW = new Set();
  for (const br of buyRows) {
    if (br.b < 0.1) continue;
    const prior = sellRows.find(s => s.w === br.w && s.b >= 0.1 && s.blk <= br.blk && (new Date(br.t) - new Date(s.t)) / 1000 <= 120 && (new Date(br.t) - new Date(s.t)) / 1000 >= 0);
    if (prior) { selfWashN++; selfWashW.add(br.w); }
  }
  return { oversellers, oversellBnb, eqCrewBest, selfWashN, selfWashW: [...selfWashW], walletN: wstat.size };
}
async function main() {
  const sb = dbManager.getClient();
  const all = [];
  for (const [wname, exp] of WINDOWS) {
    const trs = [];
    for (let off = 0; ; off += 1000) {
      const { data: rows } = await sb.from('trades').select('token_address,token_symbol,trade_direction,input_amount,output_amount,created_at')
        .eq('experiment_id', exp).order('created_at', { ascending: true }).range(off, off + 999);
      if (!rows || !rows.length) break; trs.push(...rows); if (rows.length < 1000) break;
    }
    const { data: sigs } = await sb.from('strategy_signals').select('token_address,created_at').eq('experiment_id', exp).eq('signal_type', 'BUY').order('created_at').limit(5000);
    const firstSig = new Map(); for (const s of sigs || []) if (!firstSig.has(s.token_address)) firstSig.set(s.token_address, s.created_at);
    const pnl = new Map();
    for (const t of trs) { const e = pnl.get(t.token_address) || { sym: t.token_symbol, buy: 0, sell: 0, anchor: firstSig.get(t.token_address) }; if (t.trade_direction === 'buy') e.buy += Number(t.input_amount || 0); else e.sell += Number(t.output_amount || 0); pnl.set(t.token_address, e); }
    for (const [addr, e] of pnl) {
      if (e.buy <= 0) continue;
      const anchorIso = e.anchor || trs.find(t => t.token_address === addr && t.trade_direction === 'buy')?.created_at;
      const { data: rows } = await sb.from('wss_price_ticks').select('block_time,trade_type,sender_address,trader_address,bnb_amount,block_number')
        .eq('token_address', addr).lte('block_time', anchorIso).order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(3000);
      const sh = extractShapes(rows || []);
      all.push({ win: wname, addr, sym: e.sym, pnl: e.sell - e.buy, ...sh });
    }
  }
  const A = p => p.oversellBnb >= 0.5 && p.walletN <= 12;
  const B = p => !!p.eqCrewBest && p.walletN <= 12;
  const C = p => p.selfWashN >= 1 && p.walletN <= 12;
  const J = [
    ['A 超卖≥0.5∧钱包≤12', A], ['B 等额簇∧钱包≤12', B], ['C self-wash∧钱包≤12', C],
    ['A∨B∨C', p => A(p) || B(p) || C(p)],
    ['A∨B', p => A(p) || B(p)],
    ['A∨C', p => A(p) || C(p)],
    ['(A∨B∨C)∧钱包≤10', p => (A(p) || B(p) || C(p)) && p.walletN <= 10],
  ];
  console.log(`四窗 ${all.length} 成交票`);
  for (const [name, fn] of J) {
    const hits = all.filter(fn); const hp = hits.reduce((s, x) => s + x.pnl, 0);
    const pos = hits.filter(x => x.pnl > 0.001);
    console.log(`${name}: 命中 ${hits.length} Σ${hp.toFixed(3)}B | 正票 ${pos.length} Σ${pos.reduce((s, x) => s + x.pnl, 0).toFixed(3)} | 负票 ${hits.length - pos.length} Σ${(hp - pos.reduce((s, x) => s + x.pnl, 0)).toFixed(3)}`);
  }
  // CI/MOLLY 案值核对
  for (const p of all.filter(p => ['0xf818ac2c5545a3d4b7c643efa18aca7237927777', '0xd657ad14ec75dec1882e5a2a8d019079766a7777'].includes(p.addr))) {
    console.log(`案值 ${p.sym}: walletN=${p.walletN} oversell=${p.oversellBnb.toFixed(2)} eqCrew=${p.eqCrewBest ? `${p.eqCrewBest.n}w ${p.eqCrewBest.tot.toFixed(2)}B` : '-'} selfWash=${p.selfWashN}`);
  }
  console.log(`\n===== A∨B∨C 命中明细 =====`);
  for (const p of all.filter(p => A(p) || B(p) || C(p))) {
    console.log(`  [${p.win}] ${p.sym} ${p.addr.slice(0,10)}… ${p.pnl>=0?'+':''}${p.pnl.toFixed(4)} w${p.walletN} | ${A(p)?'A':''}${B(p)?'B':''}${C(p)?'C':''} 超卖${p.oversellBnb.toFixed(2)} 簇${p.eqCrewBest?p.eqCrewBest.n+'w'+p.eqCrewBest.tot.toFixed(2)+'B':'-'} selfwash${p.selfWashN}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
