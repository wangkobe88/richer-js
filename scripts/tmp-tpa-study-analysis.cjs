// 本地二次分析：/tmp/tpa-study.json（tmp-tpa-price-study.cjs 产物）
// 核心：控制 anchorVsLaunchPct（锚点位置）分层后，看画像特征 × 前向收益的关系
'use strict';
const fs = require('fs');
const d = JSON.parse(fs.readFileSync('/tmp/tpa-study.json', 'utf8'));
const rows = d.rows;

const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const win = (a) => a.length ? a.filter(v => v > 0.5).length / a.length * 100 : null; // 60m last > +0.5% 视为涨（滤掉「0% 死票」噪声）
const q = (arr, k) => arr.filter(x => x[k] != null && Number.isFinite(x[k])).map(x => x[k]);
const fmt = (x, dd = 1) => (x == null || !Number.isFinite(x)) ? '  null' : x.toFixed(dd).padStart(7);

function layer(name, filter) {
  const sub = rows.filter(filter);
  return { name, sub };
}

// ── 分层定义（anchorVs：锚点价 vs 首可靠价）──
const LAYERS = [
  layer('锚点低位 <-10%（贴/破首发价）', r => r.anchorVsLaunchPct != null && r.anchorVsLaunchPct < -10),
  layer('锚点中位 [-10,+50)', r => r.anchorVsLaunchPct != null && r.anchorVsLaunchPct >= -10 && r.anchorVsLaunchPct < 50),
  layer('锚点高位 >=+50%（已拉升）', r => r.anchorVsLaunchPct != null && r.anchorVsLaunchPct >= 50),
];

function bucketRows(sub, keyFn, buckets) {
  const out = [];
  for (const [label, lo, hi] of buckets) {
    const b = sub.filter(r => { const v = keyFn(r); return v != null && Number.isFinite(v) && v >= lo && (hi == null || v < hi); });
    out.push([label, b]);
  }
  return out;
}

function pctl(a, f) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * f))];
}
function fwdLine(b) {
  if (!b.length) return '  (空)';
  const l60 = q(b, 'fwd60mLast'), mr60 = q(b, 'fwd60mMaxRise'), md = q(b, 'fwd60mMaxDrop');
  return `n=${String(b.length).padStart(3)} 买${String(b.filter(r => r.bought).length).padStart(2)} | 60mLast med=${fmt(med(l60))} p25=${fmt(pctl(l60, 0.25))} p75=${fmt(pctl(l60, 0.75))} win=${fmt(win(l60))}% | 60mRise med=${fmt(med(mr60))} | 60mDrop med=${fmt(med(md))}`;
}

console.log('══════════ 总体样本结构 ══════════');
for (const L of LAYERS) {
  const { sub } = L;
  console.log(`\n【${L.name}】`);
  console.log(`  ` + fwdLine(sub));
  console.log(`  画像均值: score=${fmt(mean(q(sub, 'tokenScore')))} zhuang%=${fmt(mean(q(sub, 'zhuangPct')))} newW%=${fmt(mean(q(sub, 'newWalletPct')))} retail%=${fmt(mean(q(sub, 'retailPct')))} top1%=${fmt(mean(q(sub, 'top1FloatPct')))} bad14d钱包均=${fmt(mean(q(sub, 'bad14dSum')))} age_med=${fmt(med(q(sub, 'anchorAgeSec')), 0)}`);
}

console.log('\n══════════ 层内：tokenScore 三档 × 前向 ══════════');
for (const L of LAYERS) {
  console.log(`\n【${L.name}】`);
  for (const [label, b] of bucketRows(L.sub, r => r.tokenScore, [['score<1.5', -99, 1.5], ['1.5~2.2', 1.5, 2.2], ['2.2~2.8', 2.2, 2.8], ['>=2.8', 2.8, null]])) {
    console.log(`  ${label.padEnd(10)} ` + fwdLine(b));
  }
}

console.log('\n══════════ 层内：zhuangPct（庄型占比）× 前向 ══════════');
for (const L of LAYERS) {
  console.log(`\n【${L.name}】`);
  for (const [label, b] of bucketRows(L.sub, r => r.zhuangPct, [['zh<10%', -1, 10], ['10~50%', 10, 50], ['50~90%', 50, 90], ['>=90%', 90, null]])) {
    console.log(`  ${label.padEnd(9)} ` + fwdLine(b));
  }
}

console.log('\n══════════ 层内：newWalletPct（新钱包占比）× 前向 ══════════');
for (const L of LAYERS) {
  console.log(`\n【${L.name}】`);
  for (const [label, b] of bucketRows(L.sub, r => r.newWalletPct, [['nw<10%', -1, 10], ['10~30%', 10, 30], ['30~60%', 30, 60], ['>=60%', 60, null]])) {
    console.log(`  ${label.padEnd(9)} ` + fwdLine(b));
  }
}

console.log('\n══════════ 层内：retailPct（散户/职业快买占比）× 前向 ══════════');
for (const L of LAYERS) {
  console.log(`\n【${L.name}】`);
  for (const [label, b] of bucketRows(L.sub, r => r.retailPct, [['ret<5%', -1, 5], ['5~15%', 5, 15], ['>=15%', 15, null]])) {
    console.log(`  ${label.padEnd(9)} ` + fwdLine(b));
  }
}

