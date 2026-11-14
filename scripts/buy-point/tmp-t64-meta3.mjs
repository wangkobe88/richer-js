import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const { data, error } = await c.from('strategy_signals').select('id,created_at,action,executed,metadata')
  .in('id', ['477b8925-18d7-4d53-8b2e-82ecef81096c', 'c8ac25dd-0f80-4177-8573-ee35b198fea3']);
console.log('error:', error ? error.message : 'none', 'rows:', (data ?? []).length);
for (const row of data ?? []) {
  const m = row.metadata ?? {};
  console.log('\n===== signal', row.created_at, row.action, 'executed=' + row.executed, 'metaKeys:', Object.keys(m).join(','));
  const cc = m.cheatCheck ?? {};
  console.log('cheat:', JSON.stringify({ status: cc.status, grade: cc.grade, exempt: cc.exempt, reasons: (cc.reasons || []).map(r => r.code ?? r), levels: { act: cc.levels?.activityLevel, sbw: cc.levels?.stallBurstWave } }));
  const bp = m.buyPoint ?? {};
  console.log('bp keys:', Object.keys(bp).join(','));
  const info = bp.info ?? {};
  console.log('bp.info keys:', Object.keys(info).join(','));
  const dg = info.digest ?? bp.digest ?? null;
  if (dg) {
    console.log('digest keys:', Object.keys(dg).join(','));
    if (dg.famousTraces) console.log('famousTraces:', JSON.stringify(dg.famousTraces).slice(0, 2000));
  }
  if (bp.dimensions) console.log('dims:', JSON.stringify(Object.fromEntries(Object.entries(bp.dimensions).map(([k, v]) => [k, `${v.bucket}/${v.prob}`]))));
  console.log('assessment:', JSON.stringify(bp.assessment ?? null));
}
await dbManager.close?.();
