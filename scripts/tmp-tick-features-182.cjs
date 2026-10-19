#!/usr/bin/env node
/**
 * 182 专用 v2：v22/v23/v24 成交票买入后多维度特征重建（2026-10-19 持有者门/交易额因子区分力分析）
 *
 * 同一批 wss_price_ticks 全量行，一次遍历同时重放：
 *   - holders 曲线（holder-series 五要素口径，剔尘 wallet COALESCE）
 *   - 买入后各时间窗（30/60/120/300s）与 [t0→卖出]/[t0→全史] 的：
 *     累计买额/卖额/净流入 BNB、tick 笔数、独立交易者数、holders 值
 *   - 价格路径：买入价、买入后峰值价、最大收益率、卖出/终值价
 * 只在 182 跑（红线 9）。输入输出与 v1 同目录。
 */
'use strict';

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const IN_FILE = path.join(__dirname, 'tmp-tokens-for-182.json');
const OUT_FILE = path.join(__dirname, 'tmp-tick-features-result.json');

const MIN_TICK_BNB = 0.001; // collector 尘 tick 阈值（holder-series 同款）
const WINDOWS = [30, 60, 120, 300]; // 秒

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

function replay(rows, t0, tEnd) {
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

  // holders 曲线 + 各维度单遍重放
  const net = new Map();
  let holders = 0;
  const feat = {
    priceAtBuy: null, peakPriceAfterBuy: -Infinity, maxReturnPct: null, priceAtEnd: null,
    peakAfterBuy: -1, holdersAtBuy: null, finalHolders: 0,
    win: {}, // 各时间窗
    toSell: null, toInf: null,
  };
  const winState = WINDOWS.map(() => ({ bnbBuy: 0, bnbSell: 0, ticks: 0, holdersSnap: null, priceSnap: null }));
  const sellState = { bnbBuy: 0, bnbSell: 0, ticks: 0, traders: new Set() };
  const infState = { bnbBuy: 0, bnbSell: 0, ticks: 0, traders: new Set() };
  const preState = { bnbBuy: 0, bnbSell: 0, ticks: 0, traders: new Set() };
  const holdersAtBuyTs = [];
  const afterPts = [];

  for (const u of usable) {
    const delta = u.isBuy ? u.tokenAmount : -u.tokenAmount;
    const prev = net.get(u.wallet) || 0;
    const cur = prev + delta;
    net.set(u.wallet, cur);
    if (prev <= 0 && cur > 0) holders++;
    else if (prev > 0 && cur <= 0) holders--;

    const afterBuy = u.t >= t0;
    if (!afterBuy) {
      holdersAtBuyTs.push(holders);
      if (u.price != null) feat.priceAtBuy = u.price;
      preState.bnbBuy += u.isBuy ? u.bnb : 0; preState.bnbSell += u.isBuy ? 0 : u.bnb; preState.ticks++; preState.traders.add(u.wallet);
      continue;
    }

    afterPts.push(holders);
    if (u.price != null) { feat.priceAtEnd = u.price; if (u.price > feat.peakPriceAfterBuy) feat.peakPriceAfterBuy = u.price; }
    for (let w = 0; w < WINDOWS.length; w++) {
      if (u.t <= t0 + WINDOWS[w] * 1000) { const s = winState[w]; s.bnbBuy += u.isBuy ? u.bnb : 0; s.bnbSell += u.isBuy ? 0 : u.bnb; s.ticks++; s.holdersSnap = holders; if (u.price != null) s.priceSnap = u.price; }
    }
    for (const [st, hi] of [[infState, Infinity], [sellState, tEnd]]) {
      if (hi === Infinity || u.t <= hi) {
        st.bnbBuy += u.isBuy ? u.bnb : 0; st.bnbSell += u.isBuy ? 0 : u.bnb; st.ticks++; st.traders.add(u.wallet);
      }
    }
  }
  // 重算 t0 时刻 holders 快照（≤t0 最后一个 tick 后的值）—— holdersAtBuyTs 记的是严格 <t0 前最后值
  feat.holdersAtBuy = holdersAtBuyTs.length ? holdersAtBuyTs[holdersAtBuyTs.length - 1] : 0;
  feat.peakAfterBuy = afterPts.length ? Math.max(...afterPts) : feat.holdersAtBuy;
  feat.finalHolders = holders;
  if (feat.priceAtBuy != null && feat.peakPriceAfterBuy > -Infinity) {
    feat.maxReturnPct = (feat.peakPriceAfterBuy / feat.priceAtBuy - 1) * 100;
  }
  feat.win = WINDOWS.reduce((m, w, i) => { const s = winState[i]; m['w' + w + 's'] = { bnbBuy: +s.bnbBuy.toFixed(4), bnbSell: +s.bnbSell.toFixed(4), ticks: s.ticks, holders: s.holdersSnap, price: s.priceSnap, retPct: (s.priceSnap != null && feat.priceAtBuy != null) ? +((s.priceSnap / feat.priceAtBuy - 1) * 100).toFixed(2) : null }; return m; }, {});
  feat.toSell = tEnd != null ? { bnbBuy: +sellState.bnbBuy.toFixed(4), bnbSell: +sellState.bnbSell.toFixed(4), ticks: sellState.ticks, traders: sellState.traders.size } : null;
  feat.toInf = { bnbBuy: +infState.bnbBuy.toFixed(4), bnbSell: +infState.bnbSell.toFixed(4), ticks: infState.ticks, traders: infState.traders.size };
  feat.preBuy = { bnbBuy: +preState.bnbBuy.toFixed(4), bnbSell: +preState.bnbSell.toFixed(4), ticks: preState.ticks, traders: preState.traders.size };
  feat.lifeBuy = { bnbBuy: +(preState.bnbBuy + infState.bnbBuy).toFixed(4), bnbSell: +(preState.bnbSell + infState.bnbSell).toFixed(4) };
  return feat;
}

async function main() {
  const db = dbManager.getClient();
  const tokens = JSON.parse(fs.readFileSync(IN_FILE, 'utf8'));
  const results = [];
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    try {
      const rows = await fetchAllTicks(db, tk.addr);
      results.push({ ...tk, totalRows: rows.length, feat: replay(rows, tk.buyAt, tk.lastSellAt) });
    } catch (e) {
      results.push({ ...tk, error: e.message });
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
