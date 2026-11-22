'use strict';
const path = require('path');
require('dotenv').config({ path: path.join('/Users/nobody1/Desktop/Codes/richer-js/config/.env') });
const { dbManager } = require('/Users/nobody1/Desktop/Codes/richer-js/src/services/dbManager');
const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';
const ADDR = '0x39ed13ccb5e067b7fce459548501cf2659287777';
(async () => {
  const sb = dbManager.getClient();
  const { data: et } = await sb.from('experiment_tokens')
    .select('*').eq('experiment_id', EXP).eq('token_address', ADDR).maybeSingle();
  console.log('experiment_tokens:', et ? JSON.stringify({ token_symbol: et.token_symbol, platform: et.platform, status: et.status, first_seen: et.first_seen_at, created: et.created_at }) : '不存在');
  const { data: sigs, count } = await sb.from('strategy_signals')
    .select('id', { count: 'exact', head: true })
    .eq('experiment_id', EXP).eq('token_address', ADDR);
  console.log('strategy_signals 条数:', count);
  const { data: trs } = await sb.from('trades')
    .select('id', { count: 'exact', head: true })
    .eq('experiment_id', EXP).eq('token_address', ADDR);
  console.log('trades 条数:', trs);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
