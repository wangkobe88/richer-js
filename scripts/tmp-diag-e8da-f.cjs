#!/usr/bin/env node
/** 诊断 F:两只同名 MAYA(e8da vs eb2f) 逐 tick 精确重放——正确 per-block slope + bundle 簇算法 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const TOKENS = [
  { tag: 'e8da(没买)', addr: '0xe8da305a2ea91281592e5a8e4565ad9aaa3c7777' },
  { tag: 'eb2f(买了)', addr: '0xeb2f6eab24672fd5cc1805e45de95abe891e7777' },
];
const TOTAL_SUPPLY = 1e9;

async function fetchTicks(db, addr) {
  const rows = []; let offset = 0;
  while (true) {
    const { data } = await db.from('wss_price_ticks')
      .select('block_time,block_number,log_index,trade_type,token_amount,bnb_amount,price_usd,sender_address,trader_address')
      .eq('token_address', addr).order('block_number', { ascending: true }).order('log_index', { ascending: true })
      .range(offset, offset + 999);
    if (!data || !data.length) break;
    rows.push(...data); offset += data.length;
    if (offset > 5000) break;
  }
  return rows;
}

function linRegSlope(ys) {
  const n = ys.length;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += ys[i]; sxy += i * ys[i]; sxx += i * i; }
  return (n * sxy - sx * sy) / (n * sxx - sx * sx);
}
function slopeFactor(series) { // series=[{block,count}] per-block, cap 8, >=4 points
  if (series.length < 4) return 0; // _confirmDirection: <4 → relativeSlope=0
  const recent = series.slice(-8);
  const ys = recent.map(p => p.count);
  const slope = linRegSlope(ys);
  const avg = ys.reduce((a, b) => a + b, 0) / ys.length;
  return avg > 0 ? slope / avg : 0;
}

async function main() {
  const db = dbManager.getClient();
  for (const tk of TOKENS) {
    const rows = await fetchTicks(db, tk.addr);
    const ev = await db.from('wss_events').select('kind,block_time').eq('token_address', tk.addr).limit(5);
    const create = ev.data.find(e => e.kind === 'token_create');
    const grad = ev.data.find(e => e.kind === 'graduation');
    const nr = await db.from('narrative_analysis_rounds').select('round_no,trigger_reason,started_at,completed_at,rating')
      .eq('token_address', tk.addr).order('created_at').limit(10);
    const createMs = Date.parse(create.block_time);
    const gradMs = grad ? Date.parse(grad.block_time) : null;
    const ratingMs = nr.data.length ? Date.parse(nr.data[nr.data.length - 1].completed_at) : null;

    const net = new Map();
    let cumBuy = 0, holders = 0, routerBuys = 0, buyTrades = 0;
    const firstBuy = new Map(); // wallet -> {ts, blk, bnb} (bundle 簇用)
    const holderSeries = []; // per-block [{block,count}]
    const buyEvents = []; // {ts, bnb} (bundle 分母)
    const fmt = ms => new Date(ms).toISOString().slice(14, 23);
    let lastAllPass = null, firstAllPass = null;
    let fireWindowTicks = 0;

    for (const r of rows) {
      const t = Date.parse(r.block_time);
      const isBuy = r.trade_type === 'buy';
      const wallet = (r.sender_address || r.trader_address || '').toLowerCase();
      const tkn = Number(r.token_amount) || 0;
      const bnb = Number(r.bnb_amount) || 0;
      const blk = Number(r.block_number);
      if (wallet) {
        const prev = net.get(wallet) || 0, cur = prev + (isBuy ? tkn : -tkn);
        net.set(wallet, cur);
        if (prev <= 0 && cur > 0) holders++; else if (prev > 0 && cur <= 0) holders--;
      }
      if (isBuy) {
        cumBuy += bnb; buyTrades++;
        buyEvents.push({ ts: t, bnb });
        if ((r.trader_address || '').toLowerCase().startsWith('0x1de460')) routerBuys++;
        if (!firstBuy.has(wallet)) firstBuy.set(wallet, { ts: t, blk, bnb, li: Number(r.log_index) || 0 });
      }
      // holder series per-block push (同块覆盖/新块追加/8 封顶)
      const lastH = holderSeries[holderSeries.length - 1];
      if (lastH && lastH.block === blk) lastH.count = holders;
      else { holderSeries.push({ block: blk, count: holders }); if (holderSeries.length > 8) holderSeries.shift(); }

      // bundle 簇 (10s 窗)
      const cutoff = t - 10000;
      const winBuys = buyEvents.filter(e => e.ts >= cutoff);
      const winBuyBnb = winBuys.reduce((a, e) => a + e.bnb, 0);
      const perWallet = new Map();
      for (const [w, e] of firstBuy) {
        if (e.ts < cutoff) continue;
        perWallet.set(w, e);
      }
      const byBlock = new Map();
      for (const e of perWallet.values()) {
        let c = byBlock.get(e.blk); if (!c) { c = { bnb: 0, rows: [] }; byBlock.set(e.blk, c); }
        c.bnb += e.bnb; c.rows.push(e);
      }
      let bestClusterBnb = 0, bestClusterBlk = null, bestClusterN = 0;
      for (const [blk2, c] of byBlock) if (c.bnb > bestClusterBnb) { bestClusterBnb = c.bnb; bestClusterBlk = blk2; bestClusterN = c.rows.length; }
      const bundleShare = winBuyBnb > 0 ? bestClusterBnb / winBuyBnb * 100 : 0;

      const mcap = (Number(r.price_usd) || 0) * TOTAL_SUPPLY;
      const age = (t - createMs) / 1000;
      const rating = ratingMs && t >= ratingMs ? (nr.data[nr.data.length - 1].rating) : null;
      const routerPct = buyTrades ? routerBuys / buyTrades * 100 : null;
      const slope = slopeFactor(holderSeries);
      const avgPerWallet = firstBuy.size ? buyTrades / firstBuy.size : 0;

      const gates = {
        age90: age < 90, mc3500: mcap > 3500, mc12000: mcap < 12000,
        rating23: rating === 2 || rating === 3,
        slope0: slope > 0, bundle50: bundleShare < 50,
        copy20: true, // roster 复查(前轮已证 0)
        flap: mcap < 4500 || (routerPct != null && routerPct >= 30),
        pw4: avgPerWallet < 4, buy125: cumBuy >= 1.25, hold10: holders >= 10,
      };
      const ok = Object.values(gates).every(Boolean);
      if (ok) { if (!firstAllPass) firstAllPass = { t: fmt(t), age: +age.toFixed(1), mcap: Math.round(mcap), slope: +slope.toFixed(3), bundle: +bundleShare.toFixed(1), holders, cumBuy: +cumBuy.toFixed(2), routerPct: routerPct == null ? null : Math.round(routerPct) }; lastAllPass = { t: fmt(t), mcap: Math.round(mcap) }; fireWindowTicks++; }
      if (t >= (ratingMs || Infinity) - 1500 && t <= (ratingMs || 0) + 16000 && rows.indexOf(r) % 3 === 0 && !ok) {
        // 打印 rating 就绪附近的失败快照(限流)
        if (ratingMs && t >= ratingMs - 500 && t <= ratingMs + 6000) {
          const failed = Object.entries(gates).filter(([, v]) => !v).map(([k]) => k);
          if (failed.length) console.log(tk.tag, fmt(t), 'age=' + age.toFixed(1), 'mcap=' + Math.round(mcap), 'FAIL:', failed.join(','), '| slope=' + slope.toFixed(3), 'bundle=' + bundleShare.toFixed(1), 'holders=' + holders, 'cumBuy=' + cumBuy.toFixed(2));
        }
      }
    }
    console.log('\n====', tk.tag, tk.addr);
    console.log('create:', fmt(createMs), 'grad:', gradMs ? fmt(gradMs) : '无', 'rating(rounds=' + nr.data.length + '):', ratingMs ? fmt(ratingMs) + ' r=' + nr.data[nr.data.length - 1].rating : '无');
    console.log('ticks:', rows.length, '| 首条全过:', JSON.stringify(firstAllPass), '| 末条全过:', JSON.stringify(lastAllPass), '| 全过 tick 数:', fireWindowTicks);
  }
  await dbManager.close?.();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
