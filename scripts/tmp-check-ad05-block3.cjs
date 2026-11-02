const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const TOKEN = '0xad05bf6f03a098ae823383fd2e479a4fd3b57777';
const EXP = '0e7c7e09-5b3c-4e14-b039-fce040199f83';
(async () => {
  const { dbManager } = require('../src/services/dbManager.js');
  const client = dbManager.getClient();

  const { data: trades, error: eT } = await client.from('trades')
    .select('*').eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true });
  console.log('=== trades ===', (trades || []).length, 'rows', eT ? '| err: ' + eT.message : '');
  for (const t of (trades || [])) {
    const { metadata, ...rest } = t;
    console.log(JSON.stringify(rest));
    if (metadata) console.log('  meta:', JSON.stringify(metadata).slice(0, 1500));
  }

  const { data: sigs } = await client.from('strategy_signals')
    .select('*').eq('experiment_id', EXP).eq('token_address', EXP ? TOKEN : '')
    .eq('signal_type', 'BUY');
  for (const s of (sigs || [])) {
    console.log('=== BUY signal', s.id, 'status:', s.status, 'executed:', s.executed);
    const m = s.metadata || {};
    console.log('metadata keys:', Object.keys(m));
    console.log(JSON.stringify(m, null, 1).slice(0, 4000));
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
