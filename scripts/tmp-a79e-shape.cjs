#!/usr/bin/env node
/**
 * 一次性研究脚本（182 跑）：大户主导干净盘=强庄胚子假设验证（A79e）
 * 用户假设：大户买入占比很大（无零散跟买）+ 抛压全部来自大户本身 + 盘面干净
 *          = 好的强庄币胚子 → big_buy_defer（FP32）应考虑豁免。
 * 案源：bt-v164 0xf38f…7777 被 big_buy_defer 拦（大户合计0.8302B/19s）。
 * 口径镜像 FA：出生窗 90s；大户=窗内累计买 ≥0.19（同块等额首买组合并 T172）；
 *   尘线 holderDustBnb=0.015（簇键）、earlyUniformDustBnb=0.01（等额键）；
 *   wallet=sender||trader。
 * 输出：①金狗 30 票形状表 ②bt-v164 信号对照组形状×结局交叉 ③FP32 命中票结局
 *   ④0xf38f 首几分钟时间线。用后可删。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const COLLECTION_ID = 'a8414632-7c24-4762-9253-c49bb0f53105'; // 大金狗-尽量保证买入
const EXP_ID = '9e9163de-a677-4d39-9c33-9ec9df05e400';       // bt-v164 win1003 48h
const WIN_START = '2026-10-02T23:50:00.000Z';
const SPILL_END = '2026-10-05T06:00:00.000Z';

const LAUNCH_WIN_MS = 90_000;
const BIG_LINE = 0.19;          // 大户线（窗内累计买）
const EQ_DUST = 0.01;           // 等额簇尘埃门
const HOLDER_DUST = 0.015;      // 簇键尘埃门
const TIER079 = 0.79, TIER1 = 1; // FP32 两档

const num = (v) => { const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) ? n : 0; };
const ts = (r) => new Date(r.block_time).getTime();
const walletOf = (r) => ((r.sender_address || r.trader_address) || '').toLowerCase() || null;

async function fetchAll(from, pageSize = 1000) {
  const rows = [];
  let offset = 0;
  for (;;) {
    const page = await from.range(offset, offset + pageSize - 1);
    if (page.error) throw new Error(page.error.message);
    rows.push(...page.data);
    if (page.data.length < pageSize) return rows;
    offset += pageSize;
  }
}

/** 单 token 形状分析（ticks 已按链上序排好） */
function analyze(rowsRaw, symbol) {
  const rows = rowsRaw
    .map((r, i) => ({ ...r, _t: ts(r), _i: i, _w: walletOf(r), _bnb: num(r.bnb_amount), _p: num(r.price_bnb) }))
    .sort((a, b) => (a.block_number ?? 1e15) - (b.block_number ?? 1e15) || (a.log_index ?? 0) - (b.log_index ?? 0) || a._i - b._i);
  if (!rows.length) return null;
  const t0 = rows[0]._t;
  const winEnd = t0 + LAUNCH_WIN_MS;
  const launch = rows.filter(r => r._t - t0 <= LAUNCH_WIN_MS);
  const inFollow = (a, b) => rows.filter(r => r._t - t0 > a && r._t - t0 <= b);

  // per-wallet 窗内累计买/卖 + 首买行
  const walletBuys = new Map(), walletSells = new Map(), firstBuy = new Map();
  for (const r of launch) {
    if (!r._w) continue;
    if (r.trade_type === 'buy') {
      walletBuys.set(r._w, (walletBuys.get(r._w) || 0) + r._bnb);
      if (!firstBuy.has(r._w)) firstBuy.set(r._w, r);
    } else if (r.trade_type === 'sell') {
      walletSells.set(r._w, (walletSells.get(r._w) || 0) + r._bnb);
    }
  }
  // T172 同块等额首买组（≥0.01，四位归一，≥2 钱包）
  const eqGroups = new Map();
  for (const r of firstBuy.values()) {
    if (r.block_number === null || r._bnb < EQ_DUST) continue;
    const k = r.block_number + '|' + (Math.round(r._bnb * 1e4) / 1e4);
    let arr = eqGroups.get(k); if (!arr) { arr = new Set(); eqGroups.set(k, arr); }
    arr.add(r._w);
  }
  const grouped = new Set();
  for (const arr of eqGroups.values()) if (arr.size >= 2) for (const w of arr) grouped.add(w);
  // 大户实体
  let bigBuyBnb = 0; const bigWallets = new Set();
  for (const [w, v] of walletBuys) {
    if (grouped.has(w)) continue;
    if (v >= BIG_LINE) { bigBuyBnb += v; bigWallets.add(w); }
  }
  for (const arr of eqGroups.values()) {
    if (arr.size < 2) continue;
    let merged = 0; for (const w of arr) merged += walletBuys.get(w) || 0;
    if (merged >= BIG_LINE) { bigBuyBnb += merged; for (const w of arr) bigWallets.add(w); }
  }
  // 等额簇（FA eq 链式 1e-5，≥3）
  const amts = [...firstBuy.values()].filter(r => r._bnb >= EQ_DUST).map(r => r._bnb).sort((a, b) => a - b);
  let eqN = 0, i = 0;
  while (i < amts.length) {
    let j = i + 1;
    while (j < amts.length && Math.abs(amts[j] - amts[j - 1]) / Math.max(amts[j - 1], 1e-12) < 1e-5) j++;
    if (j - i > eqN) eqN = j - i;
    i = j;
  }
  if (eqN < 3) eqN = 0;

  const totalBuyBnb = launch.filter(r => r.trade_type === 'buy').reduce((s, r) => s + r._bnb, 0);
  const bigBuySharePct = totalBuyBnb > 0 ? bigBuyBnb / totalBuyBnb * 100 : 0;
  // 零散（非大户钱包）
  let retailWalletN = 0, retailBuyBnb = 0;
  for (const [w, v] of walletBuys) if (!bigWallets.has(w)) { retailWalletN++; retailBuyBnb += v; }
  // 跟买窗 (90s,300s]
  const followRows = inFollow(LAUNCH_WIN_MS, 300_000);
  let followBuyBnb = 0, followWalletN = new Set(), bigAddBnb = 0;
  for (const r of followRows) {
    if (r.trade_type !== 'buy' || !r._w) continue;
    if (bigWallets.has(r._w)) bigAddBnb += r._bnb;
    else { followBuyBnb += r._bnb; followWalletN.add(r._w); }
  }
  // 抛压归属 [0,180s]
  const sellWin = rows.filter(r => r._t - t0 <= 180_000 && r.trade_type === 'sell');
  const totalSell180 = sellWin.reduce((s, r) => s + r._bnb, 0);
  const bigSell180 = sellWin.filter(r => r._w && bigWallets.has(r._w)).reduce((s, r) => s + r._bnb, 0);
  const bigSellerShare180 = totalSell180 > 0 ? bigSell180 / totalSell180 * 100 : null;
  // 簇键（尘线=窗内累计 ≥0.015 的钱包，per-block 计数取 max）
  const blkBuyW = new Map(), blkSellW = new Map();
  for (const r of launch) {
    if (!r._w || r.block_number === null) continue;
    const m = r.trade_type === 'buy' ? blkBuyW : (r.trade_type === 'sell' ? blkSellW : null);
    if (!m) continue;
    const dustOk = r.trade_type === 'buy'
      ? (walletBuys.get(r._w) || 0) >= HOLDER_DUST
      : (walletSells.get(r._w) || 0) >= HOLDER_DUST;
    if (!dustOk) continue;
    let s = m.get(r.block_number); if (!s) { s = new Set(); m.set(r.block_number, s); }
    s.add(r._w);
  }
  const buyClusterSize = Math.max(0, ...[...blkBuyW.values()].map(s => s.size));
  const sellClusterSize = Math.max(0, ...[...blkSellW.values()].map(s => s.size));

  // FP32 模拟：档位+推迟价+推迟后 30m 内最大涨幅（可靠价=!price_outlier）
  const tier = bigBuyBnb >= TIER1 ? 60 : (bigBuyBnb >= TIER079 ? 45 : null);
  const rel = rows.filter(r => !r.price_outlier && r._p > 0);
  const firstRelBuy = rel.find(r => r.trade_type === 'buy') || rel[0] || null;
  let deferGain30m = null, deferPrice = null, deferAt = null;
  if (tier !== null && firstRelBuy) {
    deferAt = firstRelBuy._t + tier * 1000;
    const at = rel.find(r => r._t >= deferAt);
    if (at) {
      deferPrice = at._p;
      const mx = rel.filter(r => r._t >= deferAt && r._t <= deferAt + 1_800_000);
      const maxP = Math.max(0, ...mx.map(r => r._p));
      deferGain30m = (maxP / deferPrice - 1) * 100;
    }
  }
  // 结局：首 60m 最大涨幅（可靠价）+ 全史最大（金狗集合=全史；对照≤窗+6h）
  const firstRel = rel[0];
  const rel60 = rel.filter(r => r._t - t0 <= 3_600_000);
  const max60 = firstRel ? Math.max(...rel60.map(r => r._p)) / firstRel._p : null;
  const maxAll = firstRel ? Math.max(...rel.map(r => r._p)) / firstRel._p : null;

  return {
    symbol, t0Iso: new Date(t0).toISOString(), launchN: launch.length,
    bigBuyBnb: +bigBuyBnb.toFixed(3), bigN: bigWallets.size, bigBuySharePct: +bigBuySharePct.toFixed(1),
    retailWalletN, retailBuyBnb: +retailBuyBnb.toFixed(3),
    followBuyBnb: +followBuyBnb.toFixed(3), followWalletN: followWalletN.size, bigAddBnb: +bigAddBnb.toFixed(3),
    totalSell180: +totalSell180.toFixed(3), bigSellerShare180: bigSellerShare180 === null ? null : +bigSellerShare180.toFixed(1),
    buyClusterSize, sellClusterSize, eqClusterWallets: eqN,
    tier, deferGain30m: deferGain30m === null ? null : +deferGain30m.toFixed(1),
    gain60m: max60 === null ? null : +((max60 - 1) * 100).toFixed(1),
    gainAll: maxAll === null ? null : +((maxAll - 1) * 100).toFixed(1),
    bigSellTimeline: null, // 仅 0xf38f 深挖用
  };
}

