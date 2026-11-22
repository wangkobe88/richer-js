#!/usr/bin/env node
/**
 * 一次性研究脚本 round3（182 跑）：FP32 命中票风险面补充
 * ①信号后 60m 内最深回撤（min gain）+ 5m/30m 时点涨幅（非 max 口径）
 * ②执行率统计（现状=消耗后接棒是否发生）
 * ③金狗 30 票与 FP32 域重叠（round1 JSON 聚合）
 * 用后可删。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const EXP_ID = '9e9163de-a677-4d39-9c33-9ec9df05e400';
const COLLECTION_ID = 'a8414632-7c24-4762-9253-c49bb0f53105';
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

  // ── A) round1 JSON 聚合：金狗 30 票与 FP32 域重叠 ──
  let shapeRows = [];
  try { shapeRows = JSON.parse(require('fs').readFileSync('/tmp/a79e-shape-out.json', 'utf8')); } catch { console.log('(无 round1 JSON，跳过 A)'); }
  if (shapeRows.length) {
    const g = shapeRows.filter(r => r.kind === 'G' && r.a);
    const dom = g.filter(r => r.a.bigBuyBnb >= 0.79);
    console.log(`[A] 金狗 30 票：出生窗大户合计 ≥0.79B（FP32 域内）${dom.length} 票；其中被 FP32 实际拦 ${g.filter(r => r.fp32Hit).length} 票`);
    for (const r of dom) {
      const s = r.shape || {};
      console.log(`   ${r.addr.slice(0, 10)}… ${(r.a.symbol || '').padEnd(8)} bigBnb=${r.a.bigBuyBnb} share=${r.a.bigBuySharePct}% tier=${r.a.tier} fp32Hit=${r.fp32Hit} prof=${r.profMax} gain60m=${r.a.gain60m} dom=${s.bigDominant ? 1 : 0} full=${s.all ? 1 : 0}`);
    }
  }

  // ── 信号时刻（FP32 首命中） ──
  const sigs = await fetchAll(db.from('strategy_signals')
    .select('token_address, signal_type, executed, created_at, metadata').eq('experiment_id', EXP_ID));
  const hitTime = new Map(); let execAny = new Map();
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
  const TICK_COLS = 'token_address, trade_type, price_bnb, price_outlier, block_number, log_index, block_time';
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
  // asof 形状（复用 round2 判定——读 round2 JSON 的 shape 字段）
  const asofRows = JSON.parse(require('fs').readFileSync('/tmp/a79e-asof-out.json', 'utf8'));
  const shapeMap = new Map(asofRows.map(r => [r.addr, r]));

  // round2 JSON 行内是裸指标 a（shape 未落盘）——此处重算形状标志
  const L = { share: 60, retailN: 5, retailBnb: 0.3, sellShare: 80, cluster: 7 };
  const shapeOfA = (a) => {
    if (!a) return null;
    const bigDominant = a.share >= L.share;
    const noRetail = a.retailWalletN <= L.retailN || a.retailBuyBnb <= L.retailBnb;
    const sellFromBig = a.totalSell <= 0 ? true : (a.bigSellerShare !== null && a.bigSellerShare >= L.sellShare);
    const clean = a.buyClusterSize <= L.cluster && a.sellClusterSize <= L.cluster && a.eqClusterWallets < 3;
    return { bigDominant, noRetail, sellFromBig, clean, all: bigDominant && noRetail && sellFromBig && clean };
  };

  const res = [];
  for (const addr of hitAddrs) {
    const ticks = byToken.get(addr) || [];
    const tsMs = hitTime.get(addr);
    const rel = ticks
      .map((r, i) => ({ _t: new Date(r.block_time).getTime(), _i: i, _p: num(r.price_bnb), _o: r.price_outlier }))
      .filter(r => !r._o && r._p > 0)
      .sort((a, b) => a._t - b._t || a._i - b._i);
    const at = rel.find(r => r._t >= tsMs);
    if (!at) continue;
    const seg60 = rel.filter(r => r._t >= at._t && r._t <= at._t + 3_600_000);
    if (!seg60.length) continue;
    const min60 = (Math.min(...seg60.map(r => r._p)) / at._p - 1) * 100;
    const max60 = (Math.max(...seg60.map(r => r._p)) / at._p - 1) * 100;
    const px = (ms) => { const s = rel.filter(r => r._t >= at._t + ms); return s.length ? (s[0]._p / at._p - 1) * 100 : null; };
    res.push({
      addr, _sh: shapeOfA(shapeMap.get(addr) ? shapeMap.get(addr).a : null),
      min60: +min60.toFixed(1), max60: +max60.toFixed(1),
      px5: px(300_000), px30: px(1_800_000),
      exec: execAny.get(addr) || false,
    });
  }

  const summ = (list, label) => {
    if (!list.length) { console.log(`${label}: 无样本`); return; }
    const med = (arr) => { const s = [...arr].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    const col = (k) => list.map(r => r[k]).filter(v => v !== null && v !== undefined);
    console.log(`${label}: n=${list.length} | max60 中位 ${med(col('max60')).toFixed(0)}% | min60 中位 ${med(col('min60')).toFixed(0)}% | 5m时点 中位 ${med(col('px5')).toFixed(0)}% | 30m时点 中位 ${med(col('px30')).toFixed(0)}% | 30m≥0 ${(col('px30').filter(v => v >= 0).length / col('px30').length * 100).toFixed(0)}% | 执行率 ${(list.filter(r => r.exec).length / list.length * 100).toFixed(0)}%`);
  };
  const full = (r) => r._sh && r._sh.all;
  const dom = (r) => r._sh && r._sh.bigDominant;
  console.log(`\n[B] FP32 命中 ${res.length} 票风险面：`);
  summ(res.filter(full), '★全形状      ');
  summ(res.filter(r => dom(r) && !full(r)), 'dom_only     ');
  summ(res.filter(r => !dom(r)), '非主导       ');
  // 组合增量
  const comp = (key) => {
    summ(res.filter(r => dom(r) && r._sh[key]), `dom∧${key}   `);
    summ(res.filter(r => dom(r) && !r._sh[key]), `dom∧¬${key}  `);
  };
  comp('noRetail'); comp('sellFromBig'); comp('clean');

  // ── D) 大户出货比判别（强庄在建仓 vs 拉高出货）：bigSellRatio=as-of 大户卖出÷大户买入 ──
  const ratio = (addr) => {
    const row = shapeMap.get(addr);
    if (!row || !row.a || row.a.bigBuyBnb <= 0) return null;
    if (row.a.totalSell <= 0 || row.a.bigSellerShare === null) return 0; // 零卖出=建仓中
    return (row.a.totalSell * row.a.bigSellerShare / 100) / row.a.bigBuyBnb;
  };
  console.log(`\n[D] 大户出货比（bigSell/bigBuy, as-of 信号时刻）判别：`);
  for (const line of [0.15, 0.25, 0.4]) {
    summ(res.filter(r => dom(r) && ratio(r.addr) !== null && ratio(r.addr) <= line), `dom∧出货比≤${line}`);
    summ(res.filter(r => dom(r) && ratio(r.addr) !== null && ratio(r.addr) > line), `dom∧出货比>${line} `);
  }
  const twoG = ['0x898af40e', '0xf38f48cf'];
  for (const p of twoG) {
    const r = res.find(x => x.addr.startsWith(p));
    if (r) console.log(`   金狗 ${r.addr.slice(0, 10)}… 出货比=${ratio(r.addr)?.toFixed(2)} max60=${r.max60} px30=${r.px30}`);
  }

  console.log(`\n[C] 执行率：FP32 命中后整窗曾成交买入 ${res.filter(r => r.exec).length}/${res.length}`);
  const two = res.filter(r => ['0x898af40e', '0xf38f48cf'].some(p => r.addr.startsWith(p)));
  for (const r of two) console.log(`   金狗 ${r.addr.slice(0, 10)}… max60=${r.max60} min60=${r.min60} px30=${r.px30} exec=${r.exec}`);
  process.exit(0);
})().catch((e) => { console.error('失败:', e); process.exit(1); });
