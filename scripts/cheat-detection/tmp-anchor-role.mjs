#!/usr/bin/env node
/**
 * 一次性探针（不进 git、零 DB 零网络）：sbHold/eqHold 两锚在 golden 42 校准集里的角色量化。
 * 三问：
 *   ①基线机器判罚里，有多少 cheat/unhealthy 是这两锚的数值消费通道（B/C/F）载体？
 *   ②反事实抽锚（sbHold→null / eqHold→null / 双抽）判罚怎么翻？（G 豁免臂依赖同锚，抽取可能双向翻）
 *   ③锚值分布 vs 人工期望（cheat/unhealthy/healthy 组的 sbHold/eqHold 高值面）
 */
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { gradeObservation } = require_('../../src/market-analysis/cheat-grade.js');

const golden = JSON.parse(readFileSync(resolve(HERE, 'data/cheat-grade-golden-42.json'), 'utf8'));
const cases = golden.cases;

const nullKeys = (obs, keys) => {
  const o = JSON.parse(JSON.stringify(obs));
  if (o.anchors) for (const k of keys) o.anchors[k] = null;
  return o;
};

const lvlRank = { healthy: 0, unhealthy: 1, cheat: 2 };
const fmt = (v) => (v === null || v === undefined) ? 'null' : v.toFixed(1);

let basePass = 0;
const rows = [];
for (const c of cases) {
  const base = gradeObservation(c.observation, c.extras || {});
  if (base.grade === c.expect) basePass++;
  const cfSb = gradeObservation(nullKeys(c.observation, ['sameBlockHoldPct']), c.extras || {}).grade;
  const cfEq = gradeObservation(nullKeys(c.observation, ['equalBandHoldPct']), c.extras || {}).grade;
  const cfBoth = gradeObservation(nullKeys(c.observation, ['sameBlockHoldPct', 'equalBandHoldPct']), c.extras || {}).grade;
  const a = c.observation.anchors || {};
  const eqLvl = c.observation.phenomena?.equal_amount_split ?? c.observation.extLevels?.equal_amount_split ?? null;
  const sbLvl = c.observation.phenomena?.same_block_buy_wave ?? c.observation.extLevels?.same_block_buy_wave ?? null;
  rows.push({
    id: c.caseId, expect: c.expect, base: base.grade, reasons: (base.reasons || []).map((r) => r.code),
    sbHold: a.sameBlockHoldPct, eqHold: a.equalBandHoldPct, eqLvl, sbLvl,
    cfSb, cfEq, cfBoth,
    flipSb: cfSb !== base.grade, flipEq: cfEq !== base.grade, flipBoth: cfBoth !== base.grade,
  });
}

console.log(`golden 42（${golden.rulesVersion} replay ${golden.replayNote || ''}）基线一致 ${basePass}/42\n`);

// ①数值消费通道载体统计（B/C/F 直接读锚；G 豁免臂=锚的反向角色）
const chanCount = {};
for (const r of rows) for (const code of r.reasons) chanCount[code] = (chanCount[code] || 0) + 1;
const sbNumeric = rows.filter((r) => r.reasons.some((c) => /sbHold/.test(c)));
console.log('① 通道载体（机器判罚 reason 码频次）：');
const sorted = Object.entries(chanCount).sort((a, b) => b[1] - a[1]);
for (const [code, n] of sorted) console.log(`   ${code.padEnd(34)} ×${n}`);
console.log(`\n   sbHold 数值消费载体（B/C/F 任一命中）：${sbNumeric.length}/42 票`);
console.log(`   其中 cheat 级：${sbNumeric.filter((r) => r.base === 'cheat').length} 票 / unhealthy 级：${sbNumeric.filter((r) => r.base === 'unhealthy').length} 票`);

// ②反事实
const flips = (k) => rows.filter((r) => r[k]);
for (const [k, label] of [['flipSb', '抽 sbHold'], ['flipEq', '抽 eqHold'], ['flipBoth', '双抽']]) {
  const f = flips(k);
  console.log(`\n② 反事实 ${label}：翻 ${f.length}/42`);
  for (const r of f) {
    const get = k === 'flipSb' ? 'cfSb' : k === 'flipEq' ? 'cfEq' : 'cfBoth';
    console.log(`   ${r.id} ${r.base}→${r[get]}（人工=${r.expect} sbHold=${fmt(r.sbHold)} eqHold=${fmt(r.eqHold)}）`);
  }
}

// ③分布 vs 期望
console.log('\n③ 锚值分布（按人工期望分组）：');
for (const g of ['cheat', 'unhealthy', 'healthy']) {
  const sub = rows.filter((r) => r.expect === g);
  const sb50 = sub.filter((r) => (r.sbHold ?? 0) >= 50).length;
  const sb85 = sub.filter((r) => (r.sbHold ?? 0) >= 85).length;
  const eq50 = sub.filter((r) => (r.eqHold ?? 0) >= 50).length;
  const eqStrong = sub.filter((r) => r.eqLvl === 'strong').length;
  console.log(`   人工=${g.padEnd(10)} n=${sub.length}  sbHold≥50: ${sb50}  ≥85: ${sb85}  eqHold≥50: ${eq50}  Jev eq 档=strong: ${eqStrong}`);
}
// eq strong 全量点名
console.log(`\n   Jev equal_amount_split=strong 的票：${rows.filter((r) => r.eqLvl === 'strong').map((r) => `${r.id}(人工=${r.expect})`).join(' ') || '无'}`);
// sbHold≥50 组人工期望构成
const sb50all = rows.filter((r) => (r.sbHold ?? 0) >= 50);
console.log(`   全集 sbHold≥50 的 ${sb50all.length} 票人工构成：cheat ${sb50all.filter((r) => r.expect === 'cheat').length} / unhealthy ${sb50all.filter((r) => r.expect === 'unhealthy').length} / healthy ${sb50all.filter((r) => r.expect === 'healthy').length}`);
const eq50all = rows.filter((r) => (r.eqHold ?? 0) >= 50);
console.log(`   全集 eqHold≥50 的 ${eq50all.length} 票人工构成：cheat ${eq50all.filter((r) => r.expect === 'cheat').length} / unhealthy ${eq50all.filter((r) => r.expect === 'unhealthy').length} / healthy ${eq50all.filter((r) => r.expect === 'healthy').length}`);
