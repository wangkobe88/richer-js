#!/usr/bin/env node
/**
 * 一次性研究脚本（182 跑）：冷盘强庄完整形状（用户 2026-11-21 第四轮形状修正）
 * 新腿：交易者不多（tradersN）/ 交易量不大（volBnb）/ 散户卖出不多（retailSellBnb≤线）
 *      + 散户买入不多（retailBuyBnb≤线，用户前轮「非大户买入的少」）
 * 全部 as-of 首次 FP32 命中信号时刻；EV 沿用 ev-out 的 stallClose 模拟 pnl。
 * 用后可删。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const WIN_START = '2026-10-02T23:50:00.000Z';
const SPILL_END = '2026-10-05T06:00:00.000Z';
const BIG = 0.19;
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
  const chase = JSON.parse(require('fs').readFileSync('/tmp/a79e-chase-out.json', 'utf8'));
  const sellcal = new Map(JSON.parse(require('fs').readFileSync('/tmp/a79e-sellcal-out.json', 'utf8')).map(r => [r.addr, r]));
  const ev = new Map(JSON.parse(require('fs').readFileSync('/tmp/a79e-ev-out.json', 'utf8')).map(r => [r.addr, r]));
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
    const ticks = byToken.get(c.addr) || [];
    const rows = ticks
      .map((r, i) => ({ ...r, _t: new Date(r.block_time).getTime(), _i: i, _w: ((r.sender_address || r.trader_address) || '').toLowerCase() || null, _bnb: num(r.bnb_amount) }))
      .sort((a, b) => (a.block_number ?? 1e15) - (b.block_number ?? 1e15) || (a.log_index ?? 0) - (b.log_index ?? 0) || a._i - b._i);
    if (!rows.length) continue;
    const asof = rows.filter(r => r._t <= c.ts);
    const wallets = new Map(); // w -> {buy, sell}
    let vol = 0;
    for (const r of asof) {
      vol += r._bnb;
      if (!r._w) continue;
      let l = wallets.get(r._w); if (!l) { l = { buy: 0, sell: 0 }; wallets.set(r._w, l); }
      if (r.trade_type === 'buy') l.buy += r._bnb; else l.sell += r._bnb;
    }
    let retailSell = 0, retailBuy = 0;
    for (const l of wallets.values()) {
      if (l.sell < BIG) retailSell += l.sell;
      if (l.buy < BIG) retailBuy += l.buy;
    }
    const E = ev.get(c.addr); if (!E) continue;
    res.push({
      addr: c.addr, sym: E.sym, pnl: E.pnl, golden: E.golden,
      dom: E.dom, live: E.chg30ok && E.actNetOk, bigSellDom: E.bigSellDom, old27: E.old27,
      tradersN: wallets.size, volBnb: +vol.toFixed(2),
      retailSellBnb: +retailSell.toFixed(3), retailBuyBnb: +retailBuy.toFixed(3),
    });
  }

  const summ = (list, label) => {
    if (!list.length) { console.log(`${label}: 无样本`); return; }
    const p = list.map(r => r.pnl);
    const net = p.reduce((s, v) => s + v, 0);
    const exG = list.filter(r => !r.golden);
    const netExG = exG.reduce((s, r) => s + r.pnl, 0);
    console.log(`${label}: n=${list.length} | 组净 ${net >= 0 ? '+' : ''}${net.toFixed(0)}%=${(0.2 * net / 100).toFixed(2)}B | 每票 ${(net / list.length).toFixed(1)}% | 胜率 ${(p.filter(v => v > 0).length / list.length * 100).toFixed(0)}% | 剔金狗 ${netExG >= 0 ? '+' : ''}${netExG.toFixed(0)}%（${exG.length}票）`);
  };
  const base = (r) => r.dom && r.live && r.bigSellDom;

  console.log('── 分布参考（141 张 as-of）──');
  const q = (arr, p) => [...arr].sort((a, b) => a - b)[Math.floor(arr.length * p)];
  console.log(`tradersN: p25=${q(res.map(r => r.tradersN), .25)} p50=${q(res.map(r => r.tradersN), .5)} p75=${q(res.map(r => r.tradersN), .75)}`);
  console.log(`volBnb: p25=${q(res.map(r => r.volBnb), .25)} p50=${q(res.map(r => r.volBnb), .5)} p75=${q(res.map(r => r.volBnb), .75)}`);
  console.log(`retailSell: p25=${q(res.map(r => r.retailSellBnb), .25)} p50=${q(res.map(r => r.retailSellBnb), .5)}；retailBuy: p50=${q(res.map(r => r.retailBuyBnb), .5)}`);

  console.log('\n── 基线（无新腿）──');
  summ(res.filter(base), 'B dom∧活态∧大卖占≥60');
  console.log('\n── 新腿单变量（在 B 上叠）──');
  for (const t of [10, 15, 20]) summ(res.filter(r => base(r) && r.tradersN <= t), `B∧交易者≤${t}      `);
  for (const v of [2, 3, 4]) summ(res.filter(r => base(r) && r.volBnb <= v), `B∧量≤${v}B          `);
  for (const s of [0.05, 0.1, 0.2]) summ(res.filter(r => base(r) && r.retailSellBnb <= s), `B∧散户卖≤${s}B     `);
  for (const b of [0.3, 0.5]) summ(res.filter(r => base(r) && r.retailBuyBnb <= b), `B∧散户买≤${b}B     `);
  console.log('\n── 组合扫线 ──');
  for (const [t, v, s, b] of [[15, 3, 0.1, 0.5], [15, 3, 0.2, 0.5], [20, 4, 0.2, 0.5], [10, 2, 0.05, 0.3], [15, 2, 0.1, 0.3]]) {
    summ(res.filter(r => base(r) && r.tradersN <= t && r.volBnb <= v && r.retailSellBnb <= s && r.retailBuyBnb <= b),
      `B∧人≤${t}∧量≤${v}∧散卖≤${s}∧散买≤${b}`);
  }
  require('fs').writeFileSync('/tmp/a79e-quiet-out.json', JSON.stringify(res, null, 1));
  console.log('\n明细已落 /tmp/a79e-quiet-out.json');
  process.exit(0);
})().catch((e) => { console.error('失败:', e); process.exit(1); });
