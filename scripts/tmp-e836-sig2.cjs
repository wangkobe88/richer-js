require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');

const EXP = '7d60bc05-8c4e-4f0d-993c-6f2d02428ea7';
const TOKEN = '0xe83626c404ee63b68ae2a7cdb17fd7d4d2c77777';

async function main() {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('strategy_signals')
    .select('id, created_at, reason, metadata')
    .eq('experiment_id', EXP)
    .eq('token_address', TOKEN)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw new Error(JSON.stringify(error));
  const row = data[0];
  console.log('created_at:', row.created_at, 'reason:', row.reason, );
  const md = row.metadata || {};
  console.log('\n--- signalGate ---\n', JSON.stringify(md.signalGate, null, 1));
  console.log('\n--- factorCheck ---\n', JSON.stringify(md.factorCheck, null, 1));
  console.log('\n--- actFrontGate ---\n', JSON.stringify(md.actFrontGate, null, 1));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
