// trades 列形状确认（1 行）
const { dbManager } = require('../src/services/dbManager.js');
(async () => {
  const db = dbManager.getClient();
  const { data, error } = await db.from('trades').select('*').order('created_at', { ascending: false }).limit(1);
  if (error) throw error;
  console.log('trades 列:', Object.keys(data[0]).join(','));
  console.log(JSON.stringify(data[0], null, 1).slice(0, 1200));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
