// T167 取证（2026-11-17 用户点名 btv140 两信号页）：
//   BP-T055 Muuchan 0x20574150…7777 / BP-T056 MUCHAN 0x6ac55462…7777
// 用户裁定原话：「famous 低价全清之后，立马接盘，不是个好策略。famous 低点位卖出，
// 后续一般来讲就跟着砸盘。至少冷却一段时间再说。」
// A 部=两案票 famous 退出时间线深挖；B 部=127 点全量影响面扫描（exit 价格域 × 冷却窗）。
// 182 跑零 DB（ticks 集重放），输出 /tmp/t167-fam-lowexit.json
import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { buildBuyPointSnapshot } = require_('../../src/market-analysis/buy-point-snapshot.js');
const { sliceAsOf } = await import('./lib.mjs');

const rev = JSON.parse(readFileSync('/tmp/btv140-review.json', 'utf8'));
const doc = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv140-trades.json'), 'utf8'));
const roster = new Set(JSON.parse(readFileSync(resolve(HERE, '../../config/rosters/famous-copy-wallets.json'), 'utf8')).wallets.map((w) => w.toLowerCase()));

function loadPoint(pid) {
  const rr = rev.find((r) => r.pointId === pid);
  const p = doc.points.find((x) => x.pointId === pid);
  const full = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv140-trades-ticks', p.ticksFile), 'utf8')).rows || [];
  const rows = sliceAsOf(full, p.anchorTickCount);
  const meta = { ...(doc.tokens[p.tokenAddress] || { address: p.tokenAddress }), quoteToken: p.quoteToken || null };
  const snap = buildBuyPointSnapshot(rows, meta, { anchorTickCount: p.anchorTickCount, capped: p.capped === true, signalInfo: {} });
  return { rr, p, full, rows, snap };
}

/** famous 卖出笔明细（链上真序）：{dt, priceBnb, bnb, w, outlier} */
function famousSellTicks(snap) {
  return snap.ticks.filter((t) => t.side === 'SELL' && t.wallet && roster.has(String(t.wallet).toLowerCase()))
    .map((t) => ({ dt: t.dt, priceBnb: t.priceBnb, bnb: t.bnb, w: String(t.wallet).toLowerCase(), outlier: t.outlier }));
}

/** 锚末时刻（slice 末 tick dt） */
function anchorDt(snap) {
  return snap.ticks[snap.ticks.length - 1].dt;
}

