const { dbManager } = require('../src/services/dbManager');
async function main() {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('wss_price_ticks').select('*')
    .eq('token_address','0x88edc0d6e4ba98eadf4b6f86b41540a438d67777').limit(1);
  if (error) throw error;
  console.log('cols:', data.length ? Object.keys(data[0]).join(',') : '无行');
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
