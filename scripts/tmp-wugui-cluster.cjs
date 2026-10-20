#!/usr/bin/env node
/**
 * 临时脚本：乌龟早盘「0.15 簇」深挖
 * A) 创建后 15min 每钱包净持仓/净 BNB/价格路径
 * B) 三个同块跟随钱包 + 创建块两个 0.1477 钱包的 14 天买入史（6h 分片）
 * C) pair 缓存中这几个钱包的互相共现
 */
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', 'config', '.env') });
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { dbManager } = require('../src/services/dbManager');
const TOK = '0xb2782a4a27b1fc104c377a06e3cf455ca0fe7777';
const WATCH = [
  '0x68c49e3ace53f23c0086471a126202cbfd939924', // 目标
  '0xba4bf95d5473beac646e14d79d7a71b769e40f4a',
  '0x880fb55b8caa2e39acb83b0ff02a2d6e7199d9d1',
  '0xcf293752a12eabfa948fd5a2a1b5857be895fd74',
  '0xe7673530798225ae028ee149607ec7fd52daa000',
  '0xa8bdb16ee3f408c6393eb107bc21a54c19c11bf4',
  '0x100660b178f08b4492d9d9f0f9e0cdf160ed344c',
];
const PAGE = 1000, SL = 6 * 3600e3, DAYS = 14;
const db = dbManager.getClient();

async function fetchToken(loIso, hiIso) {
  const out = [];
  let bt = null, id = 0;
  for (;;) {
    let q = db.from('wss_price_ticks')
      .select('id,trade_type,trader_address,sender_address,bnb_amount,token_amount,block_number,log_index,block_time,price_bnb,price_usd,price_outlier')
      .eq('token_address', TOK).gte('block_time', loIso).lte('block_time', hiIso);
    if (bt) q = q.or(`block_time.gt.${bt},and(block_time.eq.${bt},id.gt.${id})`);
    const { data, error } = await q.order('block_time', { ascending: true }).order('id', { ascending: true }).limit(PAGE);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < PAGE || out.length > 20000) break;
    bt = data[data.length - 1].block_time; id = data[data.length - 1].id;
  }
  out.sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
  return out;
}

async function fetchWalletBuys(addr) {
  const end = Date.now(), start = end - DAYS * 86400e3;
  const out = [];
  for (let t = start; t < end; t += SL) {
    const lo = new Date(t).toISOString(), hi = new Date(Math.min(t + SL, end)).toISOString();
    let bt = null, id = 0;
    for (;;) {
      let q = db.from('wss_price_ticks')
        .select('id,token_address,trade_type,bnb_amount,token_amount,block_time,block_number')
        .eq('sender_address', addr).is('experiment_id', null)
        .gte('block_time', lo).lt('block_time', hi);
      if (bt) q = q.or(`block_time.gt.${bt},and(block_time.eq.${bt},id.gt.${id})`);
      const { data, error } = await q.order('block_time', { ascending: true }).order('id', { ascending: true }).limit(PAGE);
      if (error) throw new Error(`${addr}: ${error.message}`);
      out.push(...data);
      if (data.length < PAGE) break;
      bt = data[data.length - 1].block_time; id = data[data.length - 1].id;
    }
  }
  return out;
}

