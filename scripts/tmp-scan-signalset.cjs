#!/usr/bin/env node
/**
 * 临时扫描 D（182 跑）：7d signal 子集上的首窗结构 × 结局——门影响面的正确口径
 * 全市场门模拟被死票（ret600=0%）污染；引擎真实会买的票=有 strategy_signal 的票，
 * 在该子集上评估 tpw/max 门才有拦截面/误伤面的决策意义。
 * 输出：per-token 明细 + 门模拟（signal 子集）+ 猪五花参照行。
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const { AGGREGATOR_ROUTER_ADDRS } = require('../src/trading-engine/pre-check/aggregator-routers');

const D24H = 24 * 3600 * 1000;
const MIN_TICK_BNB = 0.001;
const DUST_UNIFORM = 0.01;
const WIN_MS = 90 * 1000;
const END1_MS = 600 * 1000;
const END2_MS = 1800 * 1000;
const UUID0 = '00000000-0000-0000-0000-000000000000';

const winStats = (ticks, createMs, winMs) => {
  const wStat = new Map();
  let buyBnb = 0, routerBuyBnb = 0;
  const buyByWallet = new Map();
  for (const t of ticks) {
    if (new Date(t.block_time).getTime() - createMs > winMs) continue;
    const bnb = Number(t.bnb_amount) || 0;
    if (bnb < MIN_TICK_BNB || !(Number(t.token_amount) > 0)) continue;
    const w = (t.sender_address || t.trader_address || '').toLowerCase();
    const e = wStat.get(w) || { n: 0 };
    e.n++; wStat.set(w, e);
    if (t.trade_type === 'buy') {
      buyBnb += bnb;
      if (AGGREGATOR_ROUTER_ADDRS.has(t.trader_address)) routerBuyBnb += bnb;
      buyByWallet.set(w, (buyByWallet.get(w) || 0) + bnb);
    }
  }
  const wallets = wStat.size;
  const tradeCount = [...wStat.values()].reduce((s, e) => s + e.n, 0);
  const maxPerWallet = wallets ? Math.max(...[...wStat.values()].map(e => e.n)) : 0;
  const amounts = [...buyByWallet.values()].filter(a => a >= DUST_UNIFORM);
  let clusterN = 0, uniRatio = 0, clusterAmount = null;
  if (amounts.length >= 3) {
    const buckets = new Map();
    for (const a of amounts) { const k = a.toFixed(2); buckets.set(k, (buckets.get(k) || 0) + 1); }
    let best = null;
    for (const [k, n] of buckets) if (!best || n > best[1]) best = [k, n];
    clusterN = best[1]; clusterAmount = Number(best[0]); uniRatio = clusterN / amounts.length * 100;
  }
  return {
    wallets, tradeCount, tpw: wallets ? +(tradeCount / wallets).toFixed(2) : 0, maxPerWallet,
    clusterN, uniRatio: +uniRatio.toFixed(1), clusterAmount,
    routerPct: buyBnb > 0 ? +(routerBuyBnb / buyBnb * 100).toFixed(1) : 0,
    top1: buyBnb > 0 ? +([...buyByWallet.values()].reduce((m, a) => Math.max(m, a), 0) / buyBnb * 100).toFixed(1) : 0,
    buyBnb: +buyBnb.toFixed(2),
  };
};

async function main() {
  const db = dbManager.getClient();

  // 1. 7d signals（uuid keyset）→ per-token 首条 preBuy 因子
  const sigByToken = new Map();
  {
    let curId = UUID0;
    for (;;) {
      const r = await db.from('strategy_signals').select('id,token_address,created_at,metadata->preBuyCheckFactors')
        .gte('created_at', new Date(Date.now() - 7 * D24H).toISOString())
        .gt('id', curId)
        .order('id', { ascending: true })
        .limit(1000);
      const page = r.data || [];
      if (r.error) { console.log('signals 分页 error:', r.error.message); break; }
      for (const s of page) {
        const f = s.preBuyCheckFactors;
        if (!f || !s.token_address) continue;
        if (!sigByToken.has(s.token_address)) sigByToken.set(s.token_address, f);
      }
      if (page.length < 1000) break;
      curId = page.reduce((m, p) => (p.id > m ? p.id : m), curId);
    }
  }
  console.log(`[D] 7d signal tokens: ${sigByToken.size}`);

  // 2. per-token：create 锚点查 + 0-30min ticks + 结构/结局
  const rows = [];
  let i = 0;
  for (const [addr, f] of sigByToken) {
    const k = addr.toLowerCase();
    try {
      const ev = await db.from('wss_events').select('block_time,payload->symbol')
        .eq('kind', 'token_create').eq('token_address', k).limit(1);
      if (!ev.data || !ev.data[0]) { i++; continue; }
      const createMs = new Date(ev.data[0].block_time).getTime();
      const r = await db.from('wss_price_ticks')
        .select('block_time,price_bnb,bnb_amount,token_amount,trade_type,sender_address,trader_address')
        .eq('token_address', k)
        .gte('block_time', ev.data[0].block_time)
        .lte('block_time', new Date(createMs + END2_MS).toISOString())
        .limit(4000);
      const ticks = r.data || [];
      if (!ticks.length) { i++; continue; }
      const s90 = winStats(ticks, createMs, WIN_MS);
      const s30 = winStats(ticks, createMs, 30000);
      const pricePts = ticks.map(t => [new Date(t.block_time).getTime() - createMs, Number(t.price_bnb)]).filter(([, p]) => p > 0);
      const at = (ms) => { let v = null; for (const [d, p] of pricePts) if (d <= ms) v = p; return v; };
      const p90 = at(WIN_MS), p600 = at(END1_MS), p1800 = at(END2_MS);
      // 死票标记：p90 后无新价（ret600 恒 0 的污染源）
      const lastPt = pricePts.length ? pricePts[pricePts.length - 1][0] : null;
      rows.push({
        addr: k, symbol: ev.data[0].symbol || '?',
        tpw: s90.tpw, max: s90.maxPerWallet, wallets: s90.wallets,
        tpw30: s30.tpw, max30: s30.maxPerWallet,
        uniN: s90.clusterN, uniRatio: s90.uniRatio, clusterAmount: s90.clusterAmount,
        routerPct: s90.routerPct, top1: s90.top1, buyBnb: s90.buyBnb,
        lag: f.narrativeCorpusLagSec ?? null, er: f.earlyReturn ?? null, rating: f.narrativeRating ?? null,
        lastTickDelta: lastPt, // 最后价距创建 ms（<600s=死票）
        ret600: p90 && p600 ? +((p600 / p90 - 1) * 100).toFixed(1) : null,
        ret1800: p90 && p1800 ? +((p1800 / p90 - 1) * 100).toFixed(1) : null,
      });
    } catch (e) { /* 单票失败继续 */ }
    if (++i % 30 === 0) console.log(`  进度 ${i}/${sigByToken.size}`);
  }
  console.log(`[D] 有效行: ${rows.length}`);

  const med = arr => { const a = arr.filter(x => x !== null && Number.isFinite(x)).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
  const alive = rows.filter(r => (r.lastTickDelta ?? 0) >= END1_MS - 1000); // 活过 600s 的票

  console.log(`\n=== signal 子集门模拟（全 ${rows.length} 票 / 活票 ${alive.length}）===`);
  const gates = {
    'G1 tpw90>=4': r => r.tpw >= 4,
    'G2 tpw90>=5': r => r.tpw >= 5,
    'G3 max90>=8': r => r.max >= 8,
    'G3b max90>=10': r => r.max >= 10,
    'G3c max90>=15': r => r.max >= 15,
    'G4 tpw30>=4': r => r.tpw30 >= 4,
    'G5 max30>=5': r => r.max30 >= 5,
    'G5b max30>=8': r => r.max30 >= 8,
    'G8 复合 max90>=8 且 tpw30>=3': r => r.max >= 8 && r.tpw30 >= 3,
    'G9 复合 tpw90>=3 且 uniRatio<20 且 max90>=6': r => r.tpw >= 3 && r.uniRatio < 20 && r.max >= 6,
  };
  for (const set of [[`全票`, rows], [`活票(>=600s)`, alive]]) {
    console.log(`--- ${set[0]} ---`);
    for (const [name, fn] of Object.entries(gates)) {
      const hit = set[1].filter(fn);
      const hitRet = hit.map(r => r.ret600).filter(x => x !== null);
      console.log(`${name}: 拦 ${hit.length}/${set[1].length} | 被拦 ret600 中位=${med(hitRet)}% | 被拦票明细: ${hit.map(r => `${r.symbol}(${r.tpw}/${r.max}/${r.ret600}%)`).slice(0, 12).join(' ')}`);
    }
  }

  console.log('\n=== 明细（按 tpw 降序前 60）===');
  for (const r of [...rows].sort((a, b) => b.tpw - a.tpw).slice(0, 60)) {
    console.log(`${r.addr.slice(0, 10)}… ${String(r.symbol).padEnd(12)} tpw=${r.tpw} max=${r.max} w=${r.wallets} tpw30=${r.tpw30} max30=${r.max30} uni=${r.uniN}/${r.uniRatio}% amt=${r.clusterAmount} rtr=${r.routerPct} top1=${r.top1} buy=${r.buyBnb} lag=${r.lag} er=${r.er} rt=${r.rating} last=${r.lastTickDelta} ret600=${r.ret600} ret1800=${r.ret1800}`);
  }
  const ref = rows.find(r => r.addr.startsWith('0x7603c74b'));
  if (ref) console.log('\n参照(猪五花):', JSON.stringify(ref));

  await dbManager.close?.();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
