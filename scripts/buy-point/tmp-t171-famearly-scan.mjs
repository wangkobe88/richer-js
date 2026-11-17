// T171 取证（2026-11-17 用户点名 bt-v141 两票 + 立法裁定「直接立法直接拦，看看有没有误伤」）：
//   거침없이 0x288b3aad…7777（−0.0553 全实验最差）/ SI 0x13ccc4b9…7777（−0.0508 最差 3）
// 形状：famous 极早（+4s/+7s）大额首进 → 几十秒快闪 → 票死（尾态均 −18%）。
// FP 现有臂全失明：FP10 冷却窗 120s 不够（死是永久的）+ SI 卖比 0.75/残仓 0.185 双出线；
// FP8b 要 ath≥100（两案 33/50）；FP3 二法占卖 ≥20 不达。
// 本脚本 A 部=两案 famousTraces 深挖；B 部=btv141 全 499 点 × 参数矩阵扫描（早窗 × 卖比）
// 量新臂（famous 早窗快闪）拦截面与误伤面。182 跑零 DB（ticks 集重放）。
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const roster = new Set(JSON.parse(readFileSync(resolve(HERE, '../../config/rosters/famous-copy-wallets.json'), 'utf8')).wallets.map((w) => String(w).toLowerCase()));
const SET = process.env.SET || 'btv141-trades';
const doc = JSON.parse(readFileSync(resolve(HERE, 'sets', `${SET}.json`), 'utf8'));

// 182 端无 dbManager 依赖的 snapshot 直调（与 tmp-t167 同模式）
const { createRequire } = await import('module');
const require_ = createRequire(import.meta.url);
const { buildBuyPointSnapshot } = require_('../../src/market-analysis/buy-point-snapshot.js');
const { sliceAsOf } = await import('./lib.mjs');

function loadPoint(p) {
  const full = JSON.parse(readFileSync(resolve(HERE, 'sets', `${SET}-ticks`, p.ticksFile), 'utf8')).rows || [];
  const rows = sliceAsOf(full, p.anchorTickCount);
  const meta = { ...(doc.tokens?.[p.tokenAddress] || { address: p.tokenAddress }), quoteToken: p.quoteToken || null };
  const snap = buildBuyPointSnapshot(rows, meta, { anchorTickCount: p.anchorTickCount, capped: p.capped === true, signalInfo: p.signalInfo || {} });
  return { p, rows, snap };
}

/** famousTraces 群体摘要（含群体首买 dt=早窗轴） */
function famSummary(snap) {
  const ft = snap.buyDerived?.famousTraces;
  if (!ft) return null;
  const firstBuyDt = ft.wallets.length ? Math.min(...ft.wallets.map((e) => e.firstBuyDt).filter((x) => x != null)) : null;
  return {
    n: ft.wallets.length,
    firstBuyDt,
    buyBnb: ft.groupBuyBnb, sellBnb: ft.groupSellBnb,
    soldRatio: ft.groupBuyBnb > 0 ? +(ft.groupSellBnb / ft.groupBuyBnb).toFixed(3) : null,
    presenceNetBnb: ft.presenceNetBnb, inCustody: ft.inCustodyCount,
    lastSellDt: ft.wallets.length ? Math.max(...ft.wallets.map((e) => e.lastSellDt).filter((x) => x != null)) : null,
    buyPct: ft.groupBuyPct,
    wallets: ft.wallets.map((e) => ({ w: e.w.slice(0, 8), buy: e.buyBnb, sell: e.sellBnb, net: e.netBnb, t1: e.firstBuyDt, hold: e.holdSec, entryVs: e.entryVsLaunchPct })),
  };
}

