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
    .limit(50);
  if (error) throw new Error(error.message);
  console.error('rows:', sigs.length);
  for (const s of sigs) {
    const m = s.metadata || {};
    console.log(JSON.stringify({
      at: s.created_at, type: s.signal_type, action: s.action, status: s.status,
      leg: s.leg_id, reason: s.reason,
      fp: m.factorCheck ? { pass: m.factorCheck.pass, rule: m.factorCheck.rule, value: m.factorCheck.value } : undefined,
      actFront: m.actFrontGate ? { pass: m.actFrontGate.pass, act: m.actFrontGate.activityLevel, sbw: m.actFrontGate.stallBurstWave } : undefined,
      cheat: m.cheatCheck ? { grade: m.cheatCheck.grade, act: m.cheatCheck.activityLevel } : undefined,
      bp: m.buyPoint ? { status: m.buyPoint.status, bucket: m.buyPoint.bucket } : undefined,
      fpRetry: m.fpRetry,
      factorSample: m.factors ? { curVs: m.factors.currentVsLaunchPct, act: m.factors.actTotalBnb, age: m.factors.tokenAgeSec, mcap: m.factors.marketCapBnb } : undefined,
    }));
  }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
