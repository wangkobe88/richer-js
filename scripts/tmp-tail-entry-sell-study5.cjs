#!/usr/bin/env node
// 尾部低位研究 第五段：B+C 组负票（mx<3）出局时长 + 买点因子画像
const fs = require('fs');
const { dbManager } = require('../src/services/dbManager');
const EXPS = [
  ['bt-v141', '3916fb15-66a1-45f0-bde1-1c145513817a'],
  ['bt-v142', '8a7b6b09-e2bc-4773-8393-a696821ff531'],
  ['bt-v144', 'a869d119-c389-47e0-89ce-89e86114ad0e'],
  ['bt-v145', '2448116a-bebe-457d-9d8a-b4556c9a8e0d'],
  ['bt-v147', '9b31baf4-bdd3-4ebb-9031-2a1603f34633'],
];
function mean(a){return a.length?a.reduce((s,x)=>s+x,0)/a.length:null;}
function pctl(arr,p){if(!arr.length)return null;const a=[...arr].sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.max(0,Math.ceil(p*a.length)-1))];}

async function main() {
  const sb = dbManager.getClient();
  const results = JSON.parse(fs.readFileSync('/tmp/tail-entry-study2.json', 'utf8')); // slim 版含 epPnl/maxIn/rAt/sim
  // 需要 tf 画像 → 重拉 BUY 信号 trendFactors
  const tfMap = new Map();
  for (const [nm, id] of EXPS) {
    const { data: tr, error } = await sb.from('trades')
      .select('token_address,trade_direction,trade_status,input_currency,created_at,signal_id')
      .eq('experiment_id', id).limit(3000);
    if (error) throw new Error(error.message);
    const sigIds = [...new Set(tr.filter(t=>t.trade_direction==='buy').map(t=>t.signal_id).filter(Boolean))];
    for (let i=0;i<sigIds.length;i+=50) {
      const { data: sgs, error: e2 } = await sb.from('strategy_signals').select('id,metadata').in('id', sigIds.slice(i,i+50));
      if (e2) throw new Error(e2.message);
      for (const s of sgs) tfMap.set(s.id, (s.metadata&&s.metadata.trendFactors)||{});
    }
    // episode 时长
    for (const t of tr) { if (t.trade_status!=='success') continue; const k=nm+'|'+t.token_address;
      if (!tfMap.has('E|'+k)) tfMap.set('E|'+k, { firstBuy:null, lastSell:null });
      const e = tfMap.get('E|'+k);
      if (t.trade_direction==='buy' && t.input_currency==='BNB') { if (!e.firstBuy) e.firstBuy = new Date(t.created_at).getTime(); }
      if (t.trade_direction==='sell') { e.lastSell = new Date(t.created_at).getTime(); }
    }
  }

  const bc = results.filter(r => r.grp==='B_tail_low'||r.grp==='C_tail_mid');
  const neg = bc.filter(r => r.mx < 3);
  const pos = bc.filter(r => r.mx >= 10);
  console.log(`B+C 组：负票(mx<3)=${neg.length} 起涨票(mx>=10)=${pos.length} 其它=${bc.length-neg.length-pos.length}`);

  // 出局时长
  const dur = [];
  for (const r of neg) { const e = tfMap.get('E|'+r.exp+'|'+r.token); if (e && e.firstBuy && e.lastSell) dur.push(Math.round((e.lastSell-e.firstBuy)/1000)); }
  console.log(`负票出局时长(s): p25=${pctl(dur,.25)} p50=${pctl(dur,.5)} p75=${pctl(dur,.75)} max=${Math.max(...dur,-1)} n=${dur.length}`);

  // 买点画像对比（从 study2 json 没存 tf，重新对齐：用 maxIn[15] 当“买后15s动量”）
  console.log('\n负票 vs 起涨票 买点/早期画像（能识别则属买入侧改进）：');
  for (const [label, rs] of [['负票mx<3', neg], ['起涨票mx>=10', pos]]) {
    const f = (k) => mean(rs.map(r=>r[k]).filter(x=>x!=null));
    console.log(`  ${label}: n=${rs.length} curVs=${f('curVs')?.toFixed(1)} ep=${f('epPnl')?.toFixed(1)} maxIn15=${mean(rs.map(r=>r.maxIn&&r.maxIn[45]!==undefined?undefined:null).filter(x=>x!=null)) ?? '—'} 15s动量=${mean(rs.map(r=>r.rAt?r.rAt[45]:null).filter(x=>x!=null))?.toFixed(2)}% 45s动量=${mean(rs.map(r=>r.rAt?r.rAt[45]:null).filter(x=>x!=null))?.toFixed(2)}%`);
  }
}

main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
