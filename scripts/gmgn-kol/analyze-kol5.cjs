#!/usr/bin/env node
// ============================================================================
// KOL 研究·第五层：I 判据（早≤60s∧低价≤+15%∧全速倒）明细 + 变体寻优
//   ——「什么情况划分为 famous 盘挡住」的最终判定框架
// ============================================================================
const path = require('path');
const fs = require('fs');
const DIR = path.join(__dirname, '../../data/kol-study');
const events = JSON.parse(fs.readFileSync(path.join(DIR, 'kol-events.json'), 'utf8'));
const ps = JSON.parse(fs.readFileSync(path.join(DIR, 'price-series.json'), 'utf8'));
const roster = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/rosters/famous-copy-wallets.json'), 'utf8')).wallets.map((w) => w.toLowerCase()));
const pool = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scripts/buy-point/sets/kol-study-pool.json'), 'utf8'));
const priceAt = (addr, sec) => { const s = ps[addr]; if (!s) return null; if (sec == null || sec <= s.firstTs) return s.launch; let lo = 0, hi = s.samples.length - 1, ans = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if (s.samples[m][0] <= sec) { ans = m; lo = m + 1; } else hi = m - 1; } return s.samples[ans][1]; };
for (const e of events) { const p = priceAt(e.token, e.startSec); e.entryVsFirstPct = p != null ? Math.round((p / ps[e.token].launch - 1) * 1000) / 10 : null; }

const byToken = {};
for (const e of events) (byToken[e.token] || (byToken[e.token] = { symbol: e.symbol, evs: [] })).evs.push(e);
const universe = pool.tokens.map((t) => {
  const g = byToken[t.address] || null; const s = ps[t.address];
  const evs = g ? g.evs : [];
  return {
    addr: t.address, symbol: t.symbol, pnl: t.pnlBnb, evs,
    athPct: s ? Math.round((s.ath / s.launch - 1) * 1000) / 10 : null,
    n: evs.length,
    nEarlyLow: evs.filter((e) => e.entryOffsetSec != null && e.entryOffsetSec <= 60 && e.entryVsFirstPct != null && e.entryVsFirstPct <= 15).length,
    allFast: evs.length > 0 && evs.every((e) => e.holdSec != null && e.holdSec <= 60),
    nFamousEarlyLow: evs.filter((e) => roster.has(e.wallet.toLowerCase()) && e.entryOffsetSec != null && e.entryOffsetSec <= 60 && e.entryVsFirstPct != null && e.entryVsFirstPct <= 15).length,
    famousAllFast: evs.length > 0 && evs.filter((e) => roster.has(e.wallet.toLowerCase())).every((e) => e.holdSec != null && e.holdSec <= 60) && evs.some((e) => roster.has(e.wallet.toLowerCase())),
    nKolProfitEarlyLow: evs.filter((e) => e.entryOffsetSec != null && e.entryOffsetSec <= 60 && e.entryVsFirstPct != null && e.entryVsFirstPct <= 15 && (e.profitUsd || 0) > 0).length,
  };
});

const fmt = (sel) => sel.length ? `${sel.length}张 起来率${(100 * sel.filter((t) => t.athPct >= 100).length / sel.length).toFixed(0)}% ≥3x ${sel.filter((t) => t.athPct >= 300).length}张 亏钱票${sel.filter((t) => t.pnl < 0).length}张` : '0张';
console.log('== 判据变体对比（拦下票质量；起来=ATH≥+100%）==\n');
const crits = [
  ['I  早∧低价∧全速倒（KOL）', (t) => t.nEarlyLow >= 1 && t.allFast],
  ['I1 早∧低价∧全速倒∧in册famous', (t) => t.nFamousEarlyLow >= 1 && t.famousAllFast],
  ['I2 早∧低价∧KOL自己赚', (t) => t.nKolProfitEarlyLow >= 1],
  ['I3 早∧低价（E 基线）', (t) => t.nEarlyLow >= 1],
  ['I4 低价∧全速倒（不限早）', (t) => t.evs.some((e) => e.entryVsFirstPct != null && e.entryVsFirstPct <= 15) && t.allFast],
];
for (const [label, fn] of crits) {
  const block = universe.filter(fn); const pass = universe.filter((t) => !fn(t));
  console.log(`${label.padEnd(30)} 拦下:${fmt(block)}  |  放行:${fmt(pass.filter((t) => t.n > 0))}+无KOL${pass.filter((t) => t.n === 0).length}`);
}
// I 明细
console.log('\n== I 判据拦下明细（ATH 降序）==');
const fnI = crits[0][1];
for (const t of universe.filter(fnI).sort((a, b) => b.athPct - a.athPct)) {
  const k = t.evs.filter((e) => e.entryOffsetSec != null && e.entryOffsetSec <= 60 && e.entryVsFirstPct != null && e.entryVsFirstPct <= 15);
  console.log(`${String(t.symbol).slice(0, 12).padEnd(13)} ATH+${String(t.athPct).padStart(6)}%  我方pnl ${String(t.pnl).padStart(8)}  触发KOL: ${k.map((e) => `${(e.name || e.wallet.slice(0, 6)).slice(0, 12)}(t+${e.entryOffsetSec}s@+${e.entryVsFirstPct}%持${e.holdSec}s利$${e.profitUsd}${roster.has(e.wallet.toLowerCase()) ? '★' : ''})`).join(' / ')}`);
}
console.log('\n★=in册 famous；我方pnl 仅为参考（主口径=ATH 起来率）');
