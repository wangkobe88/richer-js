#!/usr/bin/env node
// CD400 落地对拍（182 跑，零 DB 零 Jev）：四基底 sets ticks 缓存直调
// buildSnapshotFromRows 重算贴锚砸出零承接六键 vs P1 手工统计基准（tmp-p1-shapes.mjs
// v4）——验收：①已知基准票六键精确值（SB 四块/FOM 单块/無為三块 0.03 边界/苍蝇/
// LOVE 双块）②命中名单四基底 7/3/3/2、pnl −0.27 与调研报告一致
// 用法：node tmp-cd400-parity.mjs [--all]
import fs from 'node:fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { buildSnapshotFromRows } = require('../../src/market-analysis/cheat-snapshot.js');

const SETS = [
  ['btv109', 'scripts/buy-point/sets/btv109-trades'],
  ['btv104', 'scripts/buy-point/sets/btv104-trades'],
  ['btv103-r2', 'scripts/buy-point/sets/btv103-r2-trades'],
  ['v73', 'scripts/buy-point/sets/bp-2026-11-05-v73-trades'],
];
const ALL = process.argv.includes('--all');
const ts = (iso) => Date.parse(iso) / 1000;

let grand = [];
for (const [name, base] of SETS) {
  const set = JSON.parse(fs.readFileSync(`${base}.json`, 'utf8'));
  let hits = [], n = 0;
  for (const p of set.points) {
    let rows;
    try { rows = JSON.parse(fs.readFileSync(`${base}-ticks/${p.tokenAddress}.json`, 'utf8')).rows; } catch { continue; }
    n++;
    const anchor = p.anchorTimeIso || rows[rows.length - 1].block_time;
    const aTs = ts(anchor);
    const pre = rows.filter((r) => ts(r.block_time) <= aTs);
    const meta = { address: p.tokenAddress, symbol: p.tokenSymbol ?? '?', name: p.tokenSymbol ?? '?', createdAt: rows[0].block_time, platform: 'fourmeme', totalSupply: 1e9 };
    const d = buildSnapshotFromRows(pre, meta).derived;
    if (d.nearDumpQualBlocks == null) continue;
    const hit = d.nearDumpQualBlocks >= 1 && d.nearDumpMinAbsorbBnb < 0.05;
    const pnl = p.trade?.episode?.pnlBnb ?? null;
    const rec = {
      set: name, pid: p.pointId.slice(3), sym: p.tokenSymbol ?? '-', addr: p.tokenAddress.slice(0, 10),
      qual: d.nearDumpQualBlocks, minAbs: d.nearDumpMinAbsorbBnb, hit,
      worstS: d.nearDumpWorstSellers, worstB: d.nearDumpWorstSellBnb,
      worstT: d.nearDumpWorstSecToAnchor, worstSame: d.nearDumpWorstSameBlkBuyBnb,
      pnl,
    };
    if (hit) hits.push(rec);
    if (ALL) console.log(JSON.stringify(rec));
  }
  const sum = hits.reduce((a, h) => a + (h.pnl ?? 0), 0);
  console.log(`${name}: points=${n} 达标块票=${[...new Set()] && ''}${''}命中(hit)=${hits.length} pnlΣ=${sum.toFixed(4)}`);
  for (const h of hits) {
    console.log(`  ${h.pid} ${h.sym} ${h.addr} qual=${h.qual} minAbs=${h.minAbs} worst=${h.worstS}户${h.worstB}BNB@${h.worstT}s 同块买${h.worstSame} pnl=${h.pnl}`);
  }
  grand = grand.concat(hits);
}
const gsum = grand.reduce((a, h) => a + (h.pnl ?? 0), 0);
const wins = grand.filter((h) => (h.pnl ?? 0) > 0.001), loses = grand.filter((h) => (h.pnl ?? 0) < -0.001);
console.log(`\n合计: ${grand.length} 票 pnlΣ=${gsum.toFixed(4)}（调研报告基准: 15 票 −0.27 亏12/盈2）`);
console.log(`亏票Σ=${loses.reduce((a, h) => a + h.pnl, 0).toFixed(4)}(${loses.length}) 盈票Σ=${wins.reduce((a, h) => a + h.pnl, 0).toFixed(4)}(${wins.length})`);
