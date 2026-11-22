#!/usr/bin/env node
/** 一次性验证：登天猫 famous 接盘时间线（信号前 famous 买=0 已知；看信号后谁接了庄的派发） */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
(async () => {
  const fam = new Set(JSON.parse(require('fs').readFileSync('config/rosters/famous-copy-wallets.json', 'utf8')).wallets.map(w => String(w).toLowerCase()));
  const num = (v) => { const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) ? n : 0; };
  const db = dbManager.getClient();
  const rows = [];
  for (let off = 0; ; off += 1000) {
    const p = await db.from('wss_price_ticks')
      .select('trade_type,sender_address,trader_address,bnb_amount,price_bnb,block_number,log_index,block_time')
      .eq('token_address', '0xf38f48cfe9e84920e7de4d47823a0fba95a87777')
      .gte('block_time', '2026-10-04T05:40:00.000Z').lte('block_time', '2026-10-04T07:00:00.000Z')
      .range(off, off + 999);
    if (p.error) throw new Error(p.error.message);
    rows.push(...p.data);
    if (p.data.length < 1000) break;
  }
  const r = rows.map((x, i) => ({ ...x, _t: new Date(x.block_time).getTime(), _i: i, _w: ((x.sender_address || x.trader_address) || '').toLowerCase() || null, _b: num(x.bnb_amount) }))
    .sort((a, b) => (a.block_number ?? 1e15) - (b.block_number ?? 1e15) || (a.log_index ?? 0) - (b.log_index ?? 0) || a._i - b._i);
  const t0 = r[0]._t, sig = t0 + 20_000;
  let buy = 0, sell = 0;
  for (const x of r.filter(x => x._w && fam.has(x._w))) {
    if (x.trade_type === 'buy') buy += x._b; else sell += x._b;
    const off = ((x._t - sig) / 1000).toFixed(0);
    console.log(`${x._t >= sig ? 't+' : 't−'}${off}s ${x.trade_type} ${x._b.toFixed(3)}B ${x._w.slice(0, 10)}…`);
  }
  const pre = r.filter(x => x._w && fam.has(x._w) && x._t <= sig && x.trade_type === 'buy').reduce((s, x) => s + x._b, 0);
  console.log(`合计：famous 买 ${buy.toFixed(3)}B 卖 ${sell.toFixed(3)}B；信号前 famous 买入=${pre.toFixed(3)}B`);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