// ═══ A 部：两案深挖 ═══
console.log('═══ A 部：两案 ═══');
for (const addr of ['0x288b3aad44de17174bb815133355583c7d717777', '0x13ccc4b96a0561201211e7d37b1352d03ed37777']) {
  const pts = doc.points.filter((x) => x.tokenAddress === addr);
  for (const p of pts) {
    const { snap } = loadPoint(p);
    const f = famSummary(snap);
    const bd = snap.buyDerived || {};
    console.log(`\n${p.pointId} ${p.tokenSymbol} src=${p.source} pnl=${p.trade?.episode?.pnlBnb ?? p.forwardReturns?.byHorizon?.['300']?.maxRisePct ?? '—'}`);
    console.log(`  curVs=${bd.currentVsLaunchPct} ath=${bd.athVsLaunchPct} minVs=${bd.minVsLaunchPct} chg30=${bd.chg30Pct} 总买=${snap.cheatDerived?.totalBuyBnb}`);
    if (!f || !f.n) { console.log('  famous: 无'); continue; }
    console.log(`  famous: n=${f.n} 首买@${f.firstBuyDt}s 买${f.buyBnb}B(${f.buyPct}%) 卖${f.sellBnb}B 自卖比=${f.soldRatio} 在场净=${f.presenceNetBnb} 在场数=${f.inCustody}`);
    for (const w of f.wallets) console.log(`    ${w.w} 买${w.buy} 卖${w.sell} 净${w.net} t+${w.t1}s hold=${w.hold}s entry=${w.entryVs}%`);
  }
}

// ═══ B 部：全点 × 参数矩阵 ═══
console.log('\n═══ B 部：全点扫描 ═══');
const recs = [];
for (const p of doc.points) {
  let f, bd, snap, prows;
  try { const L = loadPoint(p); snap = L.snap; f = famSummary(snap); bd = snap.buyDerived || {}; prows = L.rows; }
  catch (e) { continue; }
  // T171 二修：极早入场轴——famous 群体首买在全部 BUY 行中的顺位（第几笔买）
  let famFirstBuyRank = null;
  {
    const roster2 = roster;
    let rank = 0;
    for (const t of prows) {
      if ((t.trade_type || t.side) !== 'buy' && t.side !== 'BUY') continue;
      rank++;
      const w = ((t.sender_address || t.trader_address || t.wallet || '') + '').toLowerCase();
      if (roster2.has(w)) { famFirstBuyRank = rank; break; }
    }
  }
  const pnl = p.trade?.episode?.pnlBnb ?? null;
  const anchorDt = snap.ticks.length ? snap.ticks[snap.ticks.length - 1].dt : null;
  recs.push({
    anchorDt, famFirstBuyRank,
    pid: p.pointId, src: p.source, sym: p.tokenSymbol, addr: p.tokenAddress,
    pnl, f, minVs: bd.minVsLaunchPct, curVs: bd.currentVsLaunchPct, ath: bd.athVsLaunchPct,
    fwd5: p.forwardReturns?.byHorizon?.['300']?.maxRisePct ?? null,
  });
}
console.log(`重放点数: ${recs.length}`);

const EARLY = [30, 60, 90, 120, 1e9];
const RATIO = [0.5, 0.6, 0.7, 0.8, 0.9];
const hit = (r, e, s) => r.f && r.f.n > 0 && r.f.firstBuyDt != null && r.f.firstBuyDt <= e
  && r.f.buyBnb >= 0.2 && r.f.soldRatio != null && r.f.soldRatio >= s;

for (const e of EARLY) {
  for (const s of RATIO) {
    const m = recs.filter((r) => hit(r, e, s));
    const traded = m.filter((r) => r.pnl != null);
    const pnl = traded.reduce((a, r) => a + r.pnl, 0);
    const pos = traded.filter((r) => r.pnl > 0);
    console.log(`早窗≤${e < 1e9 ? e + 's' : '∞'} 卖比≥${s}: 中 ${m.length} 点（trades ${traded.length}）| trades 净额=${pnl.toFixed(4)} | 正票误伤 ${pos.length} 张 ${pos.reduce((a, r) => a + r.pnl, 0).toFixed(3)} | 案票=${recs.filter(r=>r.addr.startsWith('0x288b')||r.addr.startsWith('0x13cc')).filter(r=>hit(r,e,s)).length}/2`);
  }
}

