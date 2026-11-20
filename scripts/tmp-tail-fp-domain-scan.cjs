#!/usr/bin/env node
// 域线组合扫描 + E 组误伤明细（基于 /tmp/tail-fp-replay.json）
const fs = require('fs');
function mean(a){return a.length?a.reduce((s,x)=>s+x,0)/a.length:null;}
const out = JSON.parse(fs.readFileSync('/tmp/tail-fp-replay.json', 'utf8'));
const tail = out.filter(o => o.grp === 'tail' || o.grp === 'tail149');
const E = out.filter(o => o.grp === 'E');

console.log('=== 域线组合扫描（拦=chg5<-5；净效应=尾部epΣ绝对值−E组误伤epΣ）');
for (const ath of [40]) {
  for (const cv of [28.5]) {
    for (const volMin of [0, 5, 10, 15]) {
      for (const ageMin of [0, 60, 90]) {
        const dom = (o) => o.athVs != null && o.curVs != null && o.chg5 != null
          && o.athVs >= ath && o.curVs <= cv
          && (volMin === 0 || (o.vol != null && o.vol >= volMin))
          && (ageMin === 0 || (o.age != null && o.age >= ageMin));
        const tHit = tail.filter(o => dom(o) && o.chg5 < -5);
        const eHit = E.filter(o => dom(o) && o.chg5 < -5);
        const tEps = tHit.map(o=>o.ep).filter(x=>x!=null), eEps = eHit.map(o=>o.ep).filter(x=>x!=null);
        const tSum = tEps.reduce((s,x)=>s+x,0), eSum = eEps.reduce((s,x)=>s+x,0);
        // 放行面（域内 chg5>=0 尾部票）保持检查
        const tKeep = tail.filter(o => dom(o) && o.chg5 >= 0);
        const kEps = tKeep.map(o=>o.ep).filter(x=>x!=null);
        console.log(`ath>=${ath} cv<=${cv} vol>=${volMin||'-'} age>=${ageMin||'-'}: 尾部拦${tHit.length}票(Σ${tSum.toFixed(0)}) E误伤${eHit.length}票(Σ${eSum.toFixed(0)}) 净=${(tSum*Math.sign(-1)+eSum).toFixed(1)}→改善${(-tSum+eSum).toFixed(1)}pp | 尾部放行${tKeep.length}票(Σ${kEps.reduce((s,x)=>s+x,0).toFixed(0)} mean${mean(kEps)?.toFixed(1)})`);
      }
    }
  }
}

console.log('\n=== E 组域内 chg5<-5 明细（athVs>=40∧curVs<=28.5 无 vol/age 腿）');
for (const o of E.filter(o => o.athVs != null && o.curVs != null && o.chg5 != null && o.athVs >= 40 && o.curVs <= 28.5 && o.chg5 < -5)) {
  console.log(`${o.exp} ${o.token.slice(0,10)} chg5=${o.chg5.toFixed(1)} chg30=${o.chg30?.toFixed(1)} athVs=${o.athVs?.toFixed(0)} curVs=${o.curVs?.toFixed(1)} vol=${o.vol?.toFixed(1)} age=${o.age?.toFixed(0)}s mx=${o.mx?.toFixed(0)} ep=${o.ep?.toFixed(1)}`);
}
console.log('\n=== 尾部域内 chg5<-5 明细（同域）');
for (const o of tail.filter(o => o.athVs != null && o.curVs != null && o.chg5 != null && o.athVs >= 40 && o.curVs <= 28.5 && o.chg5 < -5)) {
  console.log(`${o.exp} ${o.token.slice(0,10)} chg5=${o.chg5.toFixed(1)} chg30=${o.chg30?.toFixed(1)} athVs=${o.athVs?.toFixed(0)} curVs=${o.curVs?.toFixed(1)} vol=${o.vol?.toFixed(1)} age=${o.age?.toFixed(0)}s mx=${o.mx?.toFixed(0)} ep=${o.ep?.toFixed(1)}`);
}
