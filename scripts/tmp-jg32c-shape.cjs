#!/usr/bin/env node
/**
 * 一次性研究脚本（182 跑）：JG-32c 用户两提案四窗重放（FP32 域内）
 *  - 形状 A1「承接+低价赌局」：curVs≤28.5（锚入场价/首可靠买价）∧ chg30≥−10 ∧ actNet≥−0.1
 *  - 形状 A2 = A1 ∧ 大卖占≥60%（round8 B 组+低价腿）
 *  - 形状 B「换手豁免」：首波（t0+10s 前买 ≥0.1B）as-of 全清仓（净持≤10%买）∧ 后波（10s~锚点买 ≥0.1B）≥2 家持有（净持≥50%买）
 * FP32 锚点重算=镜像 tmp-a79e-cross.cjs（大户 0.19 线+T172 合并+45/60 档+90s 出生窗封顶；深破豁免不重算=域略宽）。
 * EV=stallClose 50s 出口；双口径 0.2B（对齐历史）与 0.05B（彩票臂）。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const BIG = 0.19, LAUNCH_MS = 90_000, STALL_MS = 50_000, SUB_BNB = 0.02;
const EARLY_SEC = 10, WAVE_LINE = 0.1, FIRST_CLEARED = 0.1, LATER_HOLD = 0.5, LATER_MIN = 2;
const CURVS_LINE = 28.5;
const WINDOWS = [
  ['w1003', '9e9163de-a677-4d39-9c33-9ec9df05e400', '2026-10-02T23:50:00.000Z', '2026-10-05T06:00:00.000Z'],
  ['w1019', 'ce102e94-293c-4f8f-af98-cd06f4b0e98c', '2026-10-19T00:00:00.000Z', '2026-10-21T00:00:00.000Z'],
  ['w1012', 'dddbe79e-480a-402a-aa35-85a72d2f591e', '2026-10-12T00:00:00.000Z', '2026-10-13T00:00:00.000Z'],
  ['w1103', '2448116a-bebe-457d-9d8a-b4556c9a8e0d', '2026-11-04T00:00:00.000Z', '2026-11-05T00:00:00.000Z'],
];
const num = (v) => { const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) ? n : 0; };
async function fetchAll(from, pageSize = 1000) {
  const rows = []; let offset = 0;
  for (;;) {
    const page = await from.range(offset, offset + pageSize - 1);
    if (page.error) throw new Error(page.error.message);
    rows.push(...page.data);
    if (page.data.length < pageSize) return rows;
    offset += pageSize;
  }
}

(async () => {
  const db = dbManager.getClient();
  const analyzeToken = (ticks, sigTimes, sym) => {
    const rows = ticks
      .map((r, i) => ({ ...r, _t: new Date(r.block_time).getTime(), _i: i, _w: ((r.sender_address || r.trader_address) || '').toLowerCase() || null, _bnb: num(r.bnb_amount), _p: num(r.price_bnb) }))
      .sort((a, b) => (a.block_number ?? 1e15) - (b.block_number ?? 1e15) || (a.log_index ?? 0) - (b.log_index ?? 0) || a._i - b._i);
    if (!rows.length) return null;
    const t0 = rows[0]._t;
    const rel = rows.filter(r => !r.price_outlier && r._p > 0);
    const firstRelBuy = rel.find(r => r.trade_type === 'buy') || rel[0];
    if (!firstRelBuy) return null;
    // FP32 锚点重算（同 cross.cjs）
    let anchor = null;
    for (const iso of sigTimes) {
      const ts = new Date(iso).getTime();
      const asof = rows.filter(r => r._t <= ts && r._t <= t0 + LAUNCH_MS);
      const buy = new Map(), firstBuy = new Map();
      for (const r of asof) {
        if (!r._w || r.trade_type !== 'buy') continue;
        buy.set(r._w, (buy.get(r._w) || 0) + r._bnb);
        if (!firstBuy.has(r._w)) firstBuy.set(r._w, r);
      }
      const eq = new Map();
      for (const r of firstBuy.values()) {
        if (r.block_number === null || r._bnb < 0.01) continue;
        const k = r.block_number + '|' + (Math.round(r._bnb * 1e4) / 1e4);
        let a = eq.get(k); if (!a) { a = new Set(); eq.set(k, a); }
        a.add(r._w);
      }
      const grouped = new Set();
      for (const a of eq.values()) if (a.size >= 2) for (const w of a) grouped.add(w);
      let bigSum = 0;
      for (const [w, v] of buy) if (!grouped.has(w) && v >= BIG) bigSum += v;
      for (const a of eq.values()) {
        if (a.size < 2) continue;
        let mb = 0; for (const w of a) mb += buy.get(w) || 0;
        if (mb >= BIG) bigSum += mb;
      }
      const since = (ts - firstRelBuy._t) / 1000;
      const tier = bigSum >= 1 ? 60 : bigSum >= 0.79 ? 45 : null;
      if (tier !== null && since <= tier) { anchor = { ts, bigSum, buy }; break; }
    }
    if (!anchor) return null;
    const ts = anchor.ts;
    const asofFull = rows.filter(r => r._t <= ts);
    // 钱包账本（as-of 全窗）
    const wBuy = new Map(), wSell = new Map(), wFirstBuyT = new Map();
    for (const r of asofFull) {
      if (!r._w) continue;
      if (r.trade_type === 'buy') {
        wBuy.set(r._w, (wBuy.get(r._w) || 0) + r._bnb);
        if (!wFirstBuyT.has(r._w)) wFirstBuyT.set(r._w, r._t);
      } else wSell.set(r._w, (wSell.get(r._w) || 0) + r._bnb);
    }
    const net = (w) => (wBuy.get(w) || 0) - (wSell.get(w) || 0);
    // 卖压构成
    let totalSell = 0, bigSellSum = 0;
    for (const [w, v] of wSell) { totalSell += v; if (v >= 0.19) bigSellSum += v; }
    const bigSellPct = totalSell > 0 ? (bigSellSum / totalSell) * 100 : null;
    // 活态（价格锚统一=锚前最后可靠价=信号触发 tick 价；EV 入场同价）
    const pBefore = rel.filter(r => r._t <= ts).slice(-1)[0];
    const pAt = pBefore || rel.find(r => r._t >= ts);
    if (!pAt) return null;
    const mkChg = (sec) => {
      const back = rel.filter(r => r._t <= ts - sec * 1000).slice(-1)[0];
      return back ? (pAt._p / back._p - 1) * 100 : null;
    };
    const chg30 = mkChg(30), chg10 = mkChg(10), chg5 = mkChg(5);
    const chgEff = chg30 !== null ? chg30 : chg10 !== null ? chg10 : chg5; // 最长可用窗
    let actNet = 0;
    for (const r of asofFull) if (r._t > ts - 10_000) actNet += r.trade_type === 'buy' ? r._bnb : -r._bnb;
    // curVs（简化锚=首可靠买价；研究近似）
    const curVs = (pAt._p / firstRelBuy._p - 1) * 100;
    // 形状 A1/A2
    const absorb = chgEff !== null && chgEff >= -10 && actNet >= -0.1;
    const shapeA1 = curVs <= CURVS_LINE && absorb;
    const shapeA2 = shapeA1 && bigSellPct !== null && bigSellPct >= 60;
    // 形状 B：首波/后波（单钱包口径）
    const earlyCut = t0 + EARLY_SEC * 1000;
    const early = [], later = [];
    for (const [w, b] of wBuy) {
      if (b < WAVE_LINE) continue;
      const ft = wFirstBuyT.get(w);
      (ft <= earlyCut ? early : later).push(w);
    }
    let shapeB = false, earlyN = early.length, laterHoldN = 0;
    if (earlyN >= 1) {
      const earlyCleared = early.every(w => net(w) <= wBuy.get(w) * FIRST_CLEARED);
      laterHoldN = later.filter(w => net(w) >= wBuy.get(w) * LATER_HOLD).length;
      shapeB = earlyCleared && laterHoldN >= LATER_MIN;
    }
    // EV：stallClose 出口
    const fwd = rows.filter(r => r._t >= ts);
    let lastSub = pAt._t, lastPrice = pAt._p, exitP = null;
    for (const r of fwd) {
      if (r._t - lastSub > STALL_MS) { exitP = lastPrice; break; }
      if (!r.price_outlier && r._p > 0) lastPrice = r._p;
      if (r._bnb >= SUB_BNB) lastSub = r._t;
    }
    if (exitP === null) exitP = lastPrice;
    const pnl = (exitP / pAt._p - 1) * 100;
    const seg = rel.filter(r => r._t >= ts && r._t <= ts + 3_600_000);
    const max60 = seg.length ? (Math.max(...seg.map(r => r._p)) / pAt._p - 1) * 100 : null;
    return { sym, ts: new Date(ts).toISOString(), pnl: +pnl.toFixed(1), max60: max60 === null ? null : +max60.toFixed(1),
      shapeA1, shapeA2, shapeB, curVs: +curVs.toFixed(1), chgEff: chgEff === null ? null : +chgEff.toFixed(1), actNet: +actNet.toFixed(2),
      bigSellPct: bigSellPct === null ? null : +bigSellPct.toFixed(0), earlyN, laterHoldN };
  };

  const grand = [];
  for (const [wname, expId, winStart, winEnd] of WINDOWS) {
    const sigs = await fetchAll(db.from('strategy_signals')
      .select('token_address, token_symbol, signal_type, created_at').eq('experiment_id', expId)
      .eq('signal_type', 'BUY').order('created_at', { ascending: true }));
    const byTok = new Map();
    for (const s of sigs) {
      const a = (s.token_address || '').toLowerCase(); if (!a) continue;
      let e = byTok.get(a); if (!e) { e = { sym: s.token_symbol || '', times: [] }; byTok.set(a, e); }
      e.times.push(s.created_at);
    }
    const addrs = [...byTok.keys()];
    const spillEnd = new Date(new Date(winEnd).getTime() + 6 * 3600_000).toISOString();
    const tickByToken = new Map();
    for (let i = 0; i < addrs.length; i += 50) {
      const trows = await fetchAll(db.from('wss_price_ticks')
        .select('token_address, trade_type, sender_address, trader_address, bnb_amount, price_bnb, price_outlier, block_number, log_index, block_time')
        .in('token_address', addrs.slice(i, i + 50))
        .gte('block_time', new Date(new Date(winStart).getTime() - 600_000).toISOString())
        .lte('block_time', spillEnd));
      for (const r of trows) {
        const a = r.token_address.toLowerCase();
        let arr = tickByToken.get(a); if (!arr) { arr = []; tickByToken.set(a, arr); }
        arr.push(r);
      }
    }
    const res = [];
    for (const [a, e] of byTok) {
      const r = analyzeToken(tickByToken.get(a) || [], e.times, e.sym);
      if (r) res.push({ addr: a, ...r });
    }
    const line = (label, list) => {
      if (!list.length) { console.log(`  ${label}: 0 张`); return; }
      const netPct = list.reduce((s, r) => s + r.pnl, 0);
      const tails = list.filter(r => r.max60 !== null && r.max60 >= 200);
      console.log(`  ${label}: ${list.length} 张 | stall 净 ${netPct >= 0 ? '+' : ''}${netPct.toFixed(0)}% (0.2B=${(0.2 * netPct / 100).toFixed(2)}B / 0.05B=${(0.05 * netPct / 100).toFixed(2)}B) 每票 ${(netPct / list.length).toFixed(1)}% 胜率 ${(list.filter(r => r.pnl > 0).length / list.length * 100).toFixed(0)}% | 肥尾≥200%: ${tails.length}${tails.length ? ' → ' + tails.map(r => `${r.sym || r.addr.slice(0, 6)}=${r.max60}`).join(',') : ''}`);
    };
    console.log(`\n═══ ${wname}（${expId.slice(0, 8)}）═══ BUY 信号票 ${addrs.length} → FP32 域内重算命中 ${res.length}`);
    line('域内全量（基线）', res);
    line('A1 低价∧承接', res.filter(r => r.shapeA1));
    line('A2 A1∧大卖占≥60', res.filter(r => r.shapeA2));
    line('B  首波清仓∧后波持有', res.filter(r => r.shapeB));
    for (const r of res.filter(r => r.shapeB || (r.max60 !== null && r.max60 >= 200)).sort((a, b) => b.max60 - a.max60)) {
      console.log(`    · ${r.addr.slice(0, 10)}… ${String(r.sym).padEnd(9)} pnl=${String(r.pnl).padStart(7)}% max60=${String(r.max60).padStart(7)}% curVs=${r.curVs} chgEff=${r.chgEff} actNet=${r.actNet} 大卖占=${r.bigSellPct} 首波${r.earlyN}/后波持${r.laterHoldN} A1=${r.shapeA1 ? 1 : 0} B=${r.shapeB ? 1 : 0}`);
    }
    grand.push({ wname, n: res.length,
      a1: res.filter(r => r.shapeA1), a2: res.filter(r => r.shapeA2), b: res.filter(r => r.shapeB) });
  }
  console.log('\n════ 四窗汇总 ════');
  const agg = (label, key) => {
    const all = grand.flatMap(g => g[key]);
    if (!all.length) { console.log(`${label}: 四窗合计 0 张`); return; }
    const netPct = all.reduce((s, r) => s + r.pnl, 0);
    const tails = all.filter(r => r.max60 !== null && r.max60 >= 200);
    const byW = grand.map(g => `${g.wname}:${g[key].length}`).join(' ');
    console.log(`${label}: 合计 ${all.length} 张（${byW}）| stall 净 ${netPct >= 0 ? '+' : ''}${netPct.toFixed(0)}% 每票 ${(netPct / all.length).toFixed(1)}% 胜率 ${(all.filter(r => r.pnl > 0).length / all.length * 100).toFixed(0)}% | 肥尾 ${tails.length} 张（${tails.map(r => (r.sym || r.addr.slice(0, 6)) + '=' + r.max60).join(',')}）`);
  };
  agg('A1 低价∧承接', 'a1');
  agg('A2 A1∧大卖占', 'a2');
  agg('B  换手豁免', 'b');
  process.exit(0);
})().catch((e) => { console.error('失败:', e); process.exit(1); });
