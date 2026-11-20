#!/usr/bin/env node
// 尾部低位研究 第三段：现状 ep 分布构成 + 混合模拟（现状+快出臂叠加）
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
  const results = JSON.parse(fs.readFileSync('/tmp/tail-entry-study.json', 'utf8'));

  // 现状 ep + 卖出细节（per exp+token 的 sell 明细拿持有时长和卖出原因）
  const ep = new Map();
  for (const [nm, id] of EXPS) {
    const { data: tr, error } = await sb.from('trades')
      .select('token_address,trade_direction,trade_status,input_amount,input_currency,output_amount,output_currency,created_at,metadata')
      .eq('experiment_id', id).limit(3000);
    if (error) throw new Error(error.message);
    for (const t of tr) {
      if (t.trade_status !== 'success') continue;
      const k = nm + '|' + t.token_address;
      if (!ep.has(k)) ep.set(k, { inBnb: 0, outBnb: 0, sells: [], buys: [] });
      const e = ep.get(k);
      if (t.trade_direction === 'buy' && t.input_currency === 'BNB') { e.inBnb += Number(t.input_amount); e.buys.push(t.created_at); }
      if (t.trade_direction === 'sell' && t.output_currency === 'BNB') {
        e.outBnb += Number(t.output_amount);
        e.sells.push({ ts: t.created_at, out: Number(t.output_amount), why: (t.metadata && (t.metadata.strategyName || t.metadata.strategyId)) || (t.metadata && t.metadata.why) || '?' });
      }
    }
  }
  for (const [k, e] of ep) e.pnlPct = e.inBnb > 0 ? (e.outBnb - e.inBnb) / e.inBnb * 100 : null;

  for (const r of results) {
    const e = ep.get(r.exp + '|' + r.token);
    r.epPnl = e ? e.pnlPct : null;
    r.sellWhys = e ? e.sells.map(s => s.why) : [];
  }

  // 分布构成
  for (const g of ['A_tail_deep', 'B_tail_low', 'C_tail_mid', 'E_early_thin']) {
    const rs = results.filter(r => r.grp === g && r.epPnl != null);
    if (!rs.length) continue;
    const arr = rs.map(r => r.epPnl);
    console.log(`\n[${g}] n=${rs.length} 现状ep分布: p10=${pctl(arr,.1)?.toFixed(1)} p25=${pctl(arr,.25)?.toFixed(1)} p50=${pctl(arr,.5)?.toFixed(1)} p75=${pctl(arr,.75)?.toFixed(1)} p90=${pctl(arr,.9)?.toFixed(1)} max=${Math.max(...arr)?.toFixed(1)} min=${Math.min(...arr)?.toFixed(1)} mean=${mean(arr)?.toFixed(2)}`);
    // 正贡献集中度
    const pos = arr.filter(x => x > 0).sort((a,b)=>b-a);
    const totPos = pos.reduce((s,x)=>s+x,0);
    console.log(`  正票 ${pos.length} 个 合计+${totPos.toFixed(1)}pp；Top1=${pos[0]?.toFixed(1)} 占 ${(pos[0]/Math.max(totPos,1e-9)*100).toFixed(0)}%；Top3=${(pos.slice(0,3).reduce((s,x)=>s+x,0)/Math.max(totPos,1e-9)*100).toFixed(0)}%`);
  }

  // B+C 组：现状正票 Top8 明细（谁贡献的、怎么卖的）
  console.log('\n=== B+C 组现状正票 Top8');
  const bc = results.filter(r => (r.grp==='B_tail_low'||r.grp==='C_tail_mid') && r.epPnl != null).sort((a,b)=>b.epPnl-a.epPnl);
  for (const r of bc.slice(0,8)) {
    console.log(`${r.exp} ${r.token.slice(0,10)} ${r.grp} ep=${r.epPnl.toFixed(1)} curVs=${r.curVs.toFixed(1)} mx=${r.mx.toFixed(1)}@${r.mxT}s | 卖因=${[...new Set(r.sellWhys)].join(' / ').slice(0,110)}`);
  }
  console.log('\n=== B+C 组现状负票 Top8');
  for (const r of bc.slice(-8).reverse()) {
    console.log(`${r.exp} ${r.token.slice(0,10)} ${r.grp} ep=${r.epPnl.toFixed(1)} curVs=${r.curVs.toFixed(1)} mx=${r.mx.toFixed(1)}@${r.mxT}s | 卖因=${[...new Set(r.sellWhys)].join(' / ').slice(0,110)}`);
  }

  // 卖出原因分布（B+C）
  const whyCnt = {};
  for (const r of bc) for (const w of new Set(r.sellWhys)) whyCnt[w] = (whyCnt[w]||0)+1;
  console.log('\nB+C 卖出原因分布（票数）:', JSON.stringify(whyCnt, null, 0).slice(0, 800));

  // 混合模拟：现状结构太复杂，用“现状 vs 现状+TP8 首卡快出”不可精确模拟。
  // 替代口径：TP8_half = 一半仓位 TP8、一半 HOLD（对应 2/4 卡快出）
  for (const g of ['A_tail_deep','B_tail_low','C_tail_mid','E_early_thin']) {
    const rs = results.filter(r => r.grp === g);
    if (!rs.length) continue;
    const half = rs.map(r => {
      const tp = r.sim.TP8, hold = r.sim.HOLD;
      return tp == null || hold == null ? null : tp * 0.5 + hold * 0.5;
    }).filter(x=>x!=null);
    const cur = rs.map(r=>r.epPnl).filter(x=>x!=null);
    console.log(`[${g}] 现状mean=${mean(cur)?.toFixed(2)} | TP8_half(50%快出+50%持有)=${mean(half)?.toFixed(2)} | 纯TP8=${mean(rs.map(r=>r.sim.TP8))?.toFixed(2)} | HOLD=${mean(rs.map(r=>r.sim.HOLD))?.toFixed(2)}`);
  }
}

main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
