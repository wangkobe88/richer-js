require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
async function main() {
  const sb = dbManager.getClient();
  const r = await sb.from('wss_price_ticks').select('*').eq('token_address','0xf818ac2c5545a3d4b7c643efa18aca7237927777').limit(1);
  console.log(Object.keys(r.data?.[0] || {}).join(', '));
  console.log('count:', r.count);
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
