const path = require('path'); require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager.js');
const db = dbManager.getClient();
(async () => {
  const { data, error } = await db.from('experiments').select('id,status,started_at,ended_at').eq('id', '977689d2-e381-4f0d-9b08-694a56d50f21').limit(1);
  if (error) { console.log('err', error.message); process.exit(1); }
  if (!data || !data.length) { console.log('not found'); process.exit(1); }
  console.log(JSON.stringify(data[0]));
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
