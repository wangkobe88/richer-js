#!/usr/bin/env node
// ============================================================================
// KOL 研究·第四层：KOL 入场价格 × 「币起来起不来」（ATH 口径，非我方 pnl）+
// famous 盘拦截判据矩阵（哪条判据真能预测起不来、误伤多少）
//
//   起来 = 窗口内 ATH 较首价涨幅；KOL 入场价 = startSec 前向填充（2s 采样）
// ============================================================================
const path = require('path');
const fs = require('fs');
const DIR = path.join(__dirname, '../../data/kol-study');
const events = JSON.parse(fs.readFileSync(path.join(DIR, 'kol-events.json'), 'utf8'));
const ps = JSON.parse(fs.readFileSync(path.join(DIR, 'price-series.json'), 'utf8'));
const roster = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/rosters/famous-copy-wallets.json'), 'utf8')).wallets.map((w) => w.toLowerCase()));

const RISE = 100; // 起来阈值（ATH ≥ +100%），敏感性另给 60/30 档
const priceAt = (addr, sec) => {
  const s = ps[addr]; if (!s) return null;
  if (sec == null || sec <= s.firstTs) return s.launch;
  // 二分：最后一个 ts ≤ sec 的采样
  let lo = 0, hi = s.samples.length - 1, ans = 0;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (s.samples[m][0] <= sec) { ans = m; lo = m + 1; } else hi = m - 1; }
  return s.samples[ans][1];
};
// 事件级补入场价
for (const e of events) {
  const p = priceAt(e.token, e.startSec);
  e.entryP = p; e.entryVsFirstPct = p != null ? Math.round((p / ps[e.token].launch - 1) * 1000) / 10 : null;
}

// ---- 票级聚合 ----
const byToken = {};
for (const e of events) (byToken[e.token] || (byToken[e.token] = { symbol: e.symbol, evs: [] })).evs.push(e);
const tokens = [];
for (const [addr, g] of Object.entries(byToken)) {
  const s = ps[addr];
  tokens.push({
    addr, symbol: g.symbol, n: g.evs.length,
    athPct: Math.round((s.ath / s.launch - 1) * 1000) / 10, rise: (s.ath / s.launch - 1) * 100 >= RISE,
    // 派生判据原料
    minOff: Math.min(...g.evs.map((e) => e.entryOffsetSec).filter((x) => x != null)),
    minEntryPct: Math.min(...g.evs.map((e) => e.entryVsFirstPct).filter((x) => x != null)),
    nEarly60: g.evs.filter((e) => e.entryOffsetSec != null && e.entryOffsetSec <= 60).length,
    nLow15: g.evs.filter((e) => e.entryVsFirstPct != null && e.entryVsFirstPct <= 15).length,
    nEarlyLow: g.evs.filter((e) => e.entryOffsetSec != null && e.entryOffsetSec <= 60 && e.entryVsFirstPct != null && e.entryVsFirstPct <= 15).length,
    nFamousEarly: g.evs.filter((e) => roster.has(e.wallet.toLowerCase()) && e.entryOffsetSec != null && e.entryOffsetSec <= 60).length,
    nRoster: g.evs.filter((e) => roster.has(e.wallet.toLowerCase())).length,
    allFast: g.evs.every((e) => e.holdSec != null && e.holdSec <= 60),
    evs: g.evs,
  });
}
const pool = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scripts/buy-point/sets/kol-study-pool.json'), 'utf8'));
const noKol = pool.tokens.filter((t) => !byToken[t.address] && ps[t.address]).map((t) => ({ symbol: t.symbol, athPct: Math.round((ps[t.address].ath / ps[t.address].launch - 1) * 1000) / 10, rise: (ps[t.address].ath / ps[t.address].launch - 1) * 100 >= RISE, n: 0 }));

// ---- ① KOL 数量 × 起来率（含无 KOL 对照组）----
console.log(`== ① KOL 数量 × 起来率（ATH≥+${RISE}%；含无 KOL 对照）==`);
for (const [label, sel] of [['无KOL', noKol], ['1', tokens.filter((t) => t.n === 1)], ['2', tokens.filter((t) => t.n === 2)], ['3', tokens.filter((t) => t.n === 3)], ['4+', tokens.filter((t) => t.n >= 4)]]) {
  if (!sel.length) continue;
  const rise = sel.filter((t) => t.rise).length;
  const medAth = [...sel.map((t) => t.athPct)].sort((a, b) => a - b)[Math.floor(sel.length / 2)];
  console.log(`${label.padEnd(6)} ${String(sel.length).padStart(3)} 票   起来率 ${(100 * rise / sel.length).toFixed(0).padStart(3)}%   ATH中位 +${medAth}%`);
}

// ---- ② KOL 最低入场价 × 起来率 ----
console.log(`\n== ② 票内 KOL 最低入场价（较首价）× 起来率 ==`);
for (const [label, lo, hi] of [['≤+5%', -1e9, 5], ['+5~15%', 5, 15], ['+15~30%', 15, 30], ['+30~60%', 30, 60], ['>+60%', 60, 1e9]]) {
  const sel = tokens.filter((t) => t.minEntryPct >= lo && t.minEntryPct < hi);
  if (!sel.length) continue;
  const rise = sel.filter((t) => t.rise).length;
  const medAth = [...sel.map((t) => t.athPct)].sort((a, b) => a - b)[Math.floor(sel.length / 2)];
  console.log(`${label.padEnd(9)} ${String(sel.length).padStart(3)} 票   起来率 ${(100 * rise / sel.length).toFixed(0).padStart(3)}%   ATH中位 +${medAth}%`);
}

