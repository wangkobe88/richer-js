#!/usr/bin/env node
/**
 * 一次性深度归因（0x732b…7777 MAI 是否误判 cheat，不进 git）。
 * 钱包级聚合 + 等额带成员画像 + 路由占比 + 价格轨迹。本地单 token 读取。
 */
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { AGGREGATOR_ROUTER_ADDRS } = require_('../../src/trading-engine/pre-check/aggregator-routers.js');
const { dbManager } = require_('../../src/services/dbManager.js');

const ADDR = '0x732bd5190992ecb2365e080c2d3d37880cb17777';
const ROUTERS = new Set([...AGGREGATOR_ROUTER_ADDRS].map((a) => a.toLowerCase()));
const sb = dbManager.getClient();

const { count } = await sb.from('wss_price_ticks').select('id', { count: 'exact', head: true }).eq('token_address', ADDR);
console.log(`总 tick 数=${count}`);
const LIMIT = Math.min(count, 6000);
const { data: ticks, error } = await sb.from('wss_price_ticks')
  .select('block_number,log_index,block_time,trade_type,bnb_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token')
  .eq('token_address', ADDR)
  .order('block_number', { ascending: true }).order('log_index', { ascending: true })
  .limit(LIMIT);
if (error) throw new Error(error.message);
console.log(`拉取=${ticks.length} 时间=${ticks[0]?.block_time} → ${ticks[ticks.length - 1]?.block_time}`);
console.log(`quote_token 分布=${JSON.stringify([...new Set(ticks.map((t) => t.quote_token ?? null))])}`);

// 价格轨迹（可靠价）
const px = ticks.filter((t) => t.price_bnb > 0 && !t.price_outlier).map((t) => Number(t.price_bnb));
const pxO = ticks.filter((t) => t.price_bnb > 0 && t.price_outlier).length;
const mn = Math.min(...px), mx = Math.max(...px);
console.log(`价格: 首=${px[0].toExponential(3)} 峰=${mx.toExponential(3)} 谷=${mn.toExponential(3)} 末=${px[px.length - 1].toExponential(3)} 峰/首=${(mx / px[0]).toFixed(1)}x 末/峰=${(px[px.length - 1] / mx).toFixed(2)} outlier行=${pxO}`);

// 钱包聚合（wallet=sender||trader，router 伪钱包按 snapshot 口径剔除前先看原貌）
const W = new Map(); // w -> {nb,sb,ns,ss,firstB,lastB,routerBuys,directBuys,blocks:Set}
let totBuy = 0, totSell = 0, routerBuyBnb = 0, routerSellBnb = 0;
let nRouterRows = 0, nNullSender = 0;
for (const t of ticks) {
  const w = (t.sender_address || t.trader_address || '').toLowerCase();
  const trader = (t.trader_address || '').toLowerCase();
  const isRouter = ROUTERS.has(trader);
  if (!t.sender_address) nNullSender++;
  if (isRouter) nRouterRows++;
  const buy = t.trade_type === 'buy';
  const bnb = Number(t.bnb_amount) || 0;
  if (buy) totBuy += bnb; else totSell += bnb;
  if (isRouter) { if (buy) routerBuyBnb += bnb; else routerSellBnb += bnb; }
  let e = W.get(w);
  if (!e) { e = { w, nb: 0, sb: 0, ns: 0, ss: 0, firstB: t.block_number, lastB: t.block_number, routerBuys: 0, directBuys: 0 }; W.set(w, e); }
  if (buy) { e.nb++; e.sb += bnb; if (isRouter) e.routerBuys++; else e.directBuys++; }
  else { e.ns++; e.ss += bnb; }
  e.lastB = t.block_number;
}
console.log(`\n总买=${totBuy.toFixed(2)} BNB / 总卖=${totSell.toFixed(2)} BNB；独立钱包=${W.size}；router 行=${nRouterRows}（买 ${routerBuyBnb.toFixed(2)}/卖 ${routerSellBnb.toFixed(2)}）sender 缺失行=${nNullSender}`);

// 正净持仓
const posNet = [...W.values()].map((e) => ({ w: e.w, net: e.sb - e.ss, ...e })).filter((e) => e.net > 0);
posNet.sort((a, b) => b.net - a.net);
const posTotal = posNet.reduce((s, e) => s + e.net, 0);
console.log(`正净持有人=${posNet.length} Σ正净=${posTotal.toFixed(2)} BNB`);

