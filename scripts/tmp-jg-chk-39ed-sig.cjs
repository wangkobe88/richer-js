'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';
const ADDR = '0x39ed13ccb5e067b7fce459548501cf2659287777';
(async () => {
  const sb = dbManager.getClient();
  const { data: sigs, error } = await sb.from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP).eq('token_address', ADDR);
  if (error) throw new Error(error.message);
  console.error('rows:', JSON.stringify(sigs));
  for (const s of sigs) {
    const m = s.metadata || {};
    console.log(JSON.stringify({
      created_at: s.created_at, type: s.signal_type, action: s.action, status: s.status,
      leg: s.leg_id, reason: s.reason, symbol: s.token_symbol,
      factorRule: m.factorCheck?.rule, cheatGrade: m.cheatCheck?.grade, cheatAct: m.cheatCheck?.activityLevel,
      bp: m.buyPoint?.status, bpBucket: m.buyPoint?.bucket, narrativeRating: m.narrativeRating,
    }, null, 1));
  }
})().catch(e => { console.error('FAIL:', e.message, e); process.exit(1); });
