#!/usr/bin/env node
/**
 * 182 专用 v4b：「等冲破」门模拟（2026-10-19 buyVolumeBnb/holders/netBuy 冲破门分析）
 *
 * 用户语义纠正：门不是 fire 时刻静态快照，而是 per-tick 持续评估——
 * 好票持续有人买会自然冲破门（在冲破 tick 入场），烂票终态到不了 = 不买。
 *
 * 对每票重放剔尘 ticks，记录（首破 tick 的 t/price/ageSec/ratio）：
 *   - cumBuyBnb  首破 X ∈ {0.5,1,1.2,1.5,1.8,2,2.5,3}
 *   - holders    首破 H ∈ {3,4,5,6,8,10,12,15,20,25}
 *   - cumNetBnb(买-卖累计) 首破 N ∈ {0.5,1,1.5,2}（对倒票买卖同量净额不涨——盲区解法候选）
 *   - pFire（t0 前 last tick 价）、pExit（原卖出时刻价）、lastPrice、peak 价
 * 模拟汇总在本地做（join v3 结果）。只在 182 跑（红线 9）。
 */
'use strict';

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const IN_FILE = path.join(__dirname, 'tmp-tokens-for-182.json');
const OUT_FILE = path.join(__dirname, 'tmp-cross-sim-result.json');

const MIN_TICK_BNB = 0.001;
const XS = [0.5, 1, 1.2, 1.5, 1.8, 2, 2.5, 3];
const HS = [3, 4, 5, 6, 8, 10, 12, 15, 20, 25];
const NS = [0.5, 1, 1.5, 2];

async function fetchAllTicks(db, tokenAddress) {
  const PAGE = 5000;
  const MAX_ROWS = 500000;
  const rows = [];
  let offset = 0;
  while (true) {
    const { data, error, count } = await db
      .from('wss_price_ticks')
      .select('block_time, block_number, log_index, trade_type, token_amount, bnb_amount, price_bnb, sender_address, trader_address', { count: 'exact' })
      .eq('token_address', tokenAddress)
      .order('block_time', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    offset += page.length;
    const total = Number.isFinite(count) ? count : null;
    if (!page.length || (total !== null && rows.length >= total)) break;
    if (rows.length > MAX_ROWS) throw new Error(`rows > ${MAX_ROWS} guard: ${tokenAddress}`);
  }
  return rows;
}

function crossings(rows, t0, tEnd) {
  const usable = [];
  for (const row of rows || []) {
    if (!((Number(row.bnb_amount) || 0) >= MIN_TICK_BNB)) continue; // 剔尘
    const wallet = row.sender_address || row.trader_address || null;
    if (!wallet) continue;
    const tokenAmount = Number(row.token_amount) || 0;
    if (!(tokenAmount > 0)) continue;
    const t = new Date(row.block_time).getTime();
    if (!Number.isFinite(t)) continue;
    usable.push({ t, isBuy: row.trade_type === 'buy', tokenAmount, bnb: Number(row.bnb_amount) || 0, price: row.price_bnb != null ? Number(row.price_bnb) : null, wallet, blockNumber: Number(row.block_number) || -1, logIndex: Number(row.log_index) || -1 });
  }
  usable.sort((a, b) => (a.blockNumber - b.blockNumber) || (a.logIndex - b.logIndex));

  const net = new Map();
  let holders = 0, cumBuy = 0, cumNet = 0, lastPrice = null, pFire = null, pExit = null, peakAfter = -Infinity;
  const crossBuy = {}, crossHold = {}, crossNet = {};
  const firstT = usable.length ? usable[0].t : null;
  const mark = (store, key, u) => {
    store[key] = { t: u.t, price: u.price != null ? u.price : lastPrice, ageSec: firstT != null ? +((u.t - firstT) / 1000).toFixed(1) : null };
  };
  for (const u of usable) {
    const delta = u.isBuy ? u.tokenAmount : -u.tokenAmount;
    const prev = net.get(u.wallet) || 0;
    const cur = prev + delta;
    net.set(u.wallet, cur);
    if (prev <= 0 && cur > 0) holders++;
    else if (prev > 0 && cur <= 0) holders--;

    cumNet += u.isBuy ? u.bnb : -u.bnb;
    if (u.isBuy) {
      cumBuy += u.bnb;
      for (const X of XS) if (!crossBuy[X] && cumBuy >= X) mark(crossBuy, X, u);
    }
    for (const N of NS) if (!crossNet[N] && cumNet >= N) mark(crossNet, N, u);
    for (const H of HS) if (!crossHold[H] && holders >= H) mark(crossHold, H, u);

    if (u.price != null) lastPrice = u.price;
    if (u.t <= t0 && u.price != null) pFire = u.price;
    if (tEnd != null && u.t <= tEnd && u.price != null) pExit = u.price;
    if (u.t >= t0 && u.price != null && u.price > peakAfter) peakAfter = u.price;
  }
  return { crossBuy, crossHold, crossNet, pFire, pExit, lastPrice, peakAfter: peakAfter > -Infinity ? peakAfter : null, firstT };
}

async function main() {
  const db = dbManager.getClient();
  const tokens = JSON.parse(fs.readFileSync(IN_FILE, 'utf8'));
  const results = [];
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    try {
      const rows = await fetchAllTicks(db, tk.addr);
      const c = crossings(rows, tk.buyAt, tk.lastSellAt);
      for (const store of [c.crossBuy, c.crossHold, c.crossNet]) {
        for (const k of Object.keys(store)) {
          if (store[k].price != null && c.pFire != null) store[k].ratio = +(store[k].price / c.pFire).toFixed(4);
        }
      }
      results.push({ tag: tk.tag, addr: tk.addr, sym: tk.sym, net: tk.net, buyBnb: tk.buyBnb, buyAt: tk.buyAt, lastSellAt: tk.lastSellAt, ...c });
    } catch (e) {
      results.push({ tag: tk.tag, addr: tk.addr, sym: tk.sym, net: tk.net, error: e.message });
    }
    if ((i + 1) % 10 === 0 || i === tokens.length - 1) {
      console.log(`[${i + 1}/${tokens.length}] done`);
      fs.writeFileSync(OUT_FILE, JSON.stringify(results));
    }
  }
  fs.writeFileSync(OUT_FILE, JSON.stringify(results));
  console.log('ALL DONE:', results.length, '->', OUT_FILE);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
