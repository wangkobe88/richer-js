// 40 票（首块额>=2）逐票评 v22 门串：挡 = age<=60 ∧ (clu>=3 ∨ f0>=2 ∨ wave>=3) ∧ 非经历过破发
// 豁免近似（minVs 快照无键）：launchConstVsPct<=0 ∨ priceBackToAlmostLaunch==1（宽近似=多豁免）
const { dbManager } = require('../src/services/dbManager.js');
const WINDOWS = [
  ['v109', '029bd863-55e5-4319-91d5-10803a6a9a82'],
  ['v121', '54dac9c5-6fdf-4759-8b5a-2195313b6820'],
  ['v123', 'f454a704-706e-48d4-8049-6f885f9ae46b'],
  ['v129', '4af09d63-1ce1-4987-9c31-baf78c5a5334'],
  ['v132', 'b67b7318-1715-443d-a29b-7919b2db6e65'],
  ['v133', '550f9e89-1deb-49af-98b9-9906265b1161'],
  ['v134', '19ef6433-0c92-47ff-a6fd-9f6bea745b8d'],
];
async function main() {
  const c = await dbManager.getClient();
  const rows = []; const seenTok = new Set();
  const cov = {};
  for (const [name, id] of WINDOWS) {
    const { data: tr } = await c.from('trades')
      .select('token_address,trade_direction,input_currency,input_amount,output_currency,output_amount,success')
      .eq('experiment_id', id).range(0, 999);
    const m = new Map();
    for (const t of tr || []) {
      if (t.success === false) continue;
      const buy = t.trade_direction === 'buy';
      const v = buy ? (t.input_currency === 'BNB' ? Number(t.input_amount || 0) : Number(t.output_amount || 0))
        : (t.output_currency === 'BNB' ? Number(t.output_amount || 0) : Number(t.input_amount || 0));
      let e = m.get(t.token_address);
      if (!e) { e = { b: 0, s: 0 }; m.set(t.token_address, e); }
      if (buy) e.b += v; else e.s += v;
    }
    let sigs = [];
    for (let off = 0; off < 3000; off += 1000) {
      const { data } = await c.from('strategy_signals')
        .select('token_address,signal_type,metadata,token_symbol')
        .eq('experiment_id', id).eq('signal_type', 'BUY').range(off, off + 999);
      sigs = sigs.concat(data || []);
      if (!data || data.length < 1000) break;
    }
    const seen = new Set();
    for (const s of sigs) {
      const md = s.metadata || {};
      if (md.execution_status !== 'executed' || seen.has(s.token_address)) continue;
      seen.add(s.token_address);
      if (seenTok.has(s.token_address)) continue;
      seenTok.add(s.token_address);
      const e = m.get(s.token_address); if (!e) continue;
      const tf = md.trendFactors || {};
      const bv = Number(tf.buyVolumeBnb) || 0;
      const fs = Number(tf.firstBlockBuyShare);
      const amt = Number.isFinite(fs) ? bv * fs : null;
      if (amt == null || amt < 2) continue;
      cov[name] = cov[name] || { n: 0, clu: 0, f0: 0, wave: 0, constVs: 0, pbtal: 0 };
      const k = cov[name]; k.n++;
      for (const key of ['launchBundleClusterSize', 'launchFirstBlockWallets', 'launchFirstWaveWallets', 'launchConstVsPct', 'priceBackToAlmostLaunch']) {
        if (tf[key] != null) k[key === 'launchBundleClusterSize' ? 'clu' : key === 'launchFirstBlockWallets' ? 'f0' : key === 'launchFirstWaveWallets' ? 'wave' : key === 'launchConstVsPct' ? 'constVs' : 'pbtal']++;
      }
      rows.push({
        addr: s.token_address, sym: s.token_symbol || '?', win: name, exp: id, net: e.s - e.b, amt,
        age: tf.tokenAgeSec != null ? Number(tf.tokenAgeSec) : null,
        clu: tf.launchBundleClusterSize != null ? Number(tf.launchBundleClusterSize) : null,
        f0: tf.launchFirstBlockWallets != null ? Number(tf.launchFirstBlockWallets) : null,
        wave: tf.launchFirstWaveWallets != null ? Number(tf.launchFirstWaveWallets) : null,
        constVs: tf.launchConstVsPct != null ? Number(tf.launchConstVsPct) : null,
        pbtal: tf.priceBackToAlmostLaunch != null ? Number(tf.priceBackToAlmostLaunch) : null,
      });
    }
  }
  console.log('== 各窗快照键覆盖（40 票内）==');
  for (const [w, k] of Object.entries(cov)) console.log(`${w}: n=${k.n} clu=${k.clu} f0=${k.f0} wave=${k.wave} constVs=${k.constVs} pbtal=${k.pbtal}`);

  // v22 判定
  for (const r of rows) {
    const orgKeys = r.clu != null || r.f0 != null || r.wave != null;
    if (!orgKeys || r.age == null) { r.verdict = 'NOKEY'; continue; }
    const exempt = (r.constVs != null && r.constVs <= 0) || r.pbtal === 1; // 宽近似豁免
    if (exempt) { r.verdict = 'EXEMPT(破发)'; continue; }
    if (r.age > 60) { r.verdict = 'PASS(age>60)'; continue; }
    const blocked = (r.clu != null && r.clu >= 3) || (r.f0 != null && r.f0 >= 2) || (r.wave != null && r.wave >= 3);
    r.verdict = blocked ? 'BLOCKED' : 'PASS';
  }
  const g = (v2) => rows.filter((r) => r.verdict === v2);
  const sum = (a) => a.reduce((s, r) => s + r.net, 0);
  const bl = g('BLOCKED'), pa = [...g('PASS'), ...g('PASS(age>60)'), ...g('EXEMPT(破发)')], nk = g('NOKEY');
  rows.sort((a, b) => b.amt - a.amt);
  console.log(`\n== v22 门串判定（40 票，豁免为宽近似）==`);
  console.log(`BLOCKED（现行 v22 已会挡）: ${bl.length} 票 净额 ${sum(bl).toFixed(4)}`);
  for (const r of bl) console.log(`  ${r.sym} ${r.addr.slice(0, 10)} ${r.win} 净${r.net >= 0 ? '+' : ''}${r.net.toFixed(4)} 首块${r.amt.toFixed(2)} age=${r.age} clu=${r.clu} f0=${r.f0} wave=${r.wave}`);
  console.log(`PASS+EXEMPT（v22 仍会放行 = 额度门真实靶面）: ${pa.length} 票 净额 ${sum(pa).toFixed(4)}`);
  for (const r of [...pa].sort((a, b) => a.net - b.net)) console.log(`  ${r.sym} ${r.addr.slice(0, 10)} ${r.win} ${r.verdict} 净${r.net >= 0 ? '+' : ''}${r.net.toFixed(4)} 首块${r.amt.toFixed(2)} age=${r.age} clu=${r.clu} f0=${r.f0} wave=${r.wave}`);
  console.log(`NOKEY（快照无键，无法判）: ${nk.length} 票 净额 ${sum(nk).toFixed(4)}`);
  for (const r of nk) console.log(`  ${r.sym} ${r.addr.slice(0, 10)} ${r.win} 净${r.net >= 0 ? '+' : ''}${r.net.toFixed(4)} 首块${r.amt.toFixed(2)} age=${r.age}`);
  const paWin = pa.filter((r) => r.net > 0).length;
  console.log(`\n靶面统计: ${pa.length} 票 净额 ${sum(pa) >= 0 ? '+' : ''}${sum(pa).toFixed(4)} 胜${paWin}/${pa.length}${pa.length ? ' 均' + (sum(pa) / pa.length * 1000).toFixed(1) + '×1e-3/票' : ''}`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
