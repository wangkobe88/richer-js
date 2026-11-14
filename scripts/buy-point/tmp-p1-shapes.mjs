// P1 组织性拉起→砸出：三条子形状锚前可判扫描 v2（182 跑，只读）
// A 轮转分界【块级，忠实用户 T003/T004 算法】：前缀买主导块 + 后缀卖主导块，分界明显
// B 捆绑砸盘：锚前同块多户卖（单块 ≥N户∧≥0.5 / 相邻双块 ≥6户∧≥0.5∧卖≥买3倍）
// C 捆绑买入：锚前同块多户买 —— 只作 burst 豁免资格硬腿评估（sbw=1 ∧ C），非独立门
// 用法：node tmp-p1-shapes.mjs <set-name>
import fs from 'node:fs';
import { dbManager } from '../../src/services/dbManager.js';
import { AGGREGATOR_ROUTER_ADDRS } from '../../src/trading-engine/pre-check/aggregator-routers.js';

const NAME = process.argv[2] || 'btv109-trades';
const TICKS = `scripts/buy-point/sets/${NAME}-ticks`;
const SET = `scripts/buy-point/sets/${NAME}.json`;
const ROUTERS = AGGREGATOR_ROUTER_ADDRS;
const set = JSON.parse(fs.readFileSync(SET, 'utf8'));
const ts = (iso) => Date.parse(iso) / 1000;
const fmt = (v, d = 2) => (v == null ? '?' : Number(v).toFixed(d));

const c = await dbManager.getClient();
const expIds = [...new Set(set.points.map(p => p.experimentId))];
const sigMeta = new Map();
for (const eid of expIds) {
  let from = 0;
  while (true) {
    const { data, error } = await c.from('strategy_signals')
      .select('id,token_address,action,executed,metadata')
      .eq('experiment_id', eid).eq('action', 'buy').order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const s of data) {
      if (!sigMeta.has(s.token_address) || s.executed) sigMeta.set(s.token_address, s.metadata?.cheatCheck || null);
    }
    if (data.length < 1000) break; from += 1000;
  }
}

