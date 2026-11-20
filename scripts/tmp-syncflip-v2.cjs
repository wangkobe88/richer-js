require('dotenv').config({ path: 'config/.env' });
const fs = require('fs');
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
  for (const r of rows) {
    const w = wallet(r); if (!w || ROUTERS.has(w)) continue;
    const b = Number(r.bnb_amount);
    const e = wstat.get(w) || { buy: 0, sell: 0 };
    if (r.trade_type === 'buy') {
      e.buy += b;
      const m = byBlock.get(r.block_number) || new Map();
      const c = m.get(w) || { buy: 0, t: r.block_time }; c.buy += b; m.set(w, c); byBlock.set(r.block_number, m);
    } else { e.sell += b; if (e.firstSellBlock == null) { e.firstSellBlock = r.block_number; e.firstSellT = r.block_time; } }
    wstat.set(w, e);
  }
  const oversellers = [...wstat.entries()].filter(([w, e]) => e.sell >= 0.3 && e.sell > e.buy * 1.5).map(([w, e]) => ({ w: w.slice(0, 10), buy: e.buy, sell: e.sell }));
  const crews = [];
  for (const [blk, m] of byBlock) {
    const members = [...m.entries()].filter(([, e]) => e.buy >= W_DUST);
    if (members.length < 2) continue;
    const sellBlockCnt = new Map();
    for (const [w] of members) { const fs = wstat.get(w); if (fs && fs.firstSellBlock != null && fs.firstSellBlock > blk) sellBlockCnt.set(fs.firstSellBlock, (sellBlockCnt.get(fs.firstSellBlock) || 0) + 1); }
    let syncN = 0, syncT = null;
    for (const [sb, n] of sellBlockCnt) if (n > syncN) { syncN = n; syncT = wstat.get([...members.entries()].find(([w]) => wstat.get(w)?.firstSellBlock === sb)?.[0] || '')?.firstSellT; }
    if (syncN < 2) continue;
    const buvs = members.map(([, e]) => e.buy);
    crews.push({ n: members.length, tot: buvs.reduce((s, v) => s + v, 0), eq: Math.max(...buvs) / Math.min(...buvs), holdSec: syncT ? (new Date(syncT) - new Date(members[0][1].t)) / 1000 : null });
  }
  return { oversellers, crews, walletN: wstat.size, oversellBnb: oversellers.reduce((s, o) => s + o.sell, 0) };
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
  const J = [
    ['超卖≥1 ∧ 钱包≤15', p => p.oversellers.length >= 1 && p.walletN <= 15],
    ['超卖≥1 ∧ 钱包≤12', p => p.oversellers.length >= 1 && p.walletN <= 12],
    ['超卖≥1 ∧ 钱包≤10', p => p.oversellers.length >= 1 && p.walletN <= 10],
    ['超卖≥1 ∧ 同步簇 ∧ 钱包≤15', p => p.oversellers.length >= 1 && p.walletN <= 15 && p.crews.some(c => c.tot >= 0.3 && c.holdSec != null && c.holdSec <= 120)],
    ['超卖≥0.5B合计 ∧ 钱包≤12', p => p.oversellBnb >= 0.5 && p.walletN <= 12],
    ['钱包≤10 单腿(对照)', p => p.walletN <= 10],
    ['超卖≥1(对照)', p => p.oversellers.length >= 1],
  ];
  console.log(`四窗 ${all.length} 成交票`);
  for (const [name, fn] of J) {
    const hits = all.filter(fn); const hp = hits.reduce((s, x) => s + x.pnl, 0);
    const pos = hits.filter(x => x.pnl > 0.001);
    console.log(`${name}: 命中 ${hits.length} Σ${hp.toFixed(3)}B | 正票 ${pos.length} Σ${pos.reduce((s, x) => s + x.pnl, 0).toFixed(3)} | 负票 ${hits.length - pos.length} Σ${(hp - pos.reduce((s, x) => s + x.pnl, 0)).toFixed(3)}`);
  }
  console.log(`\n===== 「超卖≥1 ∧ 钱包≤15」命中明细 =====`);
  for (const p of all.filter(p => p.oversellers.length >= 1 && p.walletN <= 15)) {
    console.log(`  [${p.win}] ${p.sym} ${p.addr.slice(0,10)}… PnL ${p.pnl>=0?'+':''}${p.pnl.toFixed(4)} 钱包${p.walletN} 超卖${p.oversellBnb.toFixed(2)}B [${p.oversellers.map(o=>`${o.w} ${o.buy.toFixed(2)}→${o.sell.toFixed(2)}`).join('|')}]${p.crews.some(c=>c.tot>=0.3&&c.holdSec!=null&&c.holdSec<=120)?' +簇':''}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
