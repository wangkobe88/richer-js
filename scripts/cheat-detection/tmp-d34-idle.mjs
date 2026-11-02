#!/usr/bin/env node
// tmp：D3.2 校准——无交易期占比维度（10-31 用户裁定 CD4「活跃度应为 low，原因=大比例无交易期」）：
// 逐票 gap 分布 / 最长单段空窗占比 maxGapRatio / 惰性占比 idleRatio(T)=Σ(gap≥T)/span。零 Jev 配额。
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';
import { createRequire } from 'module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);

function sb() {
  const { dbManager } = require_('../../src/services/dbManager.js');
  return dbManager.getClient();
}
async function pullTicksToAnchor(token, n) {
  const { data, error } = await sb().from('wss_price_ticks').select('block_time,block_number,log_index')
    .eq('token_address', token).order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(n);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (rows.length < n) throw new Error(`锚截窗不足：锚=${n} 实际=${rows.length}`);
  return rows;
}

const fxDoc = JSON.parse(readFileSync(resolve(HERE, 'fixtures.json'), 'utf8'));
const { loadAndValidateFixtures } = await import('./lib.mjs');
const { cases, errors } = loadAndValidateFixtures(fxDoc);
if (errors.length) { console.error(errors.join('\n')); process.exit(2); }

const tickets = [];
for (const c of cases) {
  const rows = await pullTicksToAnchor(c.addr.toLowerCase(), c.anchor.tickCount);
  const t0 = new Date(rows[0].block_time).getTime();
  const dts = rows.map((r) => Math.round((new Date(r.block_time).getTime() - t0) / 1000));
  const gaps = [];
  for (let i = 1; i < dts.length; i++) gaps.push(dts[i] - dts[i - 1]);
  const sorted = [...gaps].sort((a, b) => a - b);
  const medGap = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const span = Math.max(1, dts[dts.length - 1] - dts[0]);
  const maxGap = gaps.length ? Math.max(...gaps) : 0;
  const idle = (T) => (gaps.filter((g) => g >= T).reduce((a, b) => a + b, 0)) / span;
  tickets.push({
    id: c.caseId, symbol: c.symbol, want: c.expect?.verdict, n: rows.length, span,
    maxGap, maxGapRatio: maxGap / span, medGap, idle10: idle(10), idle15: idle(15),
  });
}
console.log('id    symbol      want      n    span  medGap maxGap mgR%   idle10 idle15');
for (const t of tickets) {
  const mark = t.id === 'CD4' ? ' ◀' : '';
  console.log(`${t.id.padEnd(5)} ${String(t.symbol).padEnd(11).slice(0, 11)} ${String(t.want).padEnd(9)} ${String(t.n).padEnd(5)} ${String(t.span).padEnd(5)} ${String(t.medGap).padEnd(6)} ${String(t.maxGap).padEnd(6)} ${(t.maxGapRatio * 100).toFixed(0).padEnd(5)} ${(t.idle10 * 100).toFixed(0).padEnd(6)} ${(t.idle15 * 100).toFixed(0).padEnd(6)}${mark}`);
}
for (const [label, key, T] of [['idle10≥30%', 'idle10', 0.3], ['idle10≥50%', 'idle10', 0.5], ['maxGapRatio≥50%', 'maxGapRatio', 0.5]]) {
  console.log(`\n== 若 low 门加 ${label}：命中票（按类）==`);
  for (const k of ['cheat', 'unhealthy', 'healthy']) {
    const ids = tickets.filter((t) => t.want === k && t[key] >= T).map((t) => `${t.id}(${(t[key] * 100).toFixed(0)}%)`);
    console.log(`  ${k.padEnd(9)} ${ids.length}: ${ids.join(' ')}`);
  }
}
