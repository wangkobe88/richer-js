require('dotenv').config({ path: './config/.env' });
const fs = require('fs');
const { dbManager } = require('./src/services/dbManager');
(async () => {
  const db = dbManager.getClient();
  const { data } = await db.from('strategy_signals').select('*').eq('id', 'af118777-0ab8-4da9-aee9-71c9249181aa').limit(1);
  const s = data && data[0];
  fs.writeFileSync('tmp-diag-7f25-signal2.json', JSON.stringify(s, null, 2));
  const bp = (s.metadata||{}).buyPoint || {};
  console.log('bp keys:', Object.keys(bp).join(','));
  console.log('status:', bp.status, '| passed:', bp.passed);
  const as = bp.assessment;
  if (as) {
    console.log('\n--- assessment ---');
    console.log(JSON.stringify(as, null, 2).slice(0, 3000));
  }
  const dims = bp.dimensions || bp.answers;
  if (dims) {
    console.log('\n--- dimensions/answers ---');
    console.log(JSON.stringify(dims, null, 2).slice(0, 4000));
  }
  const an = bp.anchors || {};
  if (an && Object.keys(an).length) {
    console.log('\n--- anchors ---');
    for (const k of ['totalVolumeBnb','curVsLaunchPct','dumpBlockSellBnb','dumpBlockRatio','dump2BlockRatio','followBuyBnb','secToAnchor','anchorSellCount','minVsLaunchPct','athVsLaunchPct'])
      if (an[k] !== undefined) console.log(' ', k, '=', JSON.stringify(an[k]));
    console.log(' anchor keys:', Object.keys(an).join(','));
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
