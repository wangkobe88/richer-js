require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
async function main() {
  const sb = dbManager.getClient();
  const r = await sb.from('strategy_signals').select('*').limit(1);
  console.log('signals:', Object.keys(r.data?.[0] || {}).join(', '));
  const e = await sb.from('experiments').select('*').eq('id','d29420e7-9d5a-48b4-9e72-0b3dfe00c22f').limit(1);
  console.log('exp:', Object.keys(e.data?.[0] || {}).join(', '));
  console.log('exprow name:', e.data?.[0]?.name, e.data?.[0]?.trading_mode, e.data?.[0]?.platform);
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
