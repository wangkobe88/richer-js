#!/usr/bin/env node
// 一次性（本地小结果）：0xf38f 登摩羯 开盘 100s 大户形状 v2（修 trade_type 小写坑）+ 全 ticks 分页完整性。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const TOKEN = '0xf38f48cfe9e84920e7de4d47823a0fba95a87777';
const COLS = 'id,block_time,trade_type,bnb_amount,price_bnb,price_outlier,trader_address,sender_address';
(async () => {
  const sb = dbManager.getClient();
  // 分页拉全（id keyset，批 1000）
  const all = [];
  let after = null;
  for (;;) {
    let q = sb.from('wss_price_ticks').select(COLS).eq('token_address', TOKEN).order('id', { ascending: true }).limit(1000);
    if (after) q = q.gt('id', after);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data.length) break;
    all.push(...data);
    if (data.length < 1000) break;
    after = data[data.length - 1].id;
  }
  console.log('全 ticks =', all.length, '首', all[0] && all[0].block_time, '末', all[all.length - 1] && all[all.length - 1].block_time);
  // 链上真序排序（block_number 不在 select 里，用 id 序近似创建序即可——统计不依赖）
  const rows = all.filter(r => r.block_time >= '2026-10-04T05:50:00Z' && r.block_time <= '2026-10-04T05:51:50Z');
  console.log('开盘 100s 窗行 =', rows.length);
  const agg = new Map();
  for (const r of rows) {
    const wk = (r.sender_address || r.trader_address || '').toLowerCase();
    if (!wk) continue;
    const o = agg.get(wk) || { buy: 0, sell: 0, nBuy: 0, nSell: 0, first: r.block_time, last: r.block_time };
    if (r.trade_type === 'buy') { o.buy += Number(r.bnb_amount); o.nBuy++; } else if (r.trade_type === 'sell') { o.sell += Number(r.bnb_amount); o.nSell++; }
    o.last = r.block_time;
    agg.set(wk, o);
  }
  const wallets = [...agg.entries()].sort((a, b) => b[1].buy - a[1].buy);
  console.log(`窗内钱包数 ${wallets.length}，按买入额排序（≥0.1B）：`);
  for (const [wk, o] of wallets) {
    if (o.buy < 0.1 && o.sell < 0.1) continue;
    console.log(`  ${wk.slice(0, 10)} 买${o.buy.toFixed(3)}B×${o.nBuy} 卖${o.sell.toFixed(3)}B×${o.nSell} ${o.first.slice(11, 19)}~${o.last.slice(11, 19)} 净持${(o.buy - o.sell).toFixed(3)}`);
  }
  const totBuy = rows.filter(r => r.trade_type === 'buy').reduce((s, r) => s + Number(r.bnb_amount), 0);
  const totSell = rows.filter(r => r.trade_type === 'sell').reduce((s, r) => s + Number(r.bnb_amount), 0);
  console.log(`窗内总买 ${totBuy.toFixed(3)}B 总卖 ${totSell.toFixed(3)}B 净 ${(totBuy - totSell).toFixed(3)}B`);
  // 大户（买≥0.2）合计行为：FP32 的 bigBuy 口径近似
  const big = wallets.filter(([, o]) => o.buy >= 0.2);
  const bigBuy = big.reduce((s, [, o]) => s + o.buy, 0);
  const bigSell = big.reduce((s, [, o]) => s + o.sell, 0);
  console.log(`0.2 级钱包 ${big.length} 个：合计买 ${bigBuy.toFixed(3)}B / 合计卖 ${bigSell.toFixed(3)}B（FP32 口径大户持续买入中卖出占比 ${(bigSell / (bigBuy + bigSell) * 100).toFixed(1)}%）`);
  // 全 ticks 前向峰值重算（剔 outlier）
  const rel = all.filter(x => !x.price_outlier && x.price_bnb);
  const aT = Date.parse('2026-10-04T05:50:32Z');
  const base = Number((rel.filter(x => Date.parse(x.block_time) <= aT).slice(-1)[0] || {}).price_bnb || 0);
  for (const mins of [5, 15, 30]) {
    const fwd = rel.filter(x => Date.parse(x.block_time) > aT && Date.parse(x.block_time) <= aT + mins * 60 * 1000);
    if (!fwd.length) continue;
    let peak = 0, peakT = '';
    for (const f of fwd) if (Number(f.price_bnb) > peak) { peak = Number(f.price_bnb); peakT = f.block_time.slice(11, 19); }
    console.log(`拒点 05:50:32 → 前向${mins}min（全量 ticks）: peak=${peak.toExponential(4)}@${peakT} (+${((peak / base - 1) * 100).toFixed(1)}%)`);
  }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