// ---- ③ 事件级：入场价 × 入场时机 联合 × host 起来率 ----
console.log(`\n== ③ 事件级 入场价×时机 × host 起来率 ==`);
for (const [pl, pc] of [['低价≤+15%', (e) => e.entryVsFirstPct != null && e.entryVsFirstPct <= 15], ['中价+15~60%', (e) => e.entryVsFirstPct > 15 && e.entryVsFirstPct <= 60], ['高价>+60%', (e) => e.entryVsFirstPct != null && e.entryVsFirstPct > 60]]) {
  let line = pl.padEnd(12);
  for (const [tl, tc] of [['早≤30s', (e) => e.entryOffsetSec != null && e.entryOffsetSec <= 30], ['中30-120s', (e) => e.entryOffsetSec > 30 && e.entryOffsetSec <= 120], ['晚>120s', (e) => e.entryOffsetSec != null && e.entryOffsetSec > 120]]) {
    const sel = events.filter((e) => pc(e) && tc(e));
    line += sel.length ? `${tl}:${sel.length}次 host起来率${(100 * sel.filter((e) => (ps[e.token].ath / ps[e.token].launch - 1) * 100 >= RISE).length / sel.length).toFixed(0)}%  `.padEnd(24) : `${tl}:—`.padEnd(24);
  }
  console.log(line);
}

// ---- ④ famous 拦截判据矩阵（起来率口径）----
console.log(`\n== ④ 拦截判据矩阵（拦下的票 vs 放行的票； rise=ATH≥+${RISE}%）==`);
console.log('判据'.padEnd(34) + '拦截'.padStart(4) + '拦下起来率'.padStart(10) + '放行起来率'.padStart(10) + '拦下好票'.padStart(8));
const universe = [...tokens, ...noKol.map((t) => ({ ...t, n: 0, minOff: null, minEntryPct: null, nEarly60: 0, nLow15: 0, nEarlyLow: 0, nFamousEarly: 0, nRoster: 0, allFast: false, evs: [] }))];
const crits = [
  ['A ≥1 KOL ≤60s 内入场', (t) => t.nEarly60 >= 1],
  ['B ≥1 KOL 入场价 ≤+15%', (t) => t.nLow15 >= 1],
  ['C ≥2 KOL ≤30s 内入场', (t) => t.evs.filter((e) => e.entryOffsetSec != null && e.entryOffsetSec <= 30).length >= 2],
  ['D KOL 数=1', (t) => t.n === 1],
  ['E 早(≤60s)∧低价(≤+15%) ≥1', (t) => t.nEarlyLow >= 1],
  ['F 全部 KOL ≤60s 速倒', (t) => t.n > 0 && t.allFast],
  ['G in册famous ≤60s 入场 ≥1', (t) => t.nFamousEarly >= 1],
  ['H in册famous 参与 ≥1', (t) => t.nRoster >= 1],
  ['I E∧F 组合', (t) => t.nEarlyLow >= 1 && t.allFast],
  ['J KOL≥1（全拦对照）', (t) => t.n >= 1],
];
for (const [label, fn] of crits) {
  const block = universe.filter(fn); const pass = universe.filter((t) => !fn(t));
  if (!block.length || !pass.length) continue;
  const bRise = 100 * block.filter((t) => t.rise).length / block.length;
  const pRise = 100 * pass.filter((t) => t.rise).length / pass.length;
  const goodBlocked = block.filter((t) => t.athPct >= 300).length; // 拦下的 3 倍票=重误伤
  console.log(label.padEnd(34) + String(block.length).padStart(4) + (bRise.toFixed(0) + '%').padStart(10) + (pRise.toFixed(0) + '%').padStart(10) + (`${goodBlocked}张(≥3x)`).padStart(12));
}

// ---- ⑤ 敏感性：RISE 阈值 30/60/100 下最优判据的区分度 ----
console.log(`\n== ⑤ 起来阈值敏感性（E 判据 vs 无判据）==`);
for (const R of [30, 60, 100, 200]) {
  const fn = crits.find(([l]) => l.startsWith('E '))[1];
  const block = universe.filter(fn); const pass = universe.filter((t) => !fn(t));
  const bRise = 100 * block.filter((t) => t.athPct >= R).length / block.length;
  const pRise = 100 * pass.filter((t) => t.athPct >= R).length / pass.length;
  console.log(`ATH≥+${String(R).padStart(3)}%：拦下${block.length}张起来率${bRise.toFixed(0)}% vs 放行${pass.length}张${pRise.toFixed(0)}%`);
}
// 明细：E 判据拦下/放行票清单
console.log(`\n== E 判据明细 ==`);
const fnE = crits.find(([l]) => l.startsWith('E '))[1];
console.log('拦下：' + universe.filter(fnE).sort((a, b) => b.athPct - a.athPct).map((t) => `${t.symbol}(+${t.athPct}%)`).join(' '));
console.log('放行（有KOL）：' + universe.filter((t) => !fnE(t) && t.n > 0).sort((a, b) => b.athPct - a.athPct).map((t) => `${t.symbol}(+${t.athPct}%)`).join(' '));
