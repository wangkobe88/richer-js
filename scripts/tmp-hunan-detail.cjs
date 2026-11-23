#!/usr/bin/env node
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const TOK = '0xe1fcd957c62bc2da3b8337a986710142531d7777';
(async () => {
  const db = dbManager.getClient();
  const ev = await db.from('wss_events').select('block_time').eq('token_address', TOK).eq('kind', 'token_create').limit(1);
  const t0 = new Date(ev.data[0].block_time).getTime();
  const r = await db.from('wss_price_ticks')
    .select('trade_type, trader_address, sender_address, price_bnb, bnb_amount, block_number, block_time, log_index')
    .eq('token_address', TOK).order('id', { ascending: true }).limit(1000);
  if (r.error) throw new Error(r.error.message);
  const rows = r.data.sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index));
  // latch=首笔≥0.3 buy
  let latchW = null;
  const CONST = 5.546338e-9;
  for (const x of rows) {
    const w = x.sender_address || x.trader_address;
    if (w && x.trade_type === 'buy' && !latchW && Number(x.bnb_amount) >= 0.3) latchW = w;
  }
  console.log('latch =', latchW && latchW.slice(0, 10));
  console.log('=== 出生前 400s 全部成交 ===');
  let otherBuy = 0, latchBuy = 0;
  for (const x of rows) {
    const sec = (new Date(x.block_time).getTime() - t0) / 1000;
    if (sec > 400) break;
    const w = (x.sender_address || x.trader_address || '').slice(0, 10);
    const isLatch = (x.sender_address || x.trader_address) === latchW;
    if (x.trade_type === 'buy') { if (isLatch) latchBuy += Number(x.bnb_amount); else otherBuy += Number(x.bnb_amount); }
    console.log(`+${String(Math.round(sec)).padStart(4)}s ${x.trade_type.padEnd(4)} bnb=${Number(x.bnb_amount).toFixed(4).padStart(7)} (+${(Number(x.price_bnb) / CONST * 100 - 100).toFixed(1).padStart(6)}%) w=${w}${isLatch ? '★latch' : ''}  [累计: latch买${latchBuy.toFixed(3)} 其他买${otherBuy.toFixed(3)}]`);
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
