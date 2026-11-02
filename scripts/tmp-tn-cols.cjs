const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager.js');
const db = dbManager.getClient();
(async () => {
  const { data, error } = await db.from('token_narrative')
    .select('token_address, analyzed_at, stage1_rating')
    .limit(1);
  if (error) { console.error('ERR:', error.message); }
  else console.log('ok:', JSON.stringify(data[0]).slice(0, 200));
  dbManager.destroy?.();
})().catch((e) => { console.error(e.message); process.exit(1); });
