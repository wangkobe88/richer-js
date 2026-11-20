const { dbManager } = require('../src/services/dbManager');
async function main() {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('experiments').select('config,experiment_description')
    .eq('id','c73b62be-bb1d-4acf-8002-652e5fb8a507').limit(1);
  if (error) throw error;
  const cfg = data[0].config;
  console.log('backtest 段:', JSON.stringify(cfg.backtest));
  console.log('stallClose:', JSON.stringify(cfg.fourmemeWs?.stallClose ?? cfg.stallClose));
  console.log('factorSellFilter:', JSON.stringify(cfg.fourmemeWs?.factorSellFilter));
  console.log('buyStrategies:', cfg.strategiesConfig?.buyStrategies?.length, '| sellStrategies:', cfg.strategiesConfig?.sellStrategies?.length);
  console.log('platform:', cfg.platform, '| maxTickRows:', cfg.backtest?.maxTickRows);
  console.log('description:', (data[0].experiment_description||'').slice(0,300));
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
