#!/usr/bin/env node
/** 临时诊断 E:0xe8da…7777 补齐集中度臂 + roster 门逐 tick 重放 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');

const ADDR = '0xe8da305a2ea91281592e5a8e4565ad9aaa3c7777';
const TOTAL_SUPPLY = 1e9;
const CREATE_MS = Date.parse('2026-10-21T16:00:31Z');
const RATING_READY_MS = Date.parse('2026-10-21T16:00:35.442Z');
const GRAD_MS = Date.parse('2026-10-21T16:00:49Z');

const copyRoster = new Set((require('../config/rosters/copy-wallet-roster.json').wallets || []).map(w => w.toLowerCase ? w.toLowerCase() : String(w).toLowerCase()));
const famousSet = new Set((require('../config/rosters/famous-copy-wallets.json').wallets || []).map(w => String(w).toLowerCase()));
const sybil = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/rosters/sybil-clusters.json'), 'utf8'));
const sybilWallets = new Map(); // wallet -> clusterIdx
(sybil.clusters || []).forEach((c, i) => (c.wallets || []).forEach(w => sybilWallets.set(String(w).toLowerCase(), i)));

async function main() {
  const db = dbManager.getClient();
  const rows = [];
  let offset = 0;
  while (true) {
    const { data, error } = await db.from('wss_price_ticks')
      .select('block_time,block_number,log_index,trade_type,token_amount,bnb_amount,price_bnb,price_usd,sender_address,trader_address')
      .eq('token_address', ADDR).order('block_number', { ascending: true }).order('log_index', { ascending: true })
      .range(offset, offset + 999);
    if (error) throw error;
    if (!data.length) break;
    rows.push(...data); offset += data.length;
    if (offset > 5000) break;
  }

  const net = new Map(); // wallet -> net tokens
  let cumBuy = 0, holders = 0, routerBuys = 0, buyTrades = 0;
  const perWallet = new Map();
  const fmt = ms => new Date(ms).toISOString().slice(14, 23);
  const events = [];

  for (const r of rows) {
    const t = Date.parse(r.block_time);
    if (t < RATING_READY_MS || t > GRAD_MS) {
      // rating=3 之前照常累积状态
      const isBuy = r.trade_type === 'buy';
      const wallet = (r.sender_address || r.trader_address || '').toLowerCase();
      const tk = Number(r.token_amount) || 0;
      if (wallet) {
        const prev = net.get(wallet) || 0, cur = prev + (isBuy ? tk : -tk);
        net.set(wallet, cur);
        if (prev <= 0 && cur > 0) holders++; else if (prev > 0 && cur <= 0) holders--;
      }
      if (isBuy) { cumBuy += Number(r.bnb_amount) || 0; buyTrades++; if ((r.trader_address || '').toLowerCase().startsWith('0x1de460')) routerBuys++; perWallet.set(wallet, (perWallet.get(wallet) || 0) + 1); }
      continue;
    }
    const isBuy = r.trade_type === 'buy';
    const wallet = (r.sender_address || r.trader_address || '').toLowerCase();
    const tk = Number(r.token_amount) || 0;
    if (wallet) {
      const prev = net.get(wallet) || 0, cur = prev + (isBuy ? tk : -tk);
      net.set(wallet, cur);
      if (prev <= 0 && cur > 0) holders++; else if (prev > 0 && cur <= 0) holders--;
    }
    if (isBuy) { cumBuy += Number(r.bnb_amount) || 0; buyTrades++; if ((r.trader_address || '').toLowerCase().startsWith('0x1de460')) routerBuys++; perWallet.set(wallet, (perWallet.get(wallet) || 0) + 1); }

    const mcap = (Number(r.price_usd) || 0) * TOTAL_SUPPLY;
    const age = (t - CREATE_MS) / 1000;
    const routerPct = buyTrades ? (routerBuys / buyTrades) * 100 : null;
    const avgPerWallet = perWallet.size ? buyTrades / perWallet.size : 0;

    // 集中度臂(mcap>=4500 时必须走第二臂)
    let top1 = 0, top1W = '';
    for (const [w, v] of net) if (v > top1) { top1 = v; top1W = w; }
    const top1CircPct = top1 / TOTAL_SUPPLY * 100;
    let maxCopy = 0, maxCopyW = null;
    for (const [w, v] of net) if (copyRoster.has(w) && v / TOTAL_SUPPLY * 100 > maxCopy) { maxCopy = v / TOTAL_SUPPLY * 100; maxCopyW = w; }
    let famous = null;
    for (const [w, v] of net) if (famousSet.has(w)) famous = Math.max(famous || 0, v / TOTAL_SUPPLY * 100);
    let sybilPct = null;
    if (sybilWallets.size) {
      const per = new Map();
      for (const [w, v] of net) { const ci = sybilWallets.get(w); if (ci != null && v > 0) per.set(ci, (per.get(ci) || 0) + v); }
      let mx = 0; for (const v of per.values()) mx = Math.max(mx, v);
      sybilPct = mx / TOTAL_SUPPLY * 100;
    }

    const armA = mcap < 4500 && (famous == null || famous < 40);
    const armB_ = { slopeGt0: holders >= 4, top1Lt35: top1CircPct < 35, copyLt20: maxCopy < 20, bundleLt50: true };
    const armB = armB_.slopeGt0 && armB_.top1Lt35 && armB_.copyLt20 && armB_.bundleLt50;
    const gates = {
      age: age < 90, mcapLow: mcap > 3500, mcapHigh: mcap < 12000, rating: true,
      concArm: armA || armB,
      flapArm: mcap < 4500 || (routerPct != null && routerPct >= 30),
      perWallet: avgPerWallet < 4,
      famous15: famous == null || famous < 15,
      buyVol: cumBuy >= 1.25, holders10: holders >= 10,
      sybil: sybilPct == null || sybilPct < 35,
    };
    const allOk = Object.values(gates).every(Boolean);
    events.push({ t: fmt(t), age: +age.toFixed(1), mcap: Math.round(mcap), cumBuy: +cumBuy.toFixed(2), holders, routerPct: routerPct == null ? null : +routerPct.toFixed(0), avgPerWallet: +avgPerWallet.toFixed(2), top1: +top1CircPct.toFixed(1), top1W: top1W.slice(0, 10), maxCopy: +maxCopy.toFixed(1), famous: famous == null ? null : +famous.toFixed(1), sybilPct: sybilPct == null ? null : +sybilPct.toFixed(1), allOk });
  }

  // 打印:全部通过的前几条 + 首条失败原因分布
  const passes = events.filter(e => e.allOk);
  console.log('=== 评级就绪后窗口内 tick 数:', events.length, '| 全门通过 tick 数:', passes.length);
  if (passes.length) console.log('首条全过:', JSON.stringify(passes[0]));

  // 每道门在窗口内多少 tick 失败
  const failCount = {};
  for (const e of events) {
    if (e.allOk) continue;
    const g = { ...e }; delete g.allOk;
    // 重算门
  }
  // 重新门统计
  const gateStats = {};
  events.forEach((e, i) => {
    const t = Date.parse('2026-10-21T16:' + e.t + 'Z');
    const gates2 = {};
    gateStats.__n = (gateStats.__n || 0) + 1;
  });
  // 简化:直接打最后几条事件看哪个门挂
  for (const e of events.slice(0, 3).concat(events.slice(-3))) console.log(JSON.stringify(e));
  // top1 最终值
  console.log('\n终态 top1 持仓%:', events.length ? events[events.length - 1].top1 : '-', 'wallet:', events.length ? events[events.length - 1].top1W : '-');
  await dbManager.close?.();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