// ═══ A 部：两案票深挖 ═══
const A = [];
for (const pid of ['BP-T055', 'BP-T056']) {
  const { rr, snap } = loadPoint(pid);
  const bd = snap.buyDerived || {};
  const ft = bd.famousTraces;
  const tEnd = anchorDt(snap);
  const sells = famousSellTicks(snap);
  const launch = bd.launchPriceBnb;
  const relVs = (px) => (launch && px > 0 ? +(((px / launch) - 1) * 100).toFixed(1) : null);
  const lastSell = sells.length ? sells[sells.length - 1] : null;
  const lastSellRel = sells.filter((s) => !s.outlier && s.priceBnb > 0).slice(-1)[0] || null;
  const detail = {
    pid, symbol: rr.symbol, pnl: rr.pnl, fwd: { m1: rr.fwd1m, m5: rr.fwd5m, m15: rr.fwd15m },
    tEnd, launch,
    anchors: {
      curVs: bd.currentVsLaunchPct, ath: bd.athVsLaunchPct, minVs: bd.minVsLaunchPct,
      chg30: bd.chg30Pct, chg5: bd.chg5Pct, totalBuyBnb: snap.cheatDerived.totalBuyBnb, totalSellBnb: snap.cheatDerived.totalSellBnb,
    },
    famous: ft ? {
      groupBuyBnb: ft.groupBuyBnb, groupBuyPct: ft.groupBuyPct, groupSellBnb: ft.groupSellBnb, groupSellPct: ft.groupSellPct,
      soldRatio: ft.groupBuyBnb > 0 ? +(ft.groupSellBnb / ft.groupBuyBnb).toFixed(3) : null,
      presenceNetBnb: ft.presenceNetBnb, inCustodyCount: ft.inCustodyCount, netSumBnb: ft.netSumBnb,
      wallets: ft.wallets.map((e) => ({
        w: e.w.slice(0, 8), buyBnb: e.buyBnb, sellBnb: e.sellBnb, netBnb: e.netBnb,
        firstBuyDt: e.firstBuyDt, entryVs: e.entryVsLaunchPct, firstSellDt: e.firstSellDt,
        lastSellDt: e.lastSellDt, holdSec: e.holdSec, fastFlip: e.fastFlip,
        lastSellVsLaunch: (() => { const s = sells.filter((x) => x.w === e.w && !x.outlier && x.priceBnb > 0).slice(-1)[0]; return s ? relVs(s.priceBnb) : null; })(),
      })),
    } : null,
    gapSecLastSellToAnchor: lastSell ? tEnd - lastSell.dt : null,
    lastSellVsLaunch: lastSellRel ? relVs(lastSellRel.priceBnb) : null,
    famousSellTimeline: sells.map((s) => ({ dt: s.dt, vs: relVs(s.priceBnb), bnb: s.bnb, w: s.w.slice(0, 8), out: s.outlier })),
  };
  A.push(detail);
  console.log(`\n══ ${pid} ${rr.symbol} pnl=${rr.pnl} ══`);
  console.log(`  tEnd=${tEnd}s launch=${launch} curVs=${detail.anchors.curVs} ath=${detail.anchors.ath} chg30=${detail.anchors.chg30} 总买=${detail.anchors.totalBuyBnb}`);
  if (detail.famous) {
    console.log(`  famous: 买${detail.famous.groupBuyBnb}B(${detail.famous.groupBuyPct}%) 卖${detail.famous.groupSellBnb}B(${detail.famous.groupSellPct}%) 自卖比=${detail.famous.soldRatio} 在场净=${detail.famous.presenceNetBnb} 在场数=${detail.famous.inCustodyCount}`);
    for (const w of detail.famous.wallets) console.log(`    ${w.w} 买${w.buyBnb}@t+${w.firstBuyDt}s(entry ${w.entryVs}%) 卖${w.sellBnb}@t+${w.lastSellDt}s(exit ${w.lastSellVsLaunch}%) hold=${w.holdSec}s net=${w.netBnb} fastFlip=${w.fastFlip}`);
    console.log(`  ★ 末笔 famous 卖 距锚=${detail.gapSecLastSellToAnchor}s 卖价=${detail.lastSellVsLaunch}%(vs launch)`);
    console.log('  famous 卖出时间线:', detail.famousSellTimeline.map((s) => `t+${s.dt}s@${s.vs}%(${s.bnb}B)`).join(' '));
  } else console.log('  famous: 无 roster 命中');
  console.log(`  fwd: 1m=${JSON.stringify(rr.fwd1m)} 5m=${JSON.stringify(rr.fwd5m)} 15m=${JSON.stringify(rr.fwd15m)}`);
}

