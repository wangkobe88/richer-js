require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');

const EXP = '7d60bc05-8c4e-4f0d-993c-6f2d02428ea7';
const TOKEN = '0x2a84792c035229c761facd5790e4507f39377777';

async function main() {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP)
    .eq('token_address', TOKEN)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw new Error(JSON.stringify(error));
  const row = data[0];
  const md = row.metadata || {};
  console.log('created_at:', row.created_at);
  console.log('--- factorCheck ---');
  console.log(JSON.stringify(md.factorCheck, null, 1).slice(0, 6000));
  console.log('--- actFrontGate ---');
  console.log(JSON.stringify(md.actFrontGate, null, 1).slice(0, 6000));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
