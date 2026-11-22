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
  const t0 = new Date('2026-10-03T11:26:50Z');
  const DUST = 0.015 / ticks[0].price_bnb;
  const hold = new Map();
  let n = 0, inDomain = 0, miss = { holders: 0 };
  const hits = [];
  for (const t of ticks) {
    n++;
    const amt = Number(t.bnb_amount);
    const tokens = amt / t.price_bnb;
    const w = (t.sender_address || t.trader_address || '?').toLowerCase();
    if (t.trade_type === 'buy') hold.set(w, (hold.get(w) || 0) + tokens);
    else hold.set(w, (hold.get(w) || 0) - tokens);
    const age = (new Date(t.block_time) - t0) / 1000;
    const curVs = (t.price_bnb / FLOOR - 1) * 100;
    if (curVs <= 28.5) inDomain++;
    // P1 可触发时刻：age>=15（60s 后 OR 臂恒过）+ 价格域内 + holders>=4
    if (age >= 15 && curVs <= 28.5) {
      const holders = [...hold.values()].filter(v => v >= DUST).length;
      if (holders >= 4) hits.push(`a${age.toFixed(0)}s n${n} hold${holders} curVs${curVs.toFixed(1)}% ← 若条件全真此处应触发`);
      else miss.holders++;
    }
  }
  console.log('13min 内域内 tick:', inDomain, '/ 域内且age>=15但 holders<4:', miss.holders);
  console.log('域内+age>=15+holders>=4 命中:', hits.length);
  console.log(hits.slice(0, 10).join('\n'));
  // 峰值前最后进域时刻与拉升起跳点
  let lastIn = null, peak = { p: 0 };
  for (const t of ticks) {
    const age = (new Date(t.block_time) - t0) / 1000;
    const curVs = (t.price_bnb / FLOOR - 1) * 100;
    if (curVs <= 28.5 && age >= 48) lastIn = { a: age.toFixed(0), curVs: curVs.toFixed(1), at: t.block_time };
    if (t.price_bnb > peak.p) peak = { p: t.price_bnb, a: age.toFixed(0), at: t.block_time, curVs: curVs.toFixed(0) };
  }
  console.log('a48s 后最后域内 tick:', JSON.stringify(lastIn), ' 13min 峰:', JSON.stringify(peak));
  // 起跳段：a48s 之后前 30 笔
  const after = ticks.filter(t => (new Date(t.block_time) - t0) / 1000 >= 48);
  for (const t of after.slice(0, 30)) {
    const age = ((new Date(t.block_time) - t0) / 1000).toFixed(0);
    console.log(`a${age}s ${t.trade_type} ${Number(t.bnb_amount).toFixed(3)}B @${(t.price_bnb / FLOOR * 100 - 100).toFixed(1)}% w=${(t.sender_address || t.trader_address || '?').slice(0, 10)}`);
  }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
