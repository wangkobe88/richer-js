#!/usr/bin/env node
// CD136 D3.39+G13 全量对拍分析（一次性，跑在 182 data/ 目录旁）
const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const fix = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures.json'), 'utf8'));
const exp = {};
fix.cases.forEach((x) => { exp[x.caseId] = x.expect.verdict; });

const cur = JSON.parse(fs.readFileSync(path.join(HERE, 'data/cd-run-2026-11-03T00-58-40-508Z.json'), 'utf8'));
const prev = JSON.parse(fs.readFileSync(path.join(HERE, 'data/cd-run-2026-11-02T15-57-51-183Z.json'), 'utf8'));
const prevG = {}; prev.results.forEach((r) => { prevG[r.caseId] = r.grade; });
const prevAbr = {}; prev.results.forEach((r) => {
  const p = r.interp && r.interp.participation;
  prevAbr[r.caseId] = p ? (p.bucket || p) : null;
});
const codes = (r) => (r.gradeReasons || []).map((g) => g.code || String(g));
const abrOf = (r) => {
  const a = r.interp && r.interp.abnormalBehavior;
  return a ? (a.bucket || a) : null;
};

console.log('=== R 通道命中（R_abnormal_dominant）===');
const rHits = cur.results.filter((r) => codes(r).some((c) => c.startsWith('R_')));
console.log('R hits:', rHits.length);
rHits.forEach((r) => console.log(`  ${r.caseId} → ${r.grade}（人工 ${exp[r.caseId]}）（abr=${abrOf(r)}）（D3.38 grade=${prevG[r.caseId]}，D3.38 part=${prevAbr[r.caseId]}）`));

console.log('\n=== R 未命中但 abr=dominant（被更重通道盖过/取最重）===');
cur.results.filter((r) => abrOf(r) === 'dominant' && !codes(r).some((c) => c.startsWith('R_')))
  .forEach((r) => console.log(`  ${r.caseId} → ${r.grade}（人工 ${exp[r.caseId]}）reasons=${codes(r).join(',')}`));

console.log('\n=== abr=dominant 24 票 × 人工裁定 ===');
const domX = {};
cur.results.filter((r) => abrOf(r) === 'dominant').forEach((r) => {
  const k = `${r.grade}（机器）×${exp[r.caseId]}（人工）`;
  (domX[k] = domX[k] || []).push(r.caseId);
});
Object.keys(domX).sort().forEach((k) => console.log(`  ${k}: ${domX[k].length} 票 ${domX[k].join(' ')}`));

console.log('\n=== abr 桶 × 人工交叉 ===');
['negligible', 'noticeable', 'dominant'].forEach((b) => {
  const rows = cur.results.filter((r) => abrOf(r) === b);
  const byExp = {};
  rows.forEach((r) => { byExp[exp[r.caseId]] = (byExp[exp[r.caseId]] || 0) + 1; });
  console.log(`  ${b}=${rows.length}：${Object.keys(byExp).map((k) => `人工${k}=${byExp[k]}`).join(' ')}`);
});

console.log('\n=== 与 D3.38 相比新误伤（人工 healthy 且 D3.38 healthy、本轮非 healthy）===');
cur.results.filter((r) => exp[r.caseId] === 'healthy' && r.grade !== 'healthy' && prevG[r.caseId] === 'healthy')
  .forEach((r) => console.log(`  ${r.caseId} → ${r.grade} reasons=${codes(r).join(',')}（abr=${abrOf(r)}）`));

console.log('\n=== 误伤全集（人工 healthy → 机器非 healthy）===');
console.log(' ', cur.results.filter((r) => exp[r.caseId] === 'healthy' && r.grade !== 'healthy')
  .map((r) => `${r.caseId}→${r.grade}`).join(' ') || '零');

console.log('\n=== cheat 放行（人工 cheat → 机器 healthy）===');
console.log(' ', cur.results.filter((r) => exp[r.caseId] === 'cheat' && r.grade === 'healthy')
  .map((r) => r.caseId).join(' '));

console.log('\n=== 一致性汇总 ===');
const agree = cur.results.filter((r) => r.grade === exp[r.caseId]).length;
console.log(`  agree ${agree}/128`);
const gd = {}; cur.results.forEach((r) => { gd[r.grade] = (gd[r.grade] || 0) + 1; });
console.log('  机器分布:', JSON.stringify(gd));
const ed = {}; Object.values(exp).forEach((v) => { ed[v] = (ed[v] || 0) + 1; });
console.log('  人工分布:', JSON.stringify(ed));
// 拒买级以上口径（cheat+unhealthy 都拦买）
const blockAgree = cur.results.filter((r) => (r.grade === 'healthy') === (exp[r.caseId] === 'healthy')).length;
console.log(`  拦/放口径一致（healthy vs 非healthy）: ${blockAgree}/128`);

console.log('\n=== 翻转票明细（vs D3.38）===');
cur.results.filter((r) => prevG[r.caseId] && prevG[r.caseId] !== r.grade)
  .forEach((r) => console.log(`  ${r.caseId}: ${prevG[r.caseId]}→${r.grade}（人工 ${exp[r.caseId]}）reasons=${codes(r).join(',')}（abr=${abrOf(r)}）`));
