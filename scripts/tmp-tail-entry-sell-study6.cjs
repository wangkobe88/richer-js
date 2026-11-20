#!/usr/bin/env node
// 尾部低位研究 第六段：买后极速止损臂（T 时点动量 < -X → 时点价卖，否则维持现状 ep）
const fs = require('fs');
function mean(a){return a.length?a.reduce((s,x)=>s+x,0)/a.length:null;}
function pctl(arr,p){if(!arr.length)return null;const a=[...arr].sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.max(0,Math.ceil(p*a.length)-1))];}

const results = JSON.parse(fs.readFileSync('/tmp/tail-entry-study2.json', 'utf8'));
for (const g of ['A_tail_deep','B_tail_low','C_tail_mid','E_early_thin']) {
  const rs = results.filter(r => r.grp === g && r.epPnl != null && r.rAt);
  if (!rs.length) continue;
  console.log(`\n[${g}] n=${rs.length} 现状mean=${mean(rs.map(r=>r.epPnl))?.toFixed(2)}`);
  for (const X of [5, 8, 10, 12]) {
    let line = `  -${X}%: `;
    for (const T of [45, 60, 90]) {
      const arr = rs.map(r => (r.rAt[T] != null && r.rAt[T] < -X) ? r.rAt[T] : r.epPnl);
      const trig = rs.filter(r => r.rAt[T] != null && r.rAt[T] < -X).length;
      line += `T${T}=${mean(arr)?.toFixed(2)}(触${trig}) | `;
    }
    console.log(line);
  }
  // 误伤检查：被触发但现状 ep 为正的票（-8/T45）
  const hurt = rs.filter(r => r.rAt[45] != null && r.rAt[45] < -8 && r.epPnl > 5);
  for (const r of hurt) console.log(`  ⚠误伤候选: ${r.token.slice(0,10)} r45=${r.rAt[45].toFixed(1)} ep=${r.epPnl.toFixed(1)} mx=${r.mx.toFixed(1)}@${r.mxT}s`);
}
