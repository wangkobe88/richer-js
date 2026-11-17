// 一次性状态查询（2026-11-15）：node scripts/tmp-status-only.cjs <experiment_id> → 打印 status
const { dbManager } = require('../src/services/dbManager.js');
(async () => {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments').select('status').eq('id', process.argv[2]).limit(1);
  if (error) throw new Error(error.message);
  console.log(data && data[0] ? data[0].status : 'missing');
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
