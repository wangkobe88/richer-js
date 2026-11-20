const { dbManager } = require('../src/services/dbManager');
async function main() {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('experiments')
    .select('id,experiment_name,trading_mode,status,config,created_at,updated_at')
    .eq('id','c73b62be-bb1d-4acf-8002-652e5fb8a507').limit(1);
  if (error) throw error;
  if (!data.length) { console.log('实验不存在'); process.exit(1); }
  const e = data[0];
  console.log('name:', e.experiment_name);
  console.log('mode:', e.trading_mode, '| status:', e.status);
  console.log('created_at:', e.created_at, '| updated_at:', e.updated_at);
  const cfg = e.config || {};
  const fw = cfg.fourmemeWs || {};
  console.log('stallClose:', JSON.stringify(fw.stallClose ?? cfg.stallClose ?? null));
  console.log('factorSellFilter:', JSON.stringify(fw.factorSellFilter ?? null));
  const legs = (cfg.strategiesConfig?.strategies || []);
  console.log('腿数:', legs.length, '| 卖腿 id 样例:', legs.filter(l=>l.side==='sell').map(l=>l.id).slice(0,8).join(','));
  process.exit(0);
}
main().catch(err => { console.error(err.message); process.exit(1); });
