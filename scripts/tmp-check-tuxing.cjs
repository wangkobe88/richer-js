const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
async function main() {
  const db = dbManager.getClient();
  // 1. 毕业事件
  const ev = await db.from('wss_events').select('kind,block_time,payload').eq('token_address','0x74b538c08d2d9063a4223cfc43939cf8e2bc7777').order('id').limit(10);
  console.log('wss_events:', (ev.data||[]).map(e=>({kind:e.kind, at:e.block_time})));
  // 2. 该票全部 trades（跨实验）
  const tr = await db.from('trades').select('experiment_id,trade_direction,input_amount,output_amount,trade_status,executed_at,metadata->txHash as tx').eq('token_address','0x74b538c08d2d9063a4223cfc43939cf8e2bc7777').order('executed_at').limit(10);
  for (const t of tr.data||[]) console.log(JSON.stringify({exp:(t.experiment_id||'').slice(0,8), dir:t.trade_direction, in:t.input_amount, out:t.output_amount, st:t.trade_status, at:t.executed_at, tx:(t.tx||'').slice(0,14)}));
  // 3. 买行的 protocol
  const meta = await db.from('trades').select('metadata->protocol as proto, metadata->method as m').eq('token_address','0x74b538c08d2d9063a4223cfc43939cf8e2bc7777').eq('trade_direction','buy').limit(1);
  console.log('buy proto:', JSON.stringify((meta.data||[])[0]));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
