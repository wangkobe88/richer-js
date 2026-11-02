#!/usr/bin/env node
// tmp：D3.28 候选锚——「同块卖→买等额对敲」（CD27 用户裁定「对倒交易非常严重」立项）。
// 形状：同块内 SELL 与 BUY 金额落 ±2% 对数带（对齐 D3.1 带宽）配对，每 BUY 贪心配一 SELL。
//   washPairSellPct = Σ配对卖额 ÷ Σ卖 ×100（对倒出货占全部卖出的比例）
//   washPairBuyPct  = Σ配对买额 ÷ Σ买 ×100
// 现有锚失明根因（CD27 实证）：对敲「对内等额、对外不等额」——买回金额互相各异凑不成等额带、
// 每块 1-2 笔买不成同块波。本脚本 128 票锚窗全量分布（零 Jev，182 跑）。
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';
import { createRequire } from 'module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);

function sb() {
  const { dbManager } = require_('../../src/services/dbManager.js');
  return dbManager.getClient();
}
const TICK_COLS = 'block_number,log_index,trade_type,bnb_amount,trader_address,sender_address';
async function pullTicksToAnchor(token, n) {
  const { data, error } = await sb().from('wss_price_ticks').select(TICK_COLS)
    .eq('token_address', token).order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(n);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (rows.length < n) throw new Error(`锚截窗不足：锚=${n} 实际=${rows.length}`);
  return rows;
}

const BAND = Math.log(1.02);
const inBand = (a, b) => Math.abs(Math.log(a / b)) <= BAND;

function washPairs(rows) {
  const blks = new Map();
  for (const r of rows) {
    const o = blks.get(r.block_number) || { sells: [], buys: [] };
    o[r.trade_type === 'buy' ? 'buys' : 'sells'].push(r);
    blks.set(r.block_number, o);
  }
  let pairAmt = 0, pairN = 0, sameTraderN = 0;
  for (const [, o] of blks) {
    const sells = [...o.sells];
    for (const b of o.buys) {
      const amt = Number(b.bnb_amount);
      const si = sells.findIndex(s => inBand(Number(s.bnb_amount), amt));
      if (si >= 0) {
        const s = sells.splice(si, 1)[0];
        pairAmt += amt; pairN++;
        if (s.trader_address === b.trader_address) sameTraderN++;
      }
    }
  }
  const totB = rows.filter(r => r.trade_type === 'buy').reduce((s, r) => s + Number(r.bnb_amount), 0);
  const totS = rows.filter(r => r.trade_type !== 'buy').reduce((s, r) => s + Number(r.bnb_amount), 0);
  return {
    pairN, sameTraderN,
    sellPct: totS > 0 ? pairAmt / totS * 100 : null,
    buyPct: totB > 0 ? pairAmt / totB * 100 : null,
  };
}

const only = process.argv[2] || '';
const fxDoc = JSON.parse(readFileSync(resolve(HERE, 'fixtures.json'), 'utf8'));
const { loadAndValidateFixtures } = await import('./lib.mjs');
const { cases, errors } = loadAndValidateFixtures(fxDoc);
if (errors.length) { console.error(errors.join('\n')); process.exit(2); }
const targets = only ? cases.filter(c => only.split(',').includes(c.caseId)) : cases;

const out = [];
for (const c of targets) {
  const rows = await pullTicksToAnchor(c.addr.toLowerCase(), c.anchor.tickCount);
  const r = washPairs(rows);
  out.push({ id: c.caseId, expect: c.expect, ...r });
  console.error(`${c.caseId} 对=${r.pairN} 同路由=${r.sameTraderN} 卖占=${r.sellPct === null ? '—' : r.sellPct.toFixed(1)}% 买占=${r.buyPct === null ? '—' : r.buyPct.toFixed(1)}%`);
}

out.sort((a, b) => (b.sellPct ?? -1) - (a.sellPct ?? -1));
console.log('\ncaseId 卖占% 买占% 对数 同路由对 expect');
for (const o of out) {
  console.log(o.id, (o.sellPct === null ? '—' : o.sellPct.toFixed(1)).padStart(6),
    (o.buyPct === null ? '—' : o.buyPct.toFixed(1)).padStart(6),
    String(o.pairN).padStart(4), String(o.sameTraderN).padStart(4), ' ', o.expect);
}
// 分布概览（≥3 对才视为形状成立，防 1-2 对噪声）
const shaped = out.filter(o => o.pairN >= 3);
console.log(`\n对数≥3 的票: ${shaped.length}/${out.length}`);
for (const th of [50, 60, 70, 80, 90]) {
  const hit = shaped.filter(o => (o.sellPct ?? 0) >= th);
  console.log(`  卖占≥${th}%: ${hit.length} 票 -> ${hit.map(o => o.id + (o.expect === 'cheat' ? '*' : '')).join(',')}`);
}
