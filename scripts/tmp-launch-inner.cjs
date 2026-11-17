// 尾检：首块额>=2 桶内部结构 + curVs/act 控制（分辨卖压轴 vs 价格位置混杂）
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
      allRows.push({
        win: name, net: e.s - e.b, amt,
        curVs: tf.currentVsLaunchPct != null ? Number(tf.currentVsLaunchPct) : null,
        act: tf.actTotalBnb != null ? Number(tf.actTotalBnb) : null,
        age: tf.tokenAgeSec != null ? Number(tf.tokenAgeSec) : null,
        sym: (md.trendFactors || {}).tokenSymbol || s.token_address.slice(0, 10),
      });
    }
  }
  // ≥2 桶内部
  const heavy = allRows.filter((f) => f.amt != null && f.amt >= 2).sort((a, b) => b.net - a.net);
  console.log(`== 首块额>=2 桶（${heavy.length} 票，合计 +${heavy.reduce((s, f) => s + f.net, 0).toFixed(3)}）内部 ==`);
  console.log('盈利票:');
  for (const f of heavy.filter((f) => f.net > 0)) console.log(`  +${f.net.toFixed(3)} ${f.sym} ${f.win} amt=${f.amt.toFixed(1)} curVs=${f.curVs} age=${f.age}`);
  const losN = heavy.filter((f) => f.net <= 0);
  console.log(`亏损/零票 ${losN.length} 张 合计 ${losN.reduce((s, f) => s + f.net, 0).toFixed(3)}（最差 5 张：${losN.slice(0, 5).map((f) => f.net.toFixed(3) + '/' + f.sym).join(', ')}）`);
  const top3 = heavy.slice(0, 3).reduce((s, f) => s + f.net, 0);
  const rest = heavy.length > 3 ? heavy.slice(3).reduce((s, f) => s + f.net, 0) : 0;
  console.log(`top3 盈利票合计 +${top3.toFixed(3)}，其余 ${heavy.length - 3} 票合计 ${rest >= 0 ? '+' : ''}${rest.toFixed(3)}`);

  // curVs 控制：户均维度之外看首块额轴在低价位子集是否仍弱
  const cell = (label, pred) => {
    const hit = allRows.filter(pred);
    if (!hit.length) { console.log(`  ${label}: 0 票`); return; }
    const sum = hit.reduce((s, f) => s + f.net, 0);
    const win = hit.filter((f) => f.net > 0).length;
    console.log(`  ${label}: ${hit.length} 票 ${sum >= 0 ? '+' : ''}${sum.toFixed(3)} 胜${win}/${hit.length}（均${(sum / hit.length * 1000).toFixed(1)}×1e-3）`);
  };
  console.log('\n== curVs 控制（fire 时价格位置 <18 低价位子集）==');
  cell('首块额<0.8', (f) => f.amt != null && f.curVs != null && f.curVs < 18 && f.amt < 0.8);
  cell('首块额>=0.8', (f) => f.amt != null && f.curVs != null && f.curVs < 18 && f.amt >= 0.8);
  console.log('== curVs>=18 高价位子集 ==');
  cell('首块额<0.8', (f) => f.amt != null && f.curVs != null && f.curVs >= 18 && f.amt < 0.8);
  cell('首块额>=0.8', (f) => f.amt != null && f.curVs != null && f.curVs >= 18 && f.amt >= 0.8);
  console.log('\n== act 控制（actTotalBnb<0.6 非热盘子集）==');
  cell('首块额<0.8', (f) => f.amt != null && f.act != null && f.act < 0.6 && f.amt < 0.8);
  cell('首块额>=0.8', (f) => f.amt != null && f.act != null && f.act < 0.6 && f.amt >= 0.8);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
