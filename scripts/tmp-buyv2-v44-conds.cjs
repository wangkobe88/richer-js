// 单条读取：strategy_library buy-v2 最新版 legs 条件串（本地小结果读取）
const { dbManager } = require('../src/services/dbManager.js');

(async () => {
  const db = dbManager.getClient();
  const { data, error } = await db
    .from('strategy_library')
    .select('name,side,version,legs,updated_at')
    .eq('name', 'buy-v2')
    .order('version', { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = data[0];
  if (!row) { console.log('no buy-v2 row'); process.exit(1); }
  console.log(`=== ${row.name} v${row.version} side=${row.side} updated=${row.updated_at}`);
  for (const leg of row.legs) {
    console.log(`\n--- leg name=${leg.name ?? '(unnamed)'}`);
    for (const k of ['narrativeTriggerCondition', 'condition', 'gmgnCheckCondition', 'preBuyCheckCondition', 'repeatBuyCheckCondition']) {
      if (leg[k]) console.log(`  [${k}]\n    ${leg[k]}`);
    }
    for (const k of ['perBuyBnb', 'cards', 'cooldownSec']) {
      if (leg[k] !== undefined) console.log(`  ${k}: ${JSON.stringify(leg[k])}`);
    }
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
