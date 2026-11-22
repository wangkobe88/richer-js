'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';
const ADDR = '0x2ee9458681c134e9c7cd933b7af94be50a1f7777';
(async () => {
  const sb = dbManager.getClient();
  const cnt = await sb.from('wss_price_ticks').select('id', { count: 'exact', head: true })
    .eq('token_address', ADDR);
  if (cnt.error) throw new Error(cnt.error.message);
  console.log('total ticks:', cnt.count);
  const { data: rows, error } = await sb.from('wss_price_ticks')
    .select('block_time,price_bnb,price_outlier')
    .eq('token_address', ADDR)
    .gt('block_time', '2026-10-04T06:50:00Z')
    .lt('block_time', '2026-10-04T07:20:00Z')
    .limit(5000);
  if (error) throw new Error(error.message);
  rows.sort((a, b) => a.block_time.localeCompare(b.block_time));
  console.log('rows after signal:', rows.length);
  if (!rows.length) return;
  const first = rows[0], last = rows[rows.length - 1];
  let max = -Infinity, maxAt = null, min = Infinity, minAt = null;
  for (const r of rows) {
    if (r.price_bnb == null) continue;
    if (r.price_bnb > max) { max = r.price_bnb; maxAt = r.block_time; }
    if (r.price_bnb < min) { min = r.price_bnb; minAt = r.block_time; }
  }
  console.log('first:', first.block_time, first.price_bnb);
  console.log('last:', last.block_time, last.price_bnb);
  console.log('max:', max, '@', maxAt);
  console.log('min:', min, '@', minAt);
  // 信号时刻价（06:50:23 前）
  const { data: pre } = await sb.from('wss_price_ticks')
    .select('block_time,price_bnb')
    .eq('token_address', ADDR)
    .gte('block_time', '2026-10-04T06:50:00Z')
    .lte('block_time', '2026-10-04T06:50:35Z')
    .limit(200);
  (pre || []).sort((a, b) => a.block_time.localeCompare(b.block_time));
  for (const r of (pre || []).slice(0, 12)) console.log('pre/around:', r.block_time, r.price_bnb, r.price_outlier ? '(outlier)' : '');
})().catch(e => { console.error('FAIL:', e.message, e); process.exit(1); });
