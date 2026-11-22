#!/usr/bin/env node
// 一次性：0xa79e 锚窗 tick 价格路径（单票，~几十行，本地可跑）
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const TOKEN = '0xa79e736482f55c89e42000151e04af630f2b7777';
const ANCHOR = new Date('2026-10-04T12:15:19+00:00'); // 信号 created_at（锚=信号时刻）
(async () => {
  const db = dbManager.getClient();
  const start = new Date(ANCHOR.getTime() - 260 * 1000);
  const { data, error } = await db.from('wss_price_ticks')
    .select('block_time, trade_type, bnb_amount, price_bnb, price_usd, sender_address, block_number, price_outlier')
    .eq('token_address', TOKEN)
    .gte('block_time', start.toISOString())
    .lte('block_time', ANCHOR.toISOString())
    .order('block_time', { ascending: true })
    .limit(1000);
  if (error) throw new Error(error.message);
  const launch = 5.546337995470633e-9;
  console.log(`锚窗内 ${data.length} 行（launch=5.546e-9）：`);
  let prev = null;
  for (const r of data) {
    const t = new Date(r.block_time);
    const dt = ((t - ANCHOR) / 1000).toFixed(1);
    const vsL = r.price_bnb ? ((r.price_bnb / launch - 1) * 100).toFixed(1) : 'n/a';
    const p = r.price_outlier ? ' [outlier]' : '';
    const w = (r.sender_address || '').slice(0, 10);
    console.log(`t=${dt}s blk=${r.block_number} ${r.trade_type.padEnd(4)} bnb=${(r.bnb_amount || 0).toFixed(4)} px=${r.price_bnb ? r.price_bnb.toExponential(4) : 'null'} vsL=+${vsL}% ${w}${p}`);
    prev = r;
  }
  // 沉寂段统计：锚前最后一笔成交距锚
  if (data.length) {
    const last = new Date(data[data.length - 1].block_time);
    console.log(`\n最后一笔成交距锚: ${((ANCHOR - last) / 1000).toFixed(1)}s`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
