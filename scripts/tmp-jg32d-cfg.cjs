const { dbManager } = require('../src/services/dbManager');
(async () => {
  const sb = dbManager.getClient();
  const { data } = await sb.from('experiments').select('config').eq('id','4d74f39e-4055-4adb-afa3-de8a22bb9f49').limit(1);
  const cfg = data[0].config;
  console.log('top keys:', Object.keys(cfg).join(','));
  console.log('backtest:', JSON.stringify(cfg.backtest));
  console.log('fourmemeWs:', JSON.stringify(cfg.fourmemeWs || null));
  console.log('strategyId:', cfg.strategyId);
  console.log('platform:', cfg.platform);
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
