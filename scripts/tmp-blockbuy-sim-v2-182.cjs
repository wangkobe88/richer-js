#!/usr/bin/env node
/**
 * 182 专用 v2：「出生锚定最大单块买入流通占比」门回放
 *
 * 与 v1 差异：
 *   ① 新增 launchMaxBlockBuyCircPct = max(全史单 block 买入 token 累计) / 当前流通 ×100
 *      （滚动 10s 版 maxBlockBuyCircPct 在乌龟上 1s 后就滑出窗——模拟里 X<30 门只延迟 1s；
 *        出生锚定版不会滑出，真正卡「出生期有过大单块」）
 *   ② X=1e6 作为 v26 基线（无新门）
 *   ③ 汇总用正确口径 net_new = buyBnb × (rOld × pEntryOld/pEntryNew − 1)，blocked 计 0
 */
'use strict';
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const IN_FILE = path.join(__dirname, 'tmp-tokens-for-182.json');
const OUT_FILE = path.join(__dirname, 'tmp-blockbuy-sim-v2-result.json');
const MIN_TICK_BNB = 0.001;
const WIN_MS = 10000;
const XS = [10, 15, 20, 25, 30, 35, 40, 50, 60, 1e6];
const EXTRA = [{ tag: 'wugui', addr: '0xb2782a4a27b1fc104c377a06e3cf455ca0fe7777', sym: '乌龟', net: -0.001774, buyBnb: 0.004, buyAt: 1792426501287, lastSellAt: 1792427202192 }];

async function fetchAllTicks(db, tokenAddress) {
  const rows = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await db.from('wss_price_ticks')
      .select('block_time, block_number, log_index, trade_type, token_amount, bnb_amount, price_bnb, sender_address, trader_address')
      .eq('token_address', tokenAddress)
      .order('block_time', { ascending: true }).order('id', { ascending: true })
      .range(offset, offset + 999);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    offset += page.length;
    if (page.length < 1000 || rows.length > 300000) break;
  }
  return rows;
}

function simulate(rows, t0, tEnd) {
  const usable = [];
  for (const row of rows) {
    if (!((Number(row.bnb_amount) || 0) >= MIN_TICK_BNB)) continue;
    const wallet = (row.sender_address || row.trader_address || '').toLowerCase();
    if (!wallet) continue;
    const tokenAmount = Number(row.token_amount) || 0;
    if (!(tokenAmount > 0)) continue;
    const t = new Date(row.block_time).getTime();
    if (!Number.isFinite(t)) continue;
    usable.push({ t, isBuy: row.trade_type === 'buy', tokenAmount, bnb: Number(row.bnb_amount) || 0, price: row.price_bnb != null ? Number(row.price_bnb) : null, wallet, blk: Number(row.block_number) || -1, li: Number(row.log_index) || -1 });
  }
  usable.sort((a, b) => (a.blk - b.blk) || (a.li - b.li));
  const firstT = usable.length ? usable[0].t : null;
  const net = new Map();
  let holders = 0, cumBuy = 0, circ = 0, lastPrice = null;
  let launchMaxTok = 0, launchMaxBlk = null, launchMaxBnb = 0, launchMaxWallets = 0;
  let snap = null, pEntryOld = null, pExit = null, peakAfter = null;
  const blockAgg = new Map();
  const blockWallets = new Map();
  const gate = {}; for (const X of XS) gate[X] = null;

  const windowMax = (now) => {
    let best = 0, bestBlk = null, bestB = 0;
    for (const [blk, a] of blockAgg) { if (a.t < now - WIN_MS) continue; if (a.b > best) { best = a.b; bestBlk = blk; bestB = a.b; } }
    return { maxB: best, blk: bestBlk, bnb: bestBlk != null ? (blockAgg.get(bestBlk)?.bnb || 0) : 0, n: bestBlk != null ? (blockAgg.get(bestBlk)?.n || 0) : 0 };
  };
  const snapshot = (now) => {
    const wm = windowMax(now);
    return {
      cumBuy: +cumBuy.toFixed(3), holders, circ: +circ.toFixed(0),
      rollShare: circ > 0 ? +(wm.maxB / circ * 100).toFixed(1) : 0, rollBlk: wm.blk, rollTokens: wm.maxB, rollBnb: +wm.bnb.toFixed(3), rollWallets: wm.n,
      launchShare: circ > 0 ? +(launchMaxTok / circ * 100).toFixed(1) : 0, launchBlk: launchMaxBlk, launchTokens: launchMaxTok, launchBnb: +launchMaxBnb.toFixed(3), launchWallets: launchMaxWallets,
    };
  };

  for (const u of usable) {
    if (snap === null && u.t > t0) snap = snapshot(u.t);
    const delta = u.isBuy ? u.tokenAmount : -u.tokenAmount;
    const prev = net.get(u.wallet) || 0;
    const cur = prev + delta;
    net.set(u.wallet, cur);
    if (prev <= 0 && cur > 0) holders++;
    else if (prev > 0 && cur <= 0) holders--;
    circ += delta;
    if (u.isBuy) {
      cumBuy += u.bnb;
      const a = blockAgg.get(u.blk);
      if (a) { a.b += u.tokenAmount; a.bnb += u.bnb; a.n++; }
      else blockAgg.set(u.blk, { t: u.t, b: u.tokenAmount, bnb: u.bnb, n: 1 });
      const curBlock = blockAgg.get(u.blk);
      if (curBlock.b > launchMaxTok) { launchMaxTok = curBlock.b; launchMaxBlk = u.blk; launchMaxBnb = curBlock.bnb; launchMaxWallets = curBlock.n; }
      else if (launchMaxBlk === u.blk) { launchMaxBnb = curBlock.bnb; launchMaxWallets = curBlock.n; }
    }
    if (u.price != null) lastPrice = u.price;
    if (u.t <= t0 && u.price != null) pEntryOld = u.price;
    if (tEnd != null && u.t <= tEnd && u.price != null) pExit = u.price;
    if (u.t >= t0 && u.price != null && (peakAfter === null || u.price > peakAfter)) peakAfter = u.price;
    if (u.t >= t0 && firstT != null) {
      const ageSec = (u.t - firstT) / 1000;
      if (ageSec < 90 && cumBuy >= 1.25 && holders >= 10 && circ > 0) {
        const launchShare = launchMaxTok / circ * 100;
        for (const X of XS) if (gate[X] === null && launchShare < X) gate[X] = { t: u.t, price: u.price != null ? u.price : lastPrice, ageSec: +ageSec.toFixed(1), launchShare: +launchShare.toFixed(1), ratioVsOld: (pEntryOld != null && u.price != null) ? +(u.price / pEntryOld).toFixed(3) : null };
      }
    }
  }
  if (snap === null) snap = snapshot(Infinity);
  return { snap, gate, pEntryOld, pExit, peakAfter, firstT };
}

