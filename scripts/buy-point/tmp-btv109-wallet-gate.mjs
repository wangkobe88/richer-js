// 大户在场硬门 109 票验证（182 跑，只读）：用户判据「至少一个 0.3 或两个 0.2 在场」
// 口径与 state-builder BP55/BP79 逐位同构：单笔 maxBuyBnb ≥0.19/≥0.3（单笔不累计）、
// 活跃在场=净 >0.005 ∧ 末动距锚 ≤120s；剔聚合路由伪钱包 9 址。
// 门= act30>=1 || act02>=2（act30 ⊆ act02）
import fs from 'node:fs';
import { AGGREGATOR_ROUTER_ADDRS } from '../../src/trading-engine/pre-check/aggregator-routers.js';

const TICKS = 'scripts/buy-point/sets/btv109-trades-ticks';
const SET = 'scripts/buy-point/sets/btv109-trades.json';
const ROUTERS = AGGREGATOR_ROUTER_ADDRS; // Set（地址均小写）
const set = JSON.parse(fs.readFileSync(SET, 'utf8'));
const ts = (iso) => Date.parse(iso) / 1000;
const fmt = (v, d = 2) => (v == null ? '?' : Number(v).toFixed(d));

const out = [];
for (const p of set.points) {
  const pid = p.pointId.slice(3), sym = p.tokenSymbol ?? '-';
  let rows;
  try { rows = JSON.parse(fs.readFileSync(`${TICKS}/${p.tokenAddress}.json`, 'utf8')).rows; } catch { continue; }
  const anchor = p.anchorTimeIso || rows[rows.length - 1].block_time;
  const aTs = ts(anchor);
  const pre = rows.filter(r => ts(r.block_time) <= aTs);
  // wallet 聚合（锚前全窗；wallet=sender||trader；剔 router）
  const agg = new Map();
  for (const r of pre) {
    const w = (r.sender_address || r.trader_address || '').toLowerCase();
    if (!w || ROUTERS.has(w)) continue;
    if (!agg.has(w)) agg.set(w, { maxBuy: 0, buy: 0, sell: 0, lastAct: 0 });
    const e = agg.get(w);
    if (r.trade_type === 'buy') { e.buy += r.bnb_amount; if (r.bnb_amount > e.maxBuy) e.maxBuy = r.bnb_amount; }
    else e.sell += r.bnb_amount;
    e.lastAct = Math.max(e.lastAct, ts(r.block_time));
  }
  const wallets = [...agg.entries()].map(([w, e]) => ({ w, ...e, net: e.buy - e.sell, idle: aTs - e.lastAct }));
  // BP79 在场三分同构
  const cls = (e) => e.net <= 0.005 ? '离场' : (e.idle != null && e.idle <= 120 ? '活跃' : '挂账');
  const big = wallets.filter(e => e.maxBuy >= 0.19);
  const act02 = big.filter(e => cls(e) === '活跃');
  const act30 = act02.filter(e => e.maxBuy >= 0.3);
  const gatePass = act30.length >= 1 || act02.length >= 2;
  const pnl = p.trade?.episode?.pnlBnb ?? null;
  // 口径变体字段：V2=0.3 级下探 0.29 视同；V3=挂账（净>0.005）也计入在场
  const act29 = act02.filter(e => e.maxBuy >= 0.29);
  const present = big.filter(e => cls(e) !== '离场');
  const present29 = present.filter(e => e.maxBuy >= 0.29);
  // 用户澄清（2026-11-13）：在场=没有卖出（不看末动时间）——两档：
  // 未清仓=净>0.005（BP79 残仓线剔零头）；从未卖=卖出合计 ≤0.01（部分兑现也算卖出离场）
  const neverSold = big.filter(e => e.sell <= 0.01);
  const neverSold29 = neverSold.filter(e => e.maxBuy >= 0.29);
  // N 系列「从来没来过」：全窗历史口径（不看是否清仓）——出现过一个 ≥0.30 单笔 ∨ ≥2 个 0.2 级钱包
  const n30all = big.filter(e => e.maxBuy >= 0.3).length;
  const n29all = big.filter(e => e.maxBuy >= 0.29).length;
  out.push({
    pid, sym, pnl, gatePass, addr: p.tokenAddress, anchor: p.anchorTimeIso,
    n02: big.length, n30all, n29all, mxAll: wallets.length ? Math.max(...wallets.map(e => e.maxBuy)) : 0,
    nActive02: act02.length, nActive30: act30.length,
    nActive29: act29.length, presence02: present.length, presence30: present29.length, presence30s: present.filter(e => e.maxBuy >= 0.3).length,
    nsold02: neverSold.length, nsold29: neverSold29.length, nsold30: neverSold.filter(e => e.maxBuy >= 0.3).length,
    detail2: neverSold.map(e => `${e.w.slice(0, 8)} mx${fmt(e.maxBuy)} 买${fmt(e.buy, 2)} 卖${fmt(e.sell, 2)}`),
    // 明细：全部 0.2 级钱包分类（供误伤/漏拦归因）
    detail: big.map(e => `${e.w.slice(0, 8)} mx${fmt(e.maxBuy)} 净${fmt(e.net, 3)} ${cls(e)}${e.idle != null ? `@${Math.round(e.idle)}s` : ''}`),
    gray1: act02.length === 1 && act30.length === 0, // 差一个的灰区（单个 0.19~0.29 活跃在场）
  });
}

