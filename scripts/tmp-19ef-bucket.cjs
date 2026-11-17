// bt-v134 (19ef6433)：①BP status×净额 ②per-leg 净额 ③候选因子分桶净额
const { dbManager } = require('../src/services/dbManager.js');
const EXP = '19ef6433-0c92-47ff-a6fd-9f6bea745b8d';
async function main() {
  const c = await dbManager.getClient();
  const { data: rows } = await c.from('trades')
    .select('token_address,token_symbol,trade_direction,input_currency,input_amount,output_currency,output_amount,success')
    .eq('experiment_id', EXP).range(0, 999);
  const m = new Map();
  for (const t of rows || []) {
    if (t.success === false) continue;
    const buy = t.trade_direction === 'buy';
    const v = buy ? (t.input_currency === 'BNB' ? Number(t.input_amount || 0) : Number(t.output_amount || 0))
      : (t.output_currency === 'BNB' ? Number(t.output_amount || 0) : Number(t.input_amount || 0));
    let e = m.get(t.token_address);
    if (!e) { e = { sym: t.token_symbol, buyBnb: 0, sellBnb: 0 }; m.set(t.token_address, e); }
    if (buy) e.buyBnb += v; else e.sellBnb += v;
  }
  const netOf = (a) => { const e = m.get(a); return e ? e.sellBnb - e.buyBnb : null; };
  let all = [];
  for (let off = 0; off < 3000; off += 1000) {
    const { data } = await c.from('strategy_signals')
      .select('token_address,signal_type,metadata')
      .eq('experiment_id', EXP).eq('signal_type', 'BUY').range(off, off + 999);
    all = all.concat(data || []);
    if (!data || data.length < 1000) break;
  }
  const exec = all.filter((s) => (s.metadata || {}).execution_status === 'executed');

  // ① BP status × 净额
  const bpMap = new Map();
  for (const s of exec) {
    const bp = (s.metadata || {}).buyPoint || {};
    const st = bp.status || '?';
    if (!bpMap.has(st)) bpMap.set(st, { n: 0, sum: 0, win: 0 });
    const e2 = bpMap.get(st); const n2 = netOf(s.token_address);
    if (n2 != null) { e2.n++; e2.sum += n2; if (n2 > 0) e2.win++; }
  }
  console.log('== ① executed 票 BP status ==');
  for (const [k, v] of bpMap) console.log(`${k}: ${v.n} 票 净额 ${v.sum >= 0 ? '+' : ''}${v.sum.toFixed(4)} 胜 ${v.win}/${v.n}`);

  // ② per-leg 净额（executed 信号按腿聚合，per-token 首腿归属避免重复计）
  const seen = new Set(); const legMap = new Map();
  for (const s of exec) {
    if (seen.has(s.token_address)) continue; seen.add(s.token_address);
    const md = s.metadata || {}; const leg = (md.signalGate || {}).legId || md.strategyId || '?';
    if (!legMap.has(leg)) legMap.set(leg, { n: 0, sum: 0, win: 0 });
    const e2 = legMap.get(leg); const n2 = netOf(s.token_address);
    if (n2 != null) { e2.n++; e2.sum += n2; if (n2 > 0) e2.win++; }
  }
  console.log('\n== ② per-leg（票归属首 exec 腿）==');
  for (const [k, v] of [...legMap.entries()].sort((a, b) => b[1].n - a[1].n)) console.log(`${k}: ${v.n} 票 净额 ${v.sum >= 0 ? '+' : ''}${v.sum.toFixed(4)} 胜 ${v.win}/${v.n}`);

  // ③ 候选因子分桶
  const feats = [];
  for (const s of exec) { const n2 = netOf(s.token_address); if (n2 == null) continue; feats.push({ net: n2, tf: (s.metadata || {}).trendFactors || {} }); }
  const bucket = (label, keyFn, edges) => {
    const bs = edges.map(() => ({ n: 0, sum: 0, win: 0 })); const miss = { n: 0, sum: 0, win: 0 };
    for (const f of feats) {
      const v2 = keyFn(f.tf); let bi = -1;
      if (v2 == null || !Number.isFinite(v2)) { miss.n++; miss.sum += f.net; if (f.net > 0) miss.win++; continue; }
      for (let i = 0; i < edges.length; i++) if (v2 < edges[i]) { bi = i; break; }
      if (bi < 0) bi = edges.length - 1;
      // 落在最后一个 edge 之后的进最后桶：修正——edges 为上界序列
    }
    // 重写：简单固定桶
    const out = edges.map(() => ({ n: 0, sum: 0, win: 0 }));
    for (const f of feats) {
      const v2 = keyFn(f.tf);
      if (v2 == null || !Number.isFinite(v2)) { miss.n++; miss.sum += f.net; if (f.net > 0) miss.win++; continue; }
      let bi = edges.findIndex((e3) => v2 < e3);
      if (bi < 0) bi = edges.length - 1;
      const o = out[bi]; o.n++; o.sum += f.net; if (f.net > 0) o.win++;
    }
    console.log(`${label}: ` + out.map((o, i) => `${i === 0 ? '<' + edges[0] : (i === edges.length - 1 ? '>=' + edges[edges.length - 2] : '[' + edges[i - 1] + ',' + edges[i] + ')')}:${o.n}票 ${o.sum >= 0 ? '+' : ''}${o.sum.toFixed(3)} 胜${o.win}/${o.n}`).join(' | ') + ` | null:${miss.n}票 ${miss.sum >= 0 ? '+' : ''}${miss.sum.toFixed(3)}`);
  };
  console.log('\n== ③ 候选因子分桶（executed 票净额）==');
  bucket('tokenAgeSec', (t) => t.tokenAgeSec, [15, 30, 60, 120, 1e9]);
  bucket('riseSpeed', (t) => t.riseSpeed, [1, 5, 15, 30, 1e9]);
  bucket('recentBlockDropPct', (t) => t.recentBlockDropPct, [3, 6, 12, 1e9]);
  bucket('actTotalBnb', (t) => t.actTotalBnb, [0.3, 0.6, 1.2, 3, 1e9]);
  bucket('tradesNetBuyRatioShortWin', (t) => t.tradesNetBuyRatioShortWin, [-100, 0, 40, 1e9]);
  bucket('buyVolumeBnb', (t) => t.buyVolumeBnb, [1.5, 2.5, 4, 1e9]);
  bucket('buyWallets', (t) => t.buyWallets, [8, 12, 20, 1e9]);
  bucket('currentVsLaunchPct', (t) => t.currentVsLaunchPct, [10, 18, 23, 28.5, 1e9]);
  bucket('holdersExDust', (t) => t.holdersExDust, [5, 8, 12, 1e9]);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
