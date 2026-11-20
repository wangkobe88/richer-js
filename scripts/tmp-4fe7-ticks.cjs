require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const TOK = '0x4fe71b03ed8be235fb2b7671f8b84caecad57777';
async function main() {
  const sb = dbManager.getClient();
  const r = await sb.from('wss_price_ticks').select('*').eq('token_address', TOK).limit(1);
  if (!r.data || !r.data.length) { console.log('no rows at all'); process.exit(0); }
  console.log('cols:', Object.keys(r.data[0]).join(','));
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