const out = [];
for (const p of set.points) {
  const pid = p.pointId.slice(3), sym = p.tokenSymbol ?? '-';
  let rows;
  try { rows = JSON.parse(fs.readFileSync(`${TICKS}/${p.tokenAddress}.json`, 'utf8')).rows; } catch { continue; }
  const anchor = p.anchorTimeIso || rows[rows.length - 1].block_time;
  const aTs = ts(anchor);
  const pre = rows.filter(r => ts(r.block_time) <= aTs).map(r => ({
    t: ts(r.block_time), blk: r.block_number, buy: r.trade_type === 'buy',
    bnb: r.bnb_amount, w: (r.sender_address || r.trader_address || '').toLowerCase(),
  })).filter(r => r.w && !ROUTERS.has(r.w));
  const pnl = p.trade?.episode?.pnlBnb ?? null;
  const cc = sigMeta.get(p.tokenAddress) || {};
  const sbw = cc.levels?.stallBurstWave;
  const ex = cc.exempt?.code || '原生';

  // block 聚合（锚前）
  const bmap = new Map();
  for (const r of pre) {
    if (!bmap.has(r.blk)) bmap.set(r.blk, { blk: r.blk, t: r.t, buy: 0, nb: 0, buyers: new Set(), sell: 0, ns: 0, sellers: new Set() });
    const b = bmap.get(r.blk);
    if (r.buy) { b.buy += r.bnb; b.nb++; b.buyers.add(r.w); } else { b.sell += r.bnb; b.ns++; b.sellers.add(r.w); }
  }
  const bl = [...bmap.values()].sort((x, y) => x.blk - y.blk);

  // ── A 轮转分界（块级）：像样块（总额 ≥0.05）标 B/S 主导（买额占比 ≥60=B，≤40=S，中间 N）
  // 找最优分界 k：前段 B 纯度 ∧ 后段 S 纯度（各段 ≥2 像样块；末 S 块距锚 ≤60s=卖压临近买点）
  const BIG = 0.05;
  const sig2 = bl.filter(b => b.buy + b.sell >= BIG).map(b => ({ ...b, dom: b.buy / (b.buy + b.sell) >= 0.6 ? 'B' : (b.buy / (b.buy + b.sell) <= 0.4 ? 'S' : 'N') }));
  let A = { hit: false, prePurity: 0, postPurity: 0, preN: 0, postN: 0, lastS: null, splitAt: null };
  if (sig2.length >= 4) {
    let best = null;
    for (let k = 2; k <= sig2.length - 2; k++) {
      const preS2 = sig2.slice(0, k), postS2 = sig2.slice(k);
      const preB = preS2.filter(b => b.dom === 'B').length / k;
      const postS = postS2.filter(b => b.dom === 'S').length / postS2.length;
      // 末 S 块距锚
      const sBlocks = postS2.filter(b => b.dom === 'S');
      const lastS = sBlocks.length ? aTs - sBlocks[sBlocks.length - 1].t : null;
      const score = preB + postS;
      if (!best || score > best.score) best = { k, preB, postS, lastS, score };
    }
    if (best) {
    // 卖期卖额（分界点后 S 块卖合计）——轮转分界的金额维度
    const sellPhaseBnb = sig2.slice(best.k).filter(b => b.dom === 'S').reduce((a, b) => a + b.sell, 0);
    A = {
      hit: best.preB >= 0.8 && best.postS >= 0.8 && best.lastS != null && best.lastS <= 60,
      prePurity: +(best.preB * 100).toFixed(0), postPurity: +(best.postS * 100).toFixed(0),
      preN: best.k, postN: sig2.length - best.k, lastS: best.lastS, splitAt: sig2[best.k - 1] ? aTs - sig2[best.k - 1].t : null,
      sellPhaseBnb: +sellPhaseBnb.toFixed(2),
    };
  }
  }

  // ── B 捆绑砸盘 ──
  // 达标砸块（承接与命中同块判定）：单块 ≥4户∧≥0.5（s4 线），承接=该块之后到锚的新买入（同块买入=对倒不算承接）
  let B = { s6: false, s4: false, pair: false, maxW: 0, maxBnb: 0, toAnchor: null, pw: 0, buyAfter: null, near: false, nearBuyAfter: null };
  for (const b of bl) {
    if (b.sellers.size >= B.maxW) { B.maxW = b.sellers.size; B.maxBnb = b.sell; B.toAnchor = aTs - b.t; }
  }
  const buyAfterBlock = (blk) => +pre.filter(r => r.buy && r.blk > blk).reduce((a, r) => a + r.bnb, 0).toFixed(2);
  for (const b of bl) {
    if (b.sellers.size >= 4 && b.sell >= 0.5) {
      B.s4 = true;
      const af = buyAfterBlock(b.blk);
      if (B.buyAfter == null || af < B.buyAfter) B.buyAfter = af; // 取承接最小的达标块（最恶性）
      if (aTs - b.t <= 60 && (B.nearBuyAfter == null || af < B.nearBuyAfter)) B.nearBuyAfter = af;
    }
    if (b.sellers.size >= 6 && b.sell >= 0.5) B.s6 = true;
  }
  B.near = B.nearBuyAfter != null; // 存在贴锚（≤60s）达标砸块
  for (let i = 1; i < bl.length; i++) {
    const a = bl[i - 1], b = bl[i];
    if (b.blk - a.blk > 2) continue;
    const sellers = new Set([...a.sellers, ...b.sellers]);
    const totS = a.sell + b.sell, totB = a.buy + b.buy;
    if (sellers.size >= B.pw) B.pw = sellers.size;
    if (sellers.size >= 6 && totS >= 0.5 && totS >= totB * 3) B.pair = true;
  }
  B.p4 = B.pair;

  // ── C 捆绑买入（近 300s 单块 ≥6 户 ∧ ≥0.3）──
  let C = { hit: false, maxW: 0, maxBnb: 0, toAnchor: null };
  for (const b of bl) {
    if (aTs - b.t > 300) continue;
    if (b.buyers.size >= C.maxW) { C.maxW = b.buyers.size; C.maxBnb = b.buy; C.toAnchor = aTs - b.t; }
  }
  C.hit = C.maxW >= 6 && C.maxBnb >= 0.3;

  out.push({
    pid, sym, pnl, addr: p.tokenAddress, sbw, ex, A, B, C,
    detail: `A[${A.prePurity}/${A.preN}块→${A.postPurity}/${A.postN}块 卖期额${A.sellPhaseBnb ?? '?'} 末S@${A.lastS == null ? '?' : Math.round(A.lastS)}s] B(块${B.maxW}户${fmt(B.maxBnb, 1)}@${Math.round(B.toAnchor ?? -1)}s 承接${B.buyAfter ?? '?'}${B.nearBuyAfter != null ? `贴锚承接${B.nearBuyAfter}` : ''}) C(${C.maxW}户${fmt(C.maxBnb, 1)}@${Math.round(C.toAnchor ?? -1)}s)`,
  });
}

