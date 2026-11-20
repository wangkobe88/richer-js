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
      const dedupKey = tok + '|' + (s.created_at || '').slice(0, 13);
      if (seen.has(dedupKey)) continue;
      seen.set(dedupKey, 1);
      const t = tmap.get(tok);
      if (!t || !t.nBuy) continue; // 成交票
      const m = s.metadata || {};
      const bp = m.buyPoint || {};
      const an = bp.anchors || {};
      const dim = bp.dimensions || {};
      const roi = t.b > 0 ? (t.s / t.b - 1) * 100 : null;
      rows.push({
        win: w.k, tok, roi: roi !== null ? +roi.toFixed(1) : null, pnl: +(t.s - t.b).toFixed(4),
        shape: dim.entry_shape && dim.entry_shape.bucket,
        chg5: an.chg5Pct, idle: an.actIdlePct, tvm: an.totalVolumeBnb,
        sbw: (m.cheatCheck && m.cheatCheck.levels && m.cheatCheck.levels.stallBurstWave) ?? (m.actFrontGate && m.actFrontGate.sbw),
      });
    }
  }
  const avg = a => a.length ? (a.reduce((x, r) => x + r.roi, 0) / a.length) : 0;
  const med = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
  const grp = (name, g) => {
    if (!g.length) { console.log(`  ${name}: 无`); return; }
    console.log(`  ${name}: ${String(g.length).padStart(3)}票 | 平均收益率 ${avg(g).toFixed(1).padStart(7)}% | 中位 ${med(g.map(r=>r.roi)).toFixed(1).padStart(7)}% | 胜率 ${(g.filter(r=>r.roi>0).length/g.length*100).toFixed(0)}% | pnlΣ ${g.reduce((x,r)=>x+r.pnl,0).toFixed(3)}`);
  };
  console.log('== 全体（四窗 390 成交票，收益率=Σ卖/Σ买−1 per 票）==');
  for (const [lo, hi] of [[0, 15], [15, 25], [25, 35], [35, 999]]) {
    grp(`锚chg5 [${lo},${hi})`, rows.filter(r => typeof r.chg5 === 'number' && r.chg5 >= lo && r.chg5 < hi));
  }
  console.log('\n== spike 桶内 ==');
  const sp = rows.filter(r => r.shape === 'spike');
  for (const [lo, hi] of [[0, 15], [15, 25], [25, 35], [35, 999]]) {
    grp(`锚chg5 [${lo},${hi})`, sp.filter(r => typeof r.chg5 === 'number' && r.chg5 >= lo && r.chg5 < hi));
  }
  console.log('\n== 薄盘 tvm<3 ==');
  const thin = rows.filter(r => typeof r.tvm === 'number' && r.tvm < 3);
  for (const [lo, hi] in [[0, 15], [15, 25], [25, 35], [35, 999]]) {}
  for (const [lo, hi] of [[0, 15], [15, 25], [25, 35], [35, 999]]) {
    grp(`锚chg5 [${lo},${hi})`, thin.filter(r => typeof r.chg5 === 'number' && r.chg5 >= lo && r.chg5 < hi));
  }
  console.log('\n== 重点票收益率 ==');
  for (const r of rows.filter(r => ['0x577c885d', '0x583a37e3', '0xefbd24cf', '0xba5ed45b', '0xc97a6ea7', '0xc283bf2b', '0x388918ae'].some(p => r.tok.startsWith(p)))) {
    console.log(`  ${r.win} ${r.tok.slice(0, 10)} roi=${r.roi}% shape=${r.shape} chg5=${r.chg5} sbw=${r.sbw}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