(async () => {
  const db = dbManager.getClient();

  // ── 1) 金狗集合 30 票 ──
  const colTok = await fetchAll(db.from('case_collection_tokens')
    .select('token_address, note, token_meta').eq('collection_id', COLLECTION_ID));
  const golden = new Map();
  for (const t of colTok) golden.set(t.token_address.toLowerCase(), {
    note: t.note || '', symbol: (t.token_meta && t.token_meta.symbol) || '',
  });
  console.log(`金狗集合 ${golden.size} 票`);

  // ── 2) bt-v164 信号（FP32 命中+执行面） ──
  const sigs = await fetchAll(db.from('strategy_signals')
    .select('token_address, signal_type, executed, metadata').eq('experiment_id', EXP_ID));
  const sigInfo = new Map(); // addr -> {fp32Hit, fp32HitN, buyExecuted, signalN}
  for (const s of sigs) {
    const a = (s.token_address || '').toLowerCase(); if (!a) continue;
    let e = sigInfo.get(a); if (!e) { e = { fp32Hit: false, fp32HitN: 0, buyExecuted: false, signalN: 0 }; sigInfo.set(a, e); }
    e.signalN++;
    const gates = s.metadata && s.metadata.factorCheck && s.metadata.factorCheck.gates;
    if (Array.isArray(gates) && gates.some(g => g.id === 'big_buy_defer' && g.hit)) { e.fp32Hit = true; e.fp32HitN++; }
    if (s.signal_type === 'BUY' && s.executed) e.buyExecuted = true;
  }
  console.log(`bt-v164 信号票 ${sigInfo.size}（FP32 命中 ${[...sigInfo.values()].filter(v => v.fp32Hit).length}）`);

  // ── 3) token_profiles 结局 ──
  const allAddrs = [...new Set([...golden.keys(), ...sigInfo.keys()])];
  const profMax = new Map();
  for (let i = 0; i < allAddrs.length; i += 50) {
    const batch = allAddrs.slice(i, i + 50);
    const r = await db.from('token_profiles').select('token_address, max_change_percent').in('token_address', batch);
    if (r.error) throw new Error(r.error.message);
    for (const p of r.data || []) profMax.set(p.token_address.toLowerCase(), p.max_change_percent);
  }

  // ── 4) ticks：金狗走 case_ticks，对照走 wss_price_ticks（窗口+6h 溢出） ──
  const TICK_COLS = 'token_address, trade_type, trader_address, sender_address, price_bnb, bnb_amount, price_outlier, block_number, log_index, block_time';
  const goldenTicks = await fetchAll(db.from('case_ticks').select(TICK_COLS).eq('collection_id', COLLECTION_ID));
  const byToken = new Map();
  for (const r of goldenTicks) {
    const a = r.token_address.toLowerCase();
    let arr = byToken.get(a); if (!arr) { arr = []; byToken.set(a, arr); }
    arr.push(r);
  }
  const cmpAddrs = [...sigInfo.keys()].filter(a => !golden.has(a));
  for (let i = 0; i < cmpAddrs.length; i += 50) {
    const batch = cmpAddrs.slice(i, i + 50);
    const rows = await fetchAll(db.from('wss_price_ticks').select(TICK_COLS)
      .in('token_address', batch).gte('block_time', WIN_START).lte('block_time', SPILL_END));
    for (const r of rows) {
      const a = r.token_address.toLowerCase();
      let arr = byToken.get(a); if (!arr) { arr = []; byToken.set(a, arr); }
      arr.push(r);
    }
  }

  // ── 5) 逐票分析 ──
  const results = [];
  for (const [addr, g] of golden) {
    const ticks = byToken.get(addr) || [];
    const a = ticks.length ? analyze(ticks, g.symbol) : null;
    results.push({ addr, kind: 'G', note: g.note, info: sigInfo.get(addr) || null, profMax: profMax.get(addr) ?? null, a });
  }
  for (const addr of cmpAddrs) {
    const ticks = byToken.get(addr) || [];
    if (!ticks.length) continue;
    results.push({ addr, kind: 'C', note: '', info: sigInfo.get(addr) || null, profMax: profMax.get(addr) ?? null, a: analyze(ticks, '') });
  }

  // ── 形状分类（线值可调；先全量打印组件） ──
  const shapeOf = (a) => {
    if (!a) return null;
    const bigDominant = a.bigBuySharePct >= 60;
    const noRetail = a.retailWalletN <= 3 || a.retailBuyBnb <= 0.2;
    const sellFromBig = a.totalSell180 > 0 ? (a.bigSellerShare180 !== null && a.bigSellerShare180 >= 80) : true;
    const clean = a.buyClusterSize <= 7 && a.sellClusterSize <= 7 && a.eqClusterWallets < 3;
    return { bigDominant, noRetail, sellFromBig, clean, all: bigDominant && noRetail && sellFromBig && clean };
  };
  const fmt = (v, d = 1) => (v === null || v === undefined) ? '  · ' : v.toFixed(d);

  console.log('\n═══ 表1 金狗 30 票（G）形状 ═══');
  console.log('addr            sym        bigBnb bigN share% retN retBnb folB/folW  sell180 bigSell% clu(b/s/eq) tier defer30m gain60m gainAll prof%  shape');
  for (const r of results.filter(x => x.kind === 'G')) {
    const a = r.a, s = shapeOf(a);
    if (!a) { console.log(`${r.addr.slice(0, 8)}… 无 ticks`); continue; }
    console.log(
      `${r.addr.slice(0, 10)}… ${(a.symbol || '?').padEnd(9)} ${String(a.bigBuyBnb).padStart(5)} ${String(a.bigN).padStart(3)} ${String(a.bigBuySharePct).padStart(5)} ` +
      `${String(a.retailWalletN).padStart(4)} ${String(a.retailBuyBnb).padStart(6)} ${a.followBuyBnb}/${a.followWalletN} ` +
      `${String(a.totalSell180).padStart(6)} ${fmt(a.bigSellerShare180).padStart(6)} ` +
      `${a.buyClusterSize}/${a.sellClusterSize}/${a.eqClusterWallets} ${a.tier === null ? ' -' : a.tier} ` +
      `${fmt(a.deferGain30m).padStart(7)} ${fmt(a.gain60m).padStart(7)} ${fmt(a.gainAll).padStart(7)} ${fmt(r.profMax).padStart(7)} ` +
      `${s && s.all ? '★' : (s && s.bigDominant ? 'dom' : '  ')}${r.info && r.info.fp32Hit ? '⏸FP32' : ''}`);
  }

  console.log('\n═══ 表2 对照组（bt-v164 信号票，非金狗）形状×结局 ═══');
  const cmpRows = results.filter(x => x.kind === 'C' && x.a);
  for (const r of cmpRows) {
    const a = r.a, s = shapeOf(a);
    const out = r.profMax !== null ? r.profMax : a.gainAll;
    r._out = out; r._shape = s;
  }
  const bucket = (v) => v === null ? 'nodata' : (v >= 500 ? '≥500' : (v >= 100 ? '100-500' : (v >= 0 ? '0-100' : '<0')));
  const crossTab = new Map();
  for (const r of cmpRows) {
    const key = (r._shape && r._shape.all ? 'shape' : (r._shape && r._shape.bigDominant ? 'dom_only' : 'other')) + '|' + bucket(r._out);
    crossTab.set(key, (crossTab.get(key) || 0) + 1);
  }
  console.log('形状×结局（结局=profMax 缺则 gainAll）:', JSON.stringify([...crossTab.entries()]));
  // FP32 命中对照票明细
  console.log('\n── FP32 命中票（全部，含金狗）──');
  console.log('addr            kind bigBnb share% sell180 bigSell% defer30m gain60m gainAll prof%  shape executed');
  for (const r of results) {
    if (!(r.info && r.info.fp32Hit) || !r.a) continue;
    const s = shapeOf(r.a);
    console.log(`${r.addr.slice(0, 10)}… ${r.kind} ${String(r.a.bigBuyBnb).padStart(5)} ${String(r.a.bigBuySharePct).padStart(5)} ` +
      `${String(r.a.totalSell180).padStart(6)} ${fmt(r.a.bigSellerShare180).padStart(6)} ${fmt(r.a.deferGain30m).padStart(7)} ` +
      `${fmt(r.a.gain60m).padStart(7)} ${fmt(r.a.gainAll).padStart(7)} ${fmt(r.profMax).padStart(7)} ${s && s.all ? '★' : (s && s.bigDominant ? 'dom' : '  ')} ${r.info.buyExecuted}`);
  }

  // ── 6) 0xf38f 时间线（首 300s，15s 桶：大户/零散买卖+价） ──
  const F = '0xf38f48cfe9e84920e7de4d47823a0fba95a87777';
  const ft = byToken.get(F) || [];
  if (ft.length) {
    const rows = ft.map((r, i) => ({ ...r, _t: ts(r), _w: walletOf(r), _bnb: num(r.bnb_amount), _p: num(r.price_bnb) }))
      .sort((a, b) => (a.block_number ?? 1e15) - (b.block_number ?? 1e15) || (a.log_index ?? 0) - (b.log_index ?? 0));
    const t0 = rows[0]._t;
    // 大户集（复用 analyze 的口径——直接重算）
    const launch = rows.filter(r => r._t - t0 <= LAUNCH_WIN_MS);
    const wb = new Map();
    for (const r of launch) if (r.trade_type === 'buy' && r._w) wb.set(r._w, (wb.get(r._w) || 0) + r._bnb);
    const bigW = new Set([...wb.entries()].filter(([w, v]) => v >= BIG_LINE).map(([w]) => w));
    console.log(`\n═══ 0xf38f 时间线（首 300s，15s 桶）═══ 大户(${[...bigW].map(w => w.slice(0, 6)).join(',')})`);
    for (let b = 0; b < 300; b += 15) {
      const seg = rows.filter(r => r._t - t0 > b * 1000 && r._t - t0 <= (b + 15) * 1000);
      if (!seg.length) { console.log(`t+${String(b).padStart(3)}s  （无交易）`); continue; }
      let bigBuy = 0, retBuy = 0, bigSell = 0, retSell = 0, price = null;
      for (const r of seg) {
        const isBig = r._w && bigW.has(r._w);
        if (r.trade_type === 'buy') isBig ? bigBuy += r._bnb : retBuy += r._bnb;
        else isBig ? bigSell += r._bnb : retSell += r._bnb;
        if (!r.price_outlier && r._p > 0) price = r._p;
      }
      const pct = price ? ((price / (rows.find(r => !r.price_outlier && r._p > 0)?._p || price)) - 1) * 100 : null;
      console.log(`t+${String(b).padStart(3)}s  买 big ${bigBuy.toFixed(3)} / 零散 ${retBuy.toFixed(3)}   卖 big ${bigSell.toFixed(3)} / 零散 ${retSell.toFixed(3)}   价 ${price ? price.toExponential(4) : '·'} (${pct === null ? '·' : pct.toFixed(1)}%)`);
    }
  }

  // 汇总 JSON 落盘（便于本地二开）
  const fs = require('fs');
  fs.writeFileSync('/tmp/a79e-shape-out.json', JSON.stringify(results.map(({ addr, kind, note, info, profMax, a }) => ({
    addr, kind, note, fp32Hit: !!(info && info.fp32Hit), buyExecuted: !!(info && info.buyExecuted), profMax, shape: shapeOf(a), a,
  })), null, 1));
  console.log('\n明细已落 /tmp/a79e-shape-out.json');
  process.exit(0);
})().catch((e) => { console.error('失败:', e); process.exit(1); });
