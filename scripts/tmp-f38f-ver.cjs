const { dbManager } = require('../src/services/dbManager');
(async () => {
  const sb = dbManager.getClient();
  const { data: exp, error } = await sb.from('experiments').select('*').eq('id','4d74f39e-4055-4adb-afa3-de8a22bb9f49').limit(1);
  if (error) { console.error('exp ERR:', error.message); process.exit(1); }
  const e = exp && exp[0];
  if (!e) { console.log('exp row missing'); process.exit(1); }
  const cfg = e.config || {};
  console.log('exp keys:', Object.keys(e).join(','));
  console.log('name-ish:', e.experiment_name || e.title || e.description || '?', '| status:', e.status, '| created:', e.created_at);
  console.log('strategyId:', cfg.strategyId);
  if (cfg.strategyResolved) console.log('resolved.version:', cfg.strategyResolved.version, '| resolvedAt:', cfg.strategyResolved.resolvedAt || '-');
  const sid = cfg.strategyId;
  if (sid) {
    const { data: lib, error: e2 } = await sb.from('strategy_library').select('id,name,version,updated_at').eq('id', sid).limit(1);
    if (e2) console.error('lib ERR:', e2.message);
    else console.log('lib now:', JSON.stringify(lib && lib[0]));
  }
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
