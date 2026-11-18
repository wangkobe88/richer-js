const { dbManager } = require('../src/services/dbManager.js');
(async () => {
  const c = await dbManager.getClient();
  const EXP='3916fb15-66a1-45f0-bde1-1c145513817a';
  const { data: tr, error } = await c.from('trades').select('*').eq('experiment_id',EXP).limit(3);
  if (error) { console.log('err', error.message); }
  else {
    console.log('行数(≤3):', tr.length);
    if (tr.length) { console.log('列:', Object.keys(tr[0]).join(',')); console.log(JSON.stringify(tr[0]).slice(0,500)); }
  }
  const { count } = await c.from('trades').select('id',{count:'exact',head:true}).eq('experiment_id',EXP);
  console.log('trades 总数:', count);
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
