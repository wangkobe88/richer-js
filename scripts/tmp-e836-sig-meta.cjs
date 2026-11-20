#!/usr/bin/env node
// e836 案：信号 metadata 全量 dump（actFrontGate/cheatCheck/signalGate/buyPoint 段）
const { dbManager } = require('../src/services/dbManager');
const TOKEN = '0xe83626c404ee63b68ae2a7cdb17fd7d4d2c77777';

(async () => {
  const sb = dbManager.getClient();
  const { data: sigs, error } = await sb.from('strategy_signals')
    .select('id,signal_type,created_at,metadata,reason')
    .eq('experiment_id', '7d60bc05-8c4e-4f0d-993c-6f2d02428ea7')
    .eq('token_address', TOKEN).order('created_at', { ascending: true }).limit(30);
  if (error) throw error;
  for (const s of sigs) {
    const m = s.metadata || {};
    console.log('=== signal', s.created_at, s.signal_type, 'reason:', s.reason);
    for (const key of ['signalGate', 'actFrontGate', 'cheatCheck', 'buyPoint', 'factorCheck']) {
      if (m[key]) console.log(key + ':', JSON.stringify(m[key], null, 1));
    }
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
