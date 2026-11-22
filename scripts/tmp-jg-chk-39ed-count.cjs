'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';
const ADDR = '0x39ed13ccb5e067b7fce459548501cf2659287777';
(async () => {
  const sb = dbManager.getClient();
  const { count } = await sb.from('experiment_tokens').select('id', { count: 'exact', head: true }).eq('experiment_id', EXP);
  console.log('experiment_tokens 总数:', count);
  const { data: et } = await sb.from('experiment_tokens').select('token_address, token_symbol, max_change_percent, discovered_at').eq('experiment_id', EXP).eq('token_address', ADDR).maybeSingle();
  console.log('该票行:', JSON.stringify(et));
  const { data: tp } = await sb.from('token_profiles').select('token_address, max_change_percent, updated_at').eq('token_address', ADDR).maybeSingle();
  console.log('token_profiles:', JSON.stringify(tp));
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
