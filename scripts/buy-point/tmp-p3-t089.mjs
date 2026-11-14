#!/usr/bin/env node
// T089 CD400 miss 归因（182 跑，只读）：锚前 60s 块级卖方明细（剔 router 前后对照）
import fs from 'node:fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { AGGREGATOR_ROUTER_ADDRS } = require('../../src/trading-engine/pre-check/aggregator-routers.js');

const SET = 'scripts/buy-point/sets/btv109-trades.json';
const set = JSON.parse(fs.readFileSync(SET, 'utf8'));
const p = set.points.find((x) => String(x.pointId).endsWith('T089'));
const rows = JSON.parse(fs.readFileSync(`scripts/buy-point/sets/btv109-trades-ticks/${p.tokenAddress}.json`, 'utf8')).rows;
const ts = (iso) => Date.parse(iso) / 1000;
const anchor = p.anchorTimeIso || rows[rows.length - 1].block_time;
const aTs = ts(anchor);
const routers = AGGREGATOR_ROUTER_ADDRS;
const wallet = (r) => (r.sender_address || r.trader_address || '').toLowerCase();
console.log(`T089 ${p.tokenSymbol} anchor=${anchor}`);
const pre60 = rows.filter((r) => aTs - ts(r.block_time) < 60 && ts(r.block_time) <= aTs);
const blocks = new Map();
for (const r of pre60) {
  const key = r.block_number;
  if (!blocks.has(key)) blocks.set(key, { blk: key, t: r.block_time, rows: [] });
  blocks.get(key).rows.push(r);
}
for (const [blk, b] of [...blocks.entries()].sort((x, y) => x[0] - y[0])) {
  const sells = b.rows.filter((r) => r.trade_type === 'sell');
  if (!sells.length) continue;
  const sellers = new Map();
  for (const s of sells) {
    const w = wallet(s);
    sellers.set(w, (sellers.get(w) || 0) + s.bnb_amount);
  }
  const all = [...sellers.entries()];
  const exRouter = all.filter(([w]) => !routers.has(w));
  const totSell = sells.reduce((a, r) => a + r.bnb_amount, 0);
  console.log(`  blk ${blk} @${b.t.slice(11, 19)} 卖${totSell.toFixed(3)} 全户${all.length} 剔router后${exRouter.length}户`);
  for (const [w, v] of all) console.log(`     ${w} ${v.toFixed(3)}${routers.has(w) ? ' ←router' : ''}`);
}
console.log(`anchorTs=${aTs} 锚块内行数=${rows.filter((r) => ts(r.block_time) === aTs).length}`);
