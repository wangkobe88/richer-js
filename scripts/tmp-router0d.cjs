require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
async function main() {
  const sb = dbManager.getClient();
  const { data } = await sb.from('experiments').select('id,experiment_name,status,config->backtest').limit(500);
  for (const e of (data||[]).filter(e => /bt-v1(4[0-9]|5[0-9]|6[0-9])/.test(e.experiment_name||'')))
    console.log(e.experiment_name, e.id, e.status, JSON.stringify(e.config || null));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
