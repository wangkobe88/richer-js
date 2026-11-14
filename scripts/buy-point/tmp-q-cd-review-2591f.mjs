import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const e0 = await c.from('experiments').select('*').eq('id','5390bbfa-0c86-48a2-b9e1-94537c54ac17').maybeSingle();
if (e0.error) console.log('err:', JSON.stringify(e0.error));
const x = e0.data ?? {};
console.log('experiment:', JSON.stringify({ id: x.id, name: x.experiment_name ?? x.title ?? x.label, status: x.status, platform: x.platform, type: x.type, mode: x.mode, created_at: x.created_at, configKeys: Object.keys(x.config ?? {}) }));
const tok = '0x2591c5cbd66a0a532870f6ceef68f10d25bc7777';
const s = await c.from('strategy_signals').select('id,created_at,action,status,executed,strategy_id,metadata')
  .eq('experiment_id','5390bbfa-0c86-48a2-b9e1-94537c54ac17')
  .ilike('token_address', tok).order('created_at',{ascending:true}).limit(30);
if (s.error) console.log('signals err:', JSON.stringify(s.error));
for (const row of s.data ?? []) {
  const m = row.metadata ?? {};
  const cc = m.cheatCheck ?? {};
  const bp = m.buyPoint ?? {};
  console.log('=== sig', row.created_at, row.action, row.status, 'exec=' + row.executed, 'strat=' + row.strategy_id);
  console.log('cheat:', JSON.stringify({ status: cc.status, grade: cc.grade, cached: cc.cached, reason: cc.reason, reasons: cc.reasons, exempt: cc.exempt, exemptDenied: cc.exemptDenied, unhealthyGrades: cc.unhealthyGrades }));
  const lv = cc.levels ?? {};
  console.log('activityLevel=', lv.activityLevel, ' stallBurstWave=', lv.stallBurstWave, ' washPair=', lv.washPair, ' slowGrindPump=', lv.slowGrindPump);
  console.log('bp:', JSON.stringify({ status: bp.status, bucket: bp.bucket, rule: bp.rule, reason: bp.reason, exempt: bp.exempt }));
}
console.log('total signals:', (s.data ?? []).length);
await dbManager.close?.();
