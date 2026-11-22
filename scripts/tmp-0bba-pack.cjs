'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
(async () => {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('strategy_library')
    .select('name, version, definition')
    .eq('name', 'trading-standard-v1')
    .order('version', { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  const def = data[0].definition;
  console.log('pack:', data[0].name, 'v' + data[0].version, 'buyLegs:', def.buyLegs.length);
  const leg = def.buyLegs.find(l => l.id === 'buy_0_1') || def.buyLegs[0];
  console.log('LEG:', JSON.stringify(leg, null, 1).slice(0, 3000));
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
