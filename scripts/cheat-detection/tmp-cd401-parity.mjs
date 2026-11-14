#!/usr/bin/env node
// CD401 落地对拍（182 跑，零 DB 零 Jev）：四基底 sets ticks 缓存直调
// buildSnapshotFromRows 重算出口段卖压三键 vs P3 探针预演基准（tmp-p3-line2-split.mjs）
// ——验收：①命中面=8 票（btv109 3/btv104 2/btv103-r2 3/v73 0）与预演一致
// ②三大赢家（T093/T064/T065）出口卖%=0 天然安全 ③贴边保护：meem 36%/0.12、
// 小旺 31%/0.24 由卖额 0.3 门保住 ④dump 双中票（网上南宁）留 dump 码不算 CD401 增量
// 线判定=pct>=30 ∧ sellBnb>=0.3（service _exemptDeniedReason 同款；臂序 dump 在前）
// 用法：node tmp-cd401-parity.mjs [--all]
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
  let hits = [], n = 0, nearLine = [];
  for (const p of set.points) {
    let rows;
    try { rows = JSON.parse(fs.readFileSync(`${base}-ticks/${p.tokenAddress}.json`, 'utf8')).rows; } catch { continue; }
    n++;
    const anchor = p.anchorTimeIso || rows[rows.length - 1].block_time;
    const aTs = ts(anchor);
    const pre = rows.filter((r) => ts(r.block_time) <= aTs);
    const meta = { address: p.tokenAddress, symbol: p.tokenSymbol ?? '?', name: p.tokenSymbol ?? '?', createdAt: rows[0].block_time, platform: 'fourmeme', totalSupply: 1e9 };
    const d = buildSnapshotFromRows(pre, meta).derived;
    if (d.burstExitSegSellPct == null) continue; // 无 ≥50s 静默段 → 容缺不触发
    // dump 双中判定（臂序在前=留 dump 码）
    const dumpHit = d.nearDumpQualBlocks >= 1 && d.nearDumpMinAbsorbBnb < 0.05;
    const hit = d.burstExitSegSellPct >= 30 && d.burstExitSegSellBnb >= 0.3;
    const pnl = p.trade?.episode?.pnlBnb ?? null;
    const rec = {
      set: name, pid: p.pointId.slice(3), sym: p.tokenSymbol ?? '-', addr: p.tokenAddress.slice(0, 10),
      pct: d.burstExitSegSellPct, sell: d.burstExitSegSellBnb, buy: d.burstExitSegBuyBnb,
      denied: dumpHit ? 'dump_no_absorption(双中)' : (hit ? 'burst_exit_sell_pressure' : null),
      hit, pnl,
    };
    if (hit) hits.push(rec);
    // 近线观察带（不命中但 ≥15% 且卖 ≥0.15，或命中线 1.5 倍内）：贴边票保护验证
    if (!hit && d.burstExitSegSellPct >= 15 && d.burstExitSegSellBnb >= 0.15) nearLine.push(rec);
    if (ALL) console.log(JSON.stringify(rec));
  }
  const sum = hits.reduce((a, h) => a + (h.pnl ?? 0), 0);
  const inc = hits.filter((h) => !h.denied.includes('dump')); // CD401 纯增量（双中归 CD400）
  const incSum = inc.reduce((a, h) => a + (h.pnl ?? 0), 0);
  console.log(`${name}: points=${n} 命中=${hits.length}（纯增量 ${inc.length}）pnlΣ=${sum.toFixed(4)}（增量Σ=${incSum.toFixed(4)}）`);
  for (const h of hits) {
    console.log(`  ${h.pid} ${h.sym} ${h.addr} pct=${h.pct}% 卖${h.sell}/买${h.buy} denied=${h.denied} pnl=${h.pnl}`);
  }
  if (nearLine.length) {
    console.log(`  近线带（≥15%∧≥0.15 未命中=贴边保护）:`);
    for (const h of nearLine.slice(0, 12)) {
      console.log(`    ${h.pid} ${h.sym} ${h.addr} pct=${h.pct}% 卖${h.sell}/买${h.buy} pnl=${h.pnl}`);
    }
  }
  grand = grand.concat(hits);
}
const gsum = grand.reduce((a, h) => a + (h.pnl ?? 0), 0);
const ginc = grand.filter((h) => !h.denied.includes('dump'));
const gincSum = ginc.reduce((a, h) => a + (h.pnl ?? 0), 0);
console.log(`\n合计: ${grand.length} 票 pnlΣ=${gsum.toFixed(4)}（预演基准: 8 票 ≈−0.06 含我靠 2 票零效果）`);
console.log(`CD401 纯增量: ${ginc.length} 票 Σ=${gincSum.toFixed(4)}（双中 ${grand.length - ginc.length} 票归 CD400 dump 码）`);
