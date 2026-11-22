'use strict';
const path = require('path');
require('dotenv').config({ path: '../config/.env' });
const { dbManager } = require('../src/services/dbManager');
const ADDR = '0x0bba00ba64c147a6477fd18720b782a640357777';
const FLOOR = 5.546337995470633e-9;
(async () => {
  const sb = dbManager.getClient();
  const { data: ticks, error } = await sb.from('wss_price_ticks')
    .select('block_time, block_number, trade_type, bnb_amount, price_bnb, sender_address, trader_address')
    .eq('token_address', ADDR)
    .gte('block_time', '2026-10-03T11:26:50Z')
    .lt('block_time', '2026-10-03T11:40:00Z')
    .order('block_time', { ascending: true })
    .limit(1000);
  if (error) throw new Error(error.message);
  console.log('ticks 0~13min:', ticks.length);
  const t0 = new Date('2026-10-03T11:26:50Z');
  const firstPrice = ticks[0].price_bnb;
  const DUST = 0.015 / firstPrice;
  let n = 0, cumBuy = 0;
  const hold = new Map();
  const snap = [];
  let firstOut = null;
  for (const t of ticks) {
    n++;
    const amt = Number(t.bnb_amount);
    const tokens = amt / t.price_bnb;
    const w = (t.sender_address || t.trader_address || '?').toLowerCase();
    if (t.trade_type === 'buy') { cumBuy += amt; hold.set(w, (hold.get(w) || 0) + tokens); }
    else hold.set(w, (hold.get(w) || 0) - tokens);
    const age = (new Date(t.block_time) - t0) / 1000;
    const curVs = (t.price_bnb / FLOOR - 1) * 100;
    if (!firstOut && curVs > 28.5) firstOut = { at: t.block_time, age, curVs };
    const holders = [...hold.values()].filter(v => v >= DUST).length;
    if (age <= 130) snap.push(`a${age.toFixed(0)} n${n} cumBuy${cumBuy.toFixed(2)} hold${holders} curVs${curVs.toFixed(1)}${curVs <= 28.5 ? '' : ' ★穿'}`);
    else if (!snap.some(s => s.startsWith('a131+'))) snap.push('a131+ 之后省略 → 看首次穿出');
  }
  console.log(snap.join('\n'));
  console.log('首次穿出+28.5:', JSON.stringify(firstOut));
  // 11:26:50~11:30:00 全 42 笔明细
  console.log('--- 前 190s 明细 ---');
  for (const t of ticks.slice(0, 42)) {
    const age = ((new Date(t.block_time) - t0) / 1000).toFixed(1);
    console.log(`a${age}s blk${t.block_number} ${t.trade_type} ${Number(t.bnb_amount).toFixed(3)}B @${(t.price_bnb / FLOOR * 100 - 100).toFixed(1)}% w=${(t.sender_address || t.trader_address || '?').slice(0, 10)}`);
  }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
