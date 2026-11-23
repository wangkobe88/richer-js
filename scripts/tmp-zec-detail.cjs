#!/usr/bin/env node
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const TOK = '0x5bd4383824477a7f7ae7fe66e1e03f87372f7777';
(async () => {
  const db = dbManager.getClient();
  const ev = await db.from('wss_events').select('block_time').eq('token_address', TOK).eq('kind', 'token_create').limit(1);
  const t0 = new Date(ev.data[0].block_time).getTime();
  const r = await db.from('wss_price_ticks')
    .select('trade_type, trader_address, sender_address, price_bnb, bnb_amount, block_number, block_time, log_index')
    .eq('token_address', TOK).order('id', { ascending: true }).limit(1000);
  if (r.error) throw new Error(r.error.message);
  const rows = r.data.sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index));
  const CONST = 5.546338e-9;
  console.log('=== 出生前 160s 全部成交（引擎 fire@135s）===');
  for (const x of rows) {
    const sec = (new Date(x.block_time).getTime() - t0) / 1000;
    if (sec > 160) continue;
    const w = (x.sender_address || x.trader_address || '').slice(0, 10);
    console.log(`+${String(Math.round(sec)).padStart(4)}s blk=${x.block_number} log=${x.log_index} ${x.trade_type.padEnd(4)} bnb=${Number(x.bnb_amount).toFixed(4).padStart(7)} (+${(Number(x.price_bnb) / CONST * 100 - 100).toFixed(1).padStart(6)}%) w=${w}`);
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
