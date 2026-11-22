#!/usr/bin/env node
/**
 * 一次性脚本：对照组（40 候选中未入选的 18 票）前排 ticks 剖析（2026-11-21）
 * 数据源=wss_price_ticks per-token 早期 1000 行（idx_wss_ticks_token_time 索引形状，本地安全）；
 * 指标口径与金狗组 tmp-jindog-ticks-profile.cjs 完全一致（链上真序本地重排）。
 * 用后可删。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const { AGGREGATOR_ROUTER_ADDRS } = require('../src/trading-engine/pre-check/aggregator-routers');

const EXP_ID = '9e9163de-a677-4d39-9c33-9ec9df05e400';
const W_SEC = 90;
const CTRL = [
  ['0x4601febdeb991bad529290ce538af78af62b7777', '雪公主人生'],
  ['0x116187bc75d5a92001eb42a6bc052e329b457777', '骑士猫'],
  ['0xc7d0cbdf8097eb8b77587fa7df710ba56eb27777', '익명이'],
  ['0x108187b1437b154ba7b2d48a61a851c9a53d7777', 'BSI'],
  ['0x1bd0d654e44a78d9b20dcf09fa61100013c07777', '尤栗'],
  ['0xb11743fd548c162566959b0bd7eeb5b00c687777', 'HATCH'],
  ['0x796b4b2ae234c3adcb51c4aaa7a026d2d0c07777', '中国龙'],
  ['0x85be85b20bb44575893275e93c112f884d367777', 'Kumai'],
  ['0xa3607d16aff3dbd1a742ba2bfb8c7a3940727777', 'NISSAN'],
  ['0x7d01096f46b3f2e4f6803fec1c98f388387c7777', 'ERIKAZ'],
  ['0xc4b0086fee3c3bec7eea686d10aed98683017777', '躺赢人生c4'],
  ['0xf4aae57ee5a392ec783d715216fd572e46847777', 'FridayNight'],
  ['0xab8d1a5492cc4fc1f3e7538c9988805a3ee97777', '洛天依'],
  ['0xaf24fa77d8af7da83dc7dae64f0678407ae57777', 'TAIGAN'],
  ['0x0a702dfe3a690e391eb860cdf518ec9ef5827777', 'ANAN'],
  ['0xfc5b6efbad720dc557a75464350aad85841c7777', 'xSI'],
  ['0x7edb271ead7ba50dffbc74ec432aaafce4c77777', '躺赢人生7e'],
  ['0x7c3ad81780e5b4a5a04f9d0985c6d6fe1ba17777', 'SI7c'],
];

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
  const results = [];
  for (const [addr, label] of CTRL) {
    const res = await db.from('wss_price_ticks')
      .select('trade_type, trader_address, sender_address, price_bnb, bnb_amount, price_outlier, block_number, block_time, platform')
      .eq('token_address', addr)
      .order('block_time', { ascending: true })
      .limit(1000);
    if (res.error) throw new Error(`${addr}: ${res.error.message}`);
    const list = [...res.data].sort((x, y) => {
      const bx = x.block_number ?? 9e15, by = y.block_number ?? 9e15;
      if (bx !== by) return bx - by;
      return (x.log_index ?? 0) - (y.log_index ?? 0);
    });
    if (!list.length) { console.log(`${label} 无 ticks`); continue; }
    const t0 = new Date(list[0].block_time).getTime();
    const w = list.filter(r => new Date(r.block_time).getTime() - t0 <= W_SEC * 1000);
    const truncated = w.length === list.length && list.length === 1000; // 1000 行仍在窗内=窗截断
    const buys = w.filter(r => r.trade_type === 'buy');
    const sells = w.filter(r => r.trade_type === 'sell');
    const buyAmnts = buys.map(r => Number(r.bnb_amount) || 0).filter(x => x > 0);
    let t6 = null;
    if (list.length >= 6) t6 = (new Date(list[5].block_time).getTime() - t0) / 1000;
    const buyers = new Set(buys.map(walletOf).filter(Boolean));
    const big02 = buyAmnts.filter(x => x >= 0.19).length;
    const big03 = buyAmnts.filter(x => x >= 0.29).length;
    const dust = buyAmnts.filter(x => x < 0.01).length;
    const routerBuys = buys.filter(isRouter).length;
    const firstBlock = list[0].block_number;
    const fbRows = w.filter(r => r.block_number === firstBlock);
    const fbWallets = new Set(fbRows.map(walletOf).filter(Boolean));
    const rel = w.filter(r => !r.price_outlier && r.price_bnb != null);
    const p0 = rel.length ? Number(rel[0].price_bnb) : Number(list[0].price_bnb);
    const pEnd = rel.length ? Number(rel[rel.length - 1].price_bnb) : p0;
    let tGate = null;
    for (const r of rel) {
      if (p0 > 0 && (Number(r.price_bnb) / p0 - 1) * 100 >= 28.5) {
        tGate = (new Date(r.block_time).getTime() - t0) / 1000;
        break;
      }
    }
    results.push({
      label, platform: (w[0].platform || list[0].platform || '?'),
      n90: w.length, buys: buys.length, sells: sells.length,
      buyBnb: buyAmnts.reduce((a, b) => a + b, 0),
      sellBnb: sells.map(r => Number(r.bnb_amount) || 0).reduce((a, b) => a + b, 0),
      buyers: buyers.size,
      medBuy: q(buyAmnts, 0.5), maxBuy: buyAmnts.length ? Math.max(...buyAmnts) : 0,
      big02, big03, dust, dustPct: buys.length ? dust / buys.length * 100 : 0,
      routerPct: buys.length ? routerBuys / buys.length * 100 : 0,
      t6, fbN: fbRows.length, fbW: fbWallets.size,
      chg90: p0 > 0 ? (pEnd / p0 - 1) * 100 : null, tGate, truncated,
    });
  }
  results.sort((a, b) => (b.chg90 || 0) - (a.chg90 || 0));

  console.log('\n=== 对照组（未入选 18 票）前排（首 90s）结构 ===');
  console.log('pf symbol      n90 buy sell buyBnb sellBnb 买家 medBuy maxBuy ≥.2 ≥.3 尘% 路由% t6s 首块(笔/户) 90s涨幅 触28.5%');
  for (const r of results) {
    console.log(
      (r.platform === 'fourmeme' ? '4m' : r.platform.slice(0, 2)).padEnd(3),
      String(r.label).padEnd(10).slice(0, 10),
      String(r.n90).padStart(4), String(r.buys).padStart(4), String(r.sells).padStart(4),
      f1(r.buyBnb), f1(r.sellBnb), String(r.buyers).padStart(4),
      f1(r.medBuy), f1(r.maxBuy), String(r.big02).padStart(3), String(r.big03).padStart(3),
      f1(r.dustPct), f1(r.routerPct),
      r.t6 == null ? '  -  ' : String(r.t6.toFixed(0)).padStart(5),
      `(${r.fbN}/${r.fbW})`.padStart(7),
      (r.chg90 == null ? '  -  ' : (r.chg90 >= 0 ? '+' : '') + r.chg90.toFixed(0) + '%').padStart(6),
      (r.tGate == null ? '>90s' : r.tGate.toFixed(0) + 's') + (r.truncated ? '~' : '')
    );
  }

  const stat = (key) => {
    const vals = results.map(r => r[key]).filter(v => typeof v === 'number' && isFinite(v));
    return `${key}: p25=${f1(q(vals, 0.25))} p50=${f1(q(vals, 0.5))} p75=${f1(q(vals, 0.75))} (n=${vals.length})`;
  };
  console.log('\n=== 对照组分位汇总 ===');
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
