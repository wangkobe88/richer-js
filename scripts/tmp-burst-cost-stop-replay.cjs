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
      const tf = m.trendFactors || {};
      const shape = dim.entry_shape && dim.entry_shape.bucket;
      const chg5 = an.chg5Pct;
      if (shape !== 'spike' && !(typeof chg5 === 'number' && chg5 >= 25)) continue;
      rows.push({
        win: w.k, tok, buyT: s.created_at, pnl: +(t.s - t.b).toFixed(4), roi: (t.s / t.b - 1) * 100,
        // 破发切片原料
        fireMinVsFloor: tf.launchMinVsFloorPct,          // FA T142: 滚动最低 vs 地板（≤0=经历过破发）
        bpMinVs: an.minVsLaunchPct,                       // BP: 涨起后最低 vs 发行价（≤5=前期筹码清零近发行价）
        curVs: an.currentVsLaunchPct,
      });
    }
  }
  console.log('票数:', rows.length);

  // ===== B: 破发切片 =====
  const grp = (name, g) => {
    if (!g.length) { console.log(name, ': 无'); return; }
    const pnl = g.reduce((x, r) => x + r.pnl, 0);
    const rois = g.map(r => r.roi).sort((a, b) => a - b);
    const med = rois[(rois.length - 1) >> 1];
    const avg = rois.reduce((a, b) => a + b, 0) / rois.length;
    console.log(`${name}: ${g.length} 票 | pnlΣ ${pnl.toFixed(4).padStart(8)} | 胜率 ${(g.filter(r => r.roi > 0).length / g.length * 100).toFixed(0)}% | roi 均 ${avg.toFixed(1)}% 中位 ${med.toFixed(1)}% | 最好 ${rois[rois.length - 1].toFixed(0)}% 最差 ${rois[0].toFixed(0)}%`);
  };
  console.log('\n== B: 破发切片（fire 快照 launchMinVsFloorPct）==');
  grp('  破发过 (≤0)', rows.filter(r => typeof r.fireMinVsFloor === 'number' && r.fireMinVsFloor <= 0));
  grp('  未破发 (>0)', rows.filter(r => typeof r.fireMinVsFloor === 'number' && r.fireMinVsFloor > 0));
  grp('  无值', rows.filter(r => typeof r.fireMinVsFloor !== 'number'));
  console.log('\n== B2: BP 涨起后最低切片（minVsLaunchPct ≤5 = 前期清零近发行价）==');
  grp('  清零过 (≤5)', rows.filter(r => typeof r.bpMinVs === 'number' && r.bpMinVs <= 5));
  grp('  清零过 (≤0)', rows.filter(r => typeof r.bpMinVs === 'number' && r.bpMinVs <= 0));
  grp('  未清零 (>5)', rows.filter(r => typeof r.bpMinVs === 'number' && r.bpMinVs > 5));
  // 三赢家落位
  console.log('\n三主案+三赢家落位:');
  for (const p of ['0x2f17249e', '0x40efb3d5', '0xba5ed45b', '0x577c885d', '0x583a37e3', '0x6bd2cd2e']) {
    const r = rows.find(x => x.tok.startsWith(p));
    if (r) console.log(`  ${r.tok.slice(0, 10)} roi=${r.roi.toFixed(1)}% fireMinVsFloor=${r.fireMinVsFloor} bpMinVs=${r.bpMinVs}`);
  }

  // ===== A: 成本基准止损回放 =====
  const Xs = [5, 8, 10, 12, 15, 20];
  const results = {};
  let loaded = 0;
  for (const r of rows) {
    const { data: ticks, error } = await sb.from('wss_price_ticks')
      .select('block_time,price_bnb')
      .eq('token_address', r.tok)
      .gte('block_time', r.buyT)
      .order('block_time', { ascending: true }).limit(1000);
    if (error || !ticks || ticks.length < 2) continue;
    loaded++;
    const fireP = Number(ticks[0].price_bnb);
    if (!(fireP > 0)) continue;
    r.fireP = fireP;
    for (const X of Xs) {
      const stopP = fireP * (1 - X / 100);
      let trigP = null, trigT = null;
      for (const tk of ticks.slice(1)) {
        const p = Number(tk.price_bnb);
        if (p > 0 && p <= stopP) { trigP = p; trigT = tk.block_time; break; }
      }
      if (!results[X]) results[X] = [];
      results[X].push({ ...r, trigP, trigT, simPnl: trigP !== null ? +((trigP / fireP - 1) * 0.2).toFixed(4) : r.pnl });
    }
  }
  const actual = rows.filter(r => r.fireP).reduce((x, r) => x + r.pnl, 0);
  console.log(`\n== A: 成本基准止损（买入价回撤 X% 全卖，触发价成交）== 回放 ${loaded} 票，实际 pnlΣ ${actual.toFixed(4)}`);
  for (const X of Xs) {
    const g = results[X] || [];
    if (!g.length) continue;
    const trig = g.filter(r => r.trigP !== null);
    const simTotal = g.reduce((x, r) => x + r.simPnl, 0);
    const delta = simTotal - actual;
    const better = trig.filter(r => r.simPnl > r.pnl), worse = trig.filter(r => r.simPnl <= r.pnl);
    const betterSum = better.reduce((x, r) => x + (r.simPnl - r.pnl), 0);
    const worseSum = worse.reduce((x, r) => x + (r.simPnl - r.pnl), 0);
    console.log(`X=${X}%: 触发 ${String(trig.length).padStart(3)}/${g.length} | Δ净 ${delta >= 0 ? '+' : ''}${delta.toFixed(4)} | 改善 ${better.length} 票 +${betterSum.toFixed(3)} / 恶化 ${worse.length} 票 ${worseSum.toFixed(3)} | 恶化最大: ${[...worse].sort((a, b) => (a.simPnl - a.pnl) - (b.simPnl - b.pnl)).slice(0, 3).map(r => r.tok.slice(0, 8) + (r.simPnl - r.pnl).toFixed(3)).join(' ')}`);
  }
  // X=10 触发明细
  console.log('\n== X=10% 触发票 ==');
  for (const r of (results[10] || []).filter(r => r.trigP !== null).sort((a, b) => (a.simPnl - a.pnl) - (b.simPnl - b.pnl))) {
    console.log(`  ${r.win} ${r.tok.slice(0, 10)} 实际${r.pnl.toFixed(4)} → 模拟${r.simPnl.toFixed(4)} (Δ${(r.simPnl - r.pnl >= 0 ? '+' : '') + (r.simPnl - r.pnl).toFixed(4)}) @${r.trigT && r.trigT.slice(11, 19)}`);
  }
  // 三赢家在 X 档
  console.log('\n三赢家各档:');
  for (const p of ['0x2f17249e', '0x40efb3d5', '0xba5ed45b']) {
    const line = [];
    for (const X of Xs) {
      const r = (results[X] || []).find(x => x.tok.startsWith(p));
      if (r) line.push(`X${X}:${r.trigP !== null ? r.simPnl.toFixed(3) + '触发' : r.pnl.toFixed(3) + '持有'}`);
    }
    console.log(' ', p, '实际', rows.find(x => x.tok.startsWith(p)).pnl, '|', line.join(' '));
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
