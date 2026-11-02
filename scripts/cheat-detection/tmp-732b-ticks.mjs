#!/usr/bin/env node
/**
 * 一次性查看（0x732b…7777 盘面形状验证，不进 git）：早期逐笔+signal 留痕。本地单 token 小读取。
 */
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');

const ADDR = '0x732bd5190992ecb2365e080c2d3d37880cb17777';
const sb = dbManager.getClient();

// signal 留痕（cheat_gate 拒因）
const { data: sigs } = await sb.from('strategy_signals')
  .select('experiment_id,signal_type,action,created_at,metadata')
  .eq('token_address', ADDR)
  .order('created_at', { ascending: true }).limit(10);
for (const s of sigs ?? []) {
  const m = s.metadata || {};
  const cheat = m.cheatCheck || m.gmgnCheck?.reason || null;
  console.log(`signal ${s.created_at} type=${s.signal_type} action=${s.action} cheatCheck=${JSON.stringify(cheat)?.slice(0, 400)}`);
}
if (!sigs?.length) console.log('（无 signal 行）');

// token meta
const { data: evs } = await sb.from('wss_events')
  .select('platform,payload,block_time').eq('kind', 'token_create').eq('token_address', ADDR).limit(3);
const hit = (evs ?? [])[0];
console.log(`meta: symbol=${hit?.payload?.symbol} name=${hit?.payload?.name} platform=${hit?.platform} createdAt=${hit?.block_time}`);

// 早期逐笔
const { data: ticks, error } = await sb.from('wss_price_ticks')
  .select('block_number,log_index,trade_type,bnb_amount,price_bnb,trader_address,sender_address')
  .eq('token_address', ADDR)
  .order('block_number', { ascending: true }).order('log_index', { ascending: true })
  .limit(80);
if (error) throw new Error(error.message);
console.log(`\n早期逐笔（前 ${ticks.length} 行）：`);
for (const t of ticks) {
  const w = (t.sender_address || t.trader_address || '').slice(0, 10);
  console.log(`blk=${t.block_number} ${t.trade_type.padEnd(4)} bnb=${Number(t.bnb_amount).toFixed(4)} wallet=${w}…`);
}
