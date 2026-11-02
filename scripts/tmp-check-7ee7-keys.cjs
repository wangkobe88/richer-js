const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
(async () => {
  const { dbManager } = require('../src/services/dbManager.js');
  const client = dbManager.getClient();
  const { data: trades } = await client.from('trades')
    .select('created_at,trade_direction,metadata').eq('experiment_id', '5298b7bd-8374-458d-b9e3-c5fe581e681d')
    .eq('token_address', '0x7ee7812e8b8de9c0d3411933216ef2004a627777').order('created_at');
  const buy = trades.find(t => t.trade_direction === 'buy');
  const f = buy.metadata.factors.trendFactors;
  const keys = Object.keys(f).sort();
  for (const k of keys) console.log(k, '=', f[k]);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