console.log('\n══════════ 层内：top1FloatPct（第一大户集中度）× 前向 ══════════');
for (const L of LAYERS) {
  console.log(`\n【${L.name}】`);
  for (const [label, b] of bucketRows(L.sub, r => r.top1FloatPct, [['top1<20%', -1, 20], ['20~40%', 20, 40], ['>=40%', 40, null]])) {
    console.log(`  ${label.padEnd(10)} ` + fwdLine(b));
  }
}

console.log('\n══════════ 层内：bad14d 在场（top20 内 badCount14d>0 钱包数）× 前向 ══════════');
for (const L of LAYERS) {
  console.log(`\n【${L.name}】`);
  for (const [label, b] of bucketRows(L.sub, r => (q([r], 'bad14dSum')[0] || 0) > 0 ? 1 : 0, [['无 bad14d 钱包', -1, 1], ['有 bad14d 钱包', 1, null]])) {
    console.log(`  ${label.padEnd(12)} ` + fwdLine(b));
  }
}

// Spearman（层内）
function spearman(sub, xs, ys) {
  const pts = sub.filter(r => r[xs] != null && Number.isFinite(r[xs]) && r[ys] != null && Number.isFinite(r[ys]));
  if (pts.length < 15) return { n: pts.length, rho: null };
  const rank = (vals) => {
    const idx = vals.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(vals.length); let i = 0;
    while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const rk = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = rk; i = j + 1; }
    return r;
  };
  const rx = rank(pts.map(p => p[xs])), ry = rank(pts.map(p => p[ys]));
  const n = pts.length, mx = mean(rx), my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  return { n, rho: dx && dy ? num / Math.sqrt(dx * dy) : null };
}
console.log('\n══════════ 层内 Spearman（× fwd60mLast）═══════════');
for (const L of LAYERS) {
  console.log(`\n【${L.name}】`);
  for (const f of ['tokenScore', 'zhuangPct', 'newWalletPct', 'retailPct', 'top1FloatPct', 'bad14dSum', 'ratio', 'medianHoldMed']) {
    const a = spearman(L.sub, f, 'fwd60mLast'), b = spearman(L.sub, f, 'fwd60mMaxRise');
    console.log(`  ${f.padEnd(15)} last rho=${a.rho == null ? 'null' : a.rho.toFixed(3)}(n=${a.n})   maxRise rho=${b.rho == null ? 'null' : b.rho.toFixed(3)}`);
  }
}

// 反向：层内按 fwd60mLast 分桶看画像
console.log('\n══════════ 反向（层内）：按 fwd60mLast 分桶 → 画像均值 ══════════');
for (const L of LAYERS) {
  console.log(`\n【${L.name}】`);
  console.log('  bucket        n   score  zhuang% newW%  retail% top1%  bad14d  medHold  age');
  for (const [label, lo, hi] of [['<-30%', null, -30], ['-30~-5', -30, -5], ['-5~+5(死)', -5, 5], ['+5~+50', 5, 50], ['>+50', 50, null]]) {
    const b = L.sub.filter(r => { const v = r.fwd60mLast; return v != null && Number.isFinite(v) && (lo == null || v >= lo) && (hi == null || v < hi); });
    if (!b.length) { console.log(`  ${label.padEnd(11)}   0`); continue; }
    console.log(`  ${label.padEnd(11)} ${String(b.length).padStart(3)} ${fmt(mean(q(b, 'tokenScore')))} ${fmt(mean(q(b, 'zhuangPct')))} ${fmt(mean(q(b, 'newWalletPct')))} ${fmt(mean(q(b, 'retailPct')))} ${fmt(mean(q(b, 'top1FloatPct')))} ${fmt(mean(q(b, 'bad14dSum')))} ${fmt(mean(q(b, 'medianHoldMed')), 0)} ${fmt(mean(q(b, 'anchorAgeSec')), 0)}`);
  }
}

// 四桶构成矩阵（zhuang × newWallet 高低组合）
console.log('\n══════════ 组合视角：zhuangPct×newWalletPct 四象限（全体+中位层）═══════════');
for (const L of [LAYERS[1], LAYERS[0]]) {
  console.log(`\n【${L.name}】`);
  for (const [zl, zlo] of [['zh低(<10)', 10], ['zh高(≥10)', null]]) {
    for (const [nl, nlo] of [['nw低(<20)', 20], ['nw高(≥20)', null]]) {
      const b = L.sub.filter(r => (zlo == null ? r.zhuangPct >= 10 : r.zhuangPct < 10) && (nlo == null ? r.newWalletPct >= 20 : r.newWalletPct < 20));
      console.log(`  ${zl}/${nl} `.padEnd(22) + fwdLine(b));
    }
  }
}

// 买入票 vs 未买（层内）
console.log('\n══════════ 层内：实验买入 vs 未买 前向对比 ══════════');
for (const L of LAYERS) {
  console.log(`\n【${L.name}】`);
  console.log(`  买入票 ` + fwdLine(L.sub.filter(r => r.bought)));
  console.log(`  未买票 ` + fwdLine(L.sub.filter(r => !r.bought)));
}