const sum = (arr) => arr.reduce((a, x) => a + (x.pnl || 0), 0);
const stat = (name, arr) => {
  const win = arr.filter(x => x.pnl > 0), lose = arr.filter(x => x.pnl < 0);
  console.log(`${name}: ${arr.length} 票 pnl=${fmt(sum(arr))}（亏 ${lose.length} ${fmt(sum(lose))} / 盈 ${win.length} ${fmt(sum(win))}）`);
};

console.log(`\n===== ${NAME}（${out.length} 票）=====`);
const VARIANTS = [
  ['A 块级轮转分界（前≥80%B块 ∧ 后≥80%S块 ∧ 各≥2块 ∧ 末S≤60s）', (x) => x.A.hit],
  ['A∧卖期额≥0.3（轮转+金额维度）', (x) => x.A.hit && (x.A.sellPhaseBnb ?? 0) >= 0.3],
  ['A∧卖期额≥0.5', (x) => x.A.hit && (x.A.sellPhaseBnb ?? 0) >= 0.5],
  ['B1w 单块砸 ≥4户∧≥0.5（对照）', (x) => x.B.s4],
  ['B1w∧承接<0.1（达标块承接，含历史块）', (x) => x.B.s4 && (x.B.buyAfter ?? 0) < 0.1],
  ['B1w∧承接<0.05', (x) => x.B.s4 && (x.B.buyAfter ?? 0) < 0.05],
  ['B1w∧贴锚≤60s∧承接<0.05（候选门）', (x) => x.B.near && (x.B.nearBuyAfter ?? 0) < 0.05],
  ['B1w∧贴锚≤60s∧承接<0.1', (x) => x.B.near && (x.B.nearBuyAfter ?? 0) < 0.1],
  ['B3∧承接<0.1', (x) => (x.B.s6 || x.B.p4) && (x.B.buyAfter ?? 0) < 0.1],
  ['A∧卖期额≥0.3 ∨ B3∧承接<0.1', (x) => (x.A.hit && (x.A.sellPhaseBnb ?? 0) >= 0.3) || ((x.B.s6 || x.B.p4) && (x.B.buyAfter ?? 0) < 0.1)],
  ['候选门：B1w∧贴锚≤60s∧承接<0.05 ∨ C∧sbw=1', (x) => (x.B.near && (x.B.nearBuyAfter ?? 0) < 0.05) || (x.C.hit && x.sbw === 1)],
  ['C∧sbw=1（burst 豁免资格硬腿）', (x) => x.C.hit && x.sbw === 1],
  ['C 独立门（对照，预期捞赢家）', (x) => x.C.hit],
];
for (const [name, fn] of VARIANTS) {
  const hit = out.filter(fn);
  stat(name, hit);
  if (hit.length <= 45) for (const x of hit.sort((a, b) => (a.pnl || 0) - (b.pnl || 0)))
    console.log(`   ${x.pid} ${String(x.sym).slice(0, 10)} pnl=${fmt(x.pnl, 4)} sbw=${x.sbw ?? '-'} ${x.ex} | ${x.detail}`);
}

const NAMED = { T003: 1, T004: 1, T005: 1, T006: 1, T008: 1, T025: 1, T041: 1, T045: 1, T089: 1, T097: 1, T100: 1, T101: 1 };
const named = out.filter(x => NAMED[x.pid]);
if (named.length) {
  console.log(`\n点名票覆盖：`);
  for (const x of named) console.log(`   ${x.pid} ${String(x.sym).slice(0, 10)} pnl=${fmt(x.pnl, 4)} A=${x.A.hit ? '✓' : '.'} B1=${x.B.s6 ? '✓' : '.'} B1w=${x.B.s4 ? '✓' : '.'} B2=${x.B.pair ? '✓' : '.'} C=${x.C.hit ? '✓' : '.'} | ${x.detail}`);
}
process.exit(0);
