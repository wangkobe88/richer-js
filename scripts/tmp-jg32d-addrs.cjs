// JG-32d：24 张 B 形状票完整地址解析（分页拉全）
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const WINS = [
  ['w1003', '9e9163de-a677-4d39-9c33-9ec9df05e400', ['f38f48cf','988fd577','9c07ea66','ece9cd98','6fe44c14','d0451a53','ebbc6754','cb1d32fa','1d7d9f2c','3b2748df','a2b3b5a7','995b3276','cadc767d','5c83f64b','2893a796','a878e6d4','99381691','841b41f3','5316e94b','e2417e49']],
  ['w1019', 'ce102e94-293c-4f8f-af98-cd06f4b0e98c', ['153f8335','a72df203']],
  ['w1012', 'dddbe79e-480a-402a-aa35-85a72d2f591e', ['e6765c89']],
  ['w1103', '2448116a-bebe-457d-9d8a-b4556c9a8e0d', ['f37fe6de']],
];
async function fetchAll(from, pageSize = 1000) {
  const rows = []; let offset = 0;
  for (;;) {
    const page = await from.range(offset, offset + pageSize - 1);
    if (page.error) throw new Error(page.error.message);
    rows.push(...page.data);
    if (page.data.length < pageSize) return rows;
    offset += pageSize;
  }
}
(async () => {
  const sb = dbManager.getClient();
  for (const [w, exp, prefixes] of WINS) {
    const data = await fetchAll(sb.from('strategy_signals').select('token_address, token_symbol').eq('experiment_id', exp).eq('signal_type', 'BUY'));
    console.error(`${w}: ${data.length} 行`);
    const done = new Set();
    for (const p of prefixes) {
      const hit = data.find(r => (r.token_address || '').toLowerCase().startsWith('0x'+p) && !done.has(r.token_address));
      if (hit) { done.add(hit.token_address); console.log(`${w}\t${hit.token_symbol || '?'}\t${hit.token_address}`); }
      else console.log(`${w}\t${p}\tMISS`);
    }
  }
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
