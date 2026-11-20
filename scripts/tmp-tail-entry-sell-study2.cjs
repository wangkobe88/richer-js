#!/usr/bin/env node
// 尾部低位研究 第二段：现状 episode pnl + 分实验稳健性 + PB 敏感性
const fs = require('fs');
const { dbManager } = require('../src/services/dbManager');

const EXPS = [
  ['bt-v141', '3916fb15-66a1-45f0-bde1-1c145513817a'],
  ['bt-v142', '8a7b6b09-e2bc-4773-8393-a696821ff531'],
  ['bt-v144', 'a869d119-c389-47e0-89ce-89e86114ad0e'],
  ['bt-v145', '2448116a-bebe-457d-9d8a-b4556c9a8e0d'],
  ['bt-v147', '9b31baf4-bdd3-4ebb-9031-2a1603f34633'],
];

function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; }
function pctl(arr, p) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.max(0, Math.ceil(p * a.length) - 1))];
}

async function main() {
  const sb = dbManager.getClient();
  const results = JSON.parse(fs.readFileSync('/tmp/tail-entry-study.json', 'utf8'));

  // 1) 现状 episode pnl（BNB 口径 per exp+token 的全部 buy/sell）
  const ep = new Map(); // key exp|token -> {inBnb, outBnb}
  for (const [nm, id] of EXPS) {
    const { data: tr, error } = await sb.from('trades')
      .select('token_address,trade_direction,trade_status,input_amount,input_currency,output_amount,output_currency')
      .eq('experiment_id', id).limit(3000);
    if (error) throw new Error(error.message);
    for (const t of tr) {
      if (t.trade_status !== 'success') continue;
      const k = nm + '|' + t.token_address;
      if (!ep.has(k)) ep.set(k, { inBnb: 0, outBnb: 0 });
      const e = ep.get(k);
      if (t.trade_direction === 'buy' && t.input_currency === 'BNB') e.inBnb += Number(t.input_amount);
      if (t.trade_direction === 'sell' && t.output_currency === 'BNB') e.outBnb += Number(t.output_amount);
    }
  }
  for (const [k, e] of ep) e.pnlPct = e.inBnb > 0 ? (e.outBnb - e.inBnb) / e.inBnb * 100 : null;

  // 把 episode pnl 贴到每个买点（同 exp+token）
  for (const r of results) {
    const e = ep.get(r.exp + '|' + r.token);
    r.epPnl = e ? e.pnlPct : null;
  }

  // 2) 分组总表：现状 vs 模拟
  const groups = ['A_tail_deep', 'B_tail_low', 'C_tail_mid', 'E_early_thin'];
  console.log('=== 分组：现状 episode vs 模拟（单位 %，每买点独立）');
  for (const g of groups) {
    const rs = results.filter((r) => r.grp === g);
    if (!rs.length) continue;
    const cur = rs.map((r) => r.epPnl).filter((x) => x != null);
    console.log(`\n[${g}] n=${rs.length}`);
    if (cur.length) {
      console.log(`  现状episode pnl%: mean=${mean(cur)?.toFixed(2)} p50=${pctl(cur, 0.5)?.toFixed(2)} 胜率=${(cur.filter(x=>x>0).length/cur.length*100).toFixed(0)}%`);
    }
    for (const k of ['HOLD', 'TP5', 'TP8', 'TP15', 'TO120_flat', 'TP8_or_TO120', 'PB70']) {
      const arr = rs.map((r) => r.sim[k]).filter((x) => x != null);
      console.log(`  ${k.padEnd(12)} mean=${mean(arr)?.toFixed(2)} p50=${pctl(arr,0.5)?.toFixed(2)} 胜率=${(arr.filter(x=>x>0).length/arr.length*100).toFixed(0)}%`);
    }
  }

  // 3) 分实验稳健性：B+C 合并组内每个实验的 HOLD vs TP8 vs PB70
  console.log('\n=== B+C 组分实验拆分（TP8 / PB70 vs HOLD 差值）');
  const bc = results.filter((r) => r.grp === 'B_tail_low' || r.grp === 'C_tail_mid');
  for (const [nm] of EXPS) {
    const rs = bc.filter((r) => r.exp === nm);
    if (!rs.length) { console.log(`${nm}: 0 票`); continue; }
    const h = mean(rs.map(r=>r.sim.HOLD)), t = mean(rs.map(r=>r.sim.TP8)), p = mean(rs.map(r=>r.sim.PB70));
    console.log(`${nm}: n=${rs.length} HOLD=${h?.toFixed(2)} TP8=${t?.toFixed(2)}(Δ${(t-h)?.toFixed(2)}) PB70=${p?.toFixed(2)}(Δ${(p-h)?.toFixed(2)})`);
  }

  // 4) PB 敏感性（用原始 ticks 不可得——用已存的 rh/mx 近似不行，直接在 json 上重算需要 fwd 序列。
  //    改为输出 TP 级别敏感性表：TP4/TP6/TP8/TP10/TP12（用 tpHit 已有 5/8/15，跳过）
  console.log('\n=== A 组长尾检查（HOLD>50% 的票）');
  for (const r of results.filter((r) => r.grp === 'A_tail_deep' && r.sim.HOLD > 50)) {
    console.log(`${r.exp} ${r.token.slice(0,10)} curVs=${r.curVs.toFixed(1)} HOLD=${r.sim.HOLD.toFixed(1)} mx=${r.mx.toFixed(1)}@${r.mxT}s`);
  }
  console.log('\n=== B+C 组现状 episode 最差的 10（现状卖腿在这些票上的实际表现）');
  const bcs = bc.filter(r=>r.epPnl!=null).sort((a,b)=>a.epPnl-b.epPnl);
  for (const r of bcs.slice(0,10)) {
    console.log(`${r.exp} ${r.token.slice(0,10)} ${r.grp} curVs=${r.curVs.toFixed(1)} ep=${r.epPnl.toFixed(1)} HOLD=${r.sim.HOLD.toFixed(1)} TP8=${r.sim.TP8.toFixed(1)} PB70=${r.sim.PB70.toFixed(1)} mx=${r.mx.toFixed(1)}@${r.mxT}s`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