// 等额带（±2% 对数带、带内 ≥3 钱包、≥0.001）——复刻 snapshot 口径
const bandBase = Math.log(1.02);
const bands = new Map();
for (const t of ticks) {
  if (t.trade_type !== 'buy') continue;
  const bnb = Number(t.bnb_amount) || 0;
  if (bnb < 0.001) continue;
  const w = (t.sender_address || t.trader_address || '').toLowerCase();
  const k = Math.round(Math.log(bnb) / bandBase);
  if (!bands.has(k)) bands.set(k, new Map()); // w -> {n, bnb, viaRouter}
  let e = bands.get(k).get(w);
  if (!e) { e = { n: 0, bnb: 0, viaRouter: 0 }; bands.get(k).set(w, e); }
  e.n++; e.bnb += bnb;
  if (ROUTERS.has((t.trader_address || '').toLowerCase())) e.viaRouter++;
}
const eqMembers = new Set();
const bandRows = [...bands.entries()].filter(([, m]) => m.size >= 3)
  .map(([k, m]) => {
    for (const w of m.keys()) eqMembers.add(w);
    const arr = [...m.entries()];
    return {
      center: Math.exp(k * bandBase),
      wallets: m.size,
      buys: arr.reduce((s, [, e]) => s + e.n, 0),
      bnb: arr.reduce((s, [, e]) => s + e.bnb, 0),
      routerBuys: arr.reduce((s, [, e]) => s + e.viaRouter, 0),
    };
  }).sort((a, b) => b.bnb - a.bnb);
console.log(`\n合格等额带（≥3 钱包）：${bandRows.length} 个；eqMembers=${eqMembers.size} 钱包`);
for (const b of bandRows.slice(0, 12)) {
  console.log(`  带≈${b.center.toFixed(4)} BNB: ${b.wallets} 钱包 ${b.buys} 笔 Σ${b.bnb.toFixed(2)} BNB 其中经聚合路由 ${b.routerBuys} 笔`);
}
const eqNet = posNet.filter((e) => eqMembers.has(e.w)).reduce((s, e) => s + e.net, 0);
console.log(`equalBandHoldPct 复算=${((eqNet / posTotal) * 100).toFixed(1)}%（eqMembers 正净 ${eqNet.toFixed(2)}/${posTotal.toFixed(2)}）`);

// sb∪eq 簇成员买入占比（bundleBuyPct 口径：簇成员买入合计÷Σ总买）
// sb 同块簇（≥3 笔买同块）成员
const blockBuys = new Map();
for (const t of ticks) {
  if (t.trade_type !== 'buy') continue;
  const w = (t.sender_address || t.trader_address || '').toLowerCase();
  if (!blockBuys.has(t.block_number)) blockBuys.set(t.block_number, []);
  blockBuys.get(t.block_number).push(w);
}
const sbMembers = new Set();
let sbBlocks = 0;
for (const [, arr] of blockBuys) if (arr.length >= 3) { sbBlocks++; for (const w of arr) sbMembers.add(w); }
const cluster = new Set([...sbMembers, ...eqMembers]);
let clusterBuy = 0;
for (const e of W.values()) if (cluster.has(e.w)) clusterBuy += e.sb;
console.log(`同块≥3笔买的块=${sbBlocks} sbMembers=${sbMembers.size}；sb∪eq 并集=${cluster.size} 钱包；bundleBuyPct 复算=${((clusterBuy / totBuy) * 100).toFixed(1)}%（${clusterBuy.toFixed(2)}/${totBuy.toFixed(2)}）`);

// 正净 top15 画像
console.log(`\n正净持仓 top15（net BNB | 买笔/Σ | 卖笔/Σ | 经路由买 | 首末块跨度 | inEq带）：`);
for (const e of posNet.slice(0, 15)) {
  console.log(`  ${e.w.slice(0, 12)}… net=${e.net.toFixed(3)} | 买${e.nb}/${e.sb.toFixed(2)} 卖${e.ns}/${e.ss.toFixed(2)} | 路由买${e.routerBuys}/${e.nb} | blk ${e.firstB}-${e.lastB} | ${eqMembers.has(e.w) ? 'EQ' : '-'}`);
}

// 负净 top8（砸盘方）
const negNet = [...W.values()].map((e) => ({ ...e, net: e.sb - e.ss })).filter((e) => e.net < 0).sort((a, b) => a.net - b.net);
console.log(`\n净卖 top8（砸盘方）：`);
for (const e of negNet.slice(0, 8)) {
  console.log(`  ${e.w.slice(0, 12)}… net=${e.net.toFixed(3)} | 买${e.nb}/${e.sb.toFixed(2)} 卖${e.ns}/${e.ss.toFixed(2)} | 路由买${e.routerBuys}/${e.nb} | ${eqMembers.has(e.w) ? 'EQ' : '-'}`);
}
