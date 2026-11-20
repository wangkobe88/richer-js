const { dbManager } = require('../src/services/dbManager');
const EXP = '2bdf98ab-d85f-40fa-84b5-d79099e1006c';
const TOKEN = '0x419c12c85c034f7e9f2d8a6a4de604059db77777';
async function main() {
  const sb = dbManager.getClient();
  const { data: exp } = await sb.from('experiments').select('id,name,trading_mode,status,created_at').eq('id', EXP);
  console.log('exp:', JSON.stringify(exp && exp[0]));
  const { data: sigs } = await sb.from('strategy_signals').select('experiment_id,created_at,signal_type,reason,execution_status').eq('token_address', TOKEN).order('created_at').limit(30);
  console.log('signals across experiments:', (sigs || []).length);
  for (const s of sigs || []) console.log(' ', s.experiment_id?.slice(0, 8), s.created_at, s.signal_type, '|', s.reason, '|', s.execution_status);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
