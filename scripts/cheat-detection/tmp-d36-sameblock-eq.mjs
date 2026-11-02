#!/usr/bin/env node
// tmp：D3.2c 候选——「同块近等额购买占比」（10-31 用户问询 CD6 语境：盘面停滞后同块涌入
// 一波额度相差不大的购买）。现有 D3.1 两锚=sb/eq 两轴分开且持仓（存量）口径；本脚本实测
// 流量（买入额）口径三列对照的 55 票分布（零 Jev 配额，182 跑）：
//   sbBuyPct  = 同块买入簇（≥3 笔 BUY 同块，对齐 SAME_BLOCK_CLUSTER_MIN）买入额 ÷ Σ买
//   eqBuyPct  = ±2% 对数金额带（带内 ≥3 笔 BUY 且 ≥0.001 BNB，对齐 D3.1 带帽）买入额 ÷ Σ买（不限块）
//   sbeqBuyPct= 交集形状：同块组内落同一 ±2% 对数带且带内 ≥2 笔的买入额 ÷ Σ买
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

const BAND_BASE = Math.log(1.02);
const MIN_BNB = 0.001;
const bandKey = (bnb) => Math.round(Math.log(bnb) / BAND_BASE);

const fxDoc = JSON.parse(readFileSync(resolve(HERE, 'fixtures.json'), 'utf8'));
const { loadAndValidateFixtures } = await import('./lib.mjs');
const { cases, errors } = loadAndValidateFixtures(fxDoc);
if (errors.length) { console.error(errors.join('\n')); process.exit(2); }

const tickets = [];
for (const c of cases) {
  const rows = await pullTicksToAnchor(c.addr.toLowerCase(), c.anchor.tickCount);
  const meta = { address: c.addr, symbol: c.symbol, name: c.symbol, platform: null, quoteToken: null, createdAt: null, creatorAddress: null };
  const snap = buildSnapshotFromRows(rows, meta, { capped: false, anchorTickCount: rows.length });
  const buys = snap.ticks.filter((t) => t.side === 'BUY');
  const totalBuy = buys.reduce((s, t) => s + (t.bnb || 0), 0);

  // 同块组
  const blockBuys = new Map();
  for (const t of buys) {
    if (t.block === null || t.block === undefined) continue;
    if (!blockBuys.has(t.block)) blockBuys.set(t.block, []);
    blockBuys.get(t.block).push(t);
  }
  let sbSum = 0;
  for (const arr of blockBuys.values()) if (arr.length >= 3) sbSum += arr.reduce((s, t) => s + (t.bnb || 0), 0);

  // 全窗对数带（不限块；≥3 笔才计）
  const bands = new Map();
  for (const t of buys) {
    const bnb = t.bnb || 0;
    if (bnb < MIN_BNB) continue;
    const k = bandKey(bnb);
    if (!bands.has(k)) bands.set(k, []);
    bands.get(k).push(t);
  }
  let eqSum = 0;
  for (const arr of bands.values()) if (arr.length >= 3) eqSum += arr.reduce((s, t) => s + (t.bnb || 0), 0);

  // 交集：同块组内同带 ≥2 笔
  let sbeqSum = 0;
  for (const arr of blockBuys.values()) {
    const inBands = new Map();
    for (const t of arr) {
      const bnb = t.bnb || 0;
      if (bnb < MIN_BNB) continue;
      const k = bandKey(bnb);
      if (!inBands.has(k)) inBands.set(k, []);
      inBands.get(k).push(t);
    }
    for (const a2 of inBands.values()) if (a2.length >= 2) sbeqSum += a2.reduce((s, t) => s + (t.bnb || 0), 0);
  }

  const pct = (v) => (totalBuy > 0 ? +((v / totalBuy) * 100).toFixed(1) : null);
  tickets.push({
    id: c.caseId, symbol: c.symbol, want: c.expect?.verdict, n: rows.length,
    sb: pct(sbSum), eq: pct(eqSum), sbeq: pct(sbeqSum),
  });
}
console.log('id    symbol      want      n    sb%   eq%   sbeq%');
for (const t of tickets) {
  const mark = t.id === 'CD6' ? ' ◀' : '';
  console.log(`${t.id.padEnd(5)} ${String(t.symbol).padEnd(11).slice(0, 11)} ${String(t.want).padEnd(9)} ${String(t.n).padEnd(5)} ${String(t.sb ?? '-').padEnd(5)} ${String(t.eq ?? '-').padEnd(5)} ${String(t.sbeq ?? '-').padEnd(5)}${mark}`);
}

for (const col of ['sb', 'eq', 'sbeq']) {
  console.log(`\n== ${col} 列按类分布（≥50% / ≥25% 计数）==`);
  for (const k of ['cheat', 'unhealthy', 'healthy']) {
    const sub = tickets.filter((t) => t.want === k && t[col] !== null);
    const hi = sub.filter((t) => t[col] >= 50).map((t) => `${t.id}(${t[col]})`);
    const mid = sub.filter((t) => t[col] >= 25 && t[col] < 50).map((t) => `${t.id}(${t[col]})`);
    console.log(`  ${k.padEnd(9)} n=${sub.length}  ≥50% ${hi.length}: ${hi.join(' ')}`);
    console.log(`  ${' '.padEnd(9)}          25-50% ${mid.length}: ${mid.join(' ')}`);
  }
}
