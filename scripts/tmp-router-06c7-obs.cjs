require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
async function main() {
  const sb = dbManager.getClient();
  const r = await sb.from('cheat_detection').select('*')
    .eq('token_address', '0x06c78718d19d9a19721d4794f80606976e428888').limit(3);
  if (r.data && r.data.length) {
    console.log('cols:', Object.keys(r.data[0]).join(','));
    for (const row of r.data) {
      const d = row.digest || {};
      console.log('row ts=', row.detected_at || row.block_time || row.id, 'grade=', row.grade,
        '\n  anchors.routerEntryBuyPct=', d.anchors && d.anchors.routerEntryBuyPct,
        '\n  activityLevel=', d.activityLevel, 'facts.spanSec=', d.anchors && d.anchors.spanSec, 'tickCount=', d.anchors && d.anchors.tickCount);
    }
  } else console.log('no rows / err:', r.error && r.error.message);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
