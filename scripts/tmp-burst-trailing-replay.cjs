const { dbManager } = require('../src/services/dbManager');

const WINS = [
  { k: 'v155', id: 'dddbe79e-480a-402a-aa35-85a72d2f591e' },
  { k: 'v156', id: 'b8ae9f2e-832f-42db-bbda-8d8701aecb63' },
  { k: 'v140', id: '6e75ed6d-807a-4164-9551-d3b95d1fc37b' },
  { k: 'v145', id: '2448116a-bebe-457d-9d8a-b4556c9a8e0d' },
];

async function main() {
  const sb = dbManager.getClient();
  const rows = [];
  const seen = new Map();
  for (const w of WINS) {
    const sigs = [];
    let from = 0;
    while (true) {
      const { data, error } = await sb.from('strategy_signals').select('*')
        .eq('experiment_id', w.id).eq('signal_type', 'BUY')
        .order('created_at', { ascending: true }).range(from, from + 999);
      if (error) throw error;
      if (!data || !data.length) break;
      sigs.push(...data); from += 1000;
      if (data.length < 1000) break;
    }
    const first = new Map();
    for (const s of sigs) if (!first.has(s.token_address)) first.set(s.token_address, s);
    const tmap = new Map();
    let f2 = 0;
    while (true) {
      const { data, error } = await sb.from('trades').select('*')
        .eq('experiment_id', w.id).order('created_at').range(f2, f2 + 999);
      if (error) throw error;
      if (!data || !data.length) break;
      for (const t of data) {
        if (!tmap.has(t.token_address)) tmap.set(t.token_address, { b: 0, s: 0, nBuy: 0 });
        const o = tmap.get(t.token_address);
        if (t.trade_direction === 'buy' && t.success) { o.b += Number(t.input_amount); o.nBuy++; }
        if (t.trade_direction === 'sell' && t.success) o.s += Number(t.output_amount);
      }
      f2 += 1000;
      if (data.length < 1000) break;
    }
    for (const [tok, s] of first) {
      const dk = tok + '|' + (s.created_at || '').slice(0, 13);
      if (seen.has(dk)) continue;
      seen.set(dk, 1);
      const t = tmap.get(tok);
      if (!t || !t.nBuy) continue;
      const m = s.metadata || {};
      const bp = m.buyPoint || {}; const an = bp.anchors || {}; const dim = bp.dimensions || {};
      const shape = dim.entry_shape && dim.entry_shape.bucket;
      const chg5 = an.chg5Pct;
      if (shape !== 'spike' && !(typeof chg5 === 'number' && chg5 >= 25)) continue;
      rows.push({ win: w.k, tok, buyT: s.created_at, pnl: +(t.s - t.b).toFixed(4), roi: (t.s / t.b - 1) * 100 });
    }
  }
  console.log('回放票数:', rows.length);

  // 回放：fire 后逐 tick 跟踪波顶（fire 价起算），从顶回撤 X% 触发全卖
  const Xs = [20, 25, 30, 35, 40, 50];
  const results = {};
  for (const r of rows) {
    const { data: ticks, error } = await sb.from('wss_price_ticks')
      .select('block_time,price_bnb,bnb_amount')
      .eq('token_address', r.tok)
      .gte('block_time', r.buyT)
      .order('block_time', { ascending: true }).limit(1000);
    if (error || !ticks || ticks.length < 2) { r.ticks = null; continue; }
    r.ticks = ticks;
    const fireP = Number(ticks[0].price_bnb);
    if (!(fireP > 0)) { r.ticks = null; continue; }
    r.fireP = fireP;
    for (const X of Xs) {
      let maxP = fireP, trigP = null, trigT = null;
      for (const tk of ticks.slice(1)) {
        const p = Number(tk.price_bnb);
        if (!(p > 0)) continue;
        if (p > maxP) { maxP = p; continue; }
        if (p <= maxP * (1 - X / 100)) { trigP = p; trigT = tk.block_time; break; }
      }
      if (!results[X]) results[X] = [];
      results[X].push({ ...r, trigP, trigT, trailPnl: trigP !== null ? +((trigP / fireP - 1) * 0.2).toFixed(4) : r.pnl });
    }
  }
  const totalActual = rows.filter(r => r.ticks).reduce((x, r) => x + r.pnl, 0);
  console.log('有 ticks 的票:', rows.filter(r => r.ticks).length, '| 实际 pnlΣ', totalActual.toFixed(4));
  console.log('\n== 波顶回撤 X% 全卖 — 净效应（vs 实际卖出路径）==');
  for (const X of Xs) {
    const g = results[X] || [];
    if (!g.length) continue;
    const trig = g.filter(r => r.trigP !== null);
    const keep = g.filter(r => r.trigP === null);
    const trailTotal = g.reduce((x, r) => x + r.trailPnl, 0);
    const delta = trailTotal - totalActual;
    // 触发票分改善/恶化
    const better = trig.filter(r => r.trailPnl > r.pnl), worse = trig.filter(r => r.trailPnl <= r.pnl);
    const betterSum = better.reduce((x, r) => x + (r.trailPnl - r.pnl), 0);
    const worseSum = worse.reduce((x, r) => x + (r.trailPnl - r.pnl), 0);
    console.log(`X=${X}%: 触发 ${String(trig.length).padStart(3)}/${g.length} | 模拟Σ ${trailTotal.toFixed(4)} | Δ净 ${delta >= 0 ? '+' : ''}${delta.toFixed(4)} | 改善 ${better.length} 票 +${betterSum.toFixed(3)} / 恶化 ${worse.length} 票 ${worseSum.toFixed(3)} | 恶化最大: ${[...worse].sort((a, b) => (a.trailPnl - a.pnl) - (b.trailPnl - b.pnl)).slice(0, 3).map(r => r.tok.slice(0, 8) + (r.trailPnl - r.pnl >= 0 ? '+' : '') + (r.trailPnl - r.pnl).toFixed(3)).join(' ')}`);
  }
  // X=30 明细：触发票逐个
  console.log('\n== X=30% 触发票明细 ==');
  for (const r of (results[30] || []).filter(r => r.trigP !== null).sort((a, b) => (a.trailPnl - a.pnl) - (b.trailPnl - b.pnl))) {
    console.log(`  ${r.win} ${r.tok.slice(0, 10)} 实际${r.pnl.toFixed(4)} → 模拟${r.trailPnl.toFixed(4)} (Δ${(r.trailPnl - r.pnl >= 0 ? '+' : '') + (r.trailPnl - r.pnl).toFixed(4)}) 触发@${r.trigT && r.trigT.slice(11, 19)} pp=${(r.trigP / r.fireP * 100 - 100).toFixed(1)}%`);
  }
  // 三赢家在各档位的下场
  console.log('\n== 三赢家（2f17/40ef/ba5e）在各档位 ==');
  for (const p of ['0x2f17249e', '0x40efb3d5', '0xba5ed45b']) {
    const line = [];
    for (const X of Xs) {
      const r = (results[X] || []).find(x => x.tok.startsWith(p));
      if (r) line.push(`X${X}:${r.trigP !== null ? r.trailPnl.toFixed(3) + '(触发)' : r.pnl.toFixed(3) + '(持到尾)'}`);
    }
    console.log(' ', p, '实际', rows.find(x => x.tok.startsWith(p)).pnl, '|', line.join(' '));
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
