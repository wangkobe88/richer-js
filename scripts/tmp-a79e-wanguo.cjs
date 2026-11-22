#!/usr/bin/env node
/**
 * 一次性取证脚本（182 跑）：万锅共酱会 0x2893a796…5747777 作市团队假设深挖
 * 用户观察（2026-11-21）：很强的作弊味道，疑似作市团队，可能是做庄失败。
 * 输出：①钱包账本 top20（买卖/净持仓/时间窗）②同块协调（捆绑买卖块）③对倒对（同块
 * 一买一卖近等额）④往返钱包（先买后卖）⑤GMGN 画像标签联查 ⑥分钟级时间线（价+净流）。
 * 用后可删。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const TOKEN = '0x2893a7961216a58ce2051dbd9cd4f2d515747777'.toLowerCase();
const WIN_START = '2026-10-03T00:00:00.000Z';
const SPILL_END = '2026-10-05T06:00:00.000Z';
const num = (v) => { const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) ? n : 0; };
const f8 = (ms) => new Date(ms + 8 * 3600_000).toISOString().replace('T', ' ').slice(5, 19);
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
  const ticks = await fetchAll(db.from('wss_price_ticks')
    .select('trade_type, sender_address, trader_address, bnb_amount, price_bnb, price_outlier, block_number, log_index, block_time')
    .eq('token_address', TOKEN).gte('block_time', WIN_START).lte('block_time', SPILL_END));
  const rows = ticks
    .map((r, i) => ({ ...r, _t: new Date(r.block_time).getTime(), _i: i, _w: ((r.sender_address || r.trader_address) || '').toLowerCase() || '?', _bnb: num(r.bnb_amount), _p: num(r.price_bnb) }))
    .sort((a, b) => (a.block_number ?? 1e15) - (b.block_number ?? 1e15) || (a.log_index ?? 0) - (b.log_index ?? 0) || a._i - b._i);
  const t0 = rows[0]._t;
  console.log(`共 ${rows.length} 笔，首笔 ${f8(t0)}，末笔 ${f8(rows[rows.length - 1]._t)}，总时长 ${((rows[rows.length - 1]._t - t0) / 60000).toFixed(1)}min`);

  // ① 钱包账本
  const led = new Map();
  for (const r of rows) {
    let l = led.get(r._w); if (!l) { l = { buy: 0, sell: 0, buyN: 0, sellN: 0, first: r._t, last: r._t, tokens: 0 }; led.set(r._w, l); }
    if (r.trade_type === 'buy') { l.buy += r._bnb; l.buyN++; l.tokens += r._bnb / r._p; } else { l.sell += r._bnb; l.sellN++; l.tokens -= r._bnb / r._p; }
    l.last = r._t;
  }
  const top = [...led.entries()].sort((a, b) => (b[1].buy + b[1].sell) - (a[1].buy + a[1].sell)).slice(0, 20);
  console.log(`\n── 钱包账本 top20（按总流水）──`);
  console.log('wallet          买B(nb)   卖B(nb)   净tokens(估值B)  买/卖笔  首见(龄s)  末见(龄s)');
  for (const [w, l] of top) {
    const lastPrice = rows.filter(r => !r.price_outlier).slice(-1)[0]._p;
    console.log(`${w.slice(0, 8)}…  ${l.buy.toFixed(3).padStart(7)} ${l.sell.toFixed(3).padStart(8)}  ${(l.tokens * lastPrice).toFixed(3).padStart(9)}  ${l.buyN}/${l.sellN}  ${((l.first - t0) / 1000).toFixed(0).padStart(6)}  ${((l.last - t0) / 1000).toFixed(0).padStart(7)}`);
  }

  // ② 同块协调：买卖各块的钱包数与金额
  const blk = new Map();
  for (const r of rows) {
    if (r.block_number === null) continue;
    let b = blk.get(r.block_number); if (!b) { b = { t: r._t, buyW: new Set(), buyB: 0, sellW: new Set(), sellB: 0 }; blk.set(r.block_number, b); }
    if (r.trade_type === 'buy') { b.buyW.add(r._w); b.buyB += r._bnb; } else { b.sellW.add(r._w); b.sellB += r._bnb; }
  }
  const coord = [...blk.entries()].filter(([, b]) => b.buyW.size >= 3 || b.sellW.size >= 3).sort((a, b) => Math.max(b[1].buyW.size, b[1].sellW.size) - Math.max(a[1].buyW.size, a[1].sellW.size));
  console.log(`\n── 同块协调块（买或卖钱包≥3，top12）──`);
  for (const [bn, b] of coord.slice(0, 12)) {
    console.log(`blk${bn} ${f8(b.t)}  买${b.buyW.size}钱包/${b.buyB.toFixed(3)}B  卖${b.sellW.size}钱包/${b.sellB.toFixed(3)}B`);
  }

  // ③ 对倒对：同块内 A 买 B 卖 且金额相对差 <5%（各自非零）
  console.log(`\n── 同块对倒对（金额差<5%，top10 按金额）──`);
  const pairs = [];
  const byBlk = new Map();
  for (const r of rows) if (r.block_number !== null) { let a = byBlk.get(r.block_number); if (!a) { a = []; byBlk.set(r.block_number, a); } a.push(r); }
  for (const [bn, arr] of byBlk) {
    const buys = arr.filter(r => r.trade_type === 'buy' && r._bnb >= 0.01), sells = arr.filter(r => r.trade_type === 'sell' && r._bnb >= 0.01);
    for (const b of buys) for (const s of sells) {
      if (b._w === s._w) continue;
      if (Math.abs(b._bnb - s._bnb) / Math.max(b._bnb, s._bnb) < 0.05) pairs.push({ bn, t: b._t, bw: b._w, sw: s._w, amt: b._bnb });
    }
  }
  pairs.sort((a, b) => b.amt - a.amt);
  for (const p of pairs.slice(0, 10)) console.log(`blk${p.bn} ${f8(p.t)}  ${p.bw.slice(0, 8)}买 ↔ ${p.sw.slice(0, 8)}卖  ${p.amt.toFixed(3)}B`);

  // ④ 往返钱包（买过也卖过，双边≥0.05B）+ 同进同出节奏
  const rt = [...led.entries()].filter(([, l]) => l.buy >= 0.05 && l.sell >= 0.05).sort((a, b) => b[1].buy - a[1].buy);
  console.log(`\n── 往返钱包（买≥0.05 且 卖≥0.05）${rt.length} 个 ──`);
  for (const [w, l] of rt.slice(0, 12)) console.log(`${w.slice(0, 8)}…  买${l.buy.toFixed(3)}(${l.buyN}) 卖${l.sell.toFixed(3)}(${l.sellN})  回吐率${(l.sell / l.buy * 100).toFixed(0)}%  窗口${((l.first - t0) / 1000).toFixed(0)}~${((l.last - t0) / 1000).toFixed(0)}s`);

  // ⑤ GMGN 画像
  const top20 = top.map(([w]) => w);
  const gm = await db.from('gmgn_wallet_profiles').select('address,tags,token_num,winrate,realized_profit').in('address', top20);
  console.log(`\n── GMGN 画像命中（top20 钱包）──`);
  for (const g of (gm.data || [])) console.log(`${g.address.slice(0, 8)}…  tags=${JSON.stringify(g.tags)} token_num=${g.token_num} winrate=${g.winrate} rp=${g.realized_profit}`);
  if (!(gm.data || []).length) console.log('(零命中——30d 快照无这些钱包=非 GMGN 生态常客)');

  // ⑥ 分钟级时间线
  console.log(`\n── 分钟时间线（价%vs首价 | 买/卖 BNB）──`);
  const firstP = rows.find(r => !r.price_outlier)._p;
  let maxPct = -1e9, maxMin = 0;
  for (let m = 0; m < 30; m++) {
    const seg = rows.filter(r => r._t - t0 >= m * 60000 && r._t - t0 < (m + 1) * 60000);
    if (!seg.length) continue;
    let buy = 0, sell = 0, price = null;
    for (const r of seg) { if (r.trade_type === 'buy') buy += r._bnb; else sell += r._bnb; if (!r.price_outlier && r._p > 0) price = r._p; }
    const pct = price ? (price / firstP - 1) * 100 : null;
    if (pct !== null && pct > maxPct) { maxPct = pct; maxMin = m; }
    console.log(`t+${String(m).padStart(2)}min  ${pct === null ? '  ·' : pct.toFixed(0).padStart(4)}%  买${buy.toFixed(2).padStart(6)} 卖${sell.toFixed(2).padStart(6)}  (${seg.length}笔)`);
  }
  console.log(`峰值 +${maxPct.toFixed(0)}% @ t+${maxMin}min`);
  process.exit(0);
})().catch((e) => { console.error('失败:', e); process.exit(1); });
