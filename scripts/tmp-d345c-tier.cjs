const { dbManager } = require('../src/services/dbManager.js');
const EXPS = { d345b: 'c73b62be-bb1d-4acf-8002-652e5fb8a507', d345c: '2fe55b27-e275-4792-b3bd-e815bb045be8' };
async function pullAll(table, expId) {
  const c = await dbManager.getClient(); const out = []; let from = 0;
  for (;;) { const { data, error } = await c.from(table).select('*').eq('experiment_id', expId).order('id').range(from, from + 999);
    if (error) throw new Error(error.message); out.push(...data); if (data.length < 1000) break; from += 1000; }
  return out;
}
async function load(id) {
  const trades = await pullAll('trades', id);
  const sigs = await pullAll('strategy_signals', id);
  const stall = sigs.filter(s => /流动性止损/.test(s.reason || ''));
  const byToken = new Map();
  for (const t of trades) { if (!t.success) continue;
    let st = byToken.get(t.token_address); if (!st) { st = { net: 0 }; byToken.set(t.token_address, st); }
    const b = t.trade_direction === 'buy' ? Number(t.input_amount) : Number(t.output_amount);
    if (isFinite(b)) st.net += t.trade_direction === 'buy' ? -b : b; }
  return { byToken, stall };
}
(async () => {
  const B = await load(EXPS.d345b), C = await load(EXPS.d345c);
  const grp = {};
  for (const s of B.stall) {
    const addr = s.token_address;
    const d = (C.byToken.get(addr)?.net ?? 0) - (B.byToken.get(addr)?.net ?? 0);
    if (Math.abs(d) < 1e-9) continue;
    const cs = C.stall.filter(x => x.token_address === addr);
    const tier = cs.length ? ((cs[cs.length-1].metadata||{}).stallClose||{}).tier ?? 'null_' : 'nosell';
    grp[tier] = grp[tier] || { n: 0, sum: 0, pos: 0, neg: 0 };
    grp[tier].n++; grp[tier].sum += d; if (d > 0) grp[tier].pos++; else grp[tier].neg++;
  }
  console.log('档位分组（d345b 断流卖出票在 d345c 的净差）:');
  for (const [k, v] of Object.entries(grp)) console.log(`  ${k}: n=${v.n} Σ=${v.sum.toFixed(4)} 正${v.pos}/负${v.neg}`);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
