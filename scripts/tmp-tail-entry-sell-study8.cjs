#!/usr/bin/env node
// 尾部低位研究 第八段：候选判据拦截净效应（ep 口径）+ 跨实验方向稳健性 + 组合判据
const fs = require('fs');
function pctl(arr,p){if(!arr.length)return null;const a=[...arr].sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.max(0,Math.ceil(p*a.length)-1))];}
function mean(a){return a.length?a.reduce((s,x)=>s+x,0)/a.length:null;}

const feats = JSON.parse(fs.readFileSync('/tmp/tail-entry-study3.json', 'utf8')); // 特征+mx
const slim = JSON.parse(fs.readFileSync('/tmp/tail-entry-study2.json', 'utf8')); // epPnl
const epMap = new Map();
for (const s of slim) if (s.epPnl != null) epMap.set(s.exp + '|' + s.token, s.epPnl);
for (const f of feats) f.ep = epMap.get(f.exp + '|' + f.token) ?? null;

// 按票去重（同 exp+token 多买点取第一）
const byTk = new Map();
for (const f of feats) { const k = f.exp + '|' + f.token; if (!byTk.has(k)) byTk.set(k, f); }
const P = [...byTk.values()];
const neg = P.filter(f => f.mx < 3), pos = P.filter(f => f.mx >= 10);
console.log(`按票去重 n=${P.length} 死盘=${neg.length} 起涨=${pos.length} 中间=${P.length-neg.length-pos.length}`);
console.log(`ep: 死盘 mean=${mean(neg.map(f=>f.ep))?.toFixed(1)} 起涨 mean=${mean(pos.map(f=>f.ep))?.toFixed(1)} 全体 mean=${mean(P.map(f=>f.ep))?.toFixed(1)}`);

// 跨实验方向稳健性（每个实验内：死盘中位数 vs 起涨中位数，方向是否与全体一致）
const exps = [...new Set(P.map(f => f.exp))];
const GLOBAL_DIR = {};
for (const k of ['tf_rsi14Sec','pre_chg5','tf_riseSpeed','pre120_ratio','tf_trendStrengthScore','tf_counterpartyOverlapRate','tf_crashSpeedPctPerSec','pre_chg120','pre_gapMax300','tf_actNetBnb']) {
  const nv = neg.map(f => f[k]).filter(v => typeof v === 'number');
  const pv = pos.map(f => f[k]).filter(v => typeof v === 'number');
  GLOBAL_DIR[k] = Math.sign(pctl(pv, .5) - pctl(nv, .5)) || 0;
}
console.log('\n=== 跨实验方向一致性（+ 表示起涨票该因子更大）');
for (const k of ['tf_rsi14Sec','pre_chg5','tf_riseSpeed','pre120_ratio','tf_trendStrengthScore','tf_counterpartyOverlapRate','tf_crashSpeedPctPerSec','pre_chg120','pre_gapMax300','tf_actNetBnb']) {
  let line = `${k.padEnd(30)}`;
  let agree = 0, tot = 0;
  for (const e of exps) {
    const nv = P.filter(f => f.exp === e && f.mx < 3).map(f => f[k]).filter(v => typeof v === 'number');
    const pv = P.filter(f => f.exp === e && f.mx >= 10).map(f => f[k]).filter(v => typeof v === 'number');
    if (nv.length < 2 || pv.length < 2) { line += ` ${e.slice(3,8)}:样本少`; continue; }
    const d = pctl(pv, .5) - pctl(nv, .5);
    const globalDir = GLOBAL_DIR[k] ?? 0;
    tot++; if (Math.sign(d) === Math.sign(globalDir)) agree++;
    line += ` ${e.slice(3, 8)}:${d >= 0 ? '+' : ''}${d.toFixed(2)}(${nv.length}v${pv.length})`;
  }
  console.log(line + `  方向一致 ${agree}/${tot}`);
}

