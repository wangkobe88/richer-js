'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const ADDR = '0x2ee9458681c134e9c7cd933b7af94be50a1f7777';
(async () => {
  const sb = dbManager.getClient();
  const { data: rows, error } = await sb.from('wss_price_ticks')
    .select('block_time,price_bnb')
    .eq('token_address', ADDR)
    .gt('block_time', '2026-10-04T07:05:12+00:00')
    .limit(3000);
  if (error) throw new Error(error.message);
  rows.sort((a, b) => a.block_time.localeCompare(b.block_time));
  console.log('tail rows:', rows.length);
  if (!rows.length) return;
  let max = -Infinity, maxAt = null;
  for (const r of rows) {
    if (r.price_bnb == null) continue;
    if (r.price_bnb > max) { max = r.price_bnb; maxAt = r.block_time; }
  }
  console.log('first:', rows[0].block_time, rows[0].price_bnb);
  console.log('tail max:', max, '@', maxAt);
  console.log('last:', rows[rows.length - 1].block_time, rows[rows.length - 1].price_bnb);
})().catch(e => { console.error('FAIL:', e.message, e); process.exit(1); });
