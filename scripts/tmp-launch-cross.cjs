// 交叉表：首块买入总额 × 户均首块额 —— 分辨「额度卖压」vs「散户堆量」哪个是真轴
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
  const allRows = [];
  for (const [name, id] of WINDOWS) {
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
    let sigs = [];
    for (let off = 0; off < 3000; off += 1000) {
      const { data } = await c.from('strategy_signals')
        .select('token_address,signal_type,metadata')
        .eq('experiment_id', id).eq('signal_type', 'BUY').range(off, off + 999);
      sigs = sigs.concat(data || []);
      if (!data || data.length < 1000) break;
    }
    const seen = new Set();
    for (const s of sigs) {
      const md = s.metadata || {};
      if (md.execution_status !== 'executed' || seen.has(s.token_address)) continue;
      seen.add(s.token_address);
      const e = m.get(s.token_address); if (!e) continue;
      const tf = md.trendFactors || {};
      const bv = Number(tf.buyVolumeBnb) || 0;
      const fbShare = Number(tf.firstBlockBuyShare);
      const amt = Number.isFinite(fbShare) ? bv * fbShare : null;
      const wave = Number(tf.launchFirstWaveWallets);
      const avg = amt != null && Number.isFinite(wave) && wave > 0 ? amt / wave : null;
      allRows.push({
        win: name, net: e.s - e.b, amt, avg,
        age: tf.tokenAgeSec != null ? Number(tf.tokenAgeSec) : null,
        clu: tf.launchBundleClusterSize != null ? Number(tf.launchBundleClusterSize) : null,
        f0: tf.launchFirstBlockWallets != null ? Number(tf.launchFirstBlockWallets) : null,
      });
    }
  }
  const cell = (label, pred) => {
    const hit = allRows.filter(pred);
    const sum = hit.reduce((s, f) => s + f.net, 0);
    const win = hit.filter((f) => f.net > 0).length;
    console.log(`  ${label}: ${hit.length} 票 ${sum >= 0 ? '+' : ''}${sum.toFixed(3)} 胜${win}/${hit.length}${hit.length ? '（均' + (sum / hit.length * 1000).toFixed(1) + '×1e-3/票）' : ''}`);
  };
  const hasAll = (f) => f.amt != null && f.avg != null;
  console.log('== 交叉 2×2（全窗合并，有 f0/wave 键的票）==');
  cell('总额<0.8 & 户均<0.12（小散盘）', (f) => hasAll(f) && f.amt < 0.8 && f.avg < 0.12);
  cell('总额>=0.8 & 户均<0.12（堆量盘）', (f) => hasAll(f) && f.amt >= 0.8 && f.avg < 0.12);
  cell('总额<0.8 & 户均>=0.12（小户大单）', (f) => hasAll(f) && f.amt < 0.8 && f.avg >= 0.12);
  cell('总额>=0.8 & 户均>=0.12（大户集体）', (f) => hasAll(f) && f.amt >= 0.8 && f.avg >= 0.12);
  console.log('\n== 限制 age<=60（开门串作用域，近似偏差最小）==');
  cell('总额<0.8 & 户均<0.12', (f) => hasAll(f) && f.age != null && f.age <= 60 && f.amt < 0.8 && f.avg < 0.12);
  cell('总额>=0.8 & 户均<0.12', (f) => hasAll(f) && f.age != null && f.age <= 60 && f.amt >= 0.8 && f.avg < 0.12);
  cell('总额<0.8 & 户均>=0.12', (f) => hasAll(f) && f.age != null && f.age <= 60 && f.amt < 0.8 && f.avg >= 0.12);
  cell('总额>=0.8 & 户均>=0.12', (f) => hasAll(f) && f.age != null && f.age <= 60 && f.amt >= 0.8 && f.avg >= 0.12);
  console.log('\n== 堆量盘（总额>=0.8 & 户均<0.12）逐窗方向 ==');
  for (const w of WINDOWS.map((x) => x[0])) {
    const hit = allRows.filter((f) => f.win === w && hasAll(f) && f.amt >= 0.8 && f.avg < 0.12);
    const ctrl = allRows.filter((f) => f.win === w && hasAll(f) && !(f.amt >= 0.8 && f.avg < 0.12));
    const s = (a) => `${a.length}票 ${(a.reduce((x, y) => x + y.net, 0) >= 0 ? '+' : '')}${a.reduce((x, y) => x + y.net, 0).toFixed(3)}`;
    console.log(`${w}: 堆量盘 ${s(hit)} | 其余 ${s(ctrl)}`);
  }
  console.log('\n== 大户集体盘（总额>=0.8 & 户均>=0.12）逐窗 ==');
  for (const w of WINDOWS.map((x) => x[0])) {
    const hit = allRows.filter((f) => f.win === w && hasAll(f) && f.amt >= 0.8 && f.avg >= 0.12);
    const s = (a) => `${a.length}票 ${(a.reduce((x, y) => x + y.net, 0) >= 0 ? '+' : '')}${a.reduce((x, y) => x + y.net, 0).toFixed(3)}`;
    console.log(`${w}: ${s(hit)}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
