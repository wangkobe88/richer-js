#!/usr/bin/env node
// ============================================================================
// KOL 研究·分析（2026-11-12）：有 KOL 参与的代币 好盘 vs 坏盘 差异
//
// 输入：data/kol-study/top-traders/<addr>.json（GMGN top_traders，tags 含 kol=KOL）
//       data/kol-study/token-create.json（wss_events token_create 时刻）
//       scripts/buy-point/sets/kol-study-pool.json（token 级 pnlBnb 结局）
// 输出：data/kol-study/kol-events.json   行级 KOL 参与事件（token×钱包）
//       data/kol-study/kol-wallets.json  KOL 钱包全集（跨 token 参与统计）
//       stdout：per-token 摘要 + 好/坏盘分组对照
//
// 关键口径：
//   - entryOffsetSec = start_holding_at(unix s) − token_create(s)：KOL 入场早晚
//   - holdSec = end_holding_at − start_holding_at（null end=仍在持有）
//   - buyUsd/sellUsd = buy/sell_volume_cur（GMGN 口径 USD）
//   - good = token pnlBnb > 0；bad = < 0
// ============================================================================
const path = require('path');
const fs = require('fs');

const DIR = path.join(__dirname, '../../data/kol-study');
const pool = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scripts/buy-point/sets/kol-study-pool.json'), 'utf8'));
const creates = JSON.parse(fs.readFileSync(path.join(DIR, 'token-create.json'), 'utf8'));

const isKol = (tags) => Array.isArray(tags) && tags.includes('kol');
const f1 = (n) => (n == null || isNaN(n) ? null : Math.round(n * 10) / 10);
const f4 = (n) => (n == null || isNaN(n) ? null : Math.round(n * 10000) / 10000);

const events = [];
for (const t of pool.tokens) {
  const file = path.join(DIR, 'top-traders', t.address + '.json');
  if (!fs.existsSync(file)) continue;
  const { rows } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const createSec = creates[t.address] ? Date.parse(creates[t.address].blockTime) / 1000 : null;
  for (const r of rows || []) {
    if (!isKol(r.tags)) continue;
    events.push({
      token: t.address, symbol: t.symbol, tokenPnlBnb: f4(t.pnlBnb),
      wallet: r.address, name: r.maker_info?.name || r.twitter_name || r.twitter_username || null,
      twitter: r.twitter_username || null, tags: r.tags,
      suspicious: r.is_suspicious === true || (Array.isArray(r.tags) && r.tags.includes('wash_trader')) ? 1 : 0,
      createSec,
      startSec: r.start_holding_at || null, endSec: r.end_holding_at || null,
      entryOffsetSec: r.start_holding_at && createSec ? r.start_holding_at - createSec : null,
      holdSec: r.start_holding_at && r.end_holding_at ? r.end_holding_at - r.start_holding_at : null,
      stillHolding: r.end_holding_at ? 0 : 1,
      buyUsd: f1(r.buy_volume_cur), sellUsd: f1(r.sell_volume_cur),
      amountPct: r.amount_percentage != null ? Math.round(r.amount_percentage * 10000) / 100 : null,
      profitUsd: f1(r.profit), realizedUsd: f1(r.realized_profit),
      buyTx: r.buy_tx_count_cur, sellTx: r.sell_tx_count_cur,
    });
  }
}
fs.writeFileSync(path.join(DIR, 'kol-events.json'), JSON.stringify(events, null, 1));

// ---- KOL 钱包全集 ----
const wallets = {};
for (const e of events) {
  const w = wallets[e.wallet] || (wallets[e.wallet] = { wallet: e.wallet, name: e.name, twitter: e.twitter, tags: e.tags, tokens: 0, goodTokens: 0, badTokens: 0, earlyEntries: 0, stillHoldingTokens: 0, profitUsdSum: 0, suspicious: e.suspicious });
  w.tokens++; if (e.tokenPnlBnb > 0) w.goodTokens++; else if (e.tokenPnlBnb < 0) w.badTokens++;
  if (e.entryOffsetSec != null && e.entryOffsetSec <= 60) w.earlyEntries++;
  if (e.stillHolding) w.stillHoldingTokens++;
  w.profitUsdSum = Math.round((w.profitUsdSum + (e.profitUsd || 0)) * 10) / 10;
}
fs.writeFileSync(path.join(DIR, 'kol-wallets.json'), JSON.stringify(Object.values(wallets).sort((a, b) => b.tokens - a.tokens), null, 1));

