require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
async function main() {
  const sb = dbManager.getClient();
  const r = await sb.from('strategy_signals').select('id,created_at').eq('experiment_id','d29420e7-9d5a-48b4-9e72-0b3dfe00c22f').limit(2);
  console.log(JSON.stringify(r.data));
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
