// 临时排查:0x587c61b4…7777 ticks/事件(dbManager service key,小结果读取)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager.js');

(async () => {
  const db = dbManager.getClient();
  const TOKEN = '0x587c61b4a5052b7e5e0563be61b9be0a0aa27777';

  const { data: probe } = await db.from('wss_price_ticks').select('*').eq('token_address', TOKEN).range(0, 1);
  const cols = Object.keys(probe[0] || {});
  console.log('tick 列:', cols.join(','));

  const { data: ticks, error } = await db.from('wss_price_ticks').select('*')
    .eq('token_address', TOKEN)
    .order('block_time', { ascending: true })
    .range(0, 3000);
  if (error) { console.error('ticks ERR', error.message); return; }
  console.log('ticks 总数(≤3000):', ticks.length);
  ticks.forEach((t, i) => {
    if (i % 25 === 0 || i === ticks.length - 1 || i > 0 && new Date(t.block_time) - new Date(ticks[i - 1].block_time) > 60000) {
      console.log(i, t.block_time, 'px=', t.price, 'bnbAmt=', t.bnb_amount, 'exp=', (t.experiment_id || 'NULL').slice?.(0, 8) ?? 'NULL');
    }
  });

  const { data: evs } = await db.from('wss_events').select('kind,block_number,created_at,payload')
    .eq('token_address', TOKEN).order('block_number');
  for (const e of evs || []) console.log('EVENT', e.kind, e.block_number, e.created_at, JSON.stringify(e.payload || {}).slice(0, 160));
  process.exit(0);
})();
