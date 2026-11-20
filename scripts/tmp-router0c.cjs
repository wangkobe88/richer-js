require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
async function main() {
  const sb = dbManager.getClient();
  const r = await sb.from('experiments').select('*').limit(1);
  console.log('exp cols:', Object.keys(r.data[0]).join(','));
  console.log('sample:', JSON.stringify({ id: r.data[0].id, title: r.data[0].title, exp_name: r.data[0].experiment_name, name: r.data[0].name }).slice(0, 300));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
