const { dbManager } = require('../src/services/dbManager');
(async () => {
  const sb = dbManager.getClient();
  const { data } = await sb.from('experiments').select('id,experiment_name,config').in('id', ['2b5e194b-98bb-4f5d-8d9b-a8d5884ae58b','ef2f5af0-5ab7-4577-8028-4ea9a51b889f']);
  for (const e of data) console.log(e.experiment_name, '→', JSON.stringify(e.config.fourmemeWs?.buyPointCheck));
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
