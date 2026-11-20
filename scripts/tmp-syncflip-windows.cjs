require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
async function main() {
  const sb = dbManager.getClient();
  const { data } = await sb.from('experiments')
    .select('id,experiment_name,trading_mode,started_at,stopped_at')
    .ilike('experiment_name', 'bt-v%')
    .order('started_at');
  for (const e of data || []) console.log(`${e.experiment_name} ${e.id} ${e.started_at?.slice(0,10)}~${e.stopped_at?.slice(0,10)}`);
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