// 残仓比轴矩阵：早窗≤60 ∧ 买≥0.2 ∧ 残仓比(presenceNet/buy) ≥ 阈（SI 型核心轴）
console.log('\n── 残仓比轴（早窗≤60s ∧ 买≥0.2B ∧ 残仓比≥阈，不限卖比）──');
for (const pr of [0.05, 0.10, 0.12, 0.15, 0.20, 0.30]) {
  const m = recs.filter((r) => r.f && r.f.n > 0 && r.f.firstBuyDt != null && r.f.firstBuyDt <= 60
    && r.f.buyBnb >= 0.2 && r.f.presenceNetBnb != null && r.f.buyBnb > 0 && r.f.presenceNetBnb / r.f.buyBnb >= pr);
  const traded = m.filter((r) => r.pnl != null);
  const pnl = traded.reduce((a, r) => a + r.pnl, 0);
  const pos = traded.filter((r) => r.pnl > 0);
  console.log(`残仓比≥${pr}: trades 中 ${traded.length} 净额=${pnl.toFixed(4)} | 正票 ${pos.length} 张 ${pos.map(r=>r.sym+'+'+r.pnl).join(' / ')||'无'}`);
}
// 固定线（早窗 60 / 卖比 0.7）明细
console.log('\n── 固定线明细（早窗≤60s ∧ 买≥0.2B ∧ 卖比≥0.7）──');
for (const r of recs.filter((r) => hit(r, 60, 0.7))) {
  console.log(`  ${r.pid} ${r.sym} src=${r.src} pnl=${r.pnl ?? '—'} fwd5max=${r.fwd5 ?? '—'}% | famous首@${r.f.firstBuyDt}s 买${r.f.buyBnb} 卖比${r.f.soldRatio} 在场净${r.f.presenceNetBnb} 残仓比=${(r.f.presenceNetBnb/r.f.buyBnb).toFixed(3)} minVs=${r.minVs} curVs=${r.curVs}`);
}

