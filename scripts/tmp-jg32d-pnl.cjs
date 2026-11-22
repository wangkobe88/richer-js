const { dbManager } = require('../src/services/dbManager');
(async () => {
  const sb = dbManager.getClient();
  for (const [name, exp] of [['A现行','2b5e194b-98bb-4f5d-8d9b-a8d5884ae58b'],['B无FP','c4e9f11a-9ce9-46f5-969b-9a935cd16789']]) {
    const { data } = await sb.from('experiments').select('stats').eq('id', exp).limit(1);
    const st = data[0]?.stats;
    console.log(`\n═══ ${name} stats ═══`);
    const keys = st && typeof st === 'object' ? Object.keys(st) : [];
    console.log('keys:', keys.slice(0, 20).join(','));
    const tp = st?.tokenPerformance || st?.tokens || st?.tokenStats;
    if (Array.isArray(tp)) for (const t of tp.slice(0, 30)) console.log(JSON.stringify(t).slice(0, 200));
    else if (st) console.log(JSON.stringify(st).slice(0, 1500));
  }
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
