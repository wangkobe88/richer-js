// 拉 7d92 全窗口 ticks 到本地（单票小结果集）
const { dbManager } = require('../src/services/dbManager.js');
const fs = require('fs');
(async () => {
  const db = dbManager.getClient();
  const { data, error } = await db
    .from('wss_price_ticks')
    .select('*')
    .eq('token_address', '0x7d922dbfd42e8443c29ba16c8293b4c4ea227777')
    .gte('block_time', '2026-10-29T09:18:00Z')
    .lte('block_time', '2026-10-29T09:19:20Z')
    .order('block_number', { ascending: true })
    .limit(500);
  if (error) throw error;
  console.log('ticks 行数:', data.length);
  fs.writeFileSync('/tmp/7d92-ticks.json', JSON.stringify(data, null, 1));
  // 顺带打印列名与前 3 行概览
  if (data[0]) console.log('列:', Object.keys(data[0]).join(','));
  for (const t of data.slice(0, 3)) console.log(t.block_number, t.block_time, t.trade_type, 'bnb:', t.bnb_amount, 'px:', t.price_bnb);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
