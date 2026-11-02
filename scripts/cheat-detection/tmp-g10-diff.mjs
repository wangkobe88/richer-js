#!/usr/bin/env node
/**
 * 一次性探针（不进 git、零 DB 零网络）：G10（撤 sbHold/eqHold 门侧消费）对黄金集 42 的重放 diff。
 * 对照=tmp-g8-baseline-grades.json（G8 基线，G9 已知唯一变化 CD97）。
 */
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { gradeObservation } = require_('../../src/market-analysis/cheat-grade.js');

const golden = JSON.parse(readFileSync(resolve(HERE, 'data/cheat-grade-golden-42.json'), 'utf8'));
const g8base = JSON.parse(readFileSync(resolve(HERE, 'data/tmp-g8-baseline-grades.json'), 'utf8'));

let pass = 0;
const diffs = [];
for (const c of golden.cases) {
  const r = gradeObservation(c.observation, c.extras || {});
  const ok = r.grade === c.expect;
  if (ok) pass++;
  const base8 = g8base[c.caseId] ?? '?';
  if (r.grade !== base8) diffs.push({ id: c.caseId, expect: c.expect, g8: base8, g10: r.grade, reasons: (r.reasons || []).map((x) => x.code).join(',') });
  else if (!ok) diffs.push({ id: c.caseId, expect: c.expect, g8: base8, g10: r.grade, reasons: (r.reasons || []).map((x) => x.code).join(','), note: 'G8 同判仍偏差' });
}
console.log(`G10 黄金集 ${pass}/42（G8 基线 35/42、G9 34/42）`);
console.log('\ngrade 变化/偏差票：');
for (const d of diffs) console.log(`   ${d.id} 人工=${d.expect} G8=${d.g8} G10=${d.g10} ${d.note ?? ''} [${d.reasons}]`);
