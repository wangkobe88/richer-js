#!/usr/bin/env node
/**
 * 一次性研究脚本 round4（182 跑）：用户修正口径——「非大户买入的少（来自小户的抛压小）」
 * 修正点：原 sellFromBig（已观察卖流大户占比）是错误操作化；正确=结构性小户抛压：
 *   小户买入绝对量 retailBuyBnb 小 ∧ 小户净持仓 retailNet=小户买−小户卖 小（未来抛压上限）。
 * 载体=FP32 命中 141 票（bt-v164），as-of 首命中信号时刻组件（round2 JSON）+ 结局（本脚本重拉 ticks）。
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

  // FP32 首命中时刻
  const sigs = await fetchAll(db.from('strategy_signals')
    .select('token_address, signal_type, executed, created_at, metadata').eq('experiment_id', EXP_ID));
  const hitTime = new Map(); const execAny = new Map();
  for (const s of sigs) {
    const a = (s.token_address || '').toLowerCase(); if (!a) continue;
    if (s.signal_type === 'BUY' && s.executed) execAny.set(a, true);
    const gates = s.metadata && s.metadata.factorCheck && s.metadata.factorCheck.gates;
    if (Array.isArray(gates) && gates.some(g => g.id === 'big_buy_defer' && g.hit)) {
      const t = new Date(s.created_at).getTime();
      if (!hitTime.has(a) || t < hitTime.get(a)) hitTime.set(a, t);
    }
  }
  const hitAddrs = [...hitTime.keys()];

  // ticks + 结局
  const TICK_COLS = 'token_address, price_bnb, price_outlier, block_number, log_index, block_time';
  const byToken = new Map();
  for (let i = 0; i < hitAddrs.length; i += 50) {
    const rows = await fetchAll(db.from('wss_price_ticks').select(TICK_COLS)
      .in('token_address', hitAddrs.slice(i, i + 50)).gte('block_time', WIN_START).lte('block_time', SPILL_END));
    for (const r of rows) {
      const a = r.token_address.toLowerCase();
      let arr = byToken.get(a); if (!arr) { arr = []; byToken.set(a, arr); }
      arr.push(r);
    }
  }

  // round2 as-of 组件 join + 小户净持仓推导
  const asofRows = JSON.parse(require('fs').readFileSync('/tmp/a79e-asof-out.json', 'utf8'));
  const comp = new Map();
  for (const r of asofRows) {
    if (!r.a) continue;
    const a = r.a;
    const bigSell = a.totalSell > 0 && a.bigSellerShare !== null ? a.totalSell * a.bigSellerShare / 100 : 0;
    const retailSell = Math.max(0, a.totalSell - bigSell);
    comp.set(r.addr, {
      ...a,
      retailSellBnb: +retailSell.toFixed(3),
      retailNetBnb: +(a.retailBuyBnb - retailSell).toFixed(3), // 小户净持仓≈未来小户抛压上限（BNB 计价）
      bigSellRatio: a.bigBuyBnb > 0 ? +(bigSell / a.bigBuyBnb).toFixed(3) : null,
      golden: r.golden, execEver: r.exec,
    });
  }

  const res = [];
  for (const addr of hitAddrs) {
    const c = comp.get(addr); if (!c) continue;
    const ticks = byToken.get(addr) || [];
    const tsMs = hitTime.get(addr);
    const rel2 = ticks
      .map((r, i) => ({ _t: new Date(r.block_time).getTime(), _i: i, _p: num(r.price_bnb), _o: r.price_outlier }))
      .filter(r => !r._o && r._p > 0)
      .sort((a, b) => a._t - b._t || a._i - b._i);
    const at = rel2.find(r => r._t >= tsMs);
    if (!at) continue;
    const seg60 = rel2.filter(r => r._t >= at._t && r._t <= at._t + 3_600_000);
    if (!seg60.length) continue;
    const px = (ms) => { const s = rel2.filter(r => r._t >= at._t + ms); return s.length ? +((s[0]._p / at._p - 1) * 100).toFixed(1) : null; };
    res.push({
      addr, c,
      max60: +((Math.max(...seg60.map(r => r._p)) / at._p - 1) * 100).toFixed(1),
      min60: +((Math.min(...seg60.map(r => r._p)) / at._p - 1) * 100).toFixed(1),
      px5: px(300_000), px30: px(1_800_000),
      exec: execAny.get(addr) || false,
    });
  }
  console.log(`样本 ${res.length}（FP32 命中且结局可算）`);

  const summ = (list, label) => {
    if (!list.length) { console.log(`${label}: 无样本`); return; }
    const med = (arr) => { const s = [...arr].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    const col = (k) => list.map(r => r[k]).filter(v => v !== null && v !== undefined);
    const tail = list.filter(r => r.max60 >= 300).length;
    console.log(`${label}: n=${list.length} | max60 中位 ${med(col('max60')).toFixed(0)}% max60≥300% ${tail} 票 | 5m 中位 ${med(col('px5')).toFixed(0)}% | 30m 中位 ${med(col('px30')).toFixed(0)}% 30m≥0 ${(col('px30').filter(v => v >= 0).length / col('px30').length * 100).toFixed(0)}% | min60 中位 ${med(col('min60')).toFixed(0)}%`);
  };
  const dom = (r) => r.c.share >= 60;
  const clean = (r) => r.c.buyClusterSize <= 7 && r.c.sellClusterSize <= 7 && r.c.eqClusterWallets < 3;

  console.log('\n═══ 修正口径：大户主导 ∧ 小户买入少（结构性小户抛压小）═══');
  for (const line of [0.15, 0.2, 0.3]) {
    summ(res.filter(r => dom(r) && r.c.retailBuyBnb <= line), `dom∧小户买≤${line}    `);
    summ(res.filter(r => dom(r) && r.c.retailBuyBnb > line), `dom∧小户买>${line}     `);
  }
  console.log('\n── 净持仓版（小户净持仓=未来小户抛压上限）──');
  for (const line of [0.1, 0.2, 0.3]) {
    summ(res.filter(r => dom(r) && r.c.retailNetBnb <= line), `dom∧小户净持≤${line}  `);
    summ(res.filter(r => dom(r) && r.c.retailNetBnb > line), `dom∧小户净持>${line}   `);
  }
  console.log('\n── 组合：小户净持 ≤0.2 ∧ 干净 ──');
  summ(res.filter(r => dom(r) && r.c.retailNetBnb <= 0.2 && clean(r)), 'dom∧净持≤0.2∧干净');
  summ(res.filter(r => dom(r) && r.c.retailNetBnb <= 0.2 && !clean(r)), 'dom∧净持≤0.2∧脏  ');
  console.log('\n── 基线 ──');
  summ(res.filter(r => dom(r)), 'dom_only             ');
  summ(res.filter(r => !dom(r)), '非主导               ');
  summ(res, '全部命中             ');

  console.log('\n── 两金狗修正口径组件 ──');
  for (const p of ['0x898af40e', '0xf38f48cf']) {
    const r = res.find(x => x.addr.startsWith(p));
    if (r) console.log(`   ${r.addr.slice(0, 10)}… share=${r.c.share}% 小户买=${r.c.retailBuyBnb} 小户卖=${r.c.retailSellBnb} 小户净持=${r.c.retailNetBnb} bigSellRatio=${r.c.bigSellRatio} max60=${r.max60} px30=${r.px30}`);
  }

  // 分布参考：小户买入量分位
  const rb = res.map(r => r.c.retailBuyBnb).sort((a, b) => a - b);
  const q = (p) => rb[Math.floor(rb.length * p)];
  console.log(`\n小户买入量分位：p25=${q(0.25)} p50=${q(0.5)} p75=${q(0.75)}；小户净持 p50=${[...res].sort((a, b) => a.c.retailNetBnb - b.c.retailNetBnb)[Math.floor(res.length / 2)].c.retailNetBnb}`);
  require('fs').writeFileSync('/tmp/a79e-retail-out.json', JSON.stringify(res, null, 1));
  console.log('明细已落 /tmp/a79e-retail-out.json');
  process.exit(0);
})().catch((e) => { console.error('失败:', e); process.exit(1); });