const fail = out.filter(x => !x.gatePass), pass = out.filter(x => x.gatePass);
const sum = (arr) => arr.reduce((a, x) => a + (x.pnl || 0), 0);

// ── 三口径对比（用户裁定判据的边界变体）──
// V1 严格：≥0.30 活跃在场 ≥1 ∨ ≥2×0.19 活跃在场（120s 线）
// V2 0.29 视同：0.3 级下探 0.29（与 0.2 级 ≥0.19 视同对称，BP55 惯例）
// V3 挂账在场：V2 + 挂账（净>0.005 末动>120s）也计入在场（推翻 BP79 沉默不算在场）
for (const [name, passFn] of [
  ['V1 严格 0.30/120s', (e) => e.nActive30 >= 1 || e.nActive02 >= 2],
  ['V2 0.29 视同', (e) => e.nActive29 >= 1 || e.nActive02 >= 2],
  ['V3 +挂账在场', (e) => e.presence30 >= 1 || e.presence02 >= 2],
  ['W1 未清仓 0.30 严格（净>0.005 即在场）', (e) => e.presence30s >= 1 || e.presence02 >= 2],
  ['W2 未清仓 0.29 视同（=V3）', (e) => e.presence30 >= 1 || e.presence02 >= 2],
  ['W3 从未卖（卖≤0.01，部分兑现=不在场）0.29 视同', (e) => e.nsold29 >= 1 || e.nsold02 >= 2],
  ['W4 从未卖 0.30 严格', (e) => e.nsold30 >= 1 || e.nsold02 >= 2],
  ['C2 大户来过但全部已清仓才拒（零大户纯小散放行）', (e) => e.n02 === 0 || e.presence30 >= 1 || e.presence02 >= 2],
  ['N1 从来没来过（全窗无 ≥0.30 单笔 ∧ 0.2 级 <2 个）', (e) => e.n30all >= 1 || e.n02 >= 2],
  ['N2 从来没来过 0.29 视同', (e) => e.n29all >= 1 || e.n02 >= 2],
]) {
  const rej = out.filter(x => !passFn(x));
  const win = rej.filter(x => x.pnl > 0).sort((a, b) => b.pnl - a.pnl);
  const lose = rej.filter(x => x.pnl < 0);
  console.log(`${name}: 拒 ${rej.length} 票 pnl=${fmt(sum(rej))}（亏 ${lose.length} 票 ${fmt(sum(lose))} / 盈 ${win.length} 票 ${fmt(sum(win))}）`);
  console.log(`  被拒盈利 Top8: ${win.slice(0, 8).map(x => `${x.pid}${fmt(x.pnl, 3)}`).join(' ')}`);
  console.log(`  拒中亏损: ${lose.sort((a, b) => a.pnl - b.pnl).slice(0, 8).map(x => `${x.pid}${fmt(x.pnl, 3)}`).join(' ')}`);
}
console.log('');

