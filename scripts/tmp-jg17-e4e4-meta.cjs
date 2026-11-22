'use strict';
// JG-17 补查：P2 信号 (14:22:21 arms=[]) 完整门链 metadata
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const TOKEN = '0xe4e4149ed653e10d45d640f14445ae744ffb7777';
const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';
(async () => {
  const sb = dbManager.getClient();
  const { data: sigs, error } = await sb.from('strategy_signals')
    .select('created_at,metadata')
    .eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at', { ascending: true }).limit(30);
  if (error) throw new Error(error.message);
  for (const s of (sigs || [])) {
    const md = s.metadata || {};
    const gate = md.signalGate || {};
    const parts = [];
    for (const k of ['factorCheck', 'actFrontGate', 'cheatCheck', 'buyPoint']) {
      if (md[k]) parts.push(`${k}: ${JSON.stringify(md[k]).slice(0, 300)}`);
    }
    if (gate.decision || gate.reason) parts.push(`signalGate.decision=${gate.decision}/${gate.reason}`);
    console.log(`\n=== ${s.created_at} ===`);
    console.log(parts.join('\n') || '(无门链段)');
  }
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