(async () => {
  const db = dbManager.getClient();
  const tokens = [...JSON.parse(fs.readFileSync(IN_FILE, 'utf8')), ...EXTRA];
  const results = [];
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    try {
      const rows = await fetchAllTicks(db, tk.addr);
      const s = simulate(rows, tk.buyAt, tk.lastSellAt);
      results.push({ tag: tk.tag, addr: tk.addr, sym: tk.sym, net: tk.net, buyBnb: tk.buyBnb, buyAt: tk.buyAt, lastSellAt: tk.lastSellAt, ...s });
    } catch (e) {
      results.push({ tag: tk.tag, addr: tk.addr, sym: tk.sym, net: tk.net, buyBnb: tk.buyBnb, error: e.message });
    }
    if ((i + 1) % 10 === 0 || i === tokens.length - 1) fs.writeFileSync(OUT_FILE, JSON.stringify(results));
  }
  fs.writeFileSync(OUT_FILE, JSON.stringify(results));
  const ok = results.filter(r => !r.error);
  console.log('\n=== 出生锚定最大单块买入/流通 门回放（n=' + ok.length + '）===');
  const base = ok.filter(r => r.gate[1e6]);
  const pnlOf = (r, g) => {
    const stake = r.buyBnb || 0.004;
    if (!g || r.pEntryOld == null || r.pExit == null) return 0;
    const rOld = 1 + (r.net || 0) / stake;
    const pNew = g.price != null ? g.price : r.pEntryOld;
    return stake * (rOld * r.pEntryOld / pNew - 1);
  };
  const baseSum = base.reduce((a, r) => a + pnlOf(r, r.gate[1e6]), 0);
  console.log(`基线（v26 门，无新门）: pass=${base.length} 合计≈${baseSum.toFixed(4)} BNB`);
  for (const X of XS.slice(0, -1)) {
    let sum = 0, pass = 0, blocked = [], delayed = 0, sumRatio = 0, nr = 0;
    for (const r of ok) {
      const g = r.gate[X];
      if (!g) { if (r.gate[1e6]) blocked.push(r); continue; }
      pass++; sum += pnlOf(r, g);
      if (g.t > r.buyAt + 1000) delayed++;
      if (g.ratioVsOld) { sumRatio += g.ratioVsOld; nr++; }
    }
    const blockedNet = blocked.reduce((a, r) => a + (r.net || 0), 0);
    console.log(`X=${String(X).padStart(2)}  pass=${pass} 追加拦截=${blocked.length}(原 net ${blockedNet.toFixed(4)})  delayed=${delayed}  合计≈${sum.toFixed(4)}  平均入场倍率=${(sumRatio / Math.max(1, nr)).toFixed(3)}`);
    if (blocked.length) console.log('   追加拦截票:', blocked.map(r => `${r.sym}(${(r.net || 0).toFixed(4)},${r.snap?.launchShare}%)`).join(' '));
  }
  console.log('DONE ->', OUT_FILE);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
