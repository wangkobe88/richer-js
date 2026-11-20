const { dbManager } = require('../src/services/dbManager');
async function main() {
  const sb = dbManager.getClient();
  const { data: rows } = await sb.from('experiment_tokens')
    .select('token_address,token_symbol,platform').like('token_address', '0x419c%').limit(10);
  for (const r of rows || []) console.log(r.token_symbol, r.token_address, r.platform);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
