#!/usr/bin/env node
// ============================================================================
// KOL 研究·第二层：好盘 vs 坏盘的分界在哪（入场时机/参与数量/入场量/wash 标签/
// roster 对拍）——检验用户假设「早入场+量大→崩；晚入场+留仓→好」
// ============================================================================
const path = require('path');
const fs = require('fs');
const DIR = path.join(__dirname, '../../data/kol-study');
const events = JSON.parse(fs.readFileSync(path.join(DIR, 'kol-events.json'), 'utf8'));
const roster = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/rosters/famous-copy-wallets.json'), 'utf8')).wallets.map((w) => w.toLowerCase()));

// ---- per-token 聚合（与 analyze-kol 同构）----
const byToken = {};
for (const e of events) {
  const g = byToken[e.token] || (byToken[e.token] = { symbol: e.symbol, pnl: e.tokenPnlBnb, evs: [] });
  g.evs.push(e);
}
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const tokens = Object.entries(byToken).map(([addr, g]) => ({ addr, ...g, n: g.evs.length, medOff: med(g.evs.map((e) => e.entryOffsetSec).filter((x) => x != null)), maxBuy: Math.max(...g.evs.map((e) => e.buyUsd || 0)) }));

function bucketTable(title, rows, keyFn, buckets) {
  console.log(`\n== ${title} ==`);
  console.log('bucket'.padEnd(14) + 'n'.padStart(4) + 'avgPnl'.padStart(10) + 'sumPnl'.padStart(10) + 'win%'.padStart(6));
  for (const [label, cond] of buckets) {
    const sel = rows.filter((r) => cond(keyFn(r)));
    if (!sel.length) { console.log(label.padEnd(14) + '0'.padStart(4)); continue; }
    const sum = sel.reduce((s, r) => s + r.pnl, 0);
    const win = (100 * sel.filter((r) => r.pnl > 0).length / sel.length).toFixed(0);
    console.log(label.padEnd(14) + String(sel.length).padStart(4) + (sum / sel.length).toFixed(4).padStart(10) + sum.toFixed(3).padStart(10) + (win + '%').padStart(6));
  }
}

// ① token 级：KOL 最早入场偏移（min offset）分桶 × pnl
const withOff = tokens.filter((t) => t.evs.some((e) => e.entryOffsetSec != null)).map((t) => ({ ...t, minOff: Math.min(...t.evs.map((e) => e.entryOffsetSec).filter((x) => x != null)) }));
bucketTable('① 票级：最早 KOL 入场偏移 × pnl', withOff, (t) => t.minOff, [
  ['≤10s', (o) => o <= 10], ['10-30s', (o) => o > 10 && o <= 30], ['30-60s', (o) => o > 30 && o <= 60],
  ['60-180s', (o) => o > 60 && o <= 180], ['180-600s', (o) => o > 180 && o <= 600], ['>600s', (o) => o > 600],
]);

// ② token 级：KOL 数量分桶 × pnl
bucketTable('② 票级：KOL 参与人数 × pnl', tokens, (t) => t.n, [
  ['1', (n) => n === 1], ['2', (n) => n === 2], ['3', (n) => n === 3], ['4+', (n) => n >= 4],
]);

// ③ token 级：KOL 单钱包最大买入额（USD）× pnl
bucketTable('③ 票级：KOL 最大单钱包买入$ × pnl', tokens, (t) => t.maxBuy, [
  ['<100', (v) => v < 100], ['100-300', (v) => v >= 100 && v < 300], ['300-600', (v) => v >= 300 && v < 600], ['≥600', (v) => v >= 600],
]);

// ④ 事件级：入场偏移 × 持有时长联合（早进快出的 KOL 是否收割）
console.log('\n== ④ 事件级：入场×持时 形态分布（host pnl 均值） ==');
const cells = [['早≤30s', (e) => e.entryOffsetSec != null && e.entryOffsetSec <= 30], ['中30-180s', (e) => e.entryOffsetSec > 30 && e.entryOffsetSec <= 180], ['晚>180s', (e) => e.entryOffsetSec != null && e.entryOffsetSec > 180]];
const spans = [['速出≤30s', (e) => e.holdSec != null && e.holdSec <= 30], ['持30-300s', (e) => e.holdSec > 30 && e.holdSec <= 300], ['长持>300s', (e) => e.holdSec != null && e.holdSec > 300], ['仍持有', (e) => e.stillHolding === 1]];
for (const [sl, sc] of spans) {
  let line = sl.padEnd(12);
  for (const [cl, cc] of cells) {
    const sel = events.filter((e) => sc(e) && cc(e));
    line += (sel.length ? `${cl}:${sel.length}次 均${(sel.reduce((s, e) => s + e.tokenPnlBnb, 0) / sel.length).toFixed(3)}` : `${cl}:—`).padEnd(20);
  }
  console.log(line);
}

// ⑤ wash 标签：带 wash 的 KOL 参与票 vs 干净 KOL 参与票
const washTokens = tokens.filter((t) => t.evs.every((e) => e.suspicious));
const cleanTokens = tokens.filter((t) => t.evs.some((e) => !e.suspicious));
console.log(`\n== ⑤ wash 维度 ==\n全 wash-KOL 票：${washTokens.length} 张 均${(washTokens.reduce((s, t) => s + t.pnl, 0) / washTokens.length).toFixed(4)} / 含干净 KOL 票：${cleanTokens.length} 张 均${(cleanTokens.reduce((s, t) => s + t.pnl, 0) / cleanTokens.length).toFixed(4)}`);

// ⑥ roster 对拍
const rosterHit = events.filter((e) => roster.has(e.wallet.toLowerCase()));
const kolWallets = {};
for (const e of events) kolWallets[e.wallet] = (kolWallets[e.wallet] || 0) + 1;
const inRoster = Object.keys(kolWallets).filter((w) => roster.has(w.toLowerCase()));
const notInRoster = Object.keys(kolWallets).filter((w) => !roster.has(w.toLowerCase()));
console.log(`\n== ⑥ famous roster 对拍 ==\nGMGN kol 钱包 ${Object.keys(kolWallets).length} 个：在册 ${inRoster.length} / 不在册 ${notInRoster.length}`);
console.log('不在册（roster 扩充候选，按参与票数）：');
for (const w of notInRoster.sort((a, b) => kolWallets[b] - kolWallets[a])) {
  const e = events.find((x) => x.wallet === w);
  const tp = events.filter((x) => x.wallet === w);
  const goodN = new Set(tp.filter((x) => x.tokenPnlBnb > 0).map((x) => x.token)).size, badN = new Set(tp.filter((x) => x.tokenPnlBnb < 0).map((x) => x.token)).size;
  console.log(`  ${w} ${String(e.name || '').slice(0, 24).padEnd(24)} 票${kolWallets[w]} 好${goodN} 坏${badN} tw=${e.twitter || '-'}${e.suspicious ? ' ⚠wash' : ''}`);
}
// 在册但票池未出现
const rosterMiss = [...roster].filter((w) => !kolWallets[w.toLowerCase()]);
console.log(`在册但本票池 GMGN top_traders 未见：${rosterMiss.length} 址（${rosterMiss.map((w) => w.slice(0, 8)).join(' ')}）`);
