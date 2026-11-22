'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';
const ADDR = '0x2ee9458681c134e9c7cd933b7af94be50a1f7777';
(async () => {
  const sb = dbManager.getClient();
  const { data: sigs, error } = await sb.from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP).eq('token_address', ADDR);
  if (error) throw new Error(error.message);
  console.error('rows:', sigs.length);
  for (const s of sigs) {
    const m = s.metadata || {};
    console.log('=====', s.created_at, s.signal_type, s.action, 'status=' + s.status, 'leg=' + s.leg_id, '=====');
    console.log(JSON.stringify({
      reason: s.reason,
      signalGate: m.signalGate,
      factorCheck: m.factorCheck,
      cheatCheck: m.cheatCheck,
      buyPoint: m.buyPoint,
      narrativeRating: m.narrativeRating,
    }, null, 1));
  }
})().catch(e => { console.error('FAIL:', e.message, e); process.exit(1); });