(async () => {
  const { data: ev } = await db.from('wss_events').select('payload,block_time').eq('kind', 'token_create').eq('token_address', TOK).limit(1);
  const p = ev?.[0]?.payload || {};
  const createdIso = ev?.[0]?.block_time;
  const t0 = new Date(createdIso).getTime();
  console.log(`[token] 创建=${createdIso} creator=${p.creator}`);

  const rows = await fetchToken(createdIso, new Date(t0 + 15 * 60000).toISOString());
  // A) 钱包净持仓
  const nets = new Map();
  for (const r of rows) {
    const w = (r.sender_address || r.trader_address || '').toLowerCase();
    let s = nets.get(w);
    if (!s) { s = { buyTok: 0, sellTok: 0, buyBnb: 0, sellBnb: 0, firstBuy: null, lastSell: null, n: 0 }; nets.set(w, s); }
    const bnb = Number(r.bnb_amount) || 0, tok = Number(r.token_amount) || 0;
    s.n++;
    if (r.trade_type === 'buy') { s.buyTok += tok; s.buyBnb += bnb; if (!s.firstBuy) s.firstBuy = r.block_time; }
    else { s.sellTok += tok; s.sellBnb += bnb; s.lastSell = r.block_time; }
  }
  const totalTok = [...nets.values()].reduce((a, s) => Math.max(a, s.buyTok), 0);
  console.log('\n[15min 钱包净持仓 Top]（netTok=买-卖 token；netBnb=卖-买）');
  const arr = [...nets.entries()].map(([w, s]) => ({ w, ...s, netTok: s.buyTok - s.sellTok, netBnb: s.sellBnb - s.buyBnb }))
    .sort((a, b) => b.netTok - a.netTok);
  for (const s of arr.slice(0, 12)) {
    console.log(`  ${s.w}  净token=${s.netTok.toExponential(2)} 买${s.buyBnb.toFixed(3)} 卖${s.sellBnb.toFixed(3)} netBnb=${s.netBnb.toFixed(3)} 笔${s.n} 首买=${s.firstBuy?.slice(11, 19)} 末卖=${s.lastSell?.slice(11, 19) || '-'}`);
  }
  // 价格路径（每 30s 收盘）
  console.log('\n[价格路径 30s]（可靠价：非 outlier、非尘）');
  const rel = rows.filter(r => !r.price_outlier && Number(r.price_bnb) > 0 && (Number(r.bnb_amount) || 0) >= 0.001);
  const buckets = new Map();
  for (const r of rel) {
    const m = Math.floor((new Date(r.block_time).getTime() - t0) / 30000);
    const b = buckets.get(m) || { hi: 0, lo: Infinity, close: null, vol: 0 };
    const pr = Number(r.price_bnb);
    b.hi = Math.max(b.hi, pr); b.lo = Math.min(b.lo, pr); b.close = pr; b.vol += Number(r.bnb_amount) || 0;
    buckets.set(m, b);
  }
  for (const [m, b] of [...buckets.entries()].sort((a, b) => a[0] - b[0]).slice(0, 24)) {
    console.log(`  +${String(m * 30).padStart(4)}s close=${b.close.toExponential(3)} hi=${b.hi.toExponential(3)} lo=${b.lo.toExponential(3)} vol=${b.vol.toFixed(3)}`);
  }

  // B) 各观察钱包 14 天买入史
  console.log('\n[14 天买入史]');
  for (const w of WATCH) {
    const buys = (await fetchWalletBuys(w)).filter(r => r.trade_type === 'buy');
    const per = new Map();
    for (const r of buys) { const t = r.token_address; const s = per.get(t) || { n: 0, bnb: 0, first: r.block_time }; s.n++; s.bnb += Number(r.bnb_amount) || 0; if (r.block_time < s.first) s.first = r.block_time; per.set(t, s); }
    console.log(`  ${w}  买 ${buys.length} 笔 / ${per.size} token / ${buys.reduce((a, r) => a + (Number(r.bnb_amount) || 0), 0).toFixed(2)} BNB`);
    const toks = [...per.entries()].sort((a, b) => (a[1].first < b[1].first ? 1 : -1)).slice(0, 12);
    for (const [t, s] of toks) {
      const sfx = t.slice(-4);
      console.log(`     ${t} (${sfx}) ${s.n}笔/${s.bnb.toFixed(3)}BNB 首=${s.first.slice(5, 19)}`);
    }
  }

  // C) pair 缓存互相共现
  const pc = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, '..', 'data', 'offline-cache', 'copy-trade-pairs.json.gz'))).toString('utf8'));
  const W = new Set(WATCH);
  const inSet = [];
  for (const q of pc.pairs) {
    const [a, b] = q.k.split('|');
    if (W.has(a) && W.has(b)) inSet.push({ a, b, co: q.co, even: q.even, sellSync: q.sellSync, laterA: q.laterA, laterB: q.laterB });
  }
  console.log(`\n[pair 缓存] 观察钱包之间共现 ${inSet.length} 对`);
  for (const x of inSet.sort((p, q) => q.co - p.co).slice(0, 30)) {
    console.log(`  ${x.a.slice(0, 10)}… ↔ ${x.b.slice(0, 10)}…  co=${x.co} 等额=${x.even} 同步卖=${x.sellSync}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
