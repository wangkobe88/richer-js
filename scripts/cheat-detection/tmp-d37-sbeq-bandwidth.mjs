#!/usr/bin/env node
// tmp：D3.2c 候选带宽对照——用户判据「涌入的这一波购买不像真人：额度近似且集中在单一 block」。
// 组级形状=同块买入组（≥3 笔 BUY）组内 max/min ≤ W（整组一波近额）→ 组买入额 ÷ Σ买。
// ±2% 对数带对 CD6 只捕到精确等额 0.0862×4（25.4%），近额带 0.0985-0.1281 跨 ~26% 被漏——
// 本脚本对照 5 档带宽看分离度随 W 的变化（零 Jev 配额，182 跑）。
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

const WIDTHS = [1.05, 1.1, 1.3, 1.5, 2.0];

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
  const blockBuys = new Map();
  for (const t of buys) {
    if (t.block === null || t.block === undefined) continue;
    if (!blockBuys.has(t.block)) blockBuys.set(t.block, []);
    blockBuys.get(t.block).push(t);
  }
  const rec = { id: c.caseId, symbol: c.symbol, want: c.expect?.verdict };
  for (const W of WIDTHS) {
    let sum = 0;
    for (const arr of blockBuys.values()) {
      if (arr.length < 3) continue;
      const amts = arr.map((t) => t.bnb || 0);
      const mx = Math.max(...amts), mn = Math.min(...amts);
      if (mn > 0 && mx / mn <= W) sum += amts.reduce((a, b) => a + b, 0);
    }
    rec[`w${W}`] = totalBuy > 0 ? +((sum / totalBuy) * 100).toFixed(1) : null;
  }
  tickets.push(rec);
}
console.log(`id    symbol      want      ${WIDTHS.map((w) => `w${w}`).join('  ')}`);
for (const t of tickets) {
  const mark = t.id === 'CD6' ? ' ◀' : '';
  console.log(`${t.id.padEnd(5)} ${String(t.symbol).padEnd(11).slice(0, 11)} ${String(t.want).padEnd(9)} ${WIDTHS.map((w) => String(t[`w${w}`] ?? '-').padEnd(5)).join(' ')}${mark}`);
}
for (const W of WIDTHS) {
  const k = `w${W}`;
  console.log(`\n== 组级 max/min ≤ ${W} 按类分布 ==`);
  for (const cls of ['cheat', 'unhealthy', 'healthy']) {
    const sub = tickets.filter((t) => t.want === cls && t[k] !== null);
    const hi = sub.filter((t) => t[k] >= 50).map((t) => `${t.id}(${t[k]})`);
    const mid = sub.filter((t) => t[k] >= 25 && t[k] < 50).map((t) => `${t.id}(${t[k]})`);
    console.log(`  ${cls.padEnd(9)} n=${sub.length}  ≥50% ${hi.length}: ${hi.join(' ')}`);
    console.log(`  ${' '.padEnd(9)}          25-50% ${mid.length}: ${mid.join(' ')}`);
  }
}
