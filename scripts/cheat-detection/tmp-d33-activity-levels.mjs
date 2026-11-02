#!/usr/bin/env node
// tmp：D3.2 活跃度锚正式口径 55 票分布（182 跑，零 Jev 配额）——四档+CV 直接读
// buildSnapshotFromRows.derived（单一真相源；切点=15/70/140 tpm + 尘笔均 0.05 + 长空窗 120s）。
// 按 expect 类聚合档位分布 + 逐票表；重点标 CD3（低活跃典型）与四张 healthy 兜底错票。
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
const { buildSnapshotFromRows } = require_('../../src/market-analysis/cheat-snapshot.js');
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
const { loadAndValidateFixtures } = await import('./lib.mjs');
const { cases, errors } = loadAndValidateFixtures(fxDoc);
if (errors.length) { console.error(errors.join('\n')); process.exit(2); }

const tickets = [];
for (const c of cases) {
  const rows = await pullTicksToAnchor(c.addr.toLowerCase(), c.anchor.tickCount);
  const meta = { address: c.addr, symbol: c.symbol, name: c.symbol, platform: null, quoteToken: null, createdAt: null, creatorAddress: null };
  const d = buildSnapshotFromRows(rows, meta, { capped: false, anchorTickCount: rows.length }).derived;
  tickets.push({
    id: c.caseId, symbol: c.symbol, want: c.expect?.verdict, n: rows.length,
    tpm: d.ticksPerMin, avg: d.avgTradeBnb, gap: d.maxGapSec,
    lvl: d.activityLevel, cv: d.activityCv, uneven: d.activityUneven === true,
  });
}
console.log('id    symbol      want      n    tpm     avg     gap    lvl    cv    uneven');
for (const t of tickets) {
  const mark = (t.id === 'CD3' || ['CD2', 'CD31', 'CD41', 'CD46'].includes(t.id)) ? ' ◀' : '';
  console.log(`${t.id.padEnd(5)} ${String(t.symbol).padEnd(11).slice(0, 11)} ${String(t.want).padEnd(9)} ${String(t.n).padEnd(5)} ${String(t.tpm).padEnd(7)} ${String(t.avg).padEnd(7)} ${String(t.gap).padEnd(6)} ${String(t.lvl).padEnd(6)} ${String(t.cv).padEnd(6)} ${t.uneven ? 'Y' : ''}${mark}`);
}

console.log('\n== 按类 × 档位分布 ==');
for (const k of ['cheat', 'unhealthy', 'healthy']) {
  const sub = tickets.filter((t) => t.want === k);
  const byLvl = { ultra: 0, high: 0, mid: 0, low: 0, 'null/不可评': 0 };
  for (const t of sub) byLvl[t.lvl ?? 'null/不可评']++;
  const uneven = sub.filter((t) => t.uneven).length;
  console.log(`  ${k.padEnd(9)} n=${sub.length}  档位 ultra=${byLvl.ultra} high=${byLvl.high} mid=${byLvl.mid} low=${byLvl.low} 不可评=${byLvl['null/不可评']} ｜ 不均衡 ${uneven}`);
  for (const lvl of ['ultra', 'high', 'mid', 'low']) {
    const ids = sub.filter((t) => t.lvl === lvl).map((t) => t.id);
    if (ids.length) console.log(`      ${lvl}: ${ids.join(',')}`);
  }
}

console.log('\n== 不均衡（cv≥1.0）逐票 ==');
const un = tickets.filter((t) => t.uneven);
for (const t of un) console.log(`  ${t.id} ${String(t.want).padEnd(9)} cv=${t.cv} lvl=${t.lvl}`);
const byC = { cheat: 0, unhealthy: 0, healthy: 0 };
for (const t of un) byC[t.want]++;
console.log(`  合计 ${un.length}: cheat ${byC.cheat} unhealthy ${byC.unhealthy} healthy ${byC.healthy}`);
