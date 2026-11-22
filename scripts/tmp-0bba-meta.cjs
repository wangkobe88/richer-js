'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';
const ADDR = '0x0bba00ba64c147a6477fd18720b782a640357777';
(async () => {
  const sb = dbManager.getClient();
  const { data: sigs, error } = await sb.from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP).eq('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(5);
  if (error) throw new Error(error.message);
  for (const s of sigs) {
    console.log('created_at:', s.created_at, 'status:', s.status, 'leg:', s.leg_id);
    console.log('metadata:', JSON.stringify(s.metadata, null, 1));
  }
  const { data: trades } = await sb.from('trades')
    .select('created_at,side,amount_bnb,metadata')
    .eq('experiment_id', EXP).eq('token_address', ADDR).limit(20);
  console.error('trades:', JSON.stringify(trades));
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
