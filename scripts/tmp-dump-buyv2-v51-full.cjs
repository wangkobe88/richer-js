// buy-v2 v51 + buy-early-narrative v10 + buy-v2-repeat v2 完整腿形状（含 trigger/gmgn/priority/phase）
const { dbManager } = require('../src/services/dbManager.js');
(async () => {
  const db = dbManager.getClient();
  const { data, error } = await db.from('strategy_library')
    .select('id,name,version,side,legs,updated_at')
    .in('name',['buy-v2','buy-early-narrative','buy-v2-repeat']);
  if (error) throw error;
  for (const row of data.sort((a,b)=>a.version-b.version)) {
    console.log(`\n##### ${row.name} v${row.version} (${row.side}) id=${row.id} legs=${Array.isArray(row.legs)?row.legs.length:'?'}`);
    console.log(JSON.stringify(row.legs, null, 1));
  }
  process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
