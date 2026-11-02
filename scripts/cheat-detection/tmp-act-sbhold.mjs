#!/usr/bin/env node
/**
 * 一次性探针（不进 git、零 DB 零网络）：验证用户直觉「代币活跃度极高 → sbHold 直接被拉很高」。
 * 数据源=cd-baseline 55 票存档（G8 前基线，sb/eq 两锚+activity.level 齐备）。
 */
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const run = JSON.parse(readFileSync(resolve(HERE, 'data/cd-baseline-aed2091d-2026-11-01T00-12-49-614Z.json'), 'utf8'));
const rows = run.results.map((c) => ({
  addr: c.addr, symbol: c.symbol,
  act: c.activity?.level ?? null, ticksPerMin: c.activity?.ticksPerMin ?? null,
  sbHold: c.anchors?.sameBlockHoldPct ?? null,
  eqHold: c.anchors?.equalBandHoldPct ?? null,
}));
const med = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
const pct = (xs, th) => { const v = xs.filter((x) => x != null); return v.length ? Math.round((v.filter((x) => x >= th).length / v.length) * 100) + '%' : '-'; };
console.log(`基线 ${rows.length} 票\n`);
console.log(['act档'.padEnd(6), 'n'.padEnd(4), 'tick/min中位'.padEnd(13), 'sbHold中位'.padEnd(11), 'sbHold≥50'.padEnd(9), '≥85'.padEnd(5), 'eqHold中位'.padEnd(11), 'eqHold≥50'].join(''));
for (const lv of ['low', 'mid', 'high', 'ultra']) {
  const sub = rows.filter((r) => r.act === lv);
  if (!sub.length) continue;
  const sb = sub.map((r) => r.sbHold); const eq = sub.map((r) => r.eqHold);
  console.log([lv.padEnd(6), String(sub.length).padEnd(4), String(med(sub.map((r) => r.ticksPerMin))).padEnd(13), String(med(sb)).padEnd(11), pct(sb, 50).padEnd(9), pct(sb, 85).padEnd(5), String(med(eq)).padEnd(11), pct(eq, 50)].join(''));
}
console.log('\n高活跃（high/ultra）∧ sbHold≥50 现场（用户直觉实证）：');
for (const r of rows.filter((r) => (r.act === 'high' || r.act === 'ultra') && (r.sbHold ?? 0) >= 50)) {
  console.log(`   ${r.symbol ?? ''} ${r.addr} act=${r.act} tick/min=${r.ticksPerMin} sbHold=${r.sbHold} eqHold=${r.eqHold}`);
}
