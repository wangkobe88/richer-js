// 排除「现行 v22 门串已会挡」的票后，重跑真口径分析
const { dbManager } = require('../src/services/dbManager.js');
const fs = require('fs');
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
  const rows = JSON.parse(fs.readFileSync(__dirname + '/../data/tmp-launch-real.json', 'utf8'))
    .filter((r) => r.firstBlockBnb != null);
  // 补拉快照判定键（每票首窗 executed）
  const snap = new Map();
  for (const [name, id] of WINDOWS) {
    let sigs = [];
    for (let off = 0; off < 3000; off += 1000) {
      const { data } = await c.from('strategy_signals')
        .select('token_address,signal_type,metadata')
        .eq('experiment_id', id).eq('signal_type', 'BUY').range(off, off + 999);
      sigs = sigs.concat(data || []);
      if (!data || data.length < 1000) break;
    }
    for (const s of sigs) {
      const md = s.metadata || {};
      if (md.execution_status !== 'executed' || snap.has(s.token_address)) continue;
      const tf = md.trendFactors || {};
      snap.set(s.token_address, {
        clu: tf.launchBundleClusterSize != null ? Number(tf.launchBundleClusterSize) : null,
        f0: tf.launchFirstBlockWallets != null ? Number(tf.launchFirstBlockWallets) : null,
        wave: tf.launchFirstWaveWallets != null ? Number(tf.launchFirstWaveWallets) : null,
        constVs: tf.launchConstVsPct != null ? Number(tf.launchConstVsPct) : null,
        pbtal: tf.priceBackToAlmostLaunch != null ? Number(tf.priceBackToAlmostLaunch) : null,
      });
    }
  }
  let nBlock = 0, nExempt = 0;
  const kept = [];
  for (const r of rows) {
    const s = snap.get(r.addr) || {};
    const orgKeys = s.clu != null || s.f0 != null || s.wave != null;
    r.v22 = 'PASS';
    if (orgKeys && r.age != null) {
      const exempt = (s.constVs != null && s.constVs <= 0) || s.pbtal === 1;
      if (exempt) r.v22 = 'EXEMPT';
      else if (r.age <= 60) {
        const blocked = (s.clu != null && s.clu >= 3) || (s.f0 != null && s.f0 >= 2) || (s.wave != null && s.wave >= 3);
        if (blocked) r.v22 = 'BLOCKED';
      }
    }
    if (r.v22 === 'BLOCKED') nBlock++;
    else { kept.push(r); if (r.v22 === 'EXEMPT') nExempt++; }
  }
  console.log(`样本 ${rows.length} → 排除 v22 BLOCKED ${nBlock}（其中豁免保留 ${nExempt}）→ 靶面 ${kept.length} 票`);
  const bucket = (label, keyFn, edges, sub) => {
    const rs = sub || kept;
    const out = edges.map(() => ({ n: 0, sum: 0, win: 0 }));
    for (const f of rs) {
      const v = keyFn(f);
      if (v == null || !Number.isFinite(v)) continue;
      let bi = edges.findIndex((e) => v < e);
      if (bi < 0) bi = edges.length - 1;
      const o = out[bi]; o.n++; o.sum += f.net; if (f.net > 0) o.win++;
    }
    console.log(`${label}: ` + out.map((o, i) => `${i === 0 ? '<' + edges[0] : (i === edges.length - 1 ? '>=' + edges[edges.length - 2] : '[' + edges[i - 1] + ',' + edges[i] + ')')}:${o.n}票 ${o.sum >= 0 ? '+' : ''}${o.sum.toFixed(2)} 胜${o.win}/${o.n}${o.n ? '均' + (o.sum / o.n * 1000).toFixed(1) : ''}`).join(' | '));
  };
  console.log('\n== ① 首块额（靶面）==');
  bucket('首块额 ', (f) => f.firstBlockBnb, [0.3, 0.8, 2, 1e9]);
  console.log('== ② 首波单笔 max（靶面）==');
  bucket('单笔max', (f) => f.waveMaxSingle, [0.2, 0.4, 0.8, 1e9]);
  console.log('== ③ 首波钱包 60s 卖出（靶面）==');
  bucket('waveSell', (f) => f.waveWalletSell60, [0.5, 1.5, 3, 1e9]);
  console.log('== ④ 负期望格复检：单笔 max>=0.4 × 承接比（靶面）==');
  const hi = kept.filter((f) => f.waveMaxSingle >= 0.4 && f.waveWalletSell60 > 0);
  for (const [l, lo, hiB] of [['承接比<1', null, 1], ['承接比[1,3)', 1, 3], ['承接比>=3', 3, null]]) {
    const sub = hi.filter((f) => { const ratio = f.followBuy60 / Math.max(f.waveWalletSell60, 0.3); return (lo == null || ratio >= lo) && (hiB == null || ratio < hiB); });
    const s2 = sub.reduce((x, y) => x + y.net, 0);
    console.log(`  ${l}: ${sub.length}票 ${s2 >= 0 ? '+' : ''}${s2.toFixed(2)} 胜${sub.filter((f) => f.net > 0).length}/${sub.length}${sub.length ? ' 均' + (s2 / sub.length * 1000).toFixed(1) : ''}`);
  }
  // 负格逐窗稳定性
  console.log('== 负格（max>=0.4 ∧ 承接比[1,3)）逐窗 ==');
  for (const w of WINDOWS.map((x) => x[0])) {
    const sub = hi.filter((f) => f.win === w) .filter((f) => { const ratio = f.followBuy60 / Math.max(f.waveWalletSell60, 0.3); return ratio >= 1 && ratio < 3; });
    const s2 = sub.reduce((x, y) => x + y.net, 0);
    if (sub.length) console.log(`  ${w}: ${sub.length}票 ${s2 >= 0 ? '+' : ''}${s2.toFixed(3)}`);
  }
  // 排除名单摘要
  console.log('\n== 被排除的 BLOCKED 票 ==');
  for (const r of rows.filter((x) => x.v22 === 'BLOCKED')) console.log(`  ${r.sym} ${r.addr.slice(0, 10)} ${r.win} 净${r.net >= 0 ? '+' : ''}${r.net.toFixed(3)} 首块${r.firstBlockBnb} max${r.waveMaxSingle} age=${r.age}`);
  fs.writeFileSync(__dirname + '/../data/tmp-launch-real.json', JSON.stringify(rows)); // 回写判定供后续用
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
