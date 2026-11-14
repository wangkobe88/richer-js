import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const r = await c.from('strategy_signals')
  .select('id,created_at,status,action,executed,metadata,strategy_id')
  .eq('experiment_id', '5390bbfa-0c86-48a2-b9e1-94537c54ac17')
  .eq('token_address', '0x2591c5cbd66a0a532870f6ceef68f10d25bc7777')
  .order('created_at', { ascending: true });
for (const row of r.data ?? []) {
  console.log('=== signal', row.id, row.created_at, 'action=' + row.action, 'status=' + row.status, 'executed=' + row.executed, 'strategy=' + row.strategy_id);
  const m = row.metadata ?? {};
  const cc = m.cheatCheck ?? {};
  const bp = m.buyPoint ?? {};
  console.log('cheat:', JSON.stringify({
    status: cc.status, grade: cc.grade, cached: cc.cached, reason: cc.reason,
    reasons: cc.reasons, unhealthyGrades: cc.unhealthyGrades, exempt: cc.exempt,
    exemptDenied: cc.exemptDenied, triggerNo: cc.triggerNo,
  }));
  const lv = cc.levels ?? {};
  console.log('levels.activityLevel=', lv.activityLevel, ' sbw(stallBurstWave)=', lv.stallBurstWave);
  console.log('bp:', JSON.stringify({ status: bp.status, bucket: bp.bucket, rule: bp.rule, reason: bp.reason, exempt: bp.exempt, triggerNo: bp.triggerNo, infoKeys: Object.keys(bp.info ?? {}) }));
}
console.log('total', (r.data ?? []).length);
await dbManager.close?.();