// ---- per-token 摘要 ----
const byToken = {};
for (const e of events) {
  const g = byToken[e.token] || (byToken[e.token] = { symbol: e.symbol, pnlBnb: e.tokenPnlBnb, n: 0, early: 0, holding: 0, buyUsd: 0, suspicious: 0, offsets: [], holds: [] });
  g.n++; if (e.entryOffsetSec != null && e.entryOffsetSec <= 60) g.early++;
  if (e.stillHolding) g.holding++; g.buyUsd += e.buyUsd || 0; if (e.suspicious) g.suspicious++;
  if (e.entryOffsetSec != null) g.offsets.push(e.entryOffsetSec);
  if (e.holdSec != null) g.holds.push(e.holdSec);
}
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const rows = Object.entries(byToken).map(([addr, g]) => ({ addr: addr.slice(0, 8), ...g, medOff: med(g.offsets), medHold: med(g.holds) })).sort((a, b) => (b.pnlBnb || 0) - (a.pnlBnb || 0));

console.log(`KOL 事件=${events.length} 钱包=${Object.keys(wallets).length} 有 KOL 票=${rows.length}/${pool.tokens.length}\n`);
console.log('== per-token（pnl 降序）==');
console.log('symbol'.padEnd(14) + 'pnlBnb'.padStart(8) + 'KOL'.padStart(5) + 'early≤60s'.padStart(9) + '持有着'.padStart(7) + 'buyUsd'.padStart(9) + 'medOff(s)'.padStart(10) + 'medHold(s)'.padStart(10) + 'susp'.padStart(5));
for (const r of rows) console.log(String(r.symbol).slice(0, 13).padEnd(14) + String(r.pnlBnb).padStart(8) + String(r.n).padStart(5) + String(r.early).padStart(9) + String(r.holding).padStart(7) + String(Math.round(r.buyUsd)).padStart(9) + String(r.medOff).padStart(10) + String(r.medHold).padStart(10) + String(r.suspicious).padStart(5));

// ---- 好/坏分组对照（仅含有 KOL 的票）----
for (const [label, cond] of [['good(pnl>0)', (p) => p > 0], ['bad(pnl<0)', (p) => p < 0]]) {
  const g = rows.filter((r) => cond(r.pnlBnb));
  if (!g.length) continue;
  const allOffsets = g.flatMap((r) => r.offsets), allHolds = g.flatMap((r) => r.holds);
  const nKol = g.reduce((s, r) => s + r.n, 0), nEarly = g.reduce((s, r) => s + r.early, 0), nHold = g.reduce((s, r) => s + r.holding, 0);
  console.log(`\n== ${label}：${g.length} 票 / KOL 参与 ${nKol} 次 / early(≤60s) 占 ${(100 * nEarly / nKol).toFixed(0)}% / 结束时仍持有 ${nHold} ==`);
  console.log(`   入场偏移 中位=${med(allOffsets)}s  P10=${[...allOffsets].sort((a, b) => a - b)[Math.floor(allOffsets.length * 0.1)]}s  min=${Math.min(...allOffsets)}s`);
  console.log(`   持有时长 中位=${med(allHolds)}s  max=${Math.max(...allHolds)}s`);
}
console.log('\n== KOL 钱包 Top（按参与票数）==');
for (const w of Object.values(wallets).sort((a, b) => b.tokens - a.tokens).slice(0, 15))
  console.log(`${w.wallet.slice(0, 10)} ${String(w.name || '').slice(0, 22).padEnd(22)} 票${String(w.tokens).padStart(2)} 好${String(w.goodTokens).padStart(2)} 坏${String(w.badTokens).padStart(2)} 60s内${String(w.earlyEntries).padStart(2)} 仍持${String(w.stillHoldingTokens).padStart(2)} 利润$${w.profitUsdSum}${w.suspicious ? ' ⚠wash' : ''}`);
