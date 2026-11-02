#!/usr/bin/env node
// tmp：CD27 对倒观察（11-01 用户裁定「对倒交易非常严重，如有必要增加锚」）。
// 现有 11 题/4 数值锚无一对「同钱包反复买卖、高流量低净变化」形状直接建模：
//   churn = min(买额,卖额)/max(买额,卖额)（越接近 1 越像对倒）；零净钱包=纯过手。
// 本脚本零 Jev 配额，182 跑：拉 CD27 锚窗 38 ticks → 钱包级聚合 + 同块买卖同现 + 对称对。
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createRequire } from 'module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);

function sb() {
  const { dbManager } = require_('../../src/services/dbManager.js');
  return dbManager.getClient();
}
const TICK_COLS = 'block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,trader_address,sender_address';

const ADDR = process.argv[2] || '0xa021a76aed73c0bfd233a3228faf69b4529e7777';
const N = Number(process.argv[3] || 38);

const { data, error } = await sb().from('wss_price_ticks').select(TICK_COLS)
  .eq('token_address', ADDR).order('block_number', { ascending: true })
  .order('log_index', { ascending: true }).limit(N);
if (error) throw new Error(error.message);
const rows = data ?? [];
console.log(`== ${ADDR} 锚窗 ${N} ticks，实拉 ${rows.length} 行 ==\n`);

// ── 原始流（时间 | 块/序 | 方向 | 金额 | 价 | wallet）──
const wall = (r) => (r.sender_address || r.trader_address || '?').slice(0, 10);
console.log('序 块:序 方向 金额BNB    价        钱包');
rows.forEach((r, i) => {
  console.log(String(i + 1).padStart(2), `${r.block_number}:${r.log_index}`, (r.trade_type === 'buy' ? 'BUY ' : 'SELL'),
    Number(r.bnb_amount).toFixed(4).padStart(8), Number(r.price_bnb ?? 0).toPrecision(4).padStart(9), wall(r));
});

// ── 钱包级聚合 ──
const w = new Map();
for (const r of rows) {
  const k = r.sender_address || r.trader_address || '?';
  const o = w.get(k) || { buyB: 0, sellB: 0, buyN: 0, sellN: 0, blocks: new Set() };
  if (r.trade_type === 'buy') { o.buyB += Number(r.bnb_amount); o.buyN++; }
  else { o.sellB += Number(r.bnb_amount); o.sellN++; }
  o.blocks.add(r.block_number);
  w.set(k, o);
}
const totB = rows.filter(r => r.trade_type === 'buy').reduce((s, r) => s + Number(r.bnb_amount), 0);
const totS = rows.filter(r => r.trade_type !== 'buy').reduce((s, r) => s + Number(r.bnb_amount), 0);
console.log(`\n== 钱包级（Σ买 ${totB.toFixed(3)} BNB / Σ卖 ${totS.toFixed(3)} BNB，钱包 ${w.size} 个）==`);
console.log('钱包        买额    卖额    净额     买N 卖N 块N  churn   流量占比');
const ws = [...w.entries()].map(([k, o]) => {
  const flow = o.buyB + o.sellB;
  const churn = (o.buyB > 0 && o.sellB > 0) ? Math.min(o.buyB, o.sellB) / Math.max(o.buyB, o.sellB) : 0;
  return { k: k.slice(0, 10), ...o, flow, churn, pct: flow / (totB + totS) * 100 };
}).sort((a, b) => b.flow - a.flow);
for (const o of ws) {
  console.log(o.k, o.buyB.toFixed(3).padStart(7), o.sellB.toFixed(3).padStart(8),
    (o.buyB - o.sellB).toFixed(3).padStart(9), String(o.buyN).padStart(3), String(o.sellN).padStart(3),
    String(o.blocks.size).padStart(3), o.churn.toFixed(2).padStart(6), (o.pct.toFixed(1) + '%').padStart(7));
}

// ── 对倒指标候选 ──
const churned = ws.filter(o => o.buyN >= 2 && o.sellN >= 2); // 反复进出（双臂 ≥2 笔）
const churnFlowPct = churned.reduce((s, o) => s + o.flow, 0) / (totB + totS) * 100;
console.log(`\n反复进出钱包（买≥2笔∧卖≥2笔）: ${churned.length}/${w.size}，流量占比 ${churnFlowPct.toFixed(1)}%`);
const bothSides = ws.filter(o => o.buyN >= 1 && o.sellN >= 1);
const bothFlowPct = bothSides.reduce((s, o) => s + o.flow, 0) / (totB + totS) * 100;
console.log(`双臂在场钱包（买≥1笔∧卖≥1笔）: ${bothSides.length}/${w.size}，流量占比 ${bothFlowPct.toFixed(1)}%`);

// 同块买卖同现
const byBlk = new Map();
for (const r of rows) {
  const o = byBlk.get(r.block_number) || { b: 0, s: 0 };
  if (r.trade_type === 'buy') o.b++; else o.s++;
  byBlk.set(r.block_number, o);
}
const mixed = [...byBlk.entries()].filter(([, o]) => o.b > 0 && o.s > 0);
console.log(`同块买卖同现: ${mixed.length}/${byBlk.size} 块`);
console.log('  ', mixed.map(([b, o]) => `blk${b}(B${o.b}/S${o.s})`).join(' ') || '  （无）');

// 同钱包买卖金额对称（|净|/流量 < 15% 且双臂 ≥1 笔）
const sym = ws.filter(o => o.buyN >= 1 && o.sellN >= 1 && Math.abs(o.buyB - o.sellB) / o.flow < 0.15);
console.log(`近对称钱包（|净|/流量<15%）: ${sym.length} 个 -> ${sym.map(o => o.k).join(', ') || '无'}`);

// ── 同块「卖→买」等额对敲（±2% 对数带，对齐 D3.1；每 BUY 贪心配一个 SELL）──
const BAND = Math.log(1.02);
const inBand = (a, b) => Math.abs(Math.log(a / b)) <= BAND;
const pairs = [];
{
  const blks = new Map();
  for (const r of rows) {
    const o = blks.get(r.block_number) || { sells: [], buys: [] };
    o[r.trade_type === 'buy' ? 'buys' : 'sells'].push(r);
    blks.set(r.block_number, o);
  }
  for (const [blk, o] of blks) {
    for (const b of o.buys) {
      const amt = Number(b.bnb_amount);
      const si = o.sells.findIndex(s => inBand(Number(s.bnb_amount), amt));
      if (si >= 0) {
        const s = o.sells.splice(si, 1)[0];
        pairs.push({ blk, amt, seller: wall(s), buyer: wall(b), sameTrader: s.trader_address === b.trader_address });
      }
    }
  }
}
const pairAmt = pairs.reduce((s, p) => s + p.amt, 0);
console.log(`\n== 同块卖→买等额对敲: ${pairs.length} 对，对敲额 ${pairAmt.toFixed(3)} BNB ==`);
console.log(`占Σ卖 ${(pairAmt / totS * 100).toFixed(1)}% / 占Σ买 ${(pairAmt / totB * 100).toFixed(1)}% / 占总流量 ${(pairAmt * 2 / (totB + totS) * 100).toFixed(1)}%`);
for (const p of pairs) console.log(`  blk${p.blk} ${p.amt.toFixed(4)} ${p.seller}→${p.buyer}${p.sameTrader ? ' [同路由]' : ''}`);
