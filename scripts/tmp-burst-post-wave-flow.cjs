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
  // per 票：burst 窗（fire 前 60s 最密 5s）末 + 后 60s 流量 + 观测窗末价
  let okN = 0;
  for (const r of rows) {
    const sinceMs = new Date(r.buyT).getTime() - 60000;
    const { data: ticks, error } = await sb.from('wss_price_ticks')
      .select('block_time,price_bnb,bnb_amount,trade_type')
      .eq('token_address', r.tok)
      .gte('block_time', new Date(sinceMs).toISOString())
      .order('block_time', { ascending: true }).limit(1200);
    if (error || !ticks || ticks.length < 3) continue;
    const arr = ticks.map(t => ({ ms: new Date(t.block_time).getTime(), p: Number(t.price_bnb), bnb: Number(t.bnb_amount), side: t.trade_type })).filter(t => t.p > 0);
    if (!arr.length) continue;
    // densest 5s（不限方向，全部 tick）
    let best = { n: 0 };
    for (let i = 0; i < arr.length; i++) {
      let n = 0;
      for (let j = i; j < arr.length && arr[j].ms - arr[i].ms <= 5000; j++) n++;
      if (n > best.n) best = { n, i };
    }
    if (!best.n) continue;
    let endMs = arr[best.i].ms;
    for (let j = best.i; j < arr.length && arr[j].ms - arr[best.i].ms <= 5000; j++) endMs = arr[j].ms;
    r.burstN = best.n;
    r.burstBuyBnb = arr.filter(t => t.ms >= arr[best.i].ms && t.ms <= endMs && t.side === 'buy').reduce((x, t) => x + t.bnb, 0);
    // fire 价
    const fireT = new Date(r.buyT).getTime();
    const fireTick = arr.find(t => t.ms >= fireT) || arr[arr.length - 1];
    r.fireP = fireTick.p;
    // 观测窗 [burst末+5s, burst末+65s]（+5s 避开波尾延续）
    const w0 = endMs + 5000, w1 = endMs + 65000;
    const win = arr.filter(t => t.ms > w0 && t.ms <= w1);
    r.tickN60 = win.length;
    r.buyN60 = win.filter(t => t.side === 'buy').length;
    r.buyBnb60 = +win.filter(t => t.side === 'buy').reduce((x, t) => x + t.bnb, 0).toFixed(3);
    r.sellBnb60 = +win.filter(t => t.side !== 'buy').reduce((x, t) => x + t.bnb, 0).toFixed(3);
    // 观测窗末价（或窗内最后价）
    const lastTick = win.length ? win[win.length - 1] : null;
    r.exitP = lastTick ? lastTick.p : null;
    r.exitMs = lastTick ? lastTick.ms : null;
    if (r.exitP) okN++;
  }
  console.log('有效票:', okN, '/', rows.length);

  // 三赢家+三主案落位
  console.log('\n== 关键票落位（burst 后 60s 流量窗）==');
  console.log('token         | roi%   | 波N | 波买B  | 后60s: tick/买笔/买B/卖B | 窗末价vs fire');
  for (const p of ['0x2f17249e', '0x40efb3d5', '0xba5ed45b', '0xefbd24cf', '0x577c885d', '0x583a37e3', '0x6bd2cd2e', '0x531ddef1']) {
    const r = rows.find(x => x.tok.startsWith(p));
    if (!r || !r.exitP) { console.log(p, '无数据'); continue; }
    console.log(`${r.tok.slice(0, 10)} | ${String(r.roi.toFixed(1)).padStart(6)}% | ${String(r.burstN).padStart(2)} | ${r.burstBuyBnb.toFixed(2)} | ${String(r.tickN60).padStart(3)}/${String(r.buyN60).padStart(2)}/${r.buyBnb60.toFixed(2)}B/${r.sellBnb60.toFixed(2)}B | ${((r.exitP / r.fireP - 1) * 100).toFixed(1)}%`);
  }

  // 流量分布 vs pnl 分桶
  const grp = (name, g) => {
    if (!g.length) { console.log(name, '无'); return; }
    const pnl = g.reduce((x, r) => x + r.pnl, 0);
    console.log(`${name}: ${String(g.length).padStart(2)} 票 | pnlΣ ${pnl.toFixed(4).padStart(8)} | 胜率 ${(g.filter(r => r.roi > 0).length / g.length * 100).toFixed(0)}% | roi 均 ${(g.reduce((x, r) => x + r.roi, 0) / g.length).toFixed(1)}%`);
  };
  console.log('\n== burst 后 60s 买额分桶 ==');
  for (const [lo, hi] of [[0, 0.1], [0.1, 0.3], [0.3, 1], [1, 999]]) {
    grp(`  买额 [${lo},${hi})B`, rows.filter(r => r.exitP && r.buyBnb60 >= lo && r.buyBnb60 < hi));
  }
  console.log('\n== burst 后 60s tick 数分桶 ==');
  for (const [lo, hi] of [[0, 5], [5, 15], [15, 40], [40, 999]]) {
    grp(`  tick [${lo},${hi})`, rows.filter(r => r.exitP && r.tickN60 >= lo && r.tickN60 < hi));
  }

  // 模拟规则：观测窗末若 buyBnb60<X → 以窗末价全卖；否则保持实际
  const actual = rows.filter(r => r.exitP).reduce((x, r) => x + r.pnl, 0);
  console.log(`\n== 模拟规则（burst后60s 买额<X → 窗末价全卖）实际Σ ${actual.toFixed(4)} ==`);
  for (const X of [0.1, 0.2, 0.3, 0.5, 1.0]) {
    const g = rows.filter(r => r.exitP);
    const trig = g.filter(r => r.buyBnb60 < X);
    const sim = g.map(r => r.buyBnb60 < X ? (r.exitP / r.fireP - 1) * 0.2 : r.pnl);
    const simTotal = sim.reduce((a, b) => a + b, 0);
    const delta = simTotal - actual;
    const better = trig.filter(r => (r.exitP / r.fireP - 1) * 0.2 > r.pnl);
    const worse = trig.filter(r => (r.exitP / r.fireP - 1) * 0.2 <= r.pnl);
    console.log(`X=${X}B: 触发 ${String(trig.length).padStart(2)}/${g.length} | Δ净 ${delta >= 0 ? '+' : ''}${delta.toFixed(4)} | 改善 ${better.length} +${better.reduce((x, r) => x + ((r.exitP / r.fireP - 1) * 0.2 - r.pnl), 0).toFixed(3)} / 恶化 ${worse.length} ${worse.reduce((x, r) => x + ((r.exitP / r.fireP - 1) * 0.2 - r.pnl), 0).toFixed(3)} | 恶化最大: ${[...worse].sort((a, b) => ((a.exitP / a.fireP - 1) * 0.2 - a.pnl) - ((b.exitP / b.fireP - 1) * 0.2 - b.pnl)).slice(0, 3).map(r => r.tok.slice(0, 8) + (((r.exitP / r.fireP - 1) * 0.2 - r.pnl)).toFixed(3)).join(' ')}`);
  }
  // tick 数规则
  console.log('\n== 模拟规则（burst后60s tick<N → 窗末价全卖）==');
  for (const N of [3, 5, 10]) {
    const g = rows.filter(r => r.exitP);
    const trig = g.filter(r => r.tickN60 < N);
    const simTotal = g.map(r => r.tickN60 < N ? (r.exitP / r.fireP - 1) * 0.2 : r.pnl).reduce((a, b) => a + b, 0);
    const delta = simTotal - actual;
    const worse = trig.filter(r => (r.exitP / r.fireP - 1) * 0.2 <= r.pnl);
    console.log(`N=${N}tick: 触发 ${String(trig.length).padStart(2)}/${g.length} | Δ净 ${delta >= 0 ? '+' : ''}${delta.toFixed(4)} | 误杀 ${worse.length} ${worse.reduce((x, r) => x + ((r.exitP / r.fireP - 1) * 0.2 - r.pnl), 0).toFixed(3)} | 误杀明细: ${worse.map(r => r.tok.slice(0, 8) + '(' + r.pnl.toFixed(3) + '→' + ((r.exitP / r.fireP - 1) * 0.2).toFixed(3) + ')').join(' ')}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
