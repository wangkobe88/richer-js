require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const EXP = 'd29420e7-9d5a-48b4-9e72-0b3dfe00c22f';
const TOK = '0x4fe71b03ed8be235fb2b7671f8b84caecad57777';

async function main() {
  const sb = dbManager.getClient();
  const { data, error } = await sb
    .from('strategy_signals')
    .select('id, created_at, signal_type, action, metadata')
    .eq('experiment_id', EXP)
    .eq('token_address', TOK)
    .order('created_at', { ascending: true })
    .limit(20);
  if (error) { console.error('ERR', error.message); process.exit(1); }
  console.log('rows:', data.length);
  for (const r of data) {
    const md = r.metadata || {};
    console.log('=== signal', r.id, r.created_at, r.signal_type, r.action, r.execution_status);
    const af = md.actFrontGate;
    if (af) console.log(' actFront:', JSON.stringify(af));
    const ch = md.cheatCheck;
    if (ch) console.log(' cheat:', JSON.stringify({ grade: ch.grade, activityLevel: ch.levels && ch.levels.activityLevel, levelsKeys: ch.levels ? Object.keys(ch.levels) : null }));
    const bp = md.buyPoint;
    if (bp) {
      const q = bp.qualities || {};
      console.log(' bp qualities:', JSON.stringify(q).slice(0, 800));
      console.log(' bp info keys:', Object.keys(bp));
    }
    const fc = md.factorCheck;
    if (fc) console.log(' factorCheck:', JSON.stringify(fc).slice(0, 300));
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
