#!/usr/bin/env node
// tmp：D3.2 活跃度锚候选口径实测（182 跑，零 Jev 配额）——用户裁定「增加一个活跃度低的锚」
// 直观判据（用户原话）：交易额低、有长期空窗期。候选口径全算，按类聚合 + 逐票表，
// 重点标 CD3（用户点名典型）与四张 healthy 兜底错票（CD2/CD31/CD41/CD46）。
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
const TICK_COLS = 'block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,price_outlier,trader_address,sender_address';
async function pullTicksToAnchor(token, n) {
  const { data, error } = await sb().from('wss_price_ticks').select(TICK_COLS)
    .eq('token_address', token).order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(n);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (rows.length < n) throw new Error(`锚截窗不足：锚=${n} 实际=${rows.length}`);
  return rows;
}

const fxDoc = JSON.parse(readFileSync(resolve(HERE, 'fixtures.json'), 'utf8'));
// loadAndValidateFixtures 收已解析 doc
const { loadAndValidateFixtures } = await import('./lib.mjs');
const { cases, errors } = loadAndValidateFixtures(fxDoc);
if (errors.length) { console.error(errors.join('\n')); process.exit(2); }

const ts = (r) => new Date(r.block_time).getTime();
const tickets = [];
for (const c of cases) {
  const rows = await pullTicksToAnchor(c.addr.toLowerCase(), c.anchor.tickCount);
  const t0 = ts(rows[0]);
  const spanSec = Math.max(1, (ts(rows[rows.length - 1]) - t0) / 1000);
  const gaps = [];
  for (let i = 1; i < rows.length; i++) gaps.push((ts(rows[i]) - ts(rows[i - 1])) / 1000);
  gaps.sort((a, b) => a - b);
  const maxGap = gaps.length ? gaps[gaps.length - 1] : 0;
  const medGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
  const volume = rows.reduce((s, r) => s + (r.bnb_amount || 0), 0);
  tickets.push({
    id: c.caseId, symbol: c.symbol, want: c.expect?.verdict, n: rows.length,
    spanSec: Math.round(spanSec),
    tpm: +(rows.length / spanSec * 60).toFixed(2),          // 笔/分钟
    maxGapSec: Math.round(maxGap),
    maxGapPct: +(maxGap / spanSec * 100).toFixed(1),          // 最长空窗占窗比
    medGapSec: +medGap.toFixed(1),
    gapsOver60: gaps.filter((g) => g > 60).length,
    volumeBnb: +volume.toFixed(2),
    avgBnb: +(volume / rows.length).toFixed(4),
  });
}
console.log('id    symbol      want      n  span  tpm   maxGap  gap%  medGap >60s  vol     avg');
for (const t of tickets) {
  const mark = (t.id === 'CD3' || ['CD2', 'CD31', 'CD41', 'CD46'].includes(t.id)) ? ' ◀' : '';
  console.log(`${t.id.padEnd(5)} ${String(t.symbol).padEnd(11).slice(0, 11)} ${String(t.want).padEnd(9)} ${String(t.n).padEnd(3)} ${String(t.spanSec).padEnd(5)} ${String(t.tpm).padEnd(5)} ${String(t.maxGapSec).padEnd(7)} ${String(t.maxGapPct).padEnd(5)} ${String(t.medGapSec).padEnd(6)} ${String(t.gapsOver60).padEnd(5)} ${String(t.volumeBnb).padEnd(7)} ${t.avgBnb}${mark}`);
}

const stat = (arr) => {
  const s = arr.filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return 'n/a';
  return `med=${s[Math.floor(s.length / 2)]} q25=${s[Math.floor(s.length * 0.25)]} q75=${s[Math.min(s.length - 1, Math.floor(s.length * 0.75))]}`;
};
console.log('\n== 按类分布 ==');
for (const key of ['tpm', 'maxGapSec', 'maxGapPct', 'volumeBnb', 'avgBnb']) {
  for (const k of ['cheat', 'unhealthy', 'healthy']) {
    console.log(`  ${key.padEnd(10)} ${k.padEnd(9)} ${stat(tickets.filter((t) => t.want === k).map((t) => t[key]))}`);
  }
}
// 分离度速查：候选门（tpm < X 或 volumeBnb < Y）命中哪些类
console.log('\n== 候选低活跃门命中表 ==');
for (const [name, fn] of [
  ['tpm<2', (t) => t.tpm < 2],
  ['tpm<1', (t) => t.tpm < 1],
  ['vol<3 BNB', (t) => t.volumeBnb < 3],
  ['vol<2 BNB', (t) => t.volumeBnb < 2],
  ['avg<0.05', (t) => t.avgBnb < 0.05],
  ['maxGap>120s', (t) => t.maxGapSec > 120],
  ['maxGapPct>30', (t) => t.maxGapPct > 30],
]) {
  const hit = tickets.filter(fn);
  const byC = { cheat: 0, unhealthy: 0, healthy: 0 };
  for (const t of hit) byC[t.want]++;
  console.log(`  ${name.padEnd(13)} 命中 ${hit.length}: cheat ${byC.cheat} unhealthy ${byC.unhealthy} healthy ${byC.healthy}  [${hit.map((t) => t.id).join(',')}]`);
}
// healthy 兜底错票专项（活跃度锚的目标人群：sd<moderate 落兜底的 healthy 票）
console.log('\n== healthy 兜底错票（CD2/CD31/CD41/CD46）vs cheat 票口径对照 ==');
for (const t of tickets) {
  if (['CD2', 'CD31', 'CD41', 'CD46'].includes(t.id) || (t.want === 'cheat' && ['CD6', 'CD22', 'CD27', 'CD28', 'CD33', 'CD44'].includes(t.id))) {
    console.log(`  ${t.id} ${t.want.padEnd(9)} tpm=${t.tpm} vol=${t.volumeBnb} avg=${t.avgBnb} maxGap=${t.maxGapSec}s(${t.maxGapPct}%) n=${t.n}`);
  }
}
