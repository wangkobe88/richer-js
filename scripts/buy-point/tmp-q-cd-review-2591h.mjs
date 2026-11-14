import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const tok = '0x2591c5cbd66a0a532870f6ceef68f10d25bc7777';
const s = await c.from('strategy_signals').select('id,token_symbol,signal_type,action,reason,confidence,executed,created_at,metadata')
  .eq('experiment_id','5390bbfa-0c86-48a2-b9e1-94537c54ac17')
  .ilike('token_address', tok).order('created_at',{ascending:true}).limit(40);
for (const row of s.data ?? []) {
  const m = row.metadata ?? {};
  const cc = m.cheatCheck ?? {};
  const bp = m.buyPoint ?? {};
  console.log('=== sig', row.created_at, row.token_symbol, row.signal_type, row.action, 'exec=' + row.executed, 'conf=' + row.confidence);
  console.log('  reason:', (row.reason ?? '').slice(0, 120));
  console.log('  cheat:', JSON.stringify({ status: cc.status, grade: cc.grade, cached: cc.cached, reason: cc.reason, reasons: cc.reasons, exempt: cc.exempt, exemptDenied: cc.exemptDenied, unhealthyGrades: cc.unhealthyGrades, triggerNo: cc.triggerNo }));
  const lv = cc.levels ?? {};
  console.log('  lv: activity=' + lv.activityLevel, 'sbw=' + lv.stallBurstWave, 'washPair=' + lv.washPair, 'sgp=' + lv.slowGrindPump, 'tier=' + lv.amountTiering, 'bw=' + lv.burstWave, 'rat=' + lv.abnormalBehaviorRatio);
  console.log('  bp:', JSON.stringify({ status: bp.status, bucket: bp.bucket, rule: bp.rule, reason: bp.reason, exempt: bp.exempt }));
}
console.log('total:', (s.data ?? []).length);
await dbManager.close?.();
