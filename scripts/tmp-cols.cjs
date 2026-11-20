const { dbManager } = require('../src/services/dbManager');
async function main() {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('wss_price_ticks').select('*').eq('token_address','0x419c12c85c034f7e9f2d8a6a4de604059db77777').limit(1);
  if (error) { console.error('ERR', error.message); process.exit(1); }
  console.log('wss_price_ticks cols:', Object.keys(data[0]).join(','));
  const { data: t2, error: e2 } = await sb.from('trades').select('*').eq('experiment_id','b8ae9f2e-832f-42db-bbda-8d8701aecb63').eq('token_address','0x419c12c85c034f7e9f2d8a6a4de604059db77777').limit(1);
  if (e2) { console.error('ERR2', e2.message); process.exit(1); }
  console.log('trades cols:', Object.keys(t2[0]).join(','));
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
