// 拉 P1·首买腿（buy-v2 v51）与 P2 腿条件
const { dbManager } = require('../src/services/dbManager.js');
(async () => {
  const db = dbManager.getClient();
  const { data, error } = await db
    .from('strategy_library')
    .select('id,name,side,version,legs')
    .in('name', ['buy-v2', 'buy-v2-repeat', 'buy-early-narrative'])
    .order('version', { ascending: false });
  if (error) throw error;
  for (const row of data) {
    console.log('=====', row.name, 'v' + row.version, 'id:', row.id);
    for (const leg of (row.legs || [])) {
      console.log('--- leg:', leg.name, '| buyPhase:', leg.buyPhase ?? null);
      if (leg.narrativeTriggerCondition) console.log('  trigger:', leg.narrativeTriggerCondition);
      if (leg.condition) console.log('  condition:', leg.condition);
      if (leg.gmgnCheckCondition) console.log('  gmgn:', leg.gmgnCheckCondition);
    }
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
