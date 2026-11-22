#!/usr/bin/env node
// 一次性（本地小结果）：0x00ee…7777 量纲疑点排查——成交价 4.279e-6 vs ticks 可靠价 5.45e-9 差 785×。
// 查：①两条信号完整 metadata ②wss_events token_create/quote（平台/计价）③买卖时刻附近 ticks 明细。只读。
'use strict';
const path = require('path');
require('dotenv').config({ path: __dirname + '/../config/.env' });
const { dbManager } = require('../src/services/dbManager');

const ADDR = '0x00ee613ddfef429b892aa122c8a4fde764f47777';
const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';

(async () => {
  const sb = dbManager.getClient();

  // 1. 信号完整 metadata
  const { data: sigs } = await sb.from('strategy_signals').select('*')
    .eq('experiment_id', EXP).eq('token_address', ADDR).order('created_at', { ascending: true });
  for (const s of sigs) {
    console.log(`\n=== ${s.signal_type} @ ${s.created_at} reason=${s.reason}`);
    console.log(JSON.stringify(s.metadata, null, 1).slice(0, 3000));
  }

  // 2. wss_events：平台与计价
  const { data: evs } = await sb.from('wss_events').select('kind, platform, block_time, payload')
    .eq('token_address', ADDR).limit(10);
  for (const e of (evs || [])) {
    const p = e.payload || {};
    console.log(`\n[event] ${e.kind} platform=${e.platform} @ ${e.block_time}`, JSON.stringify(p).slice(0, 400));
  }

  // 3. ticks：平台列 + 买卖前后明细
  const rows = []; let cur = 0;
  for (;;) {
    const { data: page } = await sb.from('wss_price_ticks')
      .select('id, trade_type, bnb_amount, token_amount, price_bnb, price_outlier, quote_token, block_time')
      .eq('token_address', ADDR).gt('id', cur).order('id', { ascending: true }).limit(1000);
    if (!page.length) break;
    rows.push(...page); if (page.length < 1000) break; cur = page[page.length - 1].id;
  }
  const q = rows.filter(r => r.quote_token).length;
  console.log(`\nticks ${rows.length} 行，带 quote_token 标记 ${q} 行`);
  const t0 = new Date('2026-10-03T22:35:30Z').getTime(), t1 = new Date('2026-10-03T22:38:00Z').getTime();
  console.log('22:35:30~22:38:00 ticks:');
  for (const r of rows) {
    const ts = new Date(r.block_time).getTime();
    if (ts < t0 || ts > t1) continue;
    console.log(`  ${r.block_time.slice(11, 19)} ${r.trade_type} bnb=${Number(r.bnb_amount).toFixed(4)} px=${Number(r.price_bnb).toExponential(3)} tok=${Number(r.token_amount).toExponential(2)} out=${r.price_outlier} q=${r.quote_token || '-'}`);
  }
  // 价格路径概览（每 5 分钟末笔）
  console.log('\n价格路径（每 5 分钟末笔可靠价）:');
  let lastMin = -1;
  for (const r of rows) {
    if (r.price_outlier) continue;
    const ts = new Date(r.block_time).getTime();
    const min = Math.floor(ts / 300000);
    if (min !== lastMin) { if (lastMin >= 0) continue; lastMin = min; }
    else if (Math.floor(ts / 300000) === lastMin) { /* keep overwriting below */ }
  }
  // 简化：直接每 5 分钟取末笔
  const byMin = new Map();
  for (const r of rows) {
    if (r.price_outlier) continue;
    const m = Math.floor(new Date(r.block_time).getTime() / 300000);
    byMin.set(m, r);
  }
  for (const [m, r] of [...byMin].slice(0, 80)) {
    console.log(`  ${r.block_time.slice(5, 19)} px=${Number(r.price_bnb).toExponential(3)}`);
  }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
