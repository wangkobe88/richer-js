#!/usr/bin/env node
/** 개구리씨 尾窗 0.1175B 的买入明细（谁/几笔/何时/价格） */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const TOK = '0xa38b2d9478d8a9ed87ec0fc93ea29e3e69dc7777';
(async () => {
  const db = dbManager.getClient();
  const ev = await db.from('wss_events').select('block_time, payload').eq('token_address', TOK).eq('kind', 'token_create').limit(1);
  const t0 = new Date(ev.data[0].block_time).getTime();
  const r = await db.from('wss_price_ticks')
    .select('trade_type, trader_address, sender_address, price_bnb, bnb_amount, token_amount, block_time, block_number, log_index')
    .eq('token_address', TOK).order('id', { ascending: true }).limit(1000);
  if (r.error) throw new Error(r.error.message);
  const rows = r.data.sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index));
  // latch=首笔≥0.3 buy；出口=首个 gap≥60s 的苏醒首笔
  let latchW = null, lastTs = null, exitTs = null;
  for (const x of rows) {
    const ts = new Date(x.block_time).getTime();
    if (lastTs !== null && ts - lastTs >= 60000 && !exitTs) exitTs = ts;
    const w = x.sender_address || x.trader_address;
    if (w && x.trade_type === 'buy' && !latchW && Number(x.bnb_amount) >= 0.3) latchW = w;
    lastTs = ts;
  }
  console.log(`latch=${latchW.slice(0, 10)} 出口(SIC 醒首笔)=+${(exitTs - t0) / 1000}s 尾窗=[${((exitTs - 180000 - t0) / 1000).toFixed(0)}s, ${((exitTs - t0) / 1000).toFixed(0)}s)`);
  console.log('\n=== 尾窗内全部成交（★=非 latch 的买入 → tailBuyEx）===');
  let sum = 0;
  for (const x of rows) {
    const ts = new Date(x.block_time).getTime();
    if (ts < exitTs - 180000 || ts > exitTs) continue;
    const w = (x.sender_address || x.trader_address || '').slice(0, 10);
    const mark = (x.trade_type === 'buy' && w !== latchW) ? '★' : ' ';
    if (x.trade_type === 'buy' && w !== latchW) sum += Number(x.bnb_amount);
    console.log(`${mark} +${((ts - t0) / 1000).toFixed(0).padStart(4)}s ${x.trade_type.padEnd(4)} bnb=${Number(x.bnb_amount).toFixed(4).padStart(7)} w=${w}${w === latchW ? '(latch)' : ''}`);
  }
  console.log(`\ntailBuyEx = ${sum.toFixed(4)} BNB`);
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
