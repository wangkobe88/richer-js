const path = require('path');
require('dotenv').config({ path: path.join('/Users/nobody1/Desktop/Codes/richer-js/config/.env') });
const { dbManager } = require('/Users/nobody1/Desktop/Codes/richer-js/src/services/dbManager');
async function main() {
  const db = dbManager.getClient();
  const r = await db.from('experiments').select('*').eq('id','bbbe2561-6a98-46a5-bf65-6038800dfb62').limit(1);
  const e = (r.data || [])[0];
  if (!e) { console.log('NOT FOUND. err:', JSON.stringify(r.error)); process.exit(1); }
  const cfg = e.config || {};
  console.log('status:', e.status, 'mode:', e.mode, 'platform:', e.platform);
  console.log('exp fourmemeWs.live:', JSON.stringify((cfg.fourmemeWs || {}).live || {}));
  console.log('exp flapWs.live:', JSON.stringify((cfg.flapWs || {}).live || {}));
  console.log('exp fourmemeWs keys:', Object.keys(cfg.fourmemeWs || {}).join(','));
  console.log('exp fourmemeWs:', JSON.stringify(cfg.fourmemeWs || {}, null, 1).slice(0, 1500));
  console.log('exp platform:', cfg.platform);
  process.exit(0);
}
main().catch(err => { console.error(err.message); process.exit(1); });
