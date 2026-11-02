const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
(async () => {
  const { data: rows, error } = await dbManager.getClient().from('experiments')
    .select('id,experiment_name,created_at,config')
    .eq('trading_mode', 'live').gte('created_at', new Date(Date.now() - 3 * 86400000).toISOString());
  if (error) { console.log('ERR', error.message); process.exit(1); }
  for (const r of rows || []) {
    if (!String(r.id).startsWith('d41b9c29')) continue;
    console.log('exp:', r.experiment_name, r.created_at);
    const sc = (r.config && r.config.strategiesConfig) || {};
    for (const [i, leg] of ((sc.buyStrategies) || []).entries()) {
      console.log(`\n--- buy leg ${i}: ${leg.name || ''}`);
      console.log('trigger:', leg.narrativeTriggerCondition);
      console.log('condition:', leg.condition);
      console.log('repeat:', leg.repeatBuyCheckCondition);
      console.log('gmgnCond:', leg.gmgnCheckCondition);
    }
    const fw = r.config || {};
    console.log('\nfourmemeWs.observationSignals:', JSON.stringify((fw.fourmemeWs && fw.fourmemeWs.observationSignals) || {}));
    console.log('flapWs.observationSignals:', JSON.stringify((fw.flapWs && fw.flapWs.observationSignals) || {}));
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
