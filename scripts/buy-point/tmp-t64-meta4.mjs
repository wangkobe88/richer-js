import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const { data } = await c.from('strategy_signals').select('id,created_at,metadata')
  .in('id', ['c8ac25dd-0f80-4177-8573-ee35b198fea3']);
const bp = data[0].metadata.buyPoint;
console.log('bp.passed=', bp.passed, 'status=', bp.status);
console.log('assessment:', JSON.stringify(bp.assessment));
for (const [k, v] of Object.entries(bp.dimensions ?? {})) {
  console.log(`dim ${k}:`, v ? `${v.bucket}/${v.prob}` : 'null');
}
console.log('anchors:', JSON.stringify(bp.anchors ?? null));
await dbManager.close?.();
