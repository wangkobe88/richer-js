#!/usr/bin/env node
// 一次性：0x1a08 票——信号完整 metadata + 全量 ticks 时间线（找 burst）。用后可删。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';
const TOKEN = '0x1a0810861af30ed2b85ec2c195f36fb58fc97777';

(async () => {
  const sb = dbManager.getClient();

  // 1) 信号完整 metadata
  const { data: sigs, error: e2 } = await sb.from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(50);
  if (e2) throw new Error(e2.message);
  console.log(`=== 信号行 ${sigs.length} 条 ===`);
  for (const s of sigs) {
    console.log('--- id', s.id, 'at', s.created_at, 'action', s.action, 'type', s.signal_type);
    console.log(JSON.stringify(s.metadata, null, 1));
  }

  // 2) 全量 ticks（274 条小票）——按 (block_time, log_index) 排
  const { data: ticks, error: e3 } = await sb.from('wss_price_ticks')
    .select('block_number, log_index, trade_type, price_usd, bnb_amount, block_time, sender_address, trader_address')
    .eq('token_address', TOKEN)
    .order('block_time', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(1000);
  if (e3) throw new Error(e3.message);
  console.log(`\n=== ticks ${ticks.length} 条 ===`);
  let prev = null;
  for (const t of ticks) {
    const dt = prev ? (new Date(t.block_time) - new Date(prev)) / 1000 : 0;
    console.log([
      t.block_time,
      'bn=' + t.block_number,
      'li=' + t.log_index,
      'side=' + (t.trade_type || '?'),
      'usd=' + (t.price_usd != null ? Number(t.price_usd).toFixed(6) : 'null'),
      'bnb=' + (t.bnb_amount != null ? Number(t.bnb_amount).toFixed(3) : 'null'),
      'dt=' + dt.toFixed(1) + 's',
    ].join(' '));
    prev = t.block_time;
  }

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
