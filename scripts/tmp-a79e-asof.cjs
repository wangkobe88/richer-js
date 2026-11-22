#!/usr/bin/env node
/**
 * 一次性研究脚本 round2（182 跑）：FP32 big_buy_defer 命中票 as-of 信号时刻形状 vs 结局
 * 用户假设：大户买入占比大（无零散跟买）+ 抛压全来自大户 + 干净 = 强庄胚子 → 应豁免。
 * as-of 口径：形状组件全部在 [t0, 首次FP32命中信号时刻] 窗内计算（镜像 FA 增量状态），
 * 大户=as-of 累计买 ≥0.19（T172 同块等额组合并）；结局=信号时刻价起算 30/60m 内最大涨幅；
 * 对照=同票按 FP32 推迟档（45/60s）入场价的同窗涨幅（豁免的增量价值）。
 * 用后可删。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const EXP_ID = '9e9163de-a677-4d39-9c33-9ec9df05e400'; // bt-v164
const COLLECTION_ID = 'a8414632-7c24-4762-9253-c49bb0f53105';
const WIN_START = '2026-10-02T23:50:00.000Z';
const SPILL_END = '2026-10-05T06:00:00.000Z';
const BIG_LINE = 0.19, EQ_DUST = 0.01, HOLDER_DUST = 0.015;
const TIER079 = 0.79, TIER1 = 1;

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

function analyzeAsOf(rowsRaw, tsMs) {
  const rows = rowsRaw
    .map((r, i) => ({ ...r, _t: new Date(r.block_time).getTime(), _i: i, _w: ((r.sender_address || r.trader_address) || '').toLowerCase() || null, _bnb: num(r.bnb_amount), _p: num(r.price_bnb) }))
    .sort((a, b) => (a.block_number ?? 1e15) - (b.block_number ?? 1e15) || (a.log_index ?? 0) - (b.log_index ?? 0) || a._i - b._i);
  if (!rows.length) return null;
  const t0 = rows[0]._t;
  const asof = rows.filter(r => r._t <= tsMs);
  if (!asof.length) return null;

  const walletBuys = new Map(), walletSells = new Map(), firstBuy = new Map();
  for (const r of asof) {
    if (!r._w) continue;
    if (r.trade_type === 'buy') {
      walletBuys.set(r._w, (walletBuys.get(r._w) || 0) + r._bnb);
      if (!firstBuy.has(r._w)) firstBuy.set(r._w, r);
    } else if (r.trade_type === 'sell') walletSells.set(r._w, (walletSells.get(r._w) || 0) + r._bnb);
  }
  // T172 同块等额组
  const eqGroups = new Map();
  for (const r of firstBuy.values()) {
    if (r.block_number === null || r._bnb < EQ_DUST) continue;
    const k = r.block_number + '|' + (Math.round(r._bnb * 1e4) / 1e4);
    let arr = eqGroups.get(k); if (!arr) { arr = new Set(); eqGroups.set(k, arr); }
    arr.add(r._w);
  }
  const grouped = new Set();
  for (const arr of eqGroups.values()) if (arr.size >= 2) for (const w of arr) grouped.add(w);
  let bigBuyBnb = 0; const bigWallets = new Set(); let bigN = 0;
  for (const [w, v] of walletBuys) {
    if (grouped.has(w)) continue;
    if (v >= BIG_LINE) { bigBuyBnb += v; bigWallets.add(w); bigN++; }
  }
  for (const arr of eqGroups.values()) {
    if (arr.size < 2) continue;
    let merged = 0; for (const w of arr) merged += walletBuys.get(w) || 0;
    if (merged >= BIG_LINE) { bigBuyBnb += merged; for (const w of arr) bigWallets.add(w); bigN++; }
  }
  // 等额簇
  const amts = [...firstBuy.values()].filter(r => r._bnb >= EQ_DUST).map(r => r._bnb).sort((a, b) => a - b);
  let eqN = 0, i = 0;
  while (i < amts.length) {
    let j = i + 1;
    while (j < amts.length && Math.abs(amts[j] - amts[j - 1]) / Math.max(amts[j - 1], 1e-12) < 1e-5) j++;
    if (j - i > eqN) eqN = j - i;
    i = j;
  }
  if (eqN < 3) eqN = 0;
  // 簇键（尘线 per-wallet as-of 累计）
  const blkBuyW = new Map(), blkSellW = new Map();
  for (const r of asof) {
    if (!r._w || r.block_number === null) continue;
    if (r.trade_type === 'buy') {
      if ((walletBuys.get(r._w) || 0) < HOLDER_DUST) continue;
      let s = blkBuyW.get(r.block_number); if (!s) { s = new Set(); blkBuyW.set(r.block_number, s); }
      s.add(r._w);
    } else if (r.trade_type === 'sell') {
      if ((walletSells.get(r._w) || 0) < HOLDER_DUST) continue;
      let s = blkSellW.get(r.block_number); if (!s) { s = new Set(); blkSellW.set(r.block_number, s); }
      s.add(r._w);
    }
  }
  const buyClusterSize = Math.max(0, ...[...blkBuyW.values()].map(s => s.size));
  const sellClusterSize = Math.max(0, ...[...blkSellW.values()].map(s => s.size));

  const totalBuy = asof.filter(r => r.trade_type === 'buy').reduce((s, r) => s + r._bnb, 0);
  const share = totalBuy > 0 ? bigBuyBnb / totalBuy * 100 : 0;
  let retailWalletN = 0, retailBuyBnb = 0;
  for (const [w, v] of walletBuys) if (!bigWallets.has(w)) { retailWalletN++; retailBuyBnb += v; }
  const sells = asof.filter(r => r.trade_type === 'sell');
  const totalSell = sells.reduce((s, r) => s + r._bnb, 0);
  const bigSell = sells.filter(r => r._w && bigWallets.has(r._w)).reduce((s, r) => s + r._bnb, 0);
  const bigSellerShare = totalSell > 0 ? bigSell / totalSell * 100 : null;

  // 结局：信号时刻价 → 30/60m 内最大可靠价涨幅
  const rel = rows.filter(r => !r.price_outlier && r._p > 0);
  const atTs = rel.find(r => r._t >= tsMs);
  const mx = (from, win) => {
    if (!from) return null;
    const seg = rel.filter(r => r._t >= from._t && r._t <= from._t + win);
    if (!seg.length) return null;
    return (Math.max(...seg.map(r => r._p)) / from._p - 1) * 100;
  };
  // 推迟对照：档位由 as-of bigBuyBnb 定，锚=首笔可靠买
  const tier = bigBuyBnb >= TIER1 ? 60 : TIER079;
  const firstRelBuy = rel.find(r => r.trade_type === 'buy') || rel[0] || null;
  const atTd = firstRelBuy ? rel.find(r => r._t >= firstRelBuy._t + tier * 1000) : null;

  return {
    ageSec: +((tsMs - t0) / 1000).toFixed(0),
    bigBuyBnb: +bigBuyBnb.toFixed(3), bigN, share: +share.toFixed(1),
    retailWalletN, retailBuyBnb: +retailBuyBnb.toFixed(3),
    totalSell: +totalSell.toFixed(3), bigSellerShare: bigSellerShare === null ? null : +bigSellerShare.toFixed(1),
    buyClusterSize, sellClusterSize, eqClusterWallets: eqN,
    tier,
    pTs: atTs ? atTs._p : null,
    gain30: atTs ? mx(atTs, 1_800_000) : null,
    gain60: atTs ? mx(atTs, 3_600_000) : null,
    gain30Defer: atTd ? mx(atTd, 1_800_000) : null,
    gain60Defer: atTd ? mx(atTd, 3_600_000) : null,
  };
}

(async () => {
  const db = dbManager.getClient();
  // 金狗集合成员标记
  const colTok = await fetchAll(db.from('case_collection_tokens').select('token_address, token_meta').eq('collection_id', COLLECTION_ID));
  const golden = new Set(colTok.map(t => t.token_address.toLowerCase()));
  const symOf = new Map(colTok.map(t => [t.token_address.toLowerCase(), (t.token_meta && t.token_meta.symbol) || '']));

  // 信号：FP32 命中时刻
  const sigs = await fetchAll(db.from('strategy_signals')
    .select('token_address, token_symbol, signal_type, executed, created_at, metadata').eq('experiment_id', EXP_ID));
  const hitTime = new Map(); // addr -> earliest hit ms
  const everExec = new Map();
  const symFromSig = new Map();
  for (const s of sigs) {
    const a = (s.token_address || '').toLowerCase(); if (!a) continue;
    if (s.token_symbol) symFromSig.set(a, s.token_symbol);
    if (s.signal_type === 'BUY' && s.executed) everExec.set(a, true);
    const gates = s.metadata && s.metadata.factorCheck && s.metadata.factorCheck.gates;
    if (Array.isArray(gates) && gates.some(g => g.id === 'big_buy_defer' && g.hit)) {
      const t = new Date(s.created_at).getTime();
      if (!hitTime.has(a) || t < hitTime.get(a)) hitTime.set(a, t);
    }
  }
  const hitAddrs = [...hitTime.keys()];
  console.log(`FP32 命中票 ${hitAddrs.length}（其中金狗 ${hitAddrs.filter(a => golden.has(a)).length}）`);

  // token_profiles 结局
  const profMax = new Map();
  for (let i = 0; i < hitAddrs.length; i += 50) {
    const r = await db.from('token_profiles').select('token_address, max_change_percent').in('token_address', hitAddrs.slice(i, i + 50));
    if (r.error) throw new Error(r.error.message);
    for (const p of r.data || []) profMax.set(p.token_address.toLowerCase(), p.max_change_percent);
  }

  // ticks
  const TICK_COLS = 'token_address, trade_type, trader_address, sender_address, price_bnb, bnb_amount, price_outlier, block_number, log_index, block_time';
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

  const out = [];
  for (const addr of hitAddrs) {
    const ticks = byToken.get(addr) || [];
    const a = ticks.length ? analyzeAsOf(ticks, hitTime.get(addr)) : null;
    out.push({
      addr, sym: symOf.get(addr) || symFromSig.get(addr) || '?', golden: golden.has(addr),
      exec: everExec.get(addr) || false, profMax: profMax.get(addr) ?? null, a,
    });
  }

  // 形状分类（as-of）
  const shapeOf = (a, L) => {
    if (!a) return null;
    const bigDominant = a.share >= L.share;                       // 大户买入占比
    const noRetail = a.retailWalletN <= L.retailN || a.retailBuyBnb <= L.retailBnb; // 零散跟买薄
    const sellFromBig = a.totalSell <= 0 ? true : (a.bigSellerShare !== null && a.bigSellerShare >= L.sellShare); // 抛压全来自大户
    const clean = a.buyClusterSize <= L.cluster && a.sellClusterSize <= L.cluster && a.eqClusterWallets < 3;      // 干净
    return { bigDominant, noRetail, sellFromBig, clean, all: bigDominant && noRetail && sellFromBig && clean };
  };
  const L = { share: 60, retailN: 5, retailBmb: 0, retailBnb: 0.3, sellShare: 80, cluster: 7 };

  console.log(`\naddr            sym        G exec | ageS bigBnb bigN share% retN retBnb | sellT bigSell% | clu(b/s/eq) | gain30 gain60 | defer30 defer60 | prof%  shape`);
  for (const r of out) {
    if (!r.a) { console.log(`${r.addr.slice(0, 10)}… 无 ticks`); continue; }
    const a = r.a, s = shapeOf(a, L);
    r._s = s;
    const f = (v) => v === null || v === undefined ? '    ·' : String(v.toFixed(0)).padStart(6);
    console.log(
      `${r.addr.slice(0, 10)}… ${(r.sym || '?').padEnd(9)} ${r.golden ? '狗' : ' '} ${r.exec ? 'E' : ' '} | ` +
      `${String(a.ageSec).padStart(4)} ${String(a.bigBuyBnb).padStart(5)} ${String(a.bigN).padStart(3)} ${String(a.share).padStart(5)} ` +
      `${String(a.retailWalletN).padStart(4)} ${String(a.retailBuyBnb).padStart(6)} | ${String(a.totalSell).padStart(5)} ${a.bigSellerShare === null ? '  ·' : String(a.bigSellerShare).padStart(5)} | ` +
      `${a.buyClusterSize}/${a.sellClusterSize}/${a.eqClusterWallets} | ${f(a.gain30)} ${f(a.gain60)} | ${f(a.gain30Defer)} ${f(a.gain60Defer)} | ${f(r.profMax)} ${s && s.all ? '★' : (s && s.bigDominant ? 'dom' : '  ')}`);
  }

  // 汇总：形状组 vs 非形状组的结局
  const summ = (list, label) => {
    const g = list.map(r => r.a && r.a.gain60).filter(v => v !== null && v !== undefined);
    const d = list.map(r => r.a && r.a.gain60Defer).filter(v => v !== null && v !== undefined);
    if (!g.length) { console.log(`${label}: 无样本`); return; }
    const med = (arr) => { const s = [...arr].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    console.log(`${label}: n=${g.length} gain60 中位 ${med(g).toFixed(0)}% 均值 ${(g.reduce((x, y) => x + y, 0) / g.length).toFixed(0)}% ≥100% ${(g.filter(v => v >= 100).length / g.length * 100).toFixed(0)}% ≥500% ${(g.filter(v => v >= 500).length / g.length * 100).toFixed(0)}% | 推迟入场 gain60 中位 ${d.length ? med(d).toFixed(0) + '%' : '·'}`);
  };
  console.log('\n═══ 汇总 ═══');
  summ(out.filter(r => r._s && r._s.all), '★全形状（大户主导+零散薄+抛压大户+干净）');
  summ(out.filter(r => r._s && r._s.bigDominant && !r._s.all), 'dom_only（仅大户主导）');
  summ(out.filter(r => r._s && !r._s.bigDominant), '非主导     ');
  // 组件增量
  for (const key of ['noRetail', 'sellFromBig', 'clean']) {
    summ(out.filter(r => r._s && r._s.bigDominant && r._s[key]), `dom∧${key}`);
    summ(out.filter(r => r._s && r._s.bigDominant && !r._s[key]), `dom∧¬${key}`);
  }

  require('fs').writeFileSync('/tmp/a79e-asof-out.json', JSON.stringify(out, null, 1));
  console.log('\n明细已落 /tmp/a79e-asof-out.json');
  process.exit(0);
})().catch((e) => { console.error('失败:', e); process.exit(1); });