// ═══ B 部：127 点全量扫描 ═══
// 形状=famous 全清（在场净 ≤0.005 BP63 清仓线）∧ 末笔卖在低价域 ∧ 距锚 ≤ 冷却窗
// 输出全 famous 命中票分布 + 候选线拦截面/误伤面
const B = [];
for (const rr of rev) {
  let snap;
  try { ({ snap } = loadPoint(rr.pointId)); } catch (e) { B.push({ pid: rr.pointId, err: String(e.message).slice(0, 60) }); continue; }
  const bd = snap.buyDerived || {};
  const ft = bd.famousTraces;
  if (!ft || !Array.isArray(ft.wallets) || ft.wallets.length === 0) { B.push({ pid: rr.pointId, sym: rr.symbol, pnl: rr.pnl, noFamous: true }); continue; }
  const tEnd = anchorDt(snap);
  const sells = famousSellTicks(snap).filter((s) => !s.outlier && s.priceBnb > 0);
  const lastSell = sells.length ? sells[sells.length - 1] : null;
  const launch = bd.launchPriceBnb;
  const exitVs = lastSell && launch ? +(((lastSell.priceBnb / launch) - 1) * 100).toFixed(1) : null;
  const soldRatio = ft.groupBuyBnb > 0 ? +(ft.groupSellBnb / ft.groupBuyBnb).toFixed(3) : null;
  B.push({
    pid: rr.pointId, sym: rr.symbol, pnl: rr.pnl,
    groupBuyPct: ft.groupBuyPct, groupSellPct: ft.groupSellPct, soldRatio,
    presenceNetBnb: ft.presenceNetBnb, holdingN: ft.wallets.filter((e) => e.netBnb > 0.005).length,
    wallets: ft.wallets.length,
    lastSellDt: lastSell ? lastSell.dt : null, gapSec: lastSell ? tEnd - lastSell.dt : null,
    exitVs, curVs: bd.currentVsLaunchPct, ath: bd.athVsLaunchPct, chg30: bd.chg30Pct,
    famBuyBnb: ft.groupBuyBnb,
  });
}

const famHits = B.filter((b) => !b.noFamous && !b.err);
console.log(`\n══ B 部：127 点 famous 命中 ${famHits.length} 票（按 exitVs 升序）══`);
console.log('pid        sym        pnl     占买%   占卖%   自卖比  在场净   gap(s)  exitVs  curVs  ath    chg30');
for (const b of famHits.slice().sort((a, c) => (a.exitVs ?? 999) - (c.exitVs ?? 999))) {
  console.log(`${b.pid}  ${String(b.sym).padEnd(10)} ${(b.pnl ?? 0).toFixed(3).padStart(7)} ${String(b.groupBuyPct).padStart(6)} ${String(b.groupSellPct).padStart(6)} ${String(b.soldRatio).padStart(6)} ${String(b.presenceNetBnb).padStart(7)} ${String(b.gapSec).padStart(7)} ${String(b.exitVs).padStart(7)} ${String(b.curVs).padStart(6)} ${String(b.ath).padStart(6)} ${String(b.chg30).padStart(6)}`);
}

// 候选线扫描：全清（在场净≤0.005）∧ 占买≥10 ∧ exitVs≤X ∧ gap≤W
function sweep(X, W, needClear = true) {
  const hits = famHits.filter((b) => b.exitVs !== null && b.exitVs <= X && b.gapSec !== null && b.gapSec <= W
    && (!needClear || (b.presenceNetBnb ?? 1) <= 0.005) && (b.groupBuyPct ?? 0) >= 10);
  const sum = hits.reduce((s, b) => s + (b.pnl ?? 0), 0);
  const wins = hits.filter((b) => b.pnl > 0);
  return { X, W, n: hits.length, sum: +sum.toFixed(3), winN: wins.length, winSum: +wins.reduce((s, b) => s + b.pnl, 0).toFixed(3), hits: hits.map((b) => `${b.pid}${b.pnl >= 0 ? '+' : ''}${b.pnl}`) };
}
console.log('\n候选线扫描（全清∧占买≥10∧exitVs≤X∧距锚≤W）:');
for (const X of [10, 40, 80]) for (const W of [60, 120, 180, 300]) {
  const r = sweep(X, W);
  console.log(`  exitVs≤${X} gap≤${W}s: 拦 ${r.n} 票 净=${r.sum}（正票 ${r.winN} 张 Σ${r.winSum}） ${r.hits.join(' ')}`);
}
console.log('\n对照：全清约束放开（只要 exitVs≤X∧gap≤W∧占买≥10）:');
for (const X of [10, 40]) for (const W of [120, 300]) {
  const r = sweep(X, W, false);
  console.log(`  exitVs≤${X} gap≤${W}s: 拦 ${r.n} 票 净=${r.sum}（正票 ${r.winN} 张 Σ${r.winSum}） ${r.hits.join(' ')}`);
}

writeFileSync('/tmp/t167-fam-lowexit.json', JSON.stringify({ A, B }, null, 1));
console.log('\n→ /tmp/t167-fam-lowexit.json');
