// 首块买入额>=2 的 40 张去重票 → 输出清单（地址/实验id/净额/上下文）供开 tab
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
      if (amt == null || amt < 2) { continue; }
      rows.push({
        addr: s.token_address, sym: s.token_symbol || tf.tokenSymbol || '?', exp: id, win: name,
        net: e.s - e.b, amt, curVs: tf.currentVsLaunchPct, age: tf.tokenAgeSec,
        leg: (md.signalGate || {}).legId || md.strategyId,
      });
    }
  }
  rows.sort((a, b) => b.amt - a.amt);
  console.log(`合计 ${rows.length} 票（按首块额降序）\n`);
  rows.forEach((r, i) => console.log(`${i + 1}\t${r.addr}\t${r.sym}\t${r.win}\t${r.exp}\t净${r.net >= 0 ? '+' : ''}${r.net.toFixed(4)}\t首块${r.amt.toFixed(2)}\tcurVs=${r.curVs}\tage=${r.age}\t${r.leg}`));
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
