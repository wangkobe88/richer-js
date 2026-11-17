// 跨窗验证：actTotalBnb / tokenAgeSec / 组合面 分桶在 bt-v121/123/129/132/134(v19ef) 五窗的净额
const { dbManager } = require('../src/services/dbManager.js');
async function main() {
  const c = await dbManager.getClient();
  const { data: exps } = await c.from('experiments')
    .select('id,experiment_name')
    .in('id', [
      '19ef6433-0c92-47ff-a6fd-9f6bea745b8d', // bt-v134 fp2-early33h（本窗）
      '550f9e89-1deb-49af-98b9-9906265b1161', // bt-v133 fp2 首窗
      'b67b7318-1715-443d-a29b-7919b2db6e65', // bt-v132 factor-prebuy-v2
      '4af09d63-1ce1-4987-9c31-baf78c5a5334', // bt-v129 v21 D 窗
      '54dac9c5-6fdf-4759-8b5a-2195313b6820', // bt-v121 A 窗
      'f454a704-706e-48d4-8049-6f885f9ae46b', // bt-v123 B 窗
      '029bd863-55e5-4319-91d5-10803a6a9a82', // bt-v109 27h 长窗
    ]);
  const idOf = {};
  for (const e of exps || []) idOf[e.experiment_name] = e.id;
  console.log('windows:', JSON.stringify(idOf));

  for (const [name, id] of Object.entries(idOf)) {
    const { data: rows } = await c.from('trades')
      .select('token_address,trade_direction,input_currency,input_amount,output_currency,output_amount,success')
      .eq('experiment_id', id).range(0, 999);
    const m = new Map();
    for (const t of rows || []) {
      if (t.success === false) continue;
      const buy = t.trade_direction === 'buy';
      const v = buy ? (t.input_currency === 'BNB' ? Number(t.input_amount || 0) : Number(t.output_amount || 0))
        : (t.output_currency === 'BNB' ? Number(t.output_amount || 0) : Number(t.input_amount || 0));
      let e = m.get(t.token_address);
      if (!e) { e = { b: 0, s: 0 }; m.set(t.token_address, e); }
      if (buy) e.b += v; else e.s += v;
    }
    const netOf = (a) => { const e = m.get(a); return e ? e.s - e.b : null; };
    let all = [];
    for (let off = 0; off < 3000; off += 1000) {
      const { data } = await c.from('strategy_signals')
        .select('token_address,signal_type,metadata')
        .eq('experiment_id', id).eq('signal_type', 'BUY').range(off, off + 999);
      all = all.concat(data || []);
      if (!data || data.length < 1000) break;
    }
    const seen = new Set(); const feats = [];
    for (const s of all) {
      const md = s.metadata || {};
      if (md.execution_status !== 'executed' || seen.has(s.token_address)) continue;
      seen.add(s.token_address);
      const n2 = netOf(s.token_address); if (n2 == null) continue;
      feats.push({ net: n2, tf: md.trendFactors || {} });
    }
    const tot = feats.reduce((s2, f) => s2 + f.net, 0);
    const agg = (label, pred) => {
      const hit = feats.filter((f) => pred(f.tf));
      const sum = hit.reduce((s2, f) => s2 + f.net, 0);
      const win = hit.filter((f) => f.net > 0).length;
      console.log(`  ${label}: ${hit.length} 票 ${sum >= 0 ? '+' : ''}${sum.toFixed(4)} 胜${win}/${hit.length}`);
    };
    console.log(`\n===== ${name}（executed ${feats.length} 票 总额 ${tot >= 0 ? '+' : ''}${tot.toFixed(4)}）=====`);
    agg('actTotalBnb>=1.2 ', (t) => Number(t.actTotalBnb) >= 1.2);
    agg('actTotalBnb>=0.6<1.2', (t) => { const v2 = Number(t.actTotalBnb); return v2 >= 0.6 && v2 < 1.2; });
    agg('actTotalBnb<0.6    ', (t) => Number(t.actTotalBnb) < 0.6);
    agg('age 15-60          ', (t) => { const a = Number(t.tokenAgeSec); return a >= 15 && a < 60; });
    agg('age>=60            ', (t) => Number(t.tokenAgeSec) >= 60);
    agg('age<60 & act>=1.2  ', (t) => Number(t.tokenAgeSec) < 60 && Number(t.actTotalBnb) >= 1.2);
    agg('age>=60 & act>=1.2 ', (t) => Number(t.tokenAgeSec) >= 60 && Number(t.actTotalBnb) >= 1.2);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
