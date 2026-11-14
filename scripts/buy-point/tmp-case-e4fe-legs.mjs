import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const { data, error } = await c.from('strategy_signals')
  .select('*')
  .eq('experiment_id','5390bbfa-0c86-48a2-b9e1-94537c54ac17')
  .eq('token_address','0xe4fe922f88c09cbe127cebfa25f84d2f00917777')
  .order('created_at');
if (error) throw new Error(JSON.stringify(error));
for (const s of data) {
  console.log(s.created_at, '| leg=', s.strategy_id ?? s.strategyId ?? '?', '| status=', s.status, '| reason=', (s.reason||'').slice(0,60));
  const bp = s.metadata?.buyPoint;
  if (bp && bp.dimensions?.entry_shape) console.log('   entry_shape=', bp.dimensions.entry_shape.bucket, 'rule=', bp.assessment?.rule);
  const ch = s.metadata?.cheatCheck;
  if (ch) console.log('   cheat grade=', ch.grade, 'exempt=', JSON.stringify(ch.exempt), 'denied=', ch.exemptDenied ?? '');
}
process.exit(0);
