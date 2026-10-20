#!/usr/bin/env node
/**
 * 182 专用：「最大单块买入流通占比」门回放（v26 111 票 + 乌龟）
 *
 * 因子口径 = FA maxBlockBuyCircPct：10s 窗内单 block 买入 token 累计最大值 ÷ 该 tick 时刻
 * 流通（Σ买−Σ卖 token，剔尘 >=0.001 BNB）×100。
 *
 * 每票输出：
 *   snap：原 fire 时刻（buyAt 前最后一 tick）的 cumBuy/holders/maxBlockShare + 该 block 明细
 *   gate[X]：buyAt 之后首个「cumBuy>=1.25 ∧ holders>=10 ∧ maxBlockShare<X ∧ age<90s」tick
 *            （= v26 人气门 + 新门同时为真的最早入场点；无 → 判 blocked）
 *   pEntryOld/pExit/peakAfter：原入场价 / 原卖出时刻价 / fire 后峰值
 * 汇总（脚本内打印）：各 X 的 blocked 数、延迟入场后的近似净额（net × pEntryOld/pEntryNew）。
 */
'use strict';
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const IN_FILE = path.join(__dirname, 'tmp-tokens-for-182.json');
const OUT_FILE = path.join(__dirname, 'tmp-blockbuy-sim-result.json');
const MIN_TICK_BNB = 0.001;
const WIN_MS = 10000;          // bundleWinMs
const XS = [10, 15, 20, 25, 30, 35, 40, 50, 60];
const EXTRA = [{ tag: 'wugui', addr: '0xb2782a4a27b1fc104c377a06e3cf455ca0fe7777', sym: '乌龟', net: -0.001774, buyBnb: 0.004, buyAt: 1792426501287, lastSellAt: 1792427202192 }];

async function fetchAllTicks(db, tokenAddress) {
  const rows = [];
  let offset = 0;
  while (true) {
    const { data, error } = await db.from('wss_price_ticks')
      .select('block_time, block_number, log_index, trade_type, token_amount, bnb_amount, price_bnb, sender_address, trader_address')
      .eq('token_address', tokenAddress)
      .order('block_time', { ascending: true })
      .order('id', { ascending: true })
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
  let snap = null, pEntryOld = null, pExit = null, peakAfter = null;
  const blockAgg = new Map();     // blk → { t, b, bnb, n }
  const gate = {};                // X → { t, price, ageSec } | null
  for (const X of XS) gate[X] = null;

  const windowMax = (now) => {
    let best = 0, bestBlk = null, bestB = 0;
    for (const [blk, a] of blockAgg) {
      if (a.t < now - WIN_MS) continue;
      if (a.b > best) { best = a.b; bestBlk = blk; bestB = a.b; }
    }
    return { maxB: best, blk: bestBlk, bnb: bestBlk != null ? (blockAgg.get(bestBlk)?.bnb || 0) : 0, n: bestBlk != null ? (blockAgg.get(bestBlk)?.n || 0) : 0 };
  };

  for (const u of usable) {
    // 先按 tick 前状态快照（fire 时刻口径 = 该 tick 之前已累积）
    if (snap === null && u.t > t0) snap = snapshot(u.t);
    // 更新状态
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
    }
    if (u.price != null) lastPrice = u.price;
    if (u.t <= t0 && u.price != null) pEntryOld = u.price;
    if (tEnd != null && u.t <= tEnd && u.price != null) pExit = u.price;
    if (u.t >= t0 && u.price != null && (peakAfter === null || u.price > peakAfter)) peakAfter = u.price;
    // 门评估（buyAt 之后）
    if (u.t >= t0 && firstT != null) {
      const ageSec = (u.t - firstT) / 1000;
      if (ageSec < 90 && cumBuy >= 1.25 && holders >= 10 && circ > 0) {
        const wm = windowMax(u.t);
        const share = wm.maxB / circ * 100;
        for (const X of XS) {
          if (gate[X] === null && share < X) gate[X] = { t: u.t, price: u.price != null ? u.price : lastPrice, ageSec: +ageSec.toFixed(1), share: +share.toFixed(1) };
        }
      }
    }
  }
  if (snap === null) snap = snapshot(Infinity);
  function snapshot(now) {
    const wm = windowMax(now);
    return { cumBuy: +cumBuy.toFixed(3), holders, circ: +circ.toFixed(0), maxShare: circ > 0 ? +(wm.maxB / circ * 100).toFixed(1) : 0, blk: wm.blk, blockTokens: wm.maxB, blockBnb: +wm.bnb.toFixed(3), blockWallets: wm.n };
  }
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
      const gates = {};
      for (const X of XS) {
        const g = s.gate[X];
        gates[X] = g ? { ...g, ratioVsOld: (s.pEntryOld != null && g.price != null) ? +(g.price / s.pEntryOld).toFixed(3) : null } : null;
      }
      results.push({ tag: tk.tag, addr: tk.addr, sym: tk.sym, net: tk.net, buyBnb: tk.buyBnb, buyAt: tk.buyAt, lastSellAt: tk.lastSellAt, ...s, gate: gates });
    } catch (e) {
      results.push({ tag: tk.tag, addr: tk.addr, sym: tk.sym, net: tk.net, buyBnb: tk.buyBnb, error: e.message });
    }
    if ((i + 1) % 10 === 0 || i === tokens.length - 1) {
      console.log(`[${i + 1}/${tokens.length}] done`);
      fs.writeFileSync(OUT_FILE, JSON.stringify(results));
    }
  }
  fs.writeFileSync(OUT_FILE, JSON.stringify(results));
  // 汇总
  console.log('\n=== 各阈值汇总（近似 net_new = net × pEntryOld/pEntryNew；ratioVsOld>1=入场价更高）===');
  const baseSum = results.filter(r => !r.error).reduce((a, r) => a + (r.net || 0), 0);
  console.log(`原始合计 net = ${baseSum.toFixed(4)} BNB（n=${results.filter(r => !r.error).length}）`);
  for (const X of XS) {
    let sum = 0, delayed = 0, blocked = 0, blockedNet = 0, sumRatio = 0, nRatio = 0;
    const blockedList = [];
    for (const r of results) {
      if (r.error) continue;
      const g = r.gate?.[X];
      if (!g) { blocked++; blockedNet += r.net || 0; blockedList.push(`${r.sym || ''}(${(r.net || 0).toFixed(4)})`); continue; }
      if (g.t > r.buyAt + 1000) delayed++;
      const ratio = g.ratioVsOld || 1;
      sum += (r.net || 0) * (1 / ratio);   // 入场价越高，同样 exit 下收益越差
      sumRatio += ratio; nRatio++;
    }
    console.log(`X=${String(X).padStart(2)}  blocked=${blocked} (被拦 net=${blockedNet.toFixed(4)})  delayed=${delayed}  合计≈${sum.toFixed(4)}  平均入场价倍率=${(sumRatio / Math.max(1, nRatio)).toFixed(3)}`);
    if (blocked && blockedList.length <= 25) console.log('   被拦票:', blockedList.join(' '));
  }
  console.log('DONE ->', OUT_FILE);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
