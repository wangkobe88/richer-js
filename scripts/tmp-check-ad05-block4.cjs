const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const EXP = '0e7c7e09-5b3c-4e14-b039-fce040199f83';
(async () => {
  const { dbManager } = require('../src/services/dbManager.js');
  const client = dbManager.getClient();
  const { data: exp, error } = await client.from('experiments').select('config').eq('id', EXP).single();
  if (error) { console.error('err', error.message); process.exit(1); }
  const cfg = exp.config || {};
  console.log('config top keys:', Object.keys(cfg));
  const sc = cfg.strategiesConfig || {};
  console.log('strategiesConfig keys:', Object.keys(sc));
  const legs = sc.strategies || sc.legs || [];
  console.log('legs:', legs.length);
  for (const leg of legs) {
    if (leg.side === 'buy') {
      console.log('\n=== LEG:', leg.name, '| buyPhase:', leg.buyPhase, '| maxExecutions:', leg.maxExecutions);
      console.log('narrativeTriggerCondition:', leg.narrativeTriggerCondition);
      console.log('condition:\n', leg.condition);
      console.log('gmgnCheckCondition:', leg.gmgnCheckCondition);
    }
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