console.log(`大户在场硬门验证（109 票，门=单笔≥0.3 活跃在场≥1 ∨ 单笔≥0.19 活跃在场≥2）`);
console.log(`\n过门 ${pass.length} 票 pnl=${fmt(sum(pass))} ｜ 拒 ${fail.length} 票 pnl=${fmt(sum(fail))}`);
const failWin = fail.filter(x => x.pnl > 0).sort((a, b) => b.pnl - a.pnl);
console.log(`\n被拒但盈利 ${failWin.length} 票（用户口径：小盈利不管，大幅盈利再议）：`);
for (const x of failWin) console.log(`  ${x.pid} ${String(x.sym).slice(0, 10)} pnl=${fmt(x.pnl, 4)} 0.2级${x.n02}个/活跃${x.nActive02}/0.3活跃${x.nActive30} | ${x.detail.slice(0, 3).join('；')}`);
const gray = out.filter(x => x.gray1);
console.log(`\n灰区（恰好 1 个 0.19~0.29 活跃在场，差一个过门）${gray.length} 票：`);
for (const x of gray) console.log(`  ${x.pid} ${String(x.sym).slice(0, 10)} pnl=${fmt(x.pnl, 4)} 门=${x.gatePass ? '过' : '拒'} | ${x.detail.join('；')}`);
console.log(`\n拒票全清单（含亏损=门正确拦的）：`);
for (const x of fail.sort((a, b) => (a.pnl || 0) - (b.pnl || 0))) {
  console.log(`  ${x.pid} ${String(x.sym).slice(0, 10)} pnl=${x.pnl == null ? '?' : x.pnl.toFixed(4)} 0.2级${x.n02}/活跃${x.nActive02}/0.3活跃${x.nActive30}`);
}
// ── C2 拒集明细（大户来过且全部已清仓）──
const c2rej = out.filter(x => !(x.n02 === 0 || x.presence30 >= 1 || x.presence02 >= 2));
console.log(`\nC2 拒集明细（大户来过且全部已清仓，${c2rej.length} 票）：`);
for (const x of c2rej.sort((a, b) => (b.pnl || 0) - (a.pnl || 0))) {
  console.log(`  ${x.pid} ${String(x.sym).slice(0, 12)} ${x.addr} pnl=${x.pnl == null ? '?' : x.pnl.toFixed(4)} 0.2级${x.n02}个`);
  for (const d of x.detail) console.log(`      ${d}`);
}
// ── N1 拒集明细（盘面从来没有来过一个 0.3 / 两个 0.2）──
const nrej = out.filter(x => !(x.n30all >= 1 || x.n02 >= 2));
console.log(`\nN1 拒集明细（从来没来过 ≥0.30 单笔大户 ∧ 0.2 级钱包 <2 个，${nrej.length} 票）：`);
for (const x of nrej.sort((a, b) => (b.pnl || 0) - (a.pnl || 0))) {
  console.log(`  ${x.pid} ${String(x.sym).slice(0, 12)} ${x.addr} pnl=${x.pnl == null ? '?' : x.pnl.toFixed(4)}`);
  if (x.n02 === 0) console.log(`      （零 0.2 级钱包，全窗最大单笔 ${fmt(x.mxAll, 3)}——纯小散票）`);
  for (const d of x.detail) console.log(`      ${d}`);
}
process.exit(0);
