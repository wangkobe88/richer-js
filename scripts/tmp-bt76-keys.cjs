const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
(async () => {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();
  const { data } = await db.from('experiments').select('config').eq('id', 'b67513a8-a389-4297-86d0-868a5b8eab1a').limit(1);
  const cfg = data[0].config;
  console.log('top keys:', Object.keys(cfg).join(', '));
  const sk = cfg.strategies || cfg.strategiesConfig || {};
  console.log('strategies keys:', Object.keys(sk).join(', '));
  const buys = sk.buyStrategies || sk.buy || [];
  console.log('buy legs:', buys.length);
  for (const l of buys) console.log(`  p${l.priority} ${l.condition} gate=${JSON.stringify(l.signalGate)} phase=${l.buyPhase}`);
  const sells = sk.sellStrategies || sk.sell || [];
  console.log('sell legs:', sells.length);
  for (const l of sells) console.log(`  p${l.priority} ${l.name||''} ${l.condition}`);
  console.log('fourmemeWs keys:', Object.keys(cfg.fourmemeWs || {}).join(', '));
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
