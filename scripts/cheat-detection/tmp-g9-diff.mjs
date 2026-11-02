#!/usr/bin/env node
// 一次性：G9 改动后黄金集重放 + 对 G8 基线逐票 diff
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { gradeObservation, CHEAT_GRADE_RULES_VERSION } = require_('../../src/market-analysis/cheat-grade.js');
console.log('rulesVersion =', CHEAT_GRADE_RULES_VERSION);
const golden = JSON.parse(readFileSync(resolve(HERE, 'data/cheat-grade-golden-42.json'), 'utf8'));
const base = JSON.parse(readFileSync(resolve(HERE, 'data/tmp-g8-baseline-grades.json'), 'utf8'));
const baseMap = new Map(base.rows.map((r) => [r.id, r]));
let agree = 0;
const diffs = [];
for (const c of golden.cases) {
  const g = gradeObservation(c.observation, c.extras || {});
  if (g.grade === c.expect) agree++;
  const b = baseMap.get(c.caseId);
  if (b.grade !== g.grade) {
    diffs.push({ id: c.caseId, expect: c.expect, g8: b.grade, g9: g.grade,
      g8r: b.reasons, g9r: (g.reasons || []).map((r) => r.code) });
  }
}
console.log(`G9 agree: ${agree}/42（G8 基线 ${base.agree}/42）`);
console.log(`grade 变化 ${diffs.length} 票：`);
for (const d of diffs) {
  console.log(`  ${d.id} ${d.g8}→${d.g9}（人工=${d.expect}）`);
  console.log(`     G8 reasons: ${d.g8r.join(' | ')}`);
  console.log(`     G9 reasons: ${d.g9r.join(' | ') || '（无）'}`);
}
// 与人工偏差票
const dev = golden.cases.map((c) => ({ c, g: gradeObservation(c.observation, c.extras || {}).grade }))
  .filter((x) => x.g !== x.c.expect);
console.log(`\nG9 与人工偏差 ${dev.length} 票：${dev.map((x) => `${x.c.caseId}(人工${x.c.expect}/机器${x.g})`).join(' ')}`);
