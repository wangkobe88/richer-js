// v133 vs v132 逐票归因+Jev 燃烧实测（182）
const { dbManager } = require('../src/services/dbManager.js');
async function expId(c, pre) { const { data } = await c.from('experiments').select('id').limit(500); return data.find((e) => e.id.startsWith(pre)).id; }
async function net(c, id) {
  let rows = [], from = 0;
  while (true) {
    const { data, error } = await c.from('trades').select('token_address,token_symbol,trade_direction,input_currency,input_amount,output_currency,output_amount,success').eq('experiment_id', id).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows = rows.concat(data); if (data.length < 1000) break; from += 1000;
  }
  const m = new Map();
  for (const t of rows) {
    if (t.success === false) continue;
    const buy = t.trade_direction === 'buy';
    const v = buy ? (t.input_currency === 'BNB' ? Number(t.input_amount || 0) : Number(t.output_amount || 0)) : (t.output_currency === 'BNB' ? Number(t.output_amount || 0) : Number(t.input_amount || 0));
    let e = m.get(t.token_address); if (!e) { e = { sym: t.token_symbol, buyBnb: 0, sellBnb: 0 }; m.set(t.token_address, e); }
    if (buy) e.buyBnb += v; else e.sellBnb += v;
  }
  for (const [, e] of m) e.net = e.sellBnb - e.buyBnb;
  return m;
}
async function main() {
  const c = await dbManager.getClient();
  const M = { v129: await net(c, await expId(c, '4af09d63')), v132: await net(c, await expId(c, 'b67b7318')), v133: await net(c, await expId(c, '550f9e89')) };
  for (const [k, m] of Object.entries(M)) { const a = [...m.values()]; console.log(`${k}: ${m.size} 票 net=${a.reduce((s, e) => s + e.net, 0).toFixed(4)} win=${a.filter((e) => e.net > 0).length}/${m.size}`); }
  const lost = [...M.v132.keys()].filter((k) => !M.v133.has(k));
  const gained = [...M.v133.keys()].filter((k) => !M.v132.has(k));
  const both = [...M.v132.keys()].filter((k) => M.v133.has(k));
  console.log(`\n== v132→v133 Newly-blocked ${lost.length} 票 ==`);
  for (const k of lost) console.log(`  v132净${fmt(M.v132.get(k).net)} v129${M.v129.has(k) ? fmt(M.v129.get(k).net) : '未买'}  ${sym(M.v132.get(k).sym)} ${k}`);
  console.log(`== v133 新进 ${gained.length} 票 ==`);
  for (const k of gained) console.log(`  v133净${fmt(M.v133.get(k).net)}  ${sym(M.v133.get(k).sym)} ${k}`);
  console.log(`== 共同 ${both.length} 张 漂移=${fmt(both.reduce((s, k) => s + M.v133.get(k).net - M.v132.get(k).net, 0))} ==`);
  // Jev 燃烧实测：v132 vs v133 的 cheat analyzed/BP usage 计数
  for (const [tag, pre] of [['v132', 'b67b7318'], ['v133', '550f9e89']]) {
    const { data: sigs } = await c.from('strategy_signals').select('metadata').eq('experiment_id', await expId(c, pre)).eq('signal_type', 'BUY').range(0, 1999);
    let cheat = 0, bp = 0, tok = 0;
    for (const s of sigs || []) {
      const cc = s.metadata && s.metadata.cheatCheck;
      if (cc && cc.status === 'analyzed') cheat++;
      const u = s.metadata && s.metadata.buyPoint && s.metadata.buyPoint.usage;
      if (u && u.input_tokens) { bp++; tok += (u.input_tokens + (u.output_tokens || 0)); }
    }
    console.log(`${tag} Jev 燃烧：cheat 16 题真烧=${cheat} 次 / BP=${bp} 次（${(tok / 1000).toFixed(0)}k tok）`);
  }
  function fmt(v) { return (v >= 0 ? '+' : '') + v.toFixed(4); }
  function sym(s) { return (s || '?').slice(0, 12); }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