// 候选判据净效应：拦截面 ep 合计
console.log('\n=== 候选拦截判据净效应（拦截=不买该票；ep 为现状实际口径）');
function blockEffect(name, pred) {
  const hit = P.filter(pred);
  const hitNeg = hit.filter(f => f.mx < 3).length, hitPos = hit.filter(f => f.mx >= 10).length;
  const eps = hit.map(f => f.ep).filter(x => x != null);
  const sum = eps.reduce((s, x) => s + x, 0);
  // 被拦票里按实验拆
  const byExp = {};
  for (const h of hit) byExp[h.exp] = (byExp[h.exp] || 0) + 1;
  console.log(`${name.padEnd(46)} 拦${hit.length}票(死${hitNeg}/涨${hitPos}/中${hit.length-hitNeg-hitPos}) epΣ=${sum.toFixed(1)}pp mean=${mean(eps)?.toFixed(1)} ${JSON.stringify(byExp)}`);
}
const num = (f, k) => typeof f[k] === 'number' && isFinite(f[k]);
blockEffect('rsi>=34.3(全体p67)', f => num(f, 'tf_rsi14Sec') && f.tf_rsi14Sec >= 34.3);
blockEffect('rsi>=32.5', f => num(f, 'tf_rsi14Sec') && f.tf_rsi14Sec >= 32.5);
blockEffect('rsi>=30', f => num(f, 'tf_rsi14Sec') && f.tf_rsi14Sec >= 30);
blockEffect('pre_chg5<0(买前5s未动)', f => num(f, 'pre_chg5') && f.pre_chg5 < 0);
blockEffect('pre_chg5<0 ∧ rsi>=30', f => num(f, 'pre_chg5') && f.pre_chg5 < 0 && num(f, 'tf_rsi14Sec') && f.tf_rsi14Sec >= 30);
blockEffect('riseSpeed>=7.7 ∧ pre_chg5<0', f => num(f, 'tf_riseSpeed') && f.tf_riseSpeed >= 7.7 && num(f, 'pre_chg5') && f.pre_chg5 < 0);
blockEffect('rsi>=30 ∧ pre120_ratio>=1.1(接刀)', f => num(f, 'tf_rsi14Sec') && f.tf_rsi14Sec >= 30 && num(f, 'pre120_ratio') && f.pre120_ratio >= 1.1);
blockEffect('rsi>=30 ∧ chg300>10(浅坑)', f => num(f, 'tf_rsi14Sec') && f.tf_rsi14Sec >= 30 && num(f, 'pre_chg300') && f.pre_chg300 > 10);

// 正向判据（识别起涨票，留观不拦）：看允许面的 ep
console.log('\n=== 正向识别（放行面）检验');
function allowEffect(name, pred) {
  const keep = P.filter(pred);
  const eps = keep.map(f => f.ep).filter(x => x != null);
  console.log(`${name.padEnd(46)} 留${keep.length}票 epΣ=${eps.reduce((s,x)=>s+x,0).toFixed(1)}pp mean=${mean(eps)?.toFixed(1)} 死盘留存=${keep.filter(f=>f.mx<3).length}`);
}
allowEffect('rsi<27.3(深超卖)', f => num(f, 'tf_rsi14Sec') && f.tf_rsi14Sec < 27.3);
allowEffect('pre_chg5>=0.7(买前已微涨)', f => num(f, 'pre_chg5') && f.pre_chg5 >= 0.7);

// 明细：rsi>=30 拦截票的起涨误伤清单
console.log('\n=== rsi>=30 误伤的起涨票（mx>=10）明细');
for (const f of P.filter(f => num(f, 'tf_rsi14Sec') && f.tf_rsi14Sec >= 30 && f.mx >= 10)) {
  console.log(`${f.exp} ${f.token.slice(0,10)} rsi=${f.tf_rsi14Sec.toFixed(1)} ep=${f.ep?.toFixed(1)} mx=${f.mx.toFixed(0)}@${f.mxT}s chg5=${f.pre_chg5?.toFixed(1)} ratio120=${f.pre120_ratio?.toFixed(2)}`);
}
console.log('\n=== rsi>=30 拦下的死盘票明细');
for (const f of P.filter(f => num(f, 'tf_rsi14Sec') && f.tf_rsi14Sec >= 30 && f.mx < 3)) {
  console.log(`${f.exp} ${f.token.slice(0,10)} rsi=${f.tf_rsi14Sec.toFixed(1)} ep=${f.ep?.toFixed(1)} mx=${f.mx.toFixed(1)} chg5=${f.pre_chg5?.toFixed(1)} ratio120=${f.pre120_ratio?.toFixed(2)}`);
}
fs.writeFileSync('/tmp/tail-entry-study4.json', JSON.stringify(P));
