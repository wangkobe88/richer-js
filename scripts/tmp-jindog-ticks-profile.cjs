#!/usr/bin/env node
/**
 * 一次性脚本：金狗集合 30 票前排 ticks 剖析（2026-11-21）
 * 数据源=case_ticks 集合副本（本地全量拉取安全）；链上真序 (block_number, log_index)。
 * 输出每票开盘结构指标 + 组内分位数，供共性归纳。
 * 用后可删。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const { AGGREGATOR_ROUTER_ADDRS } = require('../src/trading-engine/pre-check/aggregator-routers');

const COLLECTION_ID = 'a8414632-7c24-4762-9253-c49bb0f53105';
const EXP_ID = '9e9163de-a677-4d39-9c33-9ec9df05e400'; // bt-v164（symbol 用）
const W_SEC = 90;          // 前排窗=首笔起 90s（FA 出生锚窗同款）
const N_FIRST = 30;        // 前 N 笔口径

const walletOf = (r) => (r.sender_address || r.trader_address || '').toLowerCase();
const isRouter = (r) => AGGREGATOR_ROUTER_ADDRS.has(String(r.trader_address || '').toLowerCase());
const q = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const f1 = (x) => (x == null || !isFinite(x)) ? '  -  ' : String(x.toFixed(1)).padStart(6);

(async () => {
  const db = dbManager.getClient();

  // symbol map（实验级小查询）
  const symbolMap = new Map();
  {
    let offset = 0;
    for (;;) {
      const page = await db.from('experiment_tokens').select('token_address, token_symbol')
        .eq('experiment_id', EXP_ID).order('id', { ascending: true }).range(offset, offset + 999);
      if (page.error) throw new Error(page.error.message);
      for (const t of page.data) symbolMap.set(t.token_address.toLowerCase(), t.token_symbol || '?');
      if (page.data.length < 1000) break;
      offset += 1000;
    }
  }

  // case_ticks 全量（33 页左右）
  const rows = [];
  {
    let offset = 0;
    for (;;) {
      const page = await db.from('case_ticks')
        .select('token_address, trade_type, trader_address, sender_address, price_bnb, bnb_amount, price_outlier, block_number, block_time, platform')
        .eq('collection_id', COLLECTION_ID).order('id', { ascending: true }).range(offset, offset + 999);
      if (page.error) throw new Error(page.error.message);
      rows.push(...page.data);
      if (page.data.length < 1000) break;
      offset += 1000;
    }
  }
  console.log(`case_ticks 共 ${rows.length} 行`);

  // 按 token 分组 + 链上真序
  const byToken = new Map();
  for (const r of rows) {
    const a = r.token_address.toLowerCase();
    if (!byToken.has(a)) byToken.set(a, []);
    byToken.get(a).push(r);
  }
  for (const list of byToken.values()) {
    list.sort((x, y) => {
      const bx = x.block_number ?? 9e15, by = y.block_number ?? 9e15;
      if (bx !== by) return bx - by;
      return (x.log_index ?? 0) - (y.log_index ?? 0);
    });
  }

  const results = [];
  for (const [addr, list] of byToken) {
    const t0 = new Date(list[0].block_time).getTime();
    const w = list.filter(r => new Date(r.block_time).getTime() - t0 <= W_SEC * 1000);
    const buys = w.filter(r => r.trade_type === 'buy');
    const sells = w.filter(r => r.trade_type === 'sell');
    const buyAmnts = buys.map(r => Number(r.bnb_amount) || 0).filter(x => x > 0);

    // 第 6 笔耗时（t0 臂 6 笔线）
    let t6 = null;
    if (list.length >= 6) t6 = (new Date(list[5].block_time).getTime() - t0) / 1000;

    // 独立买家（wallet 口径）
    const buyers = new Set(buys.map(walletOf).filter(Boolean));
    // 大额/尘埃结构
    const big02 = buyAmnts.filter(x => x >= 0.19).length;
    const big03 = buyAmnts.filter(x => x >= 0.29).length;
    const dust = buyAmnts.filter(x => x < 0.01).length;
    // 路由买笔占比
    const routerBuys = buys.filter(isRouter).length;

    // 首块结构
    const firstBlock = list[0].block_number;
    const fbRows = w.filter(r => r.block_number === firstBlock);
    const fbWallets = new Set(fbRows.map(walletOf).filter(Boolean));

    // 价格轨迹（可靠价）
    const rel = w.filter(r => !r.price_outlier && r.price_bnb != null);
    const p0 = rel.length ? Number(rel[0].price_bnb) : Number(list[0].price_bnb);
    const pEnd = rel.length ? Number(rel[rel.length - 1].price_bnb) : p0;
    // 触 +28.5% 时间（ladder 价格门同线）
    let tGate = null;
    for (const r of rel) {
      if (p0 > 0 && (Number(r.price_bnb) / p0 - 1) * 100 >= 28.5) {
        tGate = (new Date(r.block_time).getTime() - t0) / 1000;
        break;
      }
    }

    results.push({
      addr, symbol: symbolMap.get(addr) || addr.slice(2, 6),
      platform: w[0].platform || list[0].platform || '?',
      n90: w.length, buys: buys.length, sells: sells.length,
      buyBnb: buyAmnts.reduce((a, b) => a + b, 0),
      sellBnb: sells.map(r => Number(r.bnb_amount) || 0).reduce((a, b) => a + b, 0),
      buyers: buyers.size,
      medBuy: q(buyAmnts, 0.5), maxBuy: buyAmnts.length ? Math.max(...buyAmnts) : 0,
      big02, big03, dust, dustPct: buys.length ? dust / buys.length * 100 : 0,
      routerPct: buys.length ? routerBuys / buys.length * 100 : 0,
      t6, fbN: fbRows.length, fbW: fbWallets.size,
      chg90: p0 > 0 ? (pEnd / p0 - 1) * 100 : null, tGate,
    });
  }
  results.sort((a, b) => (b.chg90 || 0) - (a.chg90 || 0));

  console.log('\n=== 每票前排（首 90s）结构 ===');
  console.log('pf symbol      n90 buy sell buyBnb sellBnb 买家 medBuy maxBuy ≥.2 ≥.3 尘% 路由% t6s 首块(笔/户) 90s涨幅 触28.5%');
  for (const r of results) {
    console.log(
      (r.platform === 'fourmeme' ? '4m' : r.platform.slice(0, 2)).padEnd(3),
      String(r.symbol).padEnd(10).slice(0, 10),
      String(r.n90).padStart(4), String(r.buys).padStart(4), String(r.sells).padStart(4),
      f1(r.buyBnb), f1(r.sellBnb), String(r.buyers).padStart(4),
      f1(r.medBuy), f1(r.maxBuy), String(r.big02).padStart(3), String(r.big03).padStart(3),
      f1(r.dustPct), f1(r.routerPct),
      r.t6 == null ? '  -  ' : String(r.t6.toFixed(0)).padStart(5),
      `(${r.fbN}/${r.fbW})`.padStart(7),
      (r.chg90 == null ? '  -  ' : (r.chg90 >= 0 ? '+' : '') + r.chg90.toFixed(0) + '%').padStart(6),
      r.tGate == null ? '>90s' : r.tGate.toFixed(0) + 's'
    );
  }

  // 组内分位数
  const stat = (key, fmt = f1) => {
    const vals = results.map(r => r[key]).filter(v => typeof v === 'number' && isFinite(v));
    return `${key}: p25=${fmt(q(vals, 0.25))} p50=${fmt(q(vals, 0.5))} p75=${fmt(q(vals, 0.75))} (n=${vals.length})`;
  };
  console.log('\n=== 组内分位汇总 ===');
  for (const k of ['n90', 'buys', 'sells', 'buyBnb', 'sellBnb', 'buyers', 'medBuy', 'maxBuy', 'big02', 'big03', 'dustPct', 'routerPct', 't6', 'fbW', 'chg90']) {
    console.log(stat(k));
  }
  const gateHit = results.filter(r => r.tGate != null && r.tGate <= 90).length;
  console.log(`触+28.5% 在 90s 内: ${gateHit}/${results.length}`);
  const pfCount = {};
  for (const r of results) pfCount[r.platform] = (pfCount[r.platform] || 0) + 1;
  console.log(`platform 分布: ${JSON.stringify(pfCount)}`);
  process.exit(0);
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
