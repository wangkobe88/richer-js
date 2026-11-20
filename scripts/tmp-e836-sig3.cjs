require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const EXP = '7d60bc05-8c4e-4f0d-993c-6f2d02428ea7';
const TOKEN = '0xe83626c404ee63b68ae2a7cdb17fd7d4d2c77777';
async function main() {
  const sb = dbManager.getClient();
  const { data } = await sb.from('strategy_signals')
    .select('created_at, metadata')
    .eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).range(1, 3);
  for (const row of data) {
    const fc = row.metadata?.factorCheck;
    console.log('=== sig', row.created_at, '| factorCheck pass:', fc?.pass, '| status:', fc?.status);
    if (fc?.arms?.length) console.log('arms:', JSON.stringify(fc.arms));
    if (fc?.reason) console.log('reason:', fc.reason);
    console.log('execution_status(md):', row.metadata?.execution_status);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
