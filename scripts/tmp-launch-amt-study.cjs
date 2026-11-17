// 开盘买入额度维度研究（本地近似版）：首块买入额/户均额度/单块集中度 × 净额，跨 7 窗
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
      const firstBlockAmt = Number.isFinite(fbShare) ? bv * fbShare : null;
      const f0 = Number(tf.launchFirstBlockWallets);
      const wave = Number(tf.launchFirstWaveWallets);
      const wallets = Number.isFinite(wave) ? wave : (Number.isFinite(f0) ? f0 : null);
      const avgAmt = firstBlockAmt != null && wallets ? firstBlockAmt / wallets : null;
      allRows.push({
        win: name, net: e.s - e.b, bv, firstBlockAmt, avgAmt,
        maxBlkCirc: tf.maxBlockBuyCircPct != null ? Number(tf.maxBlockBuyCircPct) : null,
        maxBlkPct: tf.cheatMaxBlockBuyPct != null ? Number(tf.cheatMaxBlockBuyPct) : null,
        age: tf.tokenAgeSec != null ? Number(tf.tokenAgeSec) : null,
        act: tf.actTotalBnb != null ? Number(tf.actTotalBnb) : null,
      });
    }
  }
  console.log(`总样本 ${allRows.length} 票（7 窗 executed）`);
  const bucket = (label, keyFn, edges) => {
    const out = edges.map(() => ({ n: 0, sum: 0, win: 0 })); const miss = { n: 0, sum: 0, win: 0 };
    for (const f of allRows) {
      const v = keyFn(f);
      if (v == null || !Number.isFinite(v)) { miss.n++; miss.sum += f.net; if (f.net > 0) miss.win++; continue; }
      let bi = edges.findIndex((e2) => v < e2);
      if (bi < 0) bi = edges.length - 1;
      const o = out[bi]; o.n++; o.sum += f.net; if (f.net > 0) o.win++;
    }
    console.log(`${label}: ` + out.map((o, i) => `${i === 0 ? '<' + edges[0] : (i === edges.length - 1 ? '>=' + edges[edges.length - 2] : '[' + edges[i - 1] + ',' + edges[i] + ')')}:${o.n}票 ${o.sum >= 0 ? '+' : ''}${o.sum.toFixed(3)} 胜${o.win}/${o.n}`).join(' | ') + ` | null:${miss.n} ${miss.sum >= 0 ? '+' : ''}${miss.sum.toFixed(3)}`);
  };
  console.log('\n== 全窗合并分桶 ==');
  bucket('首块买入额(BNB) ', (f) => f.firstBlockAmt, [0.3, 0.8, 2, 1e9]);
  bucket('户均首块额(BNB) ', (f) => f.avgAmt, [0.05, 0.12, 0.25, 1e9]);
  bucket('全窗买入额(BNB) ', (f) => f.bv, [1.5, 2.5, 4, 1e9]);
  bucket('maxBlockBuyCircPct', (f) => f.maxBlkCirc, [5, 15, 30, 1e9]);
  bucket('cheatMaxBlockBuyPct', (f) => f.maxBlkPct, [5, 15, 30, 1e9]);
  // 逐窗：首块额 <0.8 vs >=0.8（先看方向一致性）
  console.log('\n== 逐窗：首块买入额分桶净额（方向稳定性）==');
  for (const w of WINDOWS.map((x) => x[0])) {
    const sub = allRows.filter((f) => f.win === w);
    const lo = sub.filter((f) => f.firstBlockAmt != null && f.firstBlockAmt < 0.8);
    const hi = sub.filter((f) => f.firstBlockAmt != null && f.firstBlockAmt >= 0.8);
    const s = (a) => `${a.length}票 ${(a.reduce((x, y) => x + y.net, 0) >= 0 ? '+' : '')}${a.reduce((x, y) => x + y.net, 0).toFixed(3)}`;
    console.log(`${w}: <0.8 ${s(lo)} | >=0.8 ${s(hi)}`);
  }
  console.log('\n== 逐窗：户均首块额 <0.12 vs >=0.12 ==');
  for (const w of WINDOWS.map((x) => x[0])) {
    const sub = allRows.filter((f) => f.win === w);
    const lo = sub.filter((f) => f.avgAmt != null && f.avgAmt < 0.12);
    const hi = sub.filter((f) => f.avgAmt != null && f.avgAmt >= 0.12);
    const s = (a) => `${a.length}票 ${(a.reduce((x, y) => x + y.net, 0) >= 0 ? '+' : '')}${a.reduce((x, y) => x + y.net, 0).toFixed(3)}`;
    console.log(`${w}: <0.12 ${s(lo)} | >=0.12 ${s(hi)}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
