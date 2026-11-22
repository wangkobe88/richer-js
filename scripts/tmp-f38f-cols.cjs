const { dbManager } = require('../src/services/dbManager');
(async () => {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('strategy_signals').select('*').eq('experiment_id','4d74f39e-4055-4adb-afa3-de8a22bb9f49').eq('token_address','0xf38f48cfe9e84920e7de4d47823a0fba95a87777').limit(1);
  if (error) { console.error(error.message); process.exit(1); }
  console.log('cols:', Object.keys(data[0]||{}).join(', '));
  process.exit(0);
})();
