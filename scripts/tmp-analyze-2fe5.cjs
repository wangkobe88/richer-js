#!/usr/bin/env node
/** 0x2fe5…7777 前期参与者真实性审查（182 跑）：单 token 全 ticks keyset 分页 + 簇/指纹分析 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const TOKEN = '0x2fe5328cf2ea8cd632161564464c1e6c2e347777';
const GMGN = '0x1de460f3'; // GMGN BSC 聚合路由前缀（trader 层判据）

function loadRoster(rel) {
  try { return require(path.join(__dirname, '../config/rosters', rel)); } catch { return null; }
}
function collectWallets(obj, out = new Set()) {
  if (Array.isArray(obj)) {
    for (const v of obj) {
      if (typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)) out.add(v.toLowerCase());
      else collectWallets(v, out);
    }
  } else if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj)) collectWallets(v, out);
  }
  return out;
}

async function fetchAllTicks(db) {
  const rows = [];
  let cursor = 0;
  for (;;) {
    const { data, error } = await db.from('wss_price_ticks')
      .select('id, block_time, block_number, log_index, price_usd, bnb_amount, token_amount, sender_address, trader_address, trade_type, price_outlier, quote_token, experiment_id')
      .eq('token_address', TOKEN)
      .gt('id', cursor)
      .order('id', { ascending: true })
      .limit(1000);
    if (error) throw error;
    if (!data || !data.length) break;
    rows.push(...data);
    cursor = data[data.length - 1].id;
    if (data.length < 1000) break;
  }
  return rows;
}

async function main() {
  const db = dbManager.getClient();
  const sybSet = collectWallets(loadRoster('sybil-clusters.json'));
  const rosterSet = collectWallets(loadRoster('copy-wallet-roster.json'));
  const famousSet = collectWallets(loadRoster('famous-copy-wallets.json'));
  console.log(`rosters: sybil=${sybSet.size} copy=${rosterSet.size} famous=${famousSet.size}`);

  // ── 1. 事件：创建/毕业/quote_set ──
  const { data: evs } = await db.from('wss_events')
    .select('kind, block_time, block_number, payload')
    .eq('token_address', TOKEN)
    .order('block_time', { ascending: true });
  console.log('\n=== wss_events ===');
  for (const e of evs || []) {
    const p = e.payload || {};
    console.log(e.kind, 'blk=' + e.block_number, e.block_time,
      JSON.stringify({ name: p.name, symbol: p.symbol, creator: p.creator || p.token_creator, quote: p.quote_token || p.quote, note: p.note }).slice(0, 400));
  }

  // ── 2. 归属实验（谁监控/交易过它）──
  const { data: et } = await db.from('experiment_tokens')
    .select('experiment_id, first_seen_at, status')
    .eq('token_address', TOKEN).limit(10);
  console.log('\n=== experiment_tokens ===');
  for (const r of et || []) console.log(JSON.stringify(r));

  // ── 3. 全量 ticks ──
  const ticks = await fetchAllTicks(db);
  ticks.sort((a, b) => (a.block_number || 9e15) - (b.block_number || 9e15) || (a.log_index || 0) - (b.log_index || 0));
  console.log(`\nticks=${ticks.length}  span=${ticks[0]?.block_time} → ${ticks[ticks.length - 1]?.block_time}`);
  if (!ticks.length) { await dbManager.close?.(); process.exit(0); }

  const t0 = new Date(ticks[0].block_time).getTime();
  const off = (t) => +(((new Date(t.block_time).getTime()) - t0) / 1000).toFixed(1);

  // ── 4. 价格轨迹（60s 采样 + 峰值）──
  let peak = 0, peakAt = 0;
  for (const t of ticks) {
    const p = Number(t.price_usd) || 0;
    if (p > peak && !t.price_outlier) { peak = p; peakAt = off(t); }
  }
  console.log(`price: first=${ticks[0].price_usd} peak=${peak.toExponential(4)}@+${peakAt}s last=${ticks[ticks.length - 1].price_usd}`);
  const sample = [];
  let lastS = -1;
  for (const t of ticks) {
    const s = Math.floor(off(t) / 60);
    if (s > lastS) { lastS = s; sample.push(`+${s}m:${(Number(t.price_usd) || 0).toExponential(2)}`); }
  }
  console.log('price/60s:', sample.join(' '));

  // ── 5. 钱包聚合（wallet = sender||trader，GMGN 行归 sender EOA）──
  const wallets = new Map(); // w -> {buyBnb,sellBnb,buyRows,sellRows,firstT,lastT,firstBuyT,lastSellT,blocks:Set,firstBuyBnb,traderSet:Set}
  const gmgnBuyBnb = { v: 0 };
  let totBuy = 0, totSell = 0, dust = 0;
  for (const t of ticks) {
    const w = (t.sender_address || t.trader_address || '(null)').toLowerCase();
    const bnb = Number(t.bnb_amount) || 0;
    if (bnb < 1e-8) dust++;
    const e = wallets.get(w) || { buyBnb: 0, sellBnb: 0, buyRows: 0, sellRows: 0, firstT: off(t), lastT: off(t), firstBuyT: null, lastSellT: null, blocks: new Set(), firstBuyBnb: 0, traders: new Set() };
    e.lastT = off(t);
    if (t.trader_address) e.traders.add(t.trader_address.toLowerCase().slice(0, 10));
    if (t.block_number) e.blocks.add(t.block_number);
    if (t.trade_type === 'buy') {
      e.buyBnb += bnb; e.buyRows++;
      if (e.firstBuyT === null) { e.firstBuyT = off(t); e.firstBuyBnb = bnb; }
      totBuy += bnb;
      if ((t.trader_address || '').toLowerCase().startsWith(GMGN)) gmgnBuyBnb.v += bnb;
    } else {
      e.sellBnb += bnb; e.sellRows++;
      e.lastSellT = off(t);
      totSell += bnb;
    }
    wallets.set(w, e);
  }
  console.log(`\ntotBuy=${totBuy.toFixed(4)} totSell=${totSell.toFixed(4)} wallets=${wallets.size} dustRows=${dust} gmgnBuy=${gmgnBuyBnb.v.toFixed(4)} (${(gmgnBuyBnb.v / totBuy * 100).toFixed(1)}% of buy)`);

  // ── 6. 早期窗（+90s / +300s）参与者表 ──
  for (const W of [90, 300, 3600]) {
    const early = [...wallets.entries()].filter(([, e]) => e.firstT <= W);
    const eb = early.reduce((s, [, e]) => s + e.buyBnb, 0);
    console.log(`\n── 早期窗 +${W}s：${early.length} 钱包，买入 ${eb.toFixed(4)} BNB (${(eb / totBuy * 100).toFixed(1)}% of 总买) ──`);
  }
  const early90 = [...wallets.entries()].filter(([, e]) => e.firstT <= 90)
    .sort((a, b) => b[1].buyBnb - a[1].buyBnb);
  console.log('\n-- +90s 参与者明细（按买入排序，截 25）--');
  console.log('wallet          | buy    sell   rows  firstT  firstBuy  lastSell | tag');
  for (const [w, e] of early90.slice(0, 25)) {
    const tags = [];
    if (sybSet.has(w)) tags.push('SYBIL');
    if (rosterSet.has(w)) tags.push('COPY');
    if (famousSet.has(w)) tags.push('FAMOUS');
    if (e.buyRows === 0 && e.sellRows > 0) tags.push('PURE_SELL(场外分发?)');
    const suffix = w.slice(-4);
    if (/^(7777|8888|6666|0000|9999)$/.test(suffix)) tags.push('VANITY:' + suffix);
    console.log(`${w.slice(0, 8)}…${suffix} | ${e.buyBnb.toFixed(3)} ${e.sellBnb.toFixed(3)} ${e.buyRows + e.sellRows}  t=${e.firstT}s  ${e.firstBuyBnb.toFixed(3)}  ${e.lastSellT === null ? '-' : e.lastSellT + 's'} | ${tags.join(',') || ''}`);
  }

  // ── 7. 簇检测 ──
  // 7a. 同块买入簇：block -> 首次出现在该块买入的不同钱包数
  const blkBuys = new Map();
  for (const t of ticks) {
    if (t.trade_type !== 'buy' || !t.block_number) continue;
    const w = (t.sender_address || t.trader_address || '(null)').toLowerCase();
    const m = blkBuys.get(t.block_number) || new Map();
    m.set(w, (m.get(w) || 0) + (Number(t.bnb_amount) || 0));
    blkBuys.set(t.block_number, m);
  }
  const multi = [...blkBuys.entries()].filter(([, m]) => m.size >= 3)
    .sort((a, b) => b[1].size - a[1].size).slice(0, 10);
  console.log('\n-- 同块多钱包买入块（≥3 钱包，bundle 嫌疑，截 10）--');
  for (const [blk, m] of multi) {
    const amounts = [...m.values()].map(v => v.toFixed(3));
    console.log(`blk ${blk}: ${m.size} 钱包 [${amounts.join(',')}]`);
  }

  // 7b. 等额首买簇：+90s 内首买金额聚类（±2%）
  const earlyFirstBuys = early90.filter(([, e]) => e.firstBuyT !== null && e.firstBuyBnb > 0)
    .map(([w, e]) => ({ w, amt: e.firstBuyBnb, t: e.firstBuyT }));
  earlyFirstBuys.sort((a, b) => a.amt - b.amt);
  const evenClusters = [];
  for (const fb of earlyFirstBuys) {
    const c = evenClusters.find(cl => Math.abs(fb.amt - cl.amt) / cl.amt <= 0.02);
    if (c) c.members.push(fb); else evenClusters.push({ amt: fb.amt, members: [fb] });
  }
  const evenMulti = evenClusters.filter(c => c.members.length >= 2).sort((a, b) => b.members.length - a.members.length);
  console.log(`\n-- 等额首买簇（+90s 内 ≥2 钱包首买金额差 ≤2%）: ${evenMulti.length} 簇 --`);
  for (const c of evenMulti.slice(0, 8)) {
    console.log(`~${c.amt.toFixed(4)} BNB × ${c.members.length}: ${c.members.map(m => `${m.w.slice(0, 8)}…${m.w.slice(-4)}@${m.t}s`).join(' ')}`);
  }

  // 7c. 同步卖：同块多钱包卖出
  const blkSells = new Map();
  for (const t of ticks) {
    if (t.trade_type === 'buy' || !t.block_number) continue;
    const w = (t.sender_address || t.trader_address || '(null)').toLowerCase();
    const m = blkSells.get(t.block_number) || new Set();
    m.add(w);
    blkSells.set(t.block_number, m);
  }
  const syncSells = [...blkSells.entries()].filter(([, s]) => s.size >= 3).sort((a, b) => b[1].size - a[1].size);
  console.log(`\n-- 同步卖（同块 ≥3 钱包卖出）: ${syncSells.length} 块 --`);
  for (const [blk, s] of syncSells.slice(0, 10)) console.log(`blk ${blk}: ${s.size} 钱包 同块卖出`);

  // 7d. 纯卖钱包（无买入有卖出 = 场外分发货指纹）
  const pureSellers = [...wallets.entries()].filter(([, e]) => e.buyRows === 0 && e.sellRows > 0);
  const pureSellBnb = pureSellers.reduce((s, [, e]) => s + e.sellBnb, 0);
  console.log(`\n-- 纯卖钱包（零买入纯卖出）: ${pureSellers.length} 个，合计卖 ${pureSellBnb.toFixed(4)} BNB --`);
  for (const [w, e] of pureSellers.sort((a, b) => b[1].sellBnb - a[1].sellBnb).slice(0, 10)) {
    console.log(`${w.slice(0, 8)}…${w.slice(-4)} sell=${e.sellBnb.toFixed(4)} first=${e.firstT}s rows=${e.sellRows}`);
  }

  // ── 8. 尾号 vanity 统计 ──
  const suffixCnt = new Map();
  for (const w of wallets.keys()) {
    const s4 = w.slice(-4);
    if (/^([0-9a-f])\1{3}$/.test(s4) || s4 === '0000') suffixCnt.set(s4, (suffixCnt.get(s4) || 0) + 1);
  }
  console.log('\n-- 参与钱包四同尾号统计（vanity 嫌疑）--');
  console.log([...suffixCnt.entries()].map(([k, v]) => `${k}×${v}`).join(' ') || '(无)');

  // ── 9. 集中度（全史 + 净持仓视角）──
  const byBuy = [...wallets.entries()].sort((a, b) => b[1].buyBnb - a[1].buyBnb);
  const top1 = byBuy[0]?.[1].buyBnb || 0, top2 = (byBuy[0]?.[1].buyBnb || 0) + (byBuy[1]?.[1].buyBnb || 0);
  console.log(`\ntop1 买入占比 ${(top1 / totBuy * 100).toFixed(1)}%，top2 ${(top2 / totBuy * 100).toFixed(1)}%`);
  console.log('-- 全史 top 12 买家 --');
  for (const [w, e] of byBuy.slice(0, 12)) {
    const net = e.buyBnb - e.sellBnb;
    console.log(`${w.slice(0, 8)}…${w.slice(-4)} buy=${e.buyBnb.toFixed(3)} sell=${e.sellBnb.toFixed(3)} net=${net.toFixed(3)} first=${e.firstT}s lastSell=${e.lastSellT === null ? '持有' : e.lastSellT + 's'} traders=[${[...e.traders].slice(0, 3).join(',')}]`);
  }

  // ── 10. 早期钱包画像（DB 画像库对拍）──
  const earlyAddrs = early90.map(([w]) => w).slice(0, 40);
  if (earlyAddrs.length) {
    const { data: prof } = await db.from('wallet_offline_profiles').select('*').in('address', earlyAddrs);
    console.log(`\n-- 早期钱包画像命中: ${(prof || []).length}/${earlyAddrs.length} --`);
    for (const p of (prof || []).slice(0, 15)) {
      const keys = ['address', 'token_count', 'first_seen', 'median_hold_seconds', 'bad_ratio', 'sniper', 'classification'];
      const out = {};
      for (const k of keys) if (p[k] !== undefined) out[k] = p[k];
      console.log(JSON.stringify(out).slice(0, 300));
    }
  }

  // ── 11. 首 30 tick 明细 ──
  console.log('\n-- 首 30 ticks（链上真序）--');
  ticks.slice(0, 30).forEach((t, i) => {
    console.log(i, `+${off(t)}s`, t.trade_type === 'buy' ? 'BUY ' : 'SELL', `blk=${t.block_number}`, `bnb=${(Number(t.bnb_amount) || 0).toFixed(4)}`, `p=${t.price_usd}`, `w=${(t.sender_address || 'null').slice(0, 10)}`, `tr=${(t.trader_address || '').slice(0, 10)}`, t.price_outlier ? 'OUTLIER' : '');
  });

  await dbManager.close?.();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
