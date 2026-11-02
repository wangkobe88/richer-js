#!/usr/bin/env node
/**
 * 一次性归因（四票「涨得好却判 cheat」复核，CD130 同类票取证，不进 git）。
 * 每票：cheat 行轨迹+载体锚 / 价格轨迹 / 钱包结构（等额带=前端整档？路由占比/top1/对敲）。
 * 本地单 token 有界读取（每票 ≤6000 tick）。
 */
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { AGGREGATOR_ROUTER_ADDRS } = require_('../../src/trading-engine/pre-check/aggregator-routers.js');
const { dbManager } = require_('../../src/services/dbManager.js');

const ADDRS = [
  '0xec74ec6b297fbe318ff09da24023319a36737777',
  '0x5a3f19b5bd587c4a127096ff37f6c9d59f007777',
  '0x43705ac9eb429777f3d993d854a29bcd61837777',
  '0xd827bc26713cb6412f4d163766938dee3d0c7777',
];
const ROUTERS = new Set([...AGGREGATOR_ROUTER_ADDRS].map((a) => a.toLowerCase()));
const sb = dbManager.getClient();

for (const ADDR of ADDRS) {
  const line = '='.repeat(100);
  console.log(`\n${line}\n票 ${ADDR}`);
  // meta
  const { data: evs } = await sb.from('wss_events')
    .select('platform,payload,block_time').eq('kind', 'token_create').eq('token_address', ADDR).limit(1);
  const hit = (evs ?? [])[0];
  console.log(`meta: symbol=${hit?.payload?.symbol} name=${hit?.payload?.name} platform=${hit?.platform} createdAt=${hit?.block_time}`);

  // cheat 轨迹（首行+首 cheat 行）
  const { data: crows } = await sb.from('cheat_detection')
    .select('analyzed_at,verdict,snapshot_digest').eq('token_address', ADDR)
    .order('analyzed_at', { ascending: true }).limit(30);
  const rows = crows ?? [];
  console.log(`cheat_detection 行数=${rows.length}`);
  let firstCheat = null;
  for (const r of rows) {
    const d = r.snapshot_digest || {};
    if (!firstCheat && d.grade === 'cheat') firstCheat = r;
  }
  for (const r of [rows[0], firstCheat].filter(Boolean)) {
    const d = r.snapshot_digest || {};
    const a = d.anchors || {};
    console.log(`  ${r.analyzed_at} grade=${d.grade} reasons=${JSON.stringify(d.gradeReasons)}`);
    console.log(`    phenomena=${JSON.stringify(d.phenomena)} ext=${JSON.stringify(d.extLevels)}`);
    console.log(`    eqHold=${a.equalBandHoldPct} sbHold=${a.sameBlockHoldPct} bundleBuy=${a.bundleBuyPct} wash=${a.washPairCount}/${a.washPairSellPct} t1流=${a.top1HoldCircPct?.toFixed?.(1)} 纯卖=${a.noBuySellPct} act=${d.activityLevel?.bucket} bd=${d.bundledDominance?.bucket}`);
  }
  if (rows.length && !firstCheat) console.log('  （无 cheat 行）');

  // ticks + 钱包
  const { count } = await sb.from('wss_price_ticks').select('id', { count: 'exact', head: true }).eq('token_address', ADDR);
  const LIMIT = Math.min(count, 6000);
  const { data: ticks, error } = await sb.from('wss_price_ticks')
    .select('block_number,log_index,block_time,trade_type,bnb_amount,price_bnb,price_outlier,trader_address,sender_address')
    .eq('token_address', ADDR)
    .order('block_number', { ascending: true }).order('log_index', { ascending: true })
    .limit(LIMIT);
  if (error) throw new Error(error.message);
  const px = ticks.filter((t) => t.price_bnb > 0 && !t.price_outlier).map((t) => Number(t.price_bnb));
  if (px.length >= 2) {
    const mn = Math.min(...px), mx = Math.max(...px);
    console.log(`tick=${count}（拉 ${ticks.length}）${ticks[0]?.block_time} → ${ticks[ticks.length - 1]?.block_time}`);
    console.log(`价格: 首=${px[0].toExponential(2)} 峰=${mx.toExponential(2)} 末=${px[px.length - 1].toExponential(2)} 峰/首=${(mx / px[0]).toFixed(1)}x 末/峰=${(px[px.length - 1] / mx).toFixed(2)}`);
  } else console.log(`tick=${count} 可靠价不足`);

  const W = new Map();
  let totBuy = 0, totSell = 0, routerBuyBnb = 0;
  for (const t of ticks) {
    const w = (t.sender_address || t.trader_address || '').toLowerCase();
    const isRouter = ROUTERS.has((t.trader_address || '').toLowerCase());
    const buy = t.trade_type === 'buy';
    const bnb = Number(t.bnb_amount) || 0;
    if (buy) { totBuy += bnb; if (isRouter) routerBuyBnb += bnb; } else totSell += bnb;
    let e = W.get(w);
    if (!e) { e = { nb: 0, sb: 0, ns: 0, ss: 0 }; W.set(w, e); }
    if (buy) { e.nb++; e.sb += bnb; } else { e.ns++; e.ss += bnb; }
  }
  console.log(`总买=${totBuy.toFixed(2)}/总卖=${totSell.toFixed(2)} BNB；独立钱包=${W.size}；路由买=${((routerBuyBnb / (totBuy || 1)) * 100).toFixed(0)}%（${routerBuyBnb.toFixed(2)}）`);

  // 正净 + top1
  const posNet = [...W.entries()].map(([w, e]) => ({ w, net: e.sb - e.ss, ...e })).filter((e) => e.net > 0).sort((a, b) => b.net - a.net);
  const posTotal = posNet.reduce((s, e) => s + e.net, 0);
  console.log(`正净持有人=${posNet.length} top1净占=${posNet.length ? ((posNet[0].net / posTotal) * 100).toFixed(1) : '-'}%（${posNet[0]?.nb}买${posNet[0]?.sb.toFixed(2)} ${posNet[0]?.ns}卖${posNet[0]?.ss.toFixed(2)}）`);

  // 等额带（±2% 对数带 ≥3 钱包 ≥0.001）+ 同块簇
  const bandBase = Math.log(1.02);
  const bands = new Map();
  const blockBuys = new Map();
  for (const t of ticks) {
    if (t.trade_type !== 'buy') continue;
    const bnb = Number(t.bnb_amount) || 0;
    if (bnb >= 0.001) {
      const w = (t.sender_address || t.trader_address || '').toLowerCase();
      const k = Math.round(Math.log(bnb) / bandBase);
      if (!bands.has(k)) bands.set(k, new Map());
      let e = bands.get(k).get(w);
      if (!e) { e = { n: 0, bnb: 0, viaRouter: 0 }; bands.get(k).set(w, e); }
      e.n++; e.bnb += bnb;
      if (ROUTERS.has((t.trader_address || '').toLowerCase())) e.viaRouter++;
    }
    const w2 = (t.sender_address || t.trader_address || '').toLowerCase();
    if (!blockBuys.has(t.block_number)) blockBuys.set(t.block_number, []);
    blockBuys.get(t.block_number).push(w2);
  }
  const eqMembers = new Set();
  const bandRows = [...bands.entries()].filter(([, m]) => m.size >= 3)
    .map(([k, m]) => {
      for (const w of m.keys()) eqMembers.add(w);
      const arr = [...m.entries()];
      return { center: Math.exp(k * bandBase), wallets: m.size, buys: arr.reduce((s, [, e]) => s + e.n, 0), bnb: arr.reduce((s, [, e]) => s + e.bnb, 0), routerBuys: arr.reduce((s, [, e]) => s + e.viaRouter, 0) };
    }).sort((a, b) => b.bnb - a.bnb);
  const sbMembers = new Set();
  let sbBlocks = 0;
  for (const [, arr] of blockBuys) if (arr.length >= 3) { sbBlocks++; for (const w of arr) sbMembers.add(w); }
  const eqNet = posNet.filter((e) => eqMembers.has(e.w)).reduce((s, e) => s + e.net, 0);
  const sbNet = posNet.filter((e) => sbMembers.has(e.w)).reduce((s, e) => s + e.net, 0);
  console.log(`合格带=${bandRows.length} eqMembers=${eqMembers.size}/${W.size} 钱包=${((eqMembers.size / W.size) * 100).toFixed(0)}%；eqHold复算=${((eqNet / posTotal) * 100).toFixed(1)}% sbHold复算=${((sbNet / posTotal) * 100).toFixed(1)}%（同块≥3买块=${sbBlocks}）`);
  for (const b of bandRows.slice(0, 5)) {
    console.log(`  带≈${b.center.toFixed(4)}: ${b.wallets} 钱包 ${b.buys} 笔 Σ${b.bnb.toFixed(2)} BNB 其中经路由 ${b.routerBuys} 笔`);
  }
}
