// 一次性读取（本地跑）：bt-v96 t0a 买腿+pump-imbalance-exit 卖腿现状
const { dbManager } = require('../src/services/dbManager.js');
const SRC = 'e582e873-7f1a-44a5-b50f-0fca576847be';
async function main() {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments').select('config').eq('id', SRC).limit(1);
  if (error) throw new Error(error.message);
  const sc = data[0].config.strategiesConfig;
  console.log('--- t0a（condition 含 tradeCount >= 9）---');
  for (const l of sc.buyStrategies.filter(x => (x.condition || '').includes('tradeCount >= 9'))) {
    console.log(JSON.stringify(l, null, 1));
  }
  console.log('--- 卖腿名+条件摘要 ---');
  for (const l of sc.sellStrategies) {
    console.log(`[${l.priority}] ${l.name} :: ${String(l.condition).slice(0, 110)}`);
  }
  console.log('--- libraryRefs ---');
  for (const r of sc.libraryRefs || []) console.log(JSON.stringify(r));
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
