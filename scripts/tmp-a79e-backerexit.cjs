#!/usr/bin/env node
/**
 * 一次性研究脚本（182 跑）：强庄胚子形状票的「大户离场全清」卖出策略验证（用户 2026-11-21 提案）
 * 规则：入场=信号价 0.2B；持续跟踪信号时刻锁定的大户实体（T172 合并）净持仓（token 域），
 *   合计净持仓 ≤ 买入 token 的 10%（=出清）→ 以该笔（或下一笔）成交价全清。
 *   永不触发 → 数据末价。对照组=stallClose 50s 出口（round8 口径）。
 * 用后可删。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const WIN_START = '2026-10-02T23:50:00.000Z';
const SPILL_END = '2026-10-05T06:00:00.000Z';
const BIG = 0.19, EXIT_RATIO = 0.10, STALL_MS = 50_000, SUB_BNB = 0.02;
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
  const v3 = JSON.parse(require('fs').readFileSync('/tmp/a79e-v3-out.json', 'utf8'));
  const quiet = new Map(JSON.parse(require('fs').readFileSync('/tmp/a79e-quiet-out.json', 'utf8')).map(r => [r.addr, r]));
  // 最终 8 张（实体版）+ 15 张基座
  const base = r => r.dom && r.live && r.bigSellDom && (quiet.get(r.addr) || {}).volBnb <= 2;
  const final8 = v3.filter(r => base(r) && r.famousBuyBnb === 0 && r.bigNetRatio > 0.5 && r.maxEnt >= 0.35).map(r => r.addr);
  const addrSet = new Set([...final8, ...v3.filter(base).map(r => r.addr)]);
  const addrs = [...addrSet];
  console.log(`跑 ${addrs.length} 张（8 最终+基座对照）`);

  const byToken = new Map();
  for (let i = 0; i < addrs.length; i += 50) {
    const rows = await fetchAll(db.from('wss_price_ticks')
      .select('token_address, trade_type, sender_address, trader_address, bnb_amount, token_amount, price_bnb, price_outlier, block_number, log_index, block_time')
      .in('token_address', addrs.slice(i, i + 50)).gte('block_time', WIN_START).lte('block_time', SPILL_END));
    for (const r of rows) {
      const a = r.token_address.toLowerCase();
      let arr = byToken.get(a); if (!arr) { arr = []; byToken.set(a, arr); }
      arr.push(r);
    }
  }

  const out = [];
  for (const addr of addrs) {
    const c = chase.find(x => x.addr === addr);
    const V = v3.find(x => x.addr === addr);
    const ticks = byToken.get(addr) || [];
    const rows = ticks
      .map((r, i) => ({ ...r, _t: new Date(r.block_time).getTime(), _i: i, _w: ((r.sender_address || r.trader_address) || '').toLowerCase() || null, _bnb: num(r.bnb_amount), _tok: num(r.token_amount), _p: num(r.price_bnb) }))
      .sort((a, b) => (a.block_number ?? 1e15) - (b.block_number ?? 1e15) || (a.log_index ?? 0) - (b.log_index ?? 0) || a._i - b._i);
    if (!rows.length) continue;
    // as-of 入场：大户实体锁定（token 域账本）
    const asof = rows.filter(r => r._t <= c.ts);
    const buyB = new Map(), firstBuy = new Map();
    for (const r of asof) {
      if (!r._w || r.trade_type !== 'buy') continue;
      buyB.set(r._w, (buyB.get(r._w) || 0) + r._bnb);
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
    const bigWs = new Set();
    for (const [w, v] of buyB) if (!grouped.has(w) && v >= BIG) bigWs.add(w);
    for (const a of eq.values()) {
      if (a.size < 2) continue;
      let mb = 0; for (const w of a) mb += buyB.get(w) || 0;
      if (mb >= BIG) for (const w of a) bigWs.add(w);
    }
    // 入场时刻大户已持有的 token（买 token − 卖 token，as-of）
    const held = new Map();
    for (const r of asof) {
      if (!r._w || !bigWs.has(r._w)) continue;
      const d = r.trade_type === 'buy' ? r._tok : -r._tok;
      held.set(r._w, (held.get(r._w) || 0) + d);
    }
    let peakNet = [...held.values()].reduce((s, v) => s + Math.max(0, v), 0); // 入场点净持（token）
    if (peakNet <= 0) continue; // 防御（净持腿保证>0）
    // 前向走：大户离场全清
    const fwd = rows.filter(r => r._t >= c.ts);
    const rel = fwd.filter(r => !r._o && r._p > 0);
    const at = rel.find(r => r._t >= c.ts); if (!at) continue;
    let exitP = null, exitWhy = null, exitOffMs = 0, netNow = peakNet;
    for (let i = 0; i < fwd.length; i++) {
      const r = fwd[i];
      if (r._w && bigWs.has(r._w) && r.trade_type === 'sell') {
        netNow -= r._tok;
        if (netNow <= peakNet * EXIT_RATIO) {
          // 触发：该卖单所在价成交（若同刻还有后续 tick 取下一笔可靠价，保守）
          const nxt = rel.find(x => x._t >= r._t && x !== r);
          exitP = nxt && nxt._t - r._t < 10_000 ? nxt._p : r._p;
          exitWhy = 'backer_out'; exitOffMs = r._t - c.ts;
          break;
        }
      }
    }
    if (exitP === null) { exitP = rel[rel.length - 1]._p; exitWhy = 'end'; exitOffMs = rel[rel.length - 1]._t - c.ts; }
    const pnlBacker = (exitP / at._p - 1) * 100;
    // stallClose 对照（round8 同款）
    let lastSub = at._t, lastPrice = at._p, sp = null;
    for (const r of fwd) {
      if (r._t - lastSub > STALL_MS) { sp = lastPrice; break; }
      if (!r._o && r._p > 0) lastPrice = r._p;
      if (r._bnb >= SUB_BNB) lastSub = r._t;
    }
    if (sp === null) sp = lastPrice;
    const pnlStall = (sp / at._p - 1) * 100;
    out.push({
      addr, sym: V.sym, final8: final8.includes(addr), golden: V.golden,
      backerExitMin: +(exitOffMs / 60000).toFixed(1), why: exitWhy,
      pnlBacker: +pnlBacker.toFixed(1), pnlStall: +pnlStall.toFixed(1), diff: +(pnlBacker - pnlStall).toFixed(1),
    });
  }

  console.log('\naddr            sym        [v3] | 大户离场出口        | stall出口 | Δ');
  for (const r of out.sort((a, b) => b.pnlBacker - a.pnlBacker)) {
    console.log(`${r.addr.slice(0, 10)}… ${String(r.sym).padEnd(8)} ${r.final8 ? '★' : ' '} | ${r.why === 'backer_out' ? '清仓@' + r.backerExitMin + 'm' : '未触发末价'} pnl=${String(r.pnlBacker).padStart(7)}% | ${String(r.pnlStall).padStart(7)}% | ${r.diff >= 0 ? '+' : ''}${r.diff}% ${r.golden ? '狗' : ''}`);
  }
  const summ = (list, label) => {
    if (!list.length) return;
    for (const key of ['pnlBacker', 'pnlStall']) {
      const net = list.reduce((s, r) => s + r[key], 0);
      console.log(`${label} ${key === 'pnlBacker' ? '大户离场全清' : 'stallClose   '}: 组净 ${net >= 0 ? '+' : ''}${net.toFixed(0)}%=${(0.2 * net / 100).toFixed(2)}B 每票 ${(net / list.length).toFixed(1)}% 胜率 ${(list.filter(r => r[key] > 0).length / list.length * 100).toFixed(0)}%`);
    }
  };
  console.log('\n── 组对比 ──');
  summ(out.filter(r => r.final8), '最终8张');
  summ(out, '基座15张');
  require('fs').writeFileSync('/tmp/a79e-backerexit-out.json', JSON.stringify(out, null, 1));
  process.exit(0);
})().catch((e) => { console.error('失败:', e); process.exit(1); });
