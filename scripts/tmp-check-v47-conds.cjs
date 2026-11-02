const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager.js');
const db = dbManager.getClient();
(async () => {
  const v47 = '0b08a8d8-da10-4ffc-a8c9-eafab92d6144';
  const { data: cfg } = await db.from('experiments').select('config').eq('id', v47).single();
  const sc = cfg.config.strategiesConfig;
  for (const s of (sc.buyStrategies || [])) {
    console.log(`\n===== buy 策略（desc=${s.description}）`);
    console.log('trigger:', s.narrativeTriggerCondition);
    console.log('condition:', s.condition);
    console.log('gmgn:', s.gmgnCheckCondition);
  }
  dbManager.destroy?.();
})().catch((e) => { console.error(e.message); process.exit(1); });
