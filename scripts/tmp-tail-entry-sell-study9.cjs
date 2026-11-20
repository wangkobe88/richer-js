#!/usr/bin/env node
// 尾部低位研究 第九段：pre_chg5<0 拦截臂深挖（构成/腿分布/BP 判型/阈值扫描）
const fs = require('fs');
const { dbManager } = require('../src/services/dbManager');
function mean(a){return a.length?a.reduce((s,x)=>s+x,0)/a.length:null;}

async function main() {
  const sb = dbManager.getClient();
  const P = JSON.parse(fs.readFileSync('/tmp/tail-entry-study4.json', 'utf8'));
  const results = JSON.parse(fs.readFileSync('/tmp/tail-entry-study.json', 'utf8')); // 有 leg
  const legMap = new Map();
  for (const r of results) if (!legMap.has(r.exp + '|' + r.token)) legMap.set(r.exp + '|' + r.token, r.leg);

  // BUY 信号 buyPoint 段真实结构（取一条看键）
  const { data: tr } = await sb.from('trades')
    .select('signal_id').eq('experiment_id', '9b31baf4-bdd3-4ebb-9031-2a1603f34633')
    .eq('trade_direction', 'buy').limit(1);
  if (tr && tr[0] && tr[0].signal_id) {
    const { data: sg } = await sb.from('strategy_signals').select('metadata').eq('id', tr[0].signal_id).limit(1);
    const bp = sg && sg[0] && sg[0].metadata && sg[0].metadata.buyPoint;
    console.log('=== buyPoint 段结构样例:', JSON.stringify(bp).slice(0, 600));
  }

  const num = (f, k) => typeof f[k] === 'number' && isFinite(f[k]);

  // pre_chg5<0 拦截臂 19 票全明细
  console.log('\n=== pre_chg5<0 票全明细（拦截面）');
  const arm = P.filter(f => num(f, 'pre_chg5') && f.pre_chg5 < 0).sort((a, b) => a.pre_chg5 - b.pre_chg5);
  let deadEp = 0, riseEp = 0, midEp = 0;
  for (const f of arm) {
    const leg = legMap.get(f.exp + '|' + f.token);
    console.log(`${f.exp} ${f.token.slice(0,10)} chg5=${f.pre_chg5.toFixed(1)} chg30=${f.pre_chg30?.toFixed(1)} chg120=${f.pre_chg120?.toFixed(1)} rise=${f.tf_riseSpeed?.toFixed(1)} rsi=${f.tf_rsi14Sec?.toFixed(0)} ratio120=${f.pre120_ratio?.toFixed(2)} | ${f.mx<3?'死盘':f.mx>=10?'起涨':'中间'} mx=${f.mx.toFixed(0)} ep=${f.ep?.toFixed(1)} leg=${leg}`);
    if (f.mx < 3) deadEp += f.ep || 0; else if (f.mx >= 10) riseEp += f.ep || 0; else midEp += f.ep || 0;
  }
  console.log(`拦截面 ep 分解: 死盘Σ=${deadEp.toFixed(1)} 起涨Σ=${riseEp.toFixed(1)} 中间Σ=${midEp.toFixed(1)}`);

  // 放行面对照（pre_chg5>=0）
  const keep = P.filter(f => num(f, 'pre_chg5') && f.pre_chg5 >= 0);
  console.log(`\n放行面 pre_chg5>=0: n=${keep.length} ep mean=${mean(keep.map(f=>f.ep))?.toFixed(1)} 死盘=${keep.filter(f=>f.mx<3).length} 起涨=${keep.filter(f=>f.mx>=10).length}`);

  // leg 分布（死盘 vs 起涨）
  console.log('\n=== ladder 腿分布（腿名: 死盘/起涨/中间）');
  const legStat = {};
  for (const f of P) {
    const leg = legMap.get(f.exp + '|' + f.token) || '?';
    if (!legStat[leg]) legStat[leg] = { d: 0, u: 0, m: 0 };
    if (f.mx < 3) legStat[leg].d++; else if (f.mx >= 10) legStat[leg].u++; else legStat[leg].m++;
  }
  for (const [k, v] of Object.entries(legStat)) console.log(`  ${k}: 死${v.d}/涨${v.u}/中${v.m}`);

  // 阈值扫描（chg5 档 × riseSpeed 组合）
  console.log('\n=== 阈值扫描：拦截面(epΣ 负=拦了赚改善) + 死盘拦率/起涨误伤');
  for (const c5 of [-5, -2, 0, 2]) {
    for (const rs of [0, 3.5, 7.7]) {
      const hit = P.filter(f => num(f, 'pre_chg5') && num(f, 'tf_riseSpeed') && f.pre_chg5 < c5 && f.tf_riseSpeed >= rs);
      if (!hit.length) continue;
      const eps = hit.map(f => f.ep).filter(x => x != null);
      const d = hit.filter(f => f.mx < 3).length, u = hit.filter(f => f.mx >= 10).length;
      console.log(`  chg5<${c5} ∧ rise>=${rs}: n=${hit.length}(死${d}/涨${u}) epΣ=${eps.reduce((s,x)=>s+x,0).toFixed(1)} mean=${mean(eps)?.toFixed(1)}`);
    }
  }

  // 只在 RL/NL 域（尾部） vs E 组对照：pre_chg5<0 在 E 组的效应（泛化检查）
  console.log('\n=== 泛化检查：pre_chg5<0 在对照组(E 组, study.json grp)的效应');
  const all = JSON.parse(fs.readFileSync('/tmp/tail-entry-study.json', 'utf8'));
  const eFeats = JSON.parse(fs.readFileSync('/tmp/tail-entry-study3.json', 'utf8')).filter(f => f.grp === 'E_early_thin');
  // E 组 pre 特征有没有？study3 只含尾部组。→ 用 tf_riseSpeed 与 mx 近似不行，跳过；改为从 study.json E 组算 tf 侧
  const eAll = all.filter(r => r.grp === 'E_early_thin');
  const epM = new Map();
  for (const s of JSON.parse(fs.readFileSync('/tmp/tail-entry-study2.json', 'utf8'))) if (s.epPnl != null) epM.set(s.exp + '|' + s.token, s.epPnl);
  // trendFactors 只有 study3 有——E 组不在。直接给出说明。
  console.log(`  E 组 n=${eAll.length}（盘面前因子未拉，需另行验证；本轮结论限定尾部组）`);
  void eFeats; void epM;
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
