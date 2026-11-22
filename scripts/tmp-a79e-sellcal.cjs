#!/usr/bin/env node
/**
 * 一次性研究脚本（182 跑）：卖家口径修正（用户肉眼纠偏 2026-11-21：奇迹/顺风车/丁真的
 * 大户卖出远超我 flow 口径的 0.27~0.36——买入大户集合看不见 curve 外筹码大卖家）
 * 新口径（as-of 首次 FP32 命中）：
 *   allBigSellerShare = 卖出≥0.19 的钱包（不限买入）卖出÷总卖
 *   top5SellerShare   = 卖出 top5 钱包÷总卖
 *   oversellBnb/N     = T197 口径 curve 外筹码账户（单户卖≥0.3 ∧ 卖>买×1.5）
 *   sellerWalletN     = 卖出≥0.015 的钱包数
 * 用后可删。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const EXP_ID = '9e9163de-a677-4d39-9c33-9ec9df05e400';
const WIN_START = '2026-10-02T23:50:00.000Z';
const SPILL_END = '2026-10-05T06:00:00.000Z';
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
  const asof = new Map(JSON.parse(require('fs').readFileSync('/tmp/a79e-asof-out.json', 'utf8')).filter(r => r.a).map(r => [r.addr, r]));
  const addrs = chase.map(r => r.addr);

  const TICK_COLS = 'token_address, trade_type, sender_address, trader_address, bnb_amount, block_number, log_index, block_time';
  const byToken = new Map();
  for (let i = 0; i < addrs.length; i += 50) {
    const rows = await fetchAll(db.from('wss_price_ticks').select(TICK_COLS)
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
    const asofRows = rows.filter(r => r._t <= c.ts);
    const buy = new Map(), sell = new Map();
    for (const r of asofRows) {
      if (!r._w) continue;
      if (r.trade_type === 'buy') buy.set(r._w, (buy.get(r._w) || 0) + r._bnb);
      else sell.set(r._w, (sell.get(r._w) || 0) + r._bnb);
    }
    const totalSell = [...sell.values()].reduce((s, v) => s + v, 0);
    const sellers = [...sell.entries()].sort((a, b) => b[1] - a[1]);
    const bigSellerSum = sellers.filter(([w, v]) => v >= 0.19).reduce((s, [, v]) => s + v, 0);
    const top5Sum = sellers.slice(0, 5).reduce((s, [, v]) => s + v, 0);
    let oversellBnb = 0, oversellN = 0;
    for (const [w, sv] of sellers) {
      if (sv >= 0.3 && sv > 1.5 * (buy.get(w) || 0)) { oversellBnb += sv; oversellN++; }
    }
    const sellerWalletN = sellers.filter(([, v]) => v >= 0.015).length;
    const A = asof.get(c.addr);
    const a = A ? A.a : null;
    const oldBigSell = a && a.totalSell > 0 && a.bigSellerShare !== null ? a.totalSell * a.bigSellerShare / 100 : 0;
    res.push({
      addr: c.addr, sym: A ? (A.sym || '') : '',
      allBigSellerShare: totalSell > 0 ? +(bigSellerSum / totalSell * 100).toFixed(1) : null,
      top5SellerShare: totalSell > 0 ? +(top5Sum / totalSell * 100).toFixed(1) : null,
      oversellBnb: +oversellBnb.toFixed(3), oversellN, sellerWalletN,
      oldFlowRatio: a && a.bigBuyBnb > 0 ? +(oldBigSell / a.bigBuyBnb).toFixed(2) : null,
      max60: c.gainFromSig60, golden: A ? A.golden : false,
    });
  }

  // 用户点名 4 票先看
  console.log('── 用户点名票（对页核）──');
  console.log('addr            sym      | 卖家口径大卖占% top5卖占% 超卖B(户) 卖家数 | 旧flow比 | max60');
  for (const p of ['0x7ad54f15', '0x04485985', '0x3b2748df', '0x406f7005', '0xf38f48cf', '0x19c11462', '0xece9cd98', '0xa5f7632b', '0x2bb2c57a', '0x8565b6d8']) {
    const r = res.find(x => x.addr.startsWith(p)); if (!r) continue;
    console.log(`${r.addr.slice(0, 10)}… ${String(r.sym).padEnd(8)}| ${String(r.allBigSellerShare).padStart(8)} ${String(r.top5SellerShare).padStart(8)} ${String(r.oversellBnb).padStart(6)}(${r.oversellN}) ${String(r.sellerWalletN).padStart(4)} | ${String(r.oldFlowRatio).padStart(6)} | ${r.max60}`);
  }

  // 分组统计：新口径能否分开肥尾 vs 平衰（27 形状票 + 全 141）
  const med = (arr) => { const s = [...arr].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const summ = (list, label) => {
    if (!list.length) { console.log(`${label}: 无样本`); return; }
    const g = list.map(r => r.max60).filter(v => v !== null);
    console.log(`${label}: n=${list.length} | max60 中位 ${med(g).toFixed(0)}% ≥100% ${g.filter(v => v >= 100).length} ≥300% ${g.filter(v => v >= 300).length}`);
  };
  const dom27 = ['0xf38f48cf', '0x19c11462', '0xece9cd98', '0xa5f7632b', '0x2bb2c57a', '0x8565b6d8', '0x406f7005', '0x3b2748df', '0x6ef09845', '0xa9e57581', '0xba6a027e', '0x57213b99', '0xfbacdfc2', '0x2c4bf870', '0x271ac8f2', '0x91289fc4', '0x36c2b853', '0x7bb31ab1', '0x04485985', '0xf3dc364c', '0x7598119d', '0x29351d04', '0xed82cdf5', '0x7ad54f15', '0xa1802ef2', '0x1dbedefa', '0xa0b08ec7'];
  const in27 = (r) => dom27.some(p => r.addr.startsWith(p));
  console.log('\n── 新口径扫线（27 形状票内）──');
  for (const line of [60, 80, 90]) {
    summ(res.filter(r => in27(r) && r.allBigSellerShare !== null && r.allBigSellerShare < line), `形状∧大卖占<${line}%`);
    summ(res.filter(r => in27(r) && r.allBigSellerShare !== null && r.allBigSellerShare >= line), `形状∧大卖占≥${line}%`);
  }
  for (const line of [70, 85, 95]) {
    summ(res.filter(r => in27(r) && r.top5SellerShare !== null && r.top5SellerShare < line), `形状∧top5卖<${line}% `);
    summ(res.filter(r => in27(r) && r.top5SellerShare !== null && r.top5SellerShare >= line), `形状∧top5卖≥${line}% `);
  }
  console.log('\n── 全 141 新口径 ──');
  for (const line of [80, 90]) {
    summ(res.filter(r => r.allBigSellerShare !== null && r.allBigSellerShare < line), `全部∧大卖占<${line}%`);
    summ(res.filter(r => r.allBigSellerShare !== null && r.allBigSellerShare >= line), `全部∧大卖占≥${line}%`);
  }
  require('fs').writeFileSync('/tmp/a79e-sellcal-out.json', JSON.stringify(res, null, 1));
  console.log('\n明细已落 /tmp/a79e-sellcal-out.json');
  process.exit(0);
})().catch((e) => { console.error('失败:', e); process.exit(1); });
