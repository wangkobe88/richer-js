#!/usr/bin/env node
/**
 * 早期叙事臂回放 v3——变体矩阵版（2026-10-28 用户三反馈）：
 *   ① 胜率/收益率待提升 → 分层发现 fireMcap 4500-5000 强池（v2 九天全正），买门收带对照；卖腿参数矩阵
 *   ② 盘面要求低一些 → 承接门/净买门放松变体
 *   ③ eod48h 实为「断流死亡」（heldSec 35-831s tailTicks 8-47）：单独归类 + 90% 折价口径
 *      （断流票按最后成交价清仓是最乐观口径，真实滑点最重——35 票占全池亏损 38%）
 *
 * 买门变体（每票并行评估，独立触发；坏人门四件+age<=600+passAt 全变体共用）：
 *   g0 base   : 承接 0.25/4  净买 40  mcap 3500-5000（v2 原版）
 *   g1 loSup  : 承接 0.10/2  净买 40  mcap 3500-5000（盘面要求更低）
 *   g2 loNet  : 承接 0.25/4  净买 25  mcap 3500-5000
 *   g3 hiBand : 承接 0.25/4  净买 40  mcap 4500-5000（强池）
 *   g4 hiLoSup: 承接 0.10/2  净买 40  mcap 4500-5000
 *
 * 卖腿变体（全部含 protect20 与 -50 价格止损；不含 mcap 地板臂——与本臂矛盾）：
 *   e0: stop900 mcap20000 lock(100,.5)   e1: stop600 mcap20000 lock(100,.5)
 *   e2: stop900 mcap40000 lock(100,.5)   e3: stop900 无mcapExit lock(100,.4)
 *   e4: stop600 mcap40000 lock(100,.5)
 *
 * 182 跑：node scripts/tmp-early-narrative-arm-replay.cjs --days 8 [--out /tmp/x.json]
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', 'config', '.env') });
const fs = require('fs');
const path = require('path');
const { dbManager } = require('../src/services/dbManager');

const argv = process.argv.slice(2);
const argNum = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d; };
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
const DAYS = argNum('--days', 8);
const OUT = arg('--out');
const CONC = argNum('--conc', 8);

const AGE_MAX_SEC = 600;
const MIN_TICK_BNB = 0.001;
const BUY_BNB = 0.002;
const HORIZON_MS = 48 * 3600e3;
const TICK_CAP = 50000;
const EXIT_STOP_PCT = -50;
const PROTECT_ON = 20;

const GATE_VARIANTS = [
  { name: 'g0-base', supBnb: 0.25, supHolders: 4, netBuy: 40, mcapLo: 3500, mcapHi: 5000 },
  { name: 'g1-loSup', supBnb: 0.10, supHolders: 2, netBuy: 40, mcapLo: 3500, mcapHi: 5000 },
  { name: 'g2-loNet', supBnb: 0.25, supHolders: 4, netBuy: 25, mcapLo: 3500, mcapHi: 5000 },
  { name: 'g3-hiBand', supBnb: 0.25, supHolders: 4, netBuy: 40, mcapLo: 4500, mcapHi: 5000 },
  { name: 'g4-hiLoSup', supBnb: 0.10, supHolders: 2, netBuy: 40, mcapLo: 4500, mcapHi: 5000 },
];
const EXIT_VARIANTS = [
  { name: 'e0-stop900-mcap20k-lock100.5', stopSec: 900, mcapExit: 20000, lockPeak: 100, lockKeep: 0.5 },
  { name: 'e1-stop600-mcap20k-lock100.5', stopSec: 600, mcapExit: 20000, lockPeak: 100, lockKeep: 0.5 },
  { name: 'e2-stop900-mcap40k-lock100.5', stopSec: 900, mcapExit: 40000, lockPeak: 100, lockKeep: 0.5 },
  { name: 'e3-stop900-nomcap-lock100.4', stopSec: 900, mcapExit: 0, lockPeak: 100, lockKeep: 0.4 },
  { name: 'e4-stop600-mcap40k-lock100.5', stopSec: 600, mcapExit: 40000, lockPeak: 100, lockKeep: 0.5 },
];

// ── roster（与 FA loader 同源文件；sybil manual 合并同 FA 惯例）──
const ROSTER_DIR = path.resolve(__dirname, '..', 'config', 'rosters');
function loadRosters() {
  const sybil = new Set(), famous = new Set(), copy = new Set();
  try {
    const d = JSON.parse(fs.readFileSync(path.join(ROSTER_DIR, 'sybil-clusters.json'), 'utf8'));
    for (const c of d.clusters || []) for (const w of c.wallets || []) sybil.add(String(w).toLowerCase());
  } catch (e) { console.warn('sybil-clusters.json 读取失败:', e.message); }
  try {
    const d = JSON.parse(fs.readFileSync(path.join(ROSTER_DIR, 'sybil-clusters-manual.json'), 'utf8'));
    for (const c of d.clusters || []) for (const w of (c.wallets || c)) sybil.add(String(w).toLowerCase());
  } catch (_) {}
  try {
    const d = JSON.parse(fs.readFileSync(path.join(ROSTER_DIR, 'famous-copy-wallets.json'), 'utf8'));
    for (const w of d.wallets || []) famous.add(String(w).toLowerCase());
  } catch (_) {}
  try {
    const d = JSON.parse(fs.readFileSync(path.join(ROSTER_DIR, 'copy-wallet-roster.json'), 'utf8'));
    for (const w of d.wallets || []) copy.add(String((w.address || w) || '').toLowerCase());
  } catch (_) {}
  return { sybil, famous, copy };
}
const ROSTERS = loadRosters();

let db;
const PAGE = 1000;
async function fetchAll(table, select, extra, orderCol = 'id') {
  const rows = [];
  for (;;) {
    let q = db.from(table).select(select).order(orderCol, { ascending: true }).range(rows.length, rows.length + PAGE - 1);
    if (extra) q = extra(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table} 拉取失败: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}
const ratingNum = (r) => r === 'high' ? 3 : r === 'mid' ? 2 : r === 'low' ? 1 : (typeof r === 'number' ? r : null);
const ts = (v) => (v ? new Date(v).getTime() : null);

// ── 阶段 1：多变体买入门模拟（头 600s 窗单遍；每变体独立触发）──
function simulateGate(ticks, createMs, passMs, supply) {
  const st = { buyBnb: 0, sellBnb: 0, circ: 0, net: new Map(), buyBnbByWallet: new Map() };
  const fires = {};

  for (const t of ticks) {
    const bnb = Number(t.bnb_amount) || 0;
    if (bnb < MIN_TICK_BNB) continue;                       // 尘 tick：live 因子域外
    const isBuy = t.trade_type === 'buy';
    const tok = Number(t.token_amount) || 0;
    const raw = t.sender_address || t.trader_address || null;
    const wal = raw ? raw.toLowerCase() : null;
    if (isBuy) { st.buyBnb += bnb; st.circ += tok; if (wal) st.buyBnbByWallet.set(wal, (st.buyBnbByWallet.get(wal) || 0) + bnb); }
    else { st.sellBnb += bnb; st.circ -= tok; }
    if (wal && tok > 0) st.net.set(wal, (st.net.get(wal) || 0) + (isBuy ? tok : -tok));

    const tms = ts(t.block_time);
    const ageSec = (tms - createMs) / 1000;
    if (!(tms > passMs && ageSec <= AGE_MAX_SEC)) continue;
    const priceUsd = Number(t.price_usd) || 0;
    const mcap = supply > 0 && priceUsd > 0 ? priceUsd * supply : 0;
    if (!(mcap >= 3500 && mcap < 5000)) continue;           // 最宽带预筛（变体再自查窄带）

    let top1 = 0, sybilHold = 0, sybilBuy = 0, sybilHolderN = 0, famousMax = 0, copyMax = 0, holders = 0;
    for (const [waddr, v] of st.net) {
      if (v > 0) {
        holders++;
        if (v > top1) top1 = v;
        if (ROSTERS.sybil.has(waddr)) { sybilHold += v; sybilHolderN++; }
        if (ROSTERS.famous.has(waddr) && v > famousMax) famousMax = v;
        if (ROSTERS.copy.has(waddr) && v > copyMax) copyMax = v;
      }
    }
    for (const [waddr, v] of st.buyBnbByWallet) if (ROSTERS.sybil.has(waddr)) sybilBuy += v;
    const f = {
      holdersExSybil: holders - sybilHolderN,
      buyVolumeBnbExSybil: Math.round((st.buyBnb - sybilBuy) * 1e6) / 1e6,
      netBuy: st.buyBnb > 0 ? (st.buyBnb - st.sellBnb) / st.buyBnb * 100 : 0,
      top1Pct: st.circ > 0 ? top1 / st.circ * 100 : 0,
      sybilPct: st.circ > 0 ? sybilHold / st.circ * 100 : 0,
      famousPct: st.circ > 0 ? famousMax / st.circ * 100 : 0,
      copyPct: st.circ > 0 ? copyMax / st.circ * 100 : 0,
    };
    // 共用坏人门（不达标则本 tick 全变体跳过）
    if (f.top1Pct >= 35 || f.sybilPct >= 35 || f.famousPct >= 15 || f.copyPct >= 20) continue;

    for (const v of GATE_VARIANTS) {
      if (fires[v.name]) continue;
      if (mcap < v.mcapLo || mcap >= v.mcapHi) continue;
      if (!(f.buyVolumeBnbExSybil >= v.supBnb || f.holdersExSybil >= v.supHolders)) continue;
      if (!(f.netBuy >= v.netBuy)) continue;
      fires[v.name] = {
        fireTs: t.block_time, fireMs: tms, ageSec: Math.round(ageSec), mcap: Math.round(mcap),
        priceBnb: Number(t.price_bnb), passToFireSec: Math.round((tms - passMs) / 1000),
        supBnb: f.buyVolumeBnbExSybil, supHolders: f.holdersExSybil, netBuy: Math.round(f.netBuy),
      };
    }
    if (GATE_VARIANTS.every(v => fires[v.name])) break;
  }
  return fires;
}

// ── 阶段 2：多变体卖出模拟 ──
function simulateExit(ticks, fire, supply, ex, gradMs) {
  const qty = BUY_BNB / fire.priceBnb;
  let peak = 0, exit = null;
  for (const t of ticks) {
    const priceBnb = Number(t.price_bnb) || 0;
    if (priceBnb <= 0) continue;
    const tms = ts(t.block_time);
    const profit = (priceBnb / fire.priceBnb - 1) * 100;
    if (profit > peak) peak = profit;
    const priceUsd = Number(t.price_usd) || 0;
    const mcapNow = priceUsd > 0 && supply > 0 ? priceUsd * supply : 0;
    const heldSec = (tms - fire.fireMs) / 1000;
    let reason = null;
    if (profit <= EXIT_STOP_PCT) reason = 'stop_price';
    else if (peak >= PROTECT_ON && profit <= 0) reason = 'protect';
    else if (heldSec >= ex.stopSec && profit <= 0) reason = 'stop_time';
    else if (ex.mcapExit > 0 && mcapNow >= ex.mcapExit) reason = 'mcap_exit';
    else if (peak >= ex.lockPeak && profit <= peak * ex.lockKeep) reason = 'lock';
    else if (gradMs && tms >= gradMs) reason = 'graduation';
    if (reason) { exit = { reason, heldSec: Math.round(heldSec), exitPriceBnb: priceBnb, profitPct: Math.round(profit), peakPct: Math.round(peak) }; break; }
  }
  const last = ticks[ticks.length - 1];
  if (!exit && last) {
    const priceBnb = Number(last.price_bnb) || 0;
    const heldSec = Math.round((ts(last.block_time) - fire.fireMs) / 1000);
    const reason = heldSec < 3600 ? 'stream_dead' : 'eod48h'; // 断流死亡：窗末前早已无成交
    exit = { reason, heldSec, exitPriceBnb: priceBnb, profitPct: Math.round((priceBnb / fire.priceBnb - 1) * 100), peakPct: Math.round(peak) };
  }
  if (!exit) exit = { reason: 'no_ticks', heldSec: 0, exitPriceBnb: 0, profitPct: -100, peakPct: Math.round(peak) };
  exit.pnlBnb = Math.round((qty * exit.exitPriceBnb - BUY_BNB) * 1e6) / 1e6;
  exit.pnlHaircut90 = Math.round(exit.pnlBnb * (exit.reason === 'stream_dead' ? 0.9 : 1) * 1e6) / 1e6;
  return exit;
}

async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx).catch(e => ({ error: String(e && e.message || e) })); }
  }));
  return out;
}
function quantiles(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  const q = (p) => s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null;
  return { n: s.length, p10: q(0.10), p50: q(0.50), p90: q(0.90) };
}

async function main() {
  db = dbManager.getClient();
  const cutoff = new Date(Date.now() - DAYS * 86400000).toISOString();

  console.log(`[1/6] token_narrative 近 ${DAYS} 天…`);
  const tn = await fetchAll('token_narrative', 'token_address,token_symbol,analyzed_at,final_result', (q) => q.gte('analyzed_at', cutoff), 'analyzed_at');
  const cand = new Map();
  for (const r of tn) {
    const n = ratingNum(r.final_result?.rating);
    if (n === 2 || n === 3) cand.set(r.token_address, { token: r.token_address, symbol: r.token_symbol, rating: r.final_result.rating, passMsFallback: ts(r.analyzed_at) });
  }
  console.log(`  analyzed=${tn.length} 通过=${cand.size}`);

  console.log('[2/6] rounds 时序锚…');
  const rounds = await fetchAll('narrative_analysis_rounds', 'token_address,rating,completed_at',
    (q) => q.gte('created_at', new Date(Date.now() - (DAYS + 2) * 86400000).toISOString()), 'id');
  for (const r of rounds) {
    const c = cand.get(r.token_address);
    if (!c) continue;
    const n = ratingNum(r.rating);
    if (n !== 2 && n !== 3) continue;
    const m = ts(r.completed_at);
    if (m && (!c.passMs || m < c.passMs)) c.passMs = m;
  }
  for (const c of cand.values()) if (!c.passMs) c.passMs = c.passMsFallback;

  console.log(`[3/6] per-token token_create（${cand.size}）…`);
  const anchors = await pool([...cand.values()], CONC, async (c) => {
    const { data, error } = await db.from('wss_events')
      .select('token_address,payload,block_time,created_at')
      .eq('token_address', c.token).eq('kind', 'token_create')
      .order('id', { ascending: true }).limit(1);
    if (error) throw new Error(`token_create: ${error.message}`);
    const r = data && data[0];
    if (!r) return null;
    const p = r.payload || {};
    return { token: c.token, createMs: ts(r.block_time) || ts(r.created_at), supply: Number(p.totalSupply ?? p.total_supply ?? p.supply ?? 0) || 1e9 };
  });
  const list = anchors.filter(Boolean).map(a => ({ ...cand.get(a.token), ...a }));
  console.log(`  有锚=${list.length}`);

  console.log(`[4/6] 阶段1 多变体买门（${list.length} 票）…`);
  const gates = await pool(list, CONC, async (c) => {
    const { data, error } = await db.from('wss_price_ticks')
      .select('block_time,trade_type,bnb_amount,token_amount,price_bnb,price_usd,sender_address,trader_address')
      .eq('token_address', c.token)
      .gte('block_time', new Date(c.createMs - 10000).toISOString())
      .lte('block_time', new Date(c.createMs + (AGE_MAX_SEC + 2) * 1000).toISOString())
      .order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(5000);
    if (error) throw new Error(`ticks: ${error.message}`);
    return { ...c, fires: simulateGate(data || [], c.createMs, c.passMs, c.supply) };
  });
  const fireCount = {};
  for (const g of gates) for (const vn of Object.keys(g.fires)) fireCount[vn] = (fireCount[vn] || 0) + 1;
  console.log('  触发数:', JSON.stringify(fireCount));

  const fireTokens = gates.filter(g => Object.keys(g.fires).length > 0);
  console.log(`[5/6] 阶段2 卖出矩阵（${fireTokens.length} 票，${EXIT_VARIANTS.length} 卖腿 × 各买门）…`);
  const gradRs = await pool(fireTokens, CONC, async (g) => {
    const { data, error } = await db.from('wss_events')
      .select('block_time,created_at').eq('token_address', g.token).eq('kind', 'graduation')
      .order('id', { ascending: true }).limit(1);
    if (error) throw new Error(`graduation: ${error.message}`);
    return data && data[0] ? { token: g.token, ms: ts(data[0].block_time) || ts(data[0].created_at) } : null;
  });
  const gradMap = new Map();
  for (const r of gradRs) if (r) gradMap.set(r.token, r.ms);

  const results = await pool(fireTokens, CONC, async (g) => {
    const earliestFire = Math.min(...Object.values(g.fires).map(f => f.fireMs));
    const { data, error } = await db.from('wss_price_ticks')
      .select('block_time,price_bnb,price_usd')
      .eq('token_address', g.token)
      .gte('block_time', new Date(earliestFire - 1000).toISOString())
      .lte('block_time', new Date(g.createMs + HORIZON_MS).toISOString())
      .order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(TICK_CAP);
    if (error) throw new Error(`ticks2: ${error.message}`);
    const ticks = data || [];
    const out = { token: g.token, symbol: g.symbol, rating: g.rating, tailTicks: ticks.length, byGate: {} };
    for (const [vn, fire] of Object.entries(g.fires)) {
      out.byGate[vn] = {
        fire: { ageSec: fire.ageSec, mcap: fire.mcap, passToFireSec: fire.passToFireSec, supBnb: fire.supBnb, supHolders: fire.supHolders, netBuy: fire.netBuy },
        exits: {},
      };
      for (const ex of EXIT_VARIANTS) out.byGate[vn].exits[ex.name] = simulateExit(ticks, fire, g.supply, ex, gradMap.get(g.token));
    }
    return out;
  });

  console.log('[6/6] 对照 live…');
  const trades = await fetchAll('trades', 'experiment_id,token_address,trade_direction,input_amount,output_amount,success,is_virtual_trade', (q) => q.gte('created_at', cutoff), 'id');
  const baseMap = new Map();
  for (const t of trades) {
    if (t.success === false || t.is_virtual_trade) continue;
    const k = `${t.experiment_id}|${t.token_address}`;
    baseMap.set(k, (baseMap.get(k) || 0) + (t.trade_direction === 'buy' ? -(parseFloat(t.input_amount) || 0) : (parseFloat(t.output_amount) || 0)));
  }
  const basePnls = [...baseMap.values()];

  console.log('\n========== 买门 × 卖腿 矩阵（净 BNB | (%/票=净/n×50) | 胜率 | hc90=断流90折）==========');
  for (const gv of GATE_VARIANTS) {
    for (const ev of EXIT_VARIANTS) {
      const pnls = [], hc = [];
      for (const r of results) {
        const g = r.byGate && r.byGate[gv.name];
        if (!g) continue;
        pnls.push(g.exits[ev.name].pnlBnb);
        hc.push(g.exits[ev.name].pnlHaircut90);
      }
      if (!pnls.length) continue;
      const sum = pnls.reduce((a, b) => a + b, 0);
      const sumHc = hc.reduce((a, b) => a + b, 0);
      const wins = pnls.filter(v => v > 0).length;
      console.log(`${gv.name.padEnd(12)} ${ev.name.padEnd(28)} n=${String(pnls.length).padStart(3)} 净=${sum.toFixed(4)} (${(sum / pnls.length * 500).toFixed(1)}%/票) 胜率=${(wins / pnls.length * 100).toFixed(0)}% | hc90=${sumHc.toFixed(4)}`);
    }
  }

  // g3 强池 × e0 细分桶
  const bandRows = [];
  for (const r of results) {
    const g = r.byGate && r.byGate['g3-hiBand'];
    if (!g) continue;
    const e = g.exits['e0-stop900-mcap20k-lock100.5'];
    bandRows.push({ ...e, rating: r.rating, fireMcap: g.fire.mcap, ageSec: g.fire.ageSec, symbol: r.symbol, token: r.token });
  }
  if (bandRows.length) {
    console.log(`\n== g3-hiBand × e0 细分 ==`);
    const byRating = {};
    for (const r of bandRows) { (byRating[r.rating] = byRating[r.rating] || []).push(r.pnlBnb); }
    for (const [k, v] of Object.entries(byRating)) console.log(`  rating=${k}: n=${v.length} 净=${v.reduce((a, b) => a + b, 0).toFixed(4)} 胜率=${(v.filter(x => x > 0).length / v.length * 100).toFixed(0)}%`);
    const byReason = {};
    for (const r of bandRows) { (byReason[r.reason] = byReason[r.reason] || []).push(r.pnlBnb); }
    for (const [k, v] of Object.entries(byReason)) console.log(`  出场=${k}: n=${v.length} 净=${v.reduce((a, b) => a + b, 0).toFixed(4)}`);
    console.log('  pnl 分位:', JSON.stringify(quantiles(bandRows.map(r => r.pnlBnb))));
  }
  console.log(`\n对照 live: n=${basePnls.length} 净=${basePnls.reduce((a, b) => a + b, 0).toFixed(4)} 胜率=${(basePnls.filter(v => v > 0).length / Math.max(basePnls.length, 1) * 100).toFixed(0)}%`);
  console.log('注：bundle 三门未计（乐观上界）；tick 价无滑点（hc90 为断流票 90 折敏感性）');

  if (OUT) {
    fs.writeFileSync(OUT, JSON.stringify({ config: { DAYS, GATE_VARIANTS, EXIT_VARIANTS, PROTECT_ON, BUY_BNB }, results }, null, 1));
    console.log(`明细已写 ${OUT}`);
  }
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
