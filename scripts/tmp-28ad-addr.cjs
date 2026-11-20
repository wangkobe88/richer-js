require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
async function main() {
  const sb = dbManager.getClient();
  const { data } = await sb.from('strategy_signals').select('token_address,token_symbol,created_at')
    .eq('experiment_id', '2448116a-bebe-457d-9d8a-b4556c9a8e0d')
    .like('token_address', '0x28ad2c7d%').limit(3);
  for (const r of data || []) console.log(r.token_address, r.token_symbol, r.created_at);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
