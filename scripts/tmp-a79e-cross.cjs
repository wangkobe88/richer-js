#!/usr/bin/env node
/**
 * 一次性研究脚本（182 跑）：强庄胚子 v3 形状四窗跨验（w1003 已知 + w1019/w1012/w1103）
 * 老实验无 FP32 metadata → big_buy_defer 从 ticks 重算（镜像 FA：大户=出生窗 90s 封顶累计买
 * ≥0.19（T172 同块等额合并）；档 ≥1B→60s / ≥0.79B→45s；sinceFirstTrade=锚−首笔可靠买；
 * 深破豁免不重算=blocked 集略宽）。v3 形状线值与 w1003 逐字同：
 * dom(share≥60) ∧ chg30≥−10 ∧ actNet≥−0.1 ∧ 大卖占≥60% ∧ 量≤2B ∧ 无famous
 * ∧ 大户净持比>0.5 ∧ 主导实体≥0.35；EV=stallClose 50s 出口 0.2B/票。
 * ⚠活态/chg30 从 ticks 直算（chg30=锚价/30s 前可靠价−1；actNet=10s 窗净额）。
 * 用后可删。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const BIG = 0.19, LAUNCH_MS = 90_000, STALL_MS = 50_000, SUB_BNB = 0.02, POS_BNB = 0.2;
const WINDOWS = [
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
  const famousSet = new Set(JSON.parse(require('fs').readFileSync('config/rosters/famous-copy-wallets.json', 'utf8')).wallets.map(w => String(w).toLowerCase()));

  const analyzeToken = (ticks, sigTimes, sym) => {
    const rows = ticks
      .map((r, i) => ({ ...r, _t: new Date(r.block_time).getTime(), _i: i, _w: ((r.sender_address || r.trader_address) || '').toLowerCase() || null, _bnb: num(r.bnb_amount), _p: num(r.price_bnb) }))
      .sort((a, b) => (a.block_number ?? 1e15) - (b.block_number ?? 1e15) || (a.log_index ?? 0) - (b.log_index ?? 0) || a._i - b._i);
    if (!rows.length) return null;
    const t0 = rows[0]._t;
    const rel = rows.filter(r => !r.price_outlier && r._p > 0);
    const firstRelBuy = rel.find(r => r.trade_type === 'buy') || rel[0];
    if (!firstRelBuy) return null;
    // 找首个「会被 FP32 拦」的信号时刻
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
      let bigSum = 0; const ents = [];
      for (const [w, v] of buy) if (!grouped.has(w) && v >= BIG) { bigSum += v; ents.push({ w: [w], buy: v }); }
      for (const a of eq.values()) {
        if (a.size < 2) continue;
        let mb = 0; for (const w of a) mb += buy.get(w) || 0;
        if (mb >= BIG) { bigSum += mb; ents.push({ w: [...a], buy: mb }); }
      }
      const since = (ts - firstRelBuy._t) / 1000;
      const tier = bigSum >= 1 ? 60 : bigSum >= 0.79 ? 45 : null;
      if (tier !== null && since <= tier) { anchor = { ts, bigSum, ents, buy, eq, grouped }; break; }
    }
    if (!anchor) return null;
    const ts = anchor.ts;
    // ── v3 组件（[t0, ts] 窗；买方账本已含 90s 封顶；卖/量/散户用全窗到 ts）──
    const asofFull = rows.filter(r => r._t <= ts);
    const sell = new Map();
    let vol = 0, totalBuyFull = 0;
    for (const r of asofFull) {
      vol += r._bnb;
      if (!r._w) continue;
      if (r.trade_type === 'buy') totalBuyFull += r._bnb; else sell.set(r._w, (sell.get(r._w) || 0) + r._bnb);
    }
    const totalSell = [...sell.values()].reduce((s, v) => s + v, 0);
    const bigSellSum = [...sell.entries()].filter(([, v]) => v >= 0.19).reduce((s, [, v]) => s + v, 0);
    // 大户实体净持（BNB 域）
    let entBuy = 0, entSell = 0;
    const entWs = new Set();
    for (const e of anchor.ents) { entBuy += e.buy; for (const w of e.w) entWs.add(w); }
    for (const [w, v] of sell) if (entWs.has(w)) entSell += v;
    const bigNetRatio = entBuy > 0 ? (entBuy - entSell) / entBuy : 0;
    const maxEnt = anchor.ents.reduce((m, e) => Math.max(m, e.buy), 0);
    // famous
    let famousBuy = 0;
    for (const [w, v] of anchor.buy) if (famousSet.has(w)) famousBuy += v;
    // 活态
    const pAt = rel.find(r => r._t >= ts);
    const p30 = rel.filter(r => r._t <= ts).slice(-1)[0];
    const p30back = rel.filter(r => r._t <= ts - 30_000).slice(-1)[0];
    const chg30 = pAt && p30back ? (pAt._p / p30back._p - 1) * 100 : (p30 && p30back ? (p30._p / p30back._p - 1) * 100 : null);
    let actNet = 0;
    for (const r of asofFull) if (r._t > ts - 10_000) actNet += r.trade_type === 'buy' ? r._bnb : -r._bnb;
    // share
    const share = totalBuyFull > 0 ? anchor.bigSum / totalBuyFull * 100 : 0;
    // EV：stallClose 出口
    const fwd = rows.filter(r => r._t >= ts);
    if (!pAt) return null;
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
    const shapeV3 = share >= 60 && chg30 !== null && chg30 >= -10 && actNet >= -0.1
      && totalSell > 0 && bigSellSum / totalSell >= 0.6
      && vol <= 2 && famousBuy === 0 && bigNetRatio > 0.5 && maxEnt >= 0.35;
    return { sym, ts, pnl: +pnl.toFixed(1), max60: max60 === null ? null : +max60.toFixed(1), shapeV3,
      share: +share.toFixed(1), chg30: chg30 === null ? null : +chg30.toFixed(1), actNet: +actNet.toFixed(2),
      bigSellPct: totalSell > 0 ? +(bigSellSum / totalSell * 100).toFixed(1) : null, vol: +vol.toFixed(2),
      famousBuy: +famousBuy.toFixed(2), bigNetRatio: +bigNetRatio.toFixed(2), maxEnt: +maxEnt.toFixed(2) };
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
      const rows = await fetchAll(db.from('wss_price_ticks')
        .select('token_address, trade_type, sender_address, trader_address, bnb_amount, price_bnb, price_outlier, block_number, log_index, block_time')
        .in('token_address', addrs.slice(i, i + 50))
        .gte('block_time', new Date(new Date(winStart).getTime() - 600_000).toISOString())
        .lte('block_time', spillEnd));
      for (const r of rows) {
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
    const blocked = res.length, shape = res.filter(r => r.shapeV3);
    const tails = res.filter(r => r.max60 !== null && r.max60 >= 200).sort((a, b) => b.max60 - a.max60);
    console.log(`域内肥尾(max60≥200%) ${tails.length} 张：${tails.slice(0, 5).map(r => (r.sym || r.addr.slice(0, 6)) + ' max60=' + r.max60 + ' 形状=' + r.shapeV3).join(' | ')}`);
    const net = shape.reduce((s, r) => s + r.pnl, 0);
    console.log(`\n═══ ${wname}（${expId.slice(0, 8)}）═══ BUY 信号票 ${addrs.length} → FP32 域内命中 ${blocked} → v3 形状 ${shape.length}`);
    if (shape.length) {
      console.log(`形状组：净 ${net >= 0 ? '+' : ''}${net.toFixed(0)}% = ${(0.2 * net / 100).toFixed(2)}B | 每票 ${(net / shape.length).toFixed(1)}% | 胜率 ${(shape.filter(r => r.pnl > 0).length / shape.length * 100).toFixed(0)}%`);
      for (const r of shape.sort((a, b) => b.pnl - a.pnl)) console.log(`  ${r.addr.slice(0, 10)}… ${String(r.sym).padEnd(8)} pnl=${String(r.pnl).padStart(7)}% max60=${String(r.max60).padStart(7)}% share=${r.share} chg30=${r.chg30} actNet=${r.actNet} 大卖占=${r.bigSellPct} 量=${r.vol} fam=${r.famousBuy} 净持=${r.bigNetRatio} 主导=${r.maxEnt}`);
    }
    // 域内基线（对照）
    const netAll = res.reduce((s, r) => s + r.pnl, 0);
    console.log(`域内全命中基线：净 ${netAll >= 0 ? '+' : ''}${netAll.toFixed(0)}% = ${(0.2 * netAll / 100).toFixed(2)}B | 每票 ${(netAll / res.length).toFixed(1)}% | 胜率 ${(res.filter(r => r.pnl > 0).length / res.length * 100).toFixed(0)}%`);
    grand.push({ wname, blocked, shapeN: shape.length, net: +net.toFixed(0), n: shape.length ? shape.length : 0, per: shape.length ? +(net / shape.length).toFixed(1) : 0,
      win: shape.length ? +(shape.filter(r => r.pnl > 0).length / shape.length * 100).toFixed(0) : 0, members: shape.map(r => `${r.sym || r.addr.slice(0, 6)}:${r.pnl}`) });
  }
  console.log('\n════ 四窗汇总（w1003 用 round10 实测：8 张 +143%/票 25%）════');
  for (const g of [...grand, { wname: 'w1003', shapeN: 8, net: 714, per: 89.2, win: 25 }]) {
    console.log(`${g.wname}: 形状 ${g.shapeN} 张 组净 ${g.net >= 0 ? '+' : ''}${g.net}% 每票 ${g.per}% 胜率 ${g.win}%`);
  }
  process.exit(0);
})().catch((e) => { console.error('失败:', e); process.exit(1); });