// 卖比 0.5~0.7 边际带（SI 型部分撤离）单独看
console.log('\n── 边际带（早窗≤60 ∧ 买≥0.2 ∧ 0.5≤卖比<0.7）──');
for (const r of recs.filter((r) => r.f && r.f.n > 0 && r.f.firstBuyDt != null && r.f.firstBuyDt <= 60 && r.f.buyBnb >= 0.2 && r.f.soldRatio != null && r.f.soldRatio >= 0.5 && r.f.soldRatio < 0.7)) {
  console.log(`  ${r.pid} ${r.sym} src=${r.src} pnl=${r.pnl ?? '—'} fwd5max=${r.fwd5 ?? '—'}% | famous首@${r.f.firstBuyDt}s 买${r.f.buyBnb} 卖比${r.f.soldRatio} 在场净${r.f.presenceNetBnb} minVs=${r.minVs}`);
}
// T171 双支判定（早窗≤120s ∧ 群买≥0.2B 前提）：A 支砸到一半+大额残仓 / B 支清仓走人
const armAB = (r) => {
  const f = r.f;
  if (!f || !f.n || f.firstBuyDt == null || f.firstBuyDt > 120 || f.buyBnb < 0.2) return null;
  const pr = f.presenceNetBnb != null && f.buyBnb > 0 ? f.presenceNetBnb / f.buyBnb : null;
  if (f.soldRatio != null && f.soldRatio >= 0.7 && pr != null && pr >= 0.15) return 'A';
  if (f.presenceNetBnb != null && f.presenceNetBnb <= 0.01) return 'B';
  return null;
};
const armAB2 = (r, earlySec, earlyRank) => {
  const f = r.f;
  if (!f || !f.n || f.firstBuyDt == null || f.buyBnb < 0.2) return null;
  if (!(f.firstBuyDt <= earlySec || (r.famFirstBuyRank != null && r.famFirstBuyRank <= earlyRank))) return null;
  const pr = f.presenceNetBnb != null && f.buyBnb > 0 ? f.presenceNetBnb / f.buyBnb : null;
  if (f.soldRatio != null && f.soldRatio >= 0.7 && pr != null && pr >= 0.15) return 'A';
  if (f.presenceNetBnb != null && f.presenceNetBnb <= 0.01 && f.soldRatio != null && f.soldRatio >= 1.0) return 'B';
  return null;
};
console.log('\n── 极早轴矩阵（双支前提=秒≤X ∨ 顺位≤Y）trades 翻动 ──');
console.log('秒/顺位 | 首@ | 顺位 | 拦票净额 | 明细');
for (const [es, rk] of [[10, 5], [10, 3], [15, 5], [30, 8], [60, 10], [120, 999]]) {
  const hits = recs.filter((r) => r.src === 'trades' && armAB2(r, es, rk));
  const pnl = hits.reduce((a, r) => a + (r.pnl || 0), 0);
  console.log(`  秒≤${es}∨顺位≤${rk}: 拦 ${hits.length} 张 净额=${pnl.toFixed(4)} | ${hits.map((r) => `${r.sym}(${r.pnl})首@${r.f.firstBuyDt}s位${r.famFirstBuyRank}`).join(' / ')}`);
}
console.log('\n── T171 双支（A=卖比≥0.7∧残仓比≥0.15 / B=残仓≤0.01B）trades 面 ──');
for (const r of recs.filter((x) => x.src === 'trades' && x.f && x.f.n > 0 && x.f.buyBnb >= 0.2)) {
  const arm = armAB(r);
  if (arm) console.log(`  ${arm} 支拦 ${r.sym} ${r.addr.slice(0,10)}… pnl=${r.pnl} 首@${r.f.firstBuyDt}s 买${r.f.buyBnb} 卖比${r.f.soldRatio} 残仓${r.f.presenceNetBnb}`);
}
const tHit = recs.filter((r) => r.src === 'trades' && armAB(r));
console.log(`  合计拦 ${tHit.length} 张 净额=${tHit.reduce((a, r) => a + (r.pnl || 0), 0).toFixed(4)} | 正票误伤=${tHit.filter((r) => (r.pnl || 0) > 0).length}`);
console.log('\n── ladder 445 点双支中面（fwd5max 对照）──');
for (const r of recs.filter((x) => x.src === 'ladder' && armAB(x))) {
  console.log(`  ${armAB(r)} 支 ${r.pid} ${r.sym} fwd5max=${r.fwd5 ?? '—'}% | 首@${r.f.firstBuyDt}s 买${r.f.buyBnb} 卖比${r.f.soldRatio} 残仓${r.f.presenceNetBnb}`);
}
console.log('\n（对照）trades 54 点合计 pnl=', recs.filter(r=>r.pnl!=null).reduce((a,r)=>a+r.pnl,0).toFixed(4));
console.log('\n═══ trades 全 famous 票矩阵（早窗首进≤120s ∧ 买≥0.2B）═══');
console.log('票 | pnl | 首买@ | 群买B | 卖比 | 残仓B | 残仓比 | 末卖距锚s | 锚dt | minVs | curVs | ath | chg30 | 总买B');
for (const r of recs.filter((r) => r.src === 'trades' && r.f && r.f.n > 0 && r.f.firstBuyDt != null && r.f.firstBuyDt <= 120 && r.f.buyBnb >= 0.2).sort((a,b)=>(a.pnl??0)-(b.pnl??0))) {
  const pr = r.f.presenceNetBnb != null && r.f.buyBnb > 0 ? (r.f.presenceNetBnb / r.f.buyBnb).toFixed(3) : '—';
  const gap = r.f.lastSellDt != null && r.anchorDt != null ? (r.anchorDt - r.f.lastSellDt) : '—';
  console.log(`${r.sym} | ${r.pnl ?? '—'} | ${r.f.firstBuyDt}s | ${r.f.buyBnb} | ${r.f.soldRatio} | ${r.f.presenceNetBnb} | ${pr} | ${gap} | ${r.anchorDt}s | ${r.minVs} | ${r.curVs} | ${r.ath} | ${r.fwd5 ?? '—'}`);
}
