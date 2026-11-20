require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');

const EXP = '7d60bc05-8c4e-4f0d-993c-6f2d02428ea7';
const TOKEN = '0xe83626c404ee63b68ae2a7cdb17fd7d4d2c77777';

async function main() {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP)
    .eq('token_address', TOKEN)
    .order('created_at', { ascending: true })
    .limit(30);
  if (error) throw new Error(JSON.stringify(error));
  console.log('cols:', Object.keys(data[0] || {}).join(','));
  for (const row of data) {
    console.log('=== sig', row.created_at, row.signal_type, row.action, row.execution_status || row.executed, row.reason);
    const md = row.metadata || {};
    console.log('md keys:', Object.keys(md).join(','));
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
