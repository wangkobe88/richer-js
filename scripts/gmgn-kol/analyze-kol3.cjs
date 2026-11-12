#!/usr/bin/env node
// ============================================================================
// KOL 研究·第三层：KOL 自身盈亏 × host 票结局（收割/共赢四象限）+ 占盘比例 +
// 卖买比（留仓位维度）+ 好坏票 TOP 形状明细
// ============================================================================
const path = require('path');
const fs = require('fs');
const DIR = path.join(__dirname, '../../data/kol-study');
const events = JSON.parse(fs.readFileSync(path.join(DIR, 'kol-events.json'), 'utf8'));

const byToken = {};
for (const e of events) (byToken[e.token] || (byToken[e.token] = { symbol: e.symbol, pnl: e.tokenPnlBnb, evs: [] })).evs.push(e);
const tokens = Object.entries(byToken).map(([addr, g]) => ({ addr, ...g }));

function bucket(title, rows, keyFn, buckets, pnlKey = 'pnl') {
  console.log(`\n== ${title} ==`);
  console.log('bucket'.padEnd(16) + 'n'.padStart(4) + 'avgPnl'.padStart(10) + 'sumPnl'.padStart(10) + 'win%'.padStart(6));
  for (const [label, cond] of buckets) {
    const sel = rows.filter((r) => cond(keyFn(r)));
    if (!sel.length) { console.log(label.padEnd(16) + '0'.padStart(4)); continue; }
    const sum = sel.reduce((s, r) => s + r[pnlKey], 0);
    const win = (100 * sel.filter((r) => r[pnlKey] > 0).length / sel.length).toFixed(0);
    console.log(label.padEnd(16) + String(sel.length).padStart(4) + (sum / sel.length).toFixed(4).padStart(10) + sum.toFixed(3).padStart(10) + (win + '%').padStart(6));
  }
}

// ① 占盘比例 amountPct（KOL 持仓占盘 %）× host pnl（token 级取 max amountPct）
const withPct = tokens.map((t) => ({ ...t, maxPct: Math.max(...t.evs.map((e) => e.amountPct || 0)) }));
bucket('① 票级：KOL 最大占盘 % × host pnl', withPct, (t) => t.maxPct, [
  ['<1%', (v) => v < 1], ['1-3%', (v) => v >= 1 && v < 3], ['3-5%', (v) => v >= 3 && v < 5], ['≥5%', (v) => v >= 5],
]);

// ② KOL 卖买比 × host pnl（速倒型 vs 留仓型；事件级）
const evWithRatio = events.filter((e) => e.buyUsd > 0).map((e) => ({ ...e, ratio: e.sellUsd / e.buyUsd, pnl: e.tokenPnlBnb }));
bucket('② 事件级：KOL 卖/买额比 × host pnl', evWithRatio, (e) => e.ratio, [
  ['<0.5（留多）', (v) => v < 0.5], ['0.5-0.9', (v) => v >= 0.5 && v < 0.9], ['0.9-1.1（全倒）', (v) => v >= 0.9 && v <= 1.1], ['>1.1（倒赚）', (v) => v > 1.1],
]);

// ③ 四象限：KOL profit × host pnl
const q = { 赚_亏: [], 赚_赚: [], 亏_赚: [], 亏_亏: [], na: [] };
for (const e of events) {
  if (e.profitUsd == null || e.tokenPnlBnb == null) q.na.push(e);
  else if (e.profitUsd > 0 && e.tokenPnlBnb < 0) q.赚_亏.push(e);
  else if (e.profitUsd > 0 && e.tokenPnlBnb > 0) q.赚_赚.push(e);
  else if (e.profitUsd <= 0 && e.tokenPnlBnb > 0) q.亏_赚.push(e);
  else q.亏_亏.push(e);
}
console.log('\n== ③ 四象限（KOL profit × host pnl）==');
for (const [k, arr] of Object.entries(q)) {
  if (!arr.length) continue;
  const sumProf = arr.reduce((s, e) => s + (e.profitUsd || 0), 0);
  console.log(`${k.padEnd(8)} ${String(arr.length).padStart(3)} 次   KOL 利润合计 $${sumProf.toFixed(0)}   KOL 平均持时 ${Math.round(arr.reduce((s, e) => s + (e.holdSec || 0), 0) / arr.length)}s`);
}

// ④ 好票/坏票 TOP 形状明细
for (const [label, sel] of [['好票 TOP5', [...tokens].sort((a, b) => b.pnl - a.pnl).slice(0, 5)], ['坏票 TOP5', [...tokens].sort((a, b) => a.pnl - b.pnl).slice(0, 5)]]) {
  console.log(`\n== ④ ${label} KOL 参与明细 ==`);
  for (const t of sel) {
    console.log(`${t.symbol}（${t.addr.slice(0, 8)} host ${t.pnl}）：`);
    for (const e of t.evs) {
      const off = e.entryOffsetSec == null ? '?' : (e.entryOffsetSec <= 0 ? 't+0' : 't+' + e.entryOffsetSec + 's');
      const hold = e.stillHolding ? '仍持有' : (e.holdSec == null ? '?' : e.holdSec + 's');
      console.log(`    ${String(e.name || e.wallet.slice(0, 8)).slice(0, 20).padEnd(20)} ${off.padEnd(9)} 持${String(hold).padEnd(8)} 买$${e.buyUsd} 卖$${e.sellUsd} 占${e.amountPct ?? '?'}% 利$${e.profitUsd}${e.suspicious ? ' ⚠wash' : ''}`);
    }
  }
}
