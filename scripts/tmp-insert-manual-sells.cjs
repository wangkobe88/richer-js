const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const EXP = 'bbbe2561-6a98-46a5-bf65-6038800dfb62';

async function main() {
  const client = dbManager.getClient();
  for (const [addr, sym] of [
    ['0x74b538c08d2d9063a4223cfc43939cf8e2bc7777', '兔星星'],
    ['0x5ba9a7ae67e1c46affcc9a26521e766fcf927777', '禁毒喵'],
  ]) {
    const { data, error } = await client.from('manual_trade_requests')
      .insert({ experiment_id: EXP, token_address: addr, direction: 'sell', amount_bnb: null, sell_pct: 1, status: 'pending' })
      .select('id, status, requested_at').single();
    if (error) { console.error(`${sym} insert FAIL:`, error.message); process.exit(1); }
    console.log(`${sym} ${addr} → pending id=${data.id}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
