const { dbManager } = require('../src/services/dbManager');
async function main() {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('cheat_detection').select('*').eq('token_address', '0x81bf04448ad0b72258ab5d9e0a1f77e59cdf7777').limit(1);
  if (error) throw error;
  console.log('cols:', data.length ? Object.keys(data[0]).join(',') : '无行');
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
