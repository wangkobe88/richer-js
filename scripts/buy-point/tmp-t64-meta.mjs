import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const { data } = await c.from('strategy_signals').select('id,created_at,action,status,metadata')
  .in('id', ['477b8925-18d7-4d53-8b2e-82ecef81096c', 'c8ac25dd-0f80-4177-8573-ee35b198fea3']);
for (const row of data ?? []) {
  const m = row.metadata ?? {};
  console.log('\n===== signal', row.created_at, row.action, row.status, 'metaKeys:', Object.keys(m).join(','));
  const cc = m.cheatCheck ?? {};
  console.log('cheat:', JSON.stringify({ status: cc.status, grade: cc.grade, exempt: cc.exempt, reasons: (cc.reasons || []).map(r => r.code), info: cc.info ? { grade: cc.info.grade, reasons: cc.info.reasons } : null }));
  const bp = m.buyPoint ?? {};
  console.log('bp keys:', Object.keys(bp).join(','));
  const info = bp.info ?? {};
  console.log('bp.info keys:', Object.keys(info).join(','));
  if (info.digest) {
    const dg = info.digest;
    console.log('digest keys:', Object.keys(dg).join(','));
    if (dg.famousTraces) console.log('famousTraces:', JSON.stringify(dg.famousTraces).slice(0, 1200));
  }
  if (bp.dimensions) console.log('dims:', JSON.stringify(Object.fromEntries(Object.entries(bp.dimensions).map(([k, v]) => [k, `${v.bucket}/${v.prob}`]))));
  console.log('assessment:', JSON.stringify(bp.assessment ?? null));
}
await dbManager.destroy?.();
