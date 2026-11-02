#!/usr/bin/env node
// 一次性：golden 42 基线逐票 grade dump（G8 改动前存档，供 G9 diff）
import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { gradeObservation } = require_('../../src/market-analysis/cheat-grade.js');
const golden = JSON.parse(readFileSync(resolve(HERE, 'data/cheat-grade-golden-42.json'), 'utf8'));
const out = golden.cases.map((c) => {
  const g = gradeObservation(c.observation, c.extras || {});
  return { id: c.caseId, expect: c.expect, grade: g.grade, reasons: (g.reasons || []).map((r) => r.code) };
});
const agree = out.filter((r) => r.grade === r.expect).length;
console.log(`G8 baseline: ${agree}/42`);
writeFileSync(resolve(HERE, 'data/tmp-g8-baseline-grades.json'), JSON.stringify({ agree, rows: out }, null, 1));
