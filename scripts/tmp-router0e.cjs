require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const EXP = 'd29420e7-9d5a-48b4-9e72-0b3dfe00c22f';
async function main() {
  const sb = dbManager.getClient();
  const { data } = await sb.from('trades')
    .select('token_address,trade_direction,trade_status,input_currency,output_currency,input_amount,output_amount,unit_price,success,is_virtual_trade,executed_at,sold_cards')
    .eq('experiment_id', EXP).limit(8);
  for (const t of data) console.log(JSON.stringify(t));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
