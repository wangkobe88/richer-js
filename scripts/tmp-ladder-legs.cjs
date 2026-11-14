const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
(async () => {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();
  const { data, error } = await db.from('strategy_library')
    .select('id,name,version,legs')
    .eq('name', 'signal-source-ladder').order('version', { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  const row = data[0];
  console.log('version:', row.version);
  for (const leg of JSON.parse(row.legs)) {
    console.log(`  [${leg.priority}] ${leg.id} ${leg.side} :: ${leg.condition}`);
  }
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
