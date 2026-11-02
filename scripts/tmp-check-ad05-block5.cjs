const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const EXP = '0e7c7e09-5b3c-4e14-b039-fce040199f83';
(async () => {
  const { dbManager } = require('../src/services/dbManager.js');
  const client = dbManager.getClient();
  const { data: exp } = await client.from('experiments').select('config').eq('id', EXP).single();
  const sc = exp.config.strategiesConfig;
  for (const leg of (sc.buyStrategies || [])) {
    console.log('=== LEG:', leg.name, '| buyPhase:', leg.buyPhase, '| maxExecutions:', leg.maxExecutions);
    console.log('trigger:', leg.narrativeTriggerCondition);
    console.log('condition:\n' + leg.condition + '\n');
    console.log('gmgn:', leg.gmgnCheckCondition, '\n---');
  }
  console.log('libraryRefs:', JSON.stringify(sc.libraryRefs));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
