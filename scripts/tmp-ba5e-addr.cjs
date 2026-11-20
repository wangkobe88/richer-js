require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
(async () => {
  const sb = dbManager.getClient();
  const { data } = await sb.from('strategy_signals').select('token_address,token_symbol')
    .eq('experiment_id', '2448116a-bebe-457d-9d8a-b4556c9a8e0d')
    .like('token_address', '0xba5ed45b%').limit(1);
  console.log(data[0] && data[0].token_address, data[0] && data[0].token_symbol);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
