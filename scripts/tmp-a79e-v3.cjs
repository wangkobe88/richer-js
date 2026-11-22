#!/usr/bin/env node
/**
 * 一次性研究脚本（182 跑）：强庄胚子形状 v3（用户 2026-11-21 第五轮三条新腿）
 * ①famous 不在场（famous-copy-wallets.json 名单钱包 as-of 买入=0）
 * ②大户不能全离场（大户组合净持仓 ratio=Σ(买−卖)/Σ买 不落零——영희 反例立线）
 * ③主导大户：大户实体（T172 同块等额合并）最大单实体买入 ≥0.35
 * 基座=round9 形状（dom∧活态∧大卖占≥60∧量≤2B）；输出 15 张幸存者+141 全量组 EV
 * （含 0.35 腿有无两版——该腿可能剔登马甲，需用户知情）。
 * 用后可删。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const WIN_START = '2026-10-02T23:50:00.000Z';
const SPILL_END = '2026-10-05T06:00:00.000Z';
const BIG = 0.19, DOM_LINE = 0.35;
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
  console.log(`famous 名单 ${famousSet.size} 址`);
  const chase = JSON.parse(require('fs').readFileSync('/tmp/a79e-chase-out.json', 'utf8'));
  const quiet = new Map(JSON.parse(require('fs').readFileSync('/tmp/a79e-quiet-out.json', 'utf8')).map(r => [r.addr, r]));
  const addrs = chase.map(r => r.addr);

  const byToken = new Map();
  for (let i = 0; i < addrs.length; i += 50) {
    const rows = await fetchAll(db.from('wss_price_ticks')
      .select('token_address, trade_type, sender_address, trader_address, bnb_amount, block_number, log_index, block_time')
      .in('token_address', addrs.slice(i, i + 50)).gte('block_time', WIN_START).lte('block_time', SPILL_END));
    for (const r of rows) {
      const a = r.token_address.toLowerCase();
      let arr = byToken.get(a); if (!arr) { arr = []; byToken.set(a, arr); }
      arr.push(r);
    }
  }

  const res = [];
  for (const c of chase) {
    const Q = quiet.get(c.addr); if (!Q) continue;
    const ticks = byToken.get(c.addr) || [];
    const rows = ticks
      .map((r, i) => ({ ...r, _t: new Date(r.block_time).getTime(), _i: i, _w: ((r.sender_address || r.trader_address) || '').toLowerCase() || null, _bnb: num(r.bnb_amount) }))
      .sort((a, b) => (a.block_number ?? 1e15) - (b.block_number ?? 1e15) || (a.log_index ?? 0) - (b.log_index ?? 0) || a._i - b._i);
    const asof = rows.filter(r => r._t <= c.ts);
    const buy = new Map(), sell = new Map(), firstBuy = new Map();
    let famousBuyBnb = 0;
    for (const r of asof) {
      if (!r._w) continue;
      if (r.trade_type === 'buy') {
        buy.set(r._w, (buy.get(r._w) || 0) + r._bnb);
        if (!firstBuy.has(r._w)) firstBuy.set(r._w, r);
        if (famousSet.has(r._w)) famousBuyBnb += r._bnb;
      } else sell.set(r._w, (sell.get(r._w) || 0) + r._bnb);
    }
    // T172 同块等额首买组
    const eq = new Map();
    for (const r of firstBuy.values()) {
      if (r.block_number === null || r._bnb < 0.01) continue;
      const k = r.block_number + '|' + (Math.round(r._bnb * 1e4) / 1e4);
      let a = eq.get(k); if (!a) { a = new Set(); eq.set(k, a); }
      a.add(r._w);
    }
    const grouped = new Set();
    for (const a of eq.values()) if (a.size >= 2) for (const w of a) grouped.add(w);
    // 大户实体
    let bigBuySum = 0; const entities = [];
    for (const [w, v] of buy) {
      if (grouped.has(w)) continue;
      if (v >= BIG) { bigBuySum += v; entities.push({ wallets: [w], buy: v, sell: sell.get(w) || 0 }); }
    }
    for (const a of eq.values()) {
      if (a.size < 2) continue;
      let mb = 0, ms = 0; for (const w of a) { mb += buy.get(w) || 0; ms += sell.get(w) || 0; }
      if (mb >= BIG) { bigBuySum += mb; entities.push({ wallets: [...a], buy: mb, sell: ms }); }
    }
    const bigNet = entities.reduce((s, e) => s + (e.buy - e.sell), 0);
    const maxEnt = entities.reduce((m, e) => Math.max(m, e.buy), 0);
    const maxWallet = [...buy.entries()].filter(([w]) => !grouped.has(w)).reduce((m, [, v]) => Math.max(m, v), 0);
    const maxEntityNetStill = entities.reduce((m, e) => (e.buy - e.sell > m ? e.buy - e.sell : m), 0); // 最大「还在持仓」的单实体
    res.push({
      addr: c.addr, sym: Q.sym, pnl: Q.pnl, golden: Q.golden,
      dom: Q.dom, live: Q.live, bigSellDom: Q.bigSellDom, volOk: Q.volBnb <= 2,
      famousBuyBnb: +famousBuyBnb.toFixed(3),
      bigNetRatio: bigBuySum > 0 ? +(bigNet / bigBuySum).toFixed(2) : null,
      maxEnt: +maxEnt.toFixed(3), maxWallet: +maxWallet.toFixed(3), maxEntityNetStill: +maxEntityNetStill.toFixed(3),
    });
  }

  const summ = (list, label) => {
    if (!list.length) { console.log(`${label}: 无样本`); return; }
    const p = list.map(r => r.pnl);
    const net = p.reduce((s, v) => s + v, 0);
    const exG = list.filter(r => !r.golden);
    console.log(`${label}: n=${list.length} | 组净 ${net >= 0 ? '+' : ''}${net.toFixed(0)}%=${(0.2 * net / 100).toFixed(2)}B | 每票 ${(net / list.length).toFixed(1)}% | 胜率 ${(p.filter(v => v > 0).length / list.length * 100).toFixed(0)}% | 剔金狗 ${exG.reduce((s, r) => s + r.pnl, 0).toFixed(0)}%（${exG.length}票）`);
  };
  const base = r => r.dom && r.live && r.bigSellDom && r.volOk;
  console.log('\n── 新腿分布（15 张基座内）──');
  for (const r of res.filter(base).sort((a, b) => b.pnl - a.pnl)) {
    console.log(`${r.addr.slice(0, 10)}… ${String(r.sym).padEnd(8)} pnl=${String(r.pnl).padStart(7)} famous买=${r.famousBuyBnb} 大户净持比=${r.bigNetRatio} 最大实体=${r.maxEnt}（单钱包${r.maxWallet}）主导净持=${r.maxEntityNetStill} ${r.golden ? '狗' : ''}`);
  }
  console.log('\n── 组 EV（141 全量，逐腿叠加）──');
  summ(res.filter(base), '基座（=15 张）             ');
  summ(res.filter(r => base(r) && r.famousBuyBnb === 0), '基座∧无famous               ');
  summ(res.filter(r => base(r) && r.famousBuyBnb === 0 && r.bigNetRatio > 0.5), '基座∧无famous∧大户净持>50%  ');
  summ(res.filter(r => base(r) && r.famousBuyBnb === 0 && r.bigNetRatio > 0.5 && r.maxEnt >= DOM_LINE), '基座∧无famous∧净持>50%∧主导≥0.35');
  summ(res.filter(r => base(r) && r.famousBuyBnb === 0 && r.bigNetRatio > 0.5 && r.maxWallet >= DOM_LINE), '…∧单钱包≥0.35（非合并实体）');
  console.log('\n── 最终形状全明细（主导实体版）──');
  for (const r of res.filter(r => base(r) && r.famousBuyBnb === 0 && r.bigNetRatio > 0.5 && r.maxEnt >= DOM_LINE).sort((a, b) => b.pnl - a.pnl)) {
    console.log(`${r.addr.slice(0, 10)}… ${String(r.sym).padEnd(8)} pnl=${String(r.pnl).padStart(7)} 最大实体${r.maxEnt} 净持比${r.bigNetRatio} ${r.golden ? '狗' : ''}`);
  }
  require('fs').writeFileSync('/tmp/a79e-v3-out.json', JSON.stringify(res, null, 1));
  console.log('\n明细已落 /tmp/a79e-v3-out.json');
  process.exit(0);
})().catch((e) => { console.error('失败:', e); process.exit(1); });
