'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const ADDR = '0x0bba00ba64c147a6477fd18720b782a640357777';
(async () => {
  const sb = dbManager.getClient();
  // token_create 锚
  const { data: evs } = await sb.from('wss_events')
    .select('kind, block_time, payload')
    .eq('token_address', ADDR)
    .order('block_time', { ascending: true }).limit(5);
  console.error('events:', JSON.stringify(evs));
  if (!evs || !evs.length) { console.log('no token_create event'); }
  const t0 = evs && evs[0] ? new Date(evs[0].block_time) : null;
  // 早期 ticks：首个 30 分钟（限 400 行）看成交节奏与价格
  const start = t0 || new Date('2026-10-03T11:00:00Z');
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const { data: ticks, error } = await sb.from('wss_price_ticks')
    .select('block_time, trade_type, bnb_amount, price_bnb')
    .eq('token_address', ADDR)
    .gte('block_time', start.toISOString())
    .lt('block_time', end.toISOString())
    .order('block_time', { ascending: true })
    .limit(400);
  if (error) throw new Error(error.message);
  console.log('early 30min tick count:', ticks.length);
  const launch = ticks.length ? ticks[0].price_bnb : null;
  let maxP = 0, maxAt = null;
  for (const t of ticks) if (t.price_bnb > maxP) { maxP = t.price_bnb; maxAt = t.block_time; }
  const fmt = (t) => `${t.block_time.slice(11,19)} ${t.trade_type} ${Number(t.bnb_amount).toFixed(3)}B @${t.price_bnb.toExponential(4)}`;
  for (let i = 0; i < Math.min(ticks.length, 12); i++) console.log(fmt(ticks[i]));
  console.log('...');
  console.log('30min 内峰值:', maxAt, maxP.toExponential(4), 'vs 首价', launch && launch.toExponential(4), '→ +' + ((maxP / launch - 1) * 100).toFixed(1) + '%');
  // 8 小时窗内每 30 分钟成交笔数（小批量聚合本地算）
  const { data: all, error: e2 } = await sb.from('wss_price_ticks')
    .select('block_time, trade_type, bnb_amount, price_bnb')
    .eq('token_address', ADDR)
    .gte('block_time', start.toISOString())
    .lt('block_time', new Date(start.getTime() + 9 * 3600 * 1000).toISOString())
    .order('block_time', { ascending: true })
    .limit(3000);
  if (e2) throw new Error(e2.message);
  console.log('9h tick count:', all.length);
  const buckets = {};
  for (const t of all) {
    const k = Math.floor((new Date(t.block_time) - start) / (30 * 60 * 1000));
    if (!buckets[k]) buckets[k] = { n: 0, bnb: 0, hi: 0, lo: Infinity, buys: 0 };
    const b = buckets[k];
    b.n++; b.bnb += Number(t.bnb_amount); if (t.trade_type === 'BUY') b.buys++;
    b.hi = Math.max(b.hi, t.price_bnb); b.lo = Math.min(b.lo, t.price_bnb);
  }
  for (const k of Object.keys(buckets).map(Number).sort((a, b) => a - b)) {
    const b = buckets[k];
    console.log(`+${(k * 30 + 30)}min 笔${b.n}(买${b.buys}) ${b.bnb.toFixed(2)}B 价 ${(b.lo).toExponential(3)}~${(b.hi).toExponential(3)}`);
  }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
