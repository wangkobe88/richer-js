'use strict';
// 0xfc23（7777 尾=flap 票）在 bt-v164 的信号时间线 + token_create + 23:43:02 UTC 附近 ticks 概览
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const TOKEN = '0xfc23bfc0371d8296d26d034a4e8b155661a57777';
const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';
(async () => {
  const sb = dbManager.getClient();
  // 1. token_create
  const { data: ev, error: evErr } = await sb.from('wss_events')
    .select('kind,block_time,payload').eq('token_address', TOKEN).order('block_time', { ascending: true }).limit(10);
  if (evErr) throw new Error(evErr.message);
  for (const e of (ev || [])) {
    const p = e.payload || {};
    console.log(`[event] ${e.kind} ${e.block_time} symbol=${p.symbol || p.tokenSymbol || ''}`);
  }
  // 2. 信号行全量
  const { data: sigs, error } = await sb.from('strategy_signals')
    .select('created_at,signal_type,action,reason,metadata')
    .eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at', { ascending: true }).limit(50);
  if (error) throw new Error(error.message);
  console.log('\n信号行数:', (sigs || []).length);
  for (const s of (sigs || [])) {
    const md = s.metadata || {};
    const sg = md.signalGate || {};
    console.log(`- ${s.created_at} ${s.signal_type}/${s.action} reason=${s.reason || ''}${sg.legId ? ' leg=' + sg.legId : ''}${sg.trigger ? ' trigger#' + sg.trigger : ''}`);
  }
  // 3. 23:43:02 附近 ticks（哪个日期？先看 token_create 的日期）
  const createRow = (ev || []).find(e => e.kind === 'token_create');
  if (!createRow) { console.log('\n无 token_create，无法定日期'); process.exit(0); }
  const d = new Date(createRow.block_time);
  const day = d.toISOString().slice(0, 10);
  const t0 = `${day}T15:41:00Z`, t1 = `${day}T15:46:00Z`;
  const { data: ticks, error: tkErr } = await sb.from('wss_price_ticks')
    .select('block_time,price,amount_bnb,sender_address,trader_address,tx_hash')
    .eq('token_address', TOKEN).gte('block_time', t0).lte('block_time', t1)
    .order('block_time', { ascending: true }).limit(400);
  if (tkErr) throw new Error(tkErr.message);
  console.log(`\nticks ${t0}~${t1}: ${(ticks || []).length} 行`);
  let buyN = 0, sellN = 0, vol = 0;
  for (const t of (ticks || [])) {
    const isSell = t.trader_address && false; // 方向看 price 相对，粗略不做
    vol += Number(t.amount_bnb || 0);
  }
  console.log('粗略合计 amount_bnb:', vol.toFixed(3), '（首/末 3 行 ↓）');
  for (const t of (ticks || []).slice(0, 3)) console.log('  head', t.block_time, t.price, t.amount_bnb);
  for (const t of (ticks || []).slice(-3)) console.log('  tail', t.block_time, t.price, t.amount_bnb);
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
