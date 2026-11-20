#!/usr/bin/env node
// FP17 尾部接刀臂校准：研究买点 → buy_point_analyses 锚（FP/BP snapshot 同源键）分布
const fs = require('fs');
const { dbManager } = require('../src/services/dbManager');

async function main() {
  const sb = dbManager.getClient();
  const P = JSON.parse(fs.readFileSync('/tmp/tail-entry-study4.json', 'utf8')); // 尾部组 feats（含 mx/chg5/ep）
  console.log(`研究尾部买点=${P.length}`);

  // buy_point_analyses 按 token 拉，找买点 ±10s 最近行
  const byTk = new Map();
  for (const p of P) { if (!byTk.has(p.token)) byTk.set(p.token, []); byTk.get(p.token).push(p); }
  const out = [];
  for (const [tok, ps] of byTk) {
    const { data, error } = await sb.from('buy_point_analyses')
      .select('token_address,created_at,anchors')
      .eq('token_address', tok)
      .order('created_at', { ascending: true }).limit(2000);
    if (error) { console.log('err', tok.slice(0, 8), error.message); continue; }
    for (const p of ps) {
      let best = null, bd = 1e18;
      for (const r of data || []) {
        const dt = Math.abs(new Date(r.created_at).getTime() - p.buyTs);
        if (dt < bd) { bd = dt; best = r; }
      }
      if (best && bd < 15000) {
        const a = best.anchors || {};
        out.push({
          token: tok, exp: p.exp, mx: p.mx, epPnl: p.ep, pre_chg5: p.pre_chg5,
          bp_chg5: a.chg5Pct ?? null, bp_chg10: a.chg10Pct ?? null, bp_chg30: a.chg30Pct ?? null,
          bp_athVs: a.athVsLaunchPct ?? null, bp_curVs: a.currentVsLaunchPct ?? null,
          bp_vol: a.totalVolumeBnb ?? null, bp_age: a.tokenAgeSec ?? null,
          bp_span: a.spanSec ?? null, bp_secAth: a.secSinceAth ?? null,
          bp_minVs: a.minVsLaunchPct ?? null, bp_mcap: a.mcapBnb ?? null,
        });
      }
    }
  }
  console.log(`配到 BP 行=${out.length}/${P.length}`);

  function pctl(arr, p) { const a = arr.filter(x => x != null).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.ceil(p * a.length) - 1)] : null; }
  const neg = out.filter(o => o.mx < 3), pos = out.filter(o => o.mx >= 10);
  console.log('\n死盘 vs 起涨 锚分布（p25/p50/p75）:');
  for (const k of ['bp_chg5', 'bp_chg30', 'bp_athVs', 'bp_curVs', 'bp_vol', 'bp_age', 'bp_secAth']) {
    console.log(`  ${k.padEnd(10)} 死盘 ${pctl(neg.map(o=>o[k]),.25)}/${pctl(neg.map(o=>o[k]),.5)}/${pctl(neg.map(o=>o[k]),.75)}  起涨 ${pctl(pos.map(o=>o[k]),.25)}/${pctl(pos.map(o=>o[k]),.5)}/${pctl(pos.map(o=>o[k]),.75)}`);
  }
  console.log('\npre_chg5(研究口径) vs bp_chg5(FP锚口径) 一致性:');
  let same = 0, tot = 0;
  for (const o of out) { if (o.pre_chg5 != null && o.bp_chg5 != null) { tot++; if (Math.sign(o.pre_chg5) === Math.sign(o.bp_chg5)) same++; } }
  console.log(`  符号一致 ${same}/${tot}`);

  // 候选臂参数（bp 口径）效果扫描
  console.log('\n=== bp_chg5 口径候选线（尾部研究票上）');
  for (const c5 of [-5, -3, 0]) {
    const hit = out.filter(o => o.bp_chg5 != null && o.bp_chg5 < c5);
    const eps = hit.map(o => o.epPnl).filter(x => x != null);
    console.log(`  bp_chg5<${c5}: n=${hit.length}(死${hit.filter(o=>o.mx<3).length}/涨${hit.filter(o=>o.mx>=10).length}) epΣ=${eps.length?eps.reduce((s,x)=>s+x,0).toFixed(1):'—'}`);
  }
  // 域线（bp_athVs/bp_vol/bp_curVs 的组合）对 E 组的分离——E 组 BP 行也拉一部分
  console.log('\n=== 对照（需要 E 组锚——抽样 60 票）');
  const all = JSON.parse(fs.readFileSync('/tmp/tail-entry-study.json', 'utf8'));
  const eByTk = new Map();
  for (const r of all.filter(r => r.grp === 'E_early_thin')) { if (!eByTk.has(r.token)) eByTk.set(r.token, r); }
  const eSamp = [...eByTk.values()].slice(0, 60);
  const eOut = [];
  for (const p of eSamp) {
    const { data, error } = await sb.from('buy_point_analyses')
      .select('created_at,anchors').eq('token_address', p.token).order('created_at', { ascending: true }).limit(2000);
    if (error) continue;
    let best = null, bd = 1e18;
    for (const r of data || []) { const dt = Math.abs(new Date(r.created_at).getTime() - p.buyTs); if (dt < bd) { bd = dt; best = r; } }
    if (best && bd < 15000) {
      const a = best.anchors || {};
      eOut.push({ chg5: a.chg5Pct ?? null, athVs: a.athVsLaunchPct ?? null, curVs: a.currentVsLaunchPct ?? null, vol: a.totalVolumeBnb ?? null, ep: p.epPnl ?? null });
    }
  }
  console.log(`E 组抽样配到=${eOut.length}`);
  // 域线分离：E 组在 athVs>=40 ∧ curVs<=28.5 的进入率
  const inDomain = eOut.filter(o => o.athVs != null && o.curVs != null && o.athVs >= 40 && o.curVs <= 28.5);
  console.log(`E 组进入 athVs>=40∧curVs<=28.5 域: ${inDomain.length}/${eOut.filter(o=>o.athVs!=null&&o.curVs!=null).length}`);
  const inD2 = eOut.filter(o => o.athVs != null && o.curVs != null && o.vol != null && o.athVs >= 40 && o.curVs <= 28.5 && o.vol >= 3);
  console.log(`E 组进入 +vol>=3 域: ${inD2.length}`);
  // 尾部组在同域的覆盖
  const tIn = out.filter(o => o.bp_athVs != null && o.bp_curVs != null && o.bp_athVs >= 40 && o.bp_curVs <= 28.5);
  console.log(`尾部组进入同域: ${tIn.length}/${out.length}（其中 chg5<-5: ${tIn.filter(o => o.bp_chg5 != null && o.bp_chg5 < -5).length}）`);
  const tIn2 = out.filter(o => o.bp_athVs >= 40 && o.bp_curVs <= 28.5 && o.bp_vol >= 3);
  console.log(`尾部组进入 +vol>=3 域: ${tIn2.length}/${out.length}（其中 chg5<-5: ${tIn2.filter(o => o.bp_chg5 != null && o.bp_chg5 < -5).length}）`);
  fs.writeFileSync('/tmp/tail-fp-calib.json', JSON.stringify(out));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
