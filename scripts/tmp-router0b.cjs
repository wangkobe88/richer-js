require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
async function main() {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('experiments').select('id,name,status').limit(500);
  if (error) { console.error(error.message); process.exit(1); }
  for (const e of (data||[]).filter(e => /bt-v1(4[0-9]|5[0-9]|6[0-9])/.test(e.name||''))) console.log(e.name, e.id, e.status);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
