#!/usr/bin/env node
// 一次性：0x1a08 二波钱包结构取证——sender 去重/等额簇/首波钱包再入场景。用后可删。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const TOKEN = '0x1a0810861af30ed2b85ec2c195f36fb58fc97777';

(async () => {
  const sb = dbManager.getClient();
  const { data: rows, error } = await sb.from('wss_price_ticks')
    .select('block_number, log_index, trade_type, bnb_amount, block_time, sender_address, trader_address')
    .eq('token_address', TOKEN)
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(1000);
  if (error) throw new Error(error.message);

  const W2 = new Date('2026-10-04T14:09:36Z').getTime();
  const W2END = new Date('2026-10-04T14:12:40Z').getTime();
  const W1 = new Date('2026-10-04T14:04:53Z').getTime();
  const W1END = new Date('2026-10-04T14:09:36Z').getTime();

  const key = r => (r.sender_address || r.trader_address || '?').toLowerCase();
  const w1Wallets = new Set(rows.filter(r => { const t = new Date(r.block_time).getTime(); return t >= W1 && t < W1END && r.trade_type === 'buy'; }).map(key));
  console.log(`首波(14:04:53~14:09:36)买钱包 ${w1Wallets.size} 个:`, [...w1Wallets].map(a => a.slice(0, 10)).join(' '));

  // 二波段逐钱包聚合
  const agg = new Map();
  for (const r of rows) {
    const t = new Date(r.block_time).getTime();
    if (t < W2 || t > W2END) continue;
    const k = key(r);
    if (!agg.has(k)) agg.set(k, { buy: 0, sell: 0, buys: 0, sells: 0, first: r.block_time, w1: false });
    const a = agg.get(k);
    if (r.w1) a.w1 = true;
    if (w1Wallets.has(k)) a.w1 = true;
    if (r.trade_type === 'buy') { a.buy += Number(r.bnb_amount); a.buys++; }
    else { a.sell += Number(r.bnb_amount); a.sells++; }
  }
  console.log(`\n二波(14:09:36~14:12:40)钱包 ${agg.size} 个（†=首波钱包再入场）：`);
  const sorted = [...agg.entries()].sort((x, y) => (y[1].buy + y[1].sell) - (x[1].buy + x[1].sell));
  for (const [k, a] of sorted) {
    console.log(`  ${k.slice(0, 12)}${a.w1 ? '†' : ' '} 买${a.buys}笔/${a.buy.toFixed(3)}B 卖${a.sells}笔/${a.sell.toFixed(3)}B 首=${a.first.slice(11, 19)}`);
  }

  // 同块等额簇（二波段）
  console.log('\n二波段同块等额簇（≥3 笔同额）：');
  const byBlock = new Map();
  for (const r of rows) {
    const t = new Date(r.block_time).getTime();
    if (t < W2 || t > W2END || r.trade_type !== 'buy') continue;
    if (!byBlock.has(r.block_number)) byBlock.set(r.block_number, []);
    byBlock.get(r.block_number).push(r);
  }
  for (const [bn, rs] of byBlock) {
    const byAmt = new Map();
    for (const r of rs) {
      const a = Number(r.bnb_amount).toFixed(3);
      if (!byAmt.has(a)) byAmt.set(a, []);
      byAmt.get(a).push(r);
    }
    for (const [a, g] of byAmt) {
      if (g.length >= 3 && Number(a) >= 0.05) {
        const wallets = [...new Set(g.map(key))];
        console.log(`  bn=${bn} ${g.length}×${a}B 钱包${wallets.length}个 ${wallets.map(w => w.slice(0, 8)).join(',')} @${g[0].block_time.slice(11, 19)}`);
      }
    }
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
