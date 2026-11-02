const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
(async () => {
  const { dbManager } = require('../src/services/dbManager.js');
  const c = dbManager.getClient();
  const { data: tr } = await c.from('trades').select('token_address,metadata')
    .eq('experiment_id', 'c53a703a-5b9a-4c03-a874-64e3f65fd6f8')
    .eq('trade_direction', 'buy').limit(2);
  for (const t of tr) {
    const fk = Object.keys(t.metadata?.factors || {});
    console.log('TRADE', t.token_address.slice(0, 10), 'factors keys:', fk.join(','));
    console.log('  trendFactors:', JSON.stringify(t.metadata?.factors?.trendFactors).slice(0, 500));
  }
  const { data: sg } = await c.from('strategy_signals').select('token_address,metadata')
    .eq('experiment_id', 'c53a703a-5b9a-4c03-a874-64e3f65fd6f8')
    .eq('action', 'buy').limit(2);
  for (const s of sg) {
    const md = s.metadata || {};
    console.log('SIG', s.token_address.slice(0, 10), 'md keys:', Object.keys(md).join(','));
    console.log('  narrativeRating:', md.factors?.narrativeRating, 'strategyName:', md.strategyName);
  }
  process.exit(0);
})();
