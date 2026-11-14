import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const e = await c.from('experiments').select('config').eq('id','5390bbfa-0c86-48a2-b9e1-94537c54ac17').maybeSingle();
const cfg = e.data?.config ?? {};
console.log('cheatCheck config:', JSON.stringify(cfg.fourmemeWs?.cheatCheck ?? null));
console.log('buyPointCheck config:', JSON.stringify(cfg.fourmemeWs?.buyPointCheck ?? null));
const tok = '0x2591c5cbd66a0a532870f6ceef68f10d25bc7777';
const s = await c.from('strategy_signals').select('created_at,metadata')
  .eq('experiment_id','5390bbfa-0c86-48a2-b9e1-94537c54ac17')
  .ilike('token_address', tok).eq('action','buy').order('created_at',{ascending:true}).limit(5);
for (const row of s.data ?? []) {
  const cc = row.metadata?.cheatCheck ?? {};
  console.log('=== BUY', row.created_at, 'cheatCheck keys:', Object.keys(cc).join(','));
  console.log('  exemptRelated:', JSON.stringify({ exempt: cc.exempt, exemptDenied: cc.exemptDenied, originalGrade: cc.originalGrade, grade: cc.grade, activityLevel: cc.levels?.activityLevel, alwaysRecheck: cc.alwaysRecheck }));
}
await dbManager.close?.();
