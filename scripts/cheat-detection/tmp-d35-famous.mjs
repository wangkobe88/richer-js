#!/usr/bin/env node
// tmp：D3.2b 著名钱包单极控盘锚 55 票分布（182 跑，零 Jev 配额）——
// famous-copy-wallets 名单 ∩ 窗内持仓 + 60s 跟单集 ÷ 全场正净持仓，三档（50/25 先验）。
// 直接读 buildSnapshotFromRows.derived（单一真相源）；重点标 CD5（0xbf00 接盘=锚触发场景）。
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
    lvl: d.famousDominanceLevel, hold: d.famousHoldPct, top1: d.famousTop1Pct,
    fol: d.famousFollowerPct, dom: d.famousDominancePct,
  });
}
console.log('id    symbol      want      n    lvl   hold  top1  fol   dom');
for (const t of tickets) {
  const mark = t.id === 'CD5' ? ' ◀' : '';
  console.log(`${t.id.padEnd(5)} ${String(t.symbol).padEnd(11).slice(0, 11)} ${String(t.want).padEnd(9)} ${String(t.n).padEnd(5)} ${String(t.lvl ?? '-').padEnd(5)} ${String(t.hold ?? '-').padEnd(5)} ${String(t.top1 ?? '-').padEnd(5)} ${String(t.fol ?? '-').padEnd(5)} ${String(t.dom ?? '-').padEnd(5)}${mark}`);
}

console.log('\n== 按类 × 档位分布 ==');
for (const k of ['cheat', 'unhealthy', 'healthy']) {
  const sub = tickets.filter((t) => t.want === k);
  const byLvl = { high: 0, mid: 0, low: 0, null: 0 };
  for (const t of sub) byLvl[String(t.lvl)]++;
  console.log(`  ${k.padEnd(9)} n=${sub.length}  high=${byLvl.high} mid=${byLvl.mid} low=${byLvl.low} 不适用=${byLvl.null}`);
}

console.log('\n== 名单命中票（非 null）逐票 ==');
for (const t of tickets.filter((t) => t.lvl !== null)) {
  console.log(`  ${t.id} ${String(t.want).padEnd(9)} lvl=${t.lvl} hold=${t.hold} top1=${t.top1} fol=${t.fol} dom=${t.dom}`);
}
