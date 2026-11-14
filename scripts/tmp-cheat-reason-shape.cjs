const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
(async () => {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();
  const { data, error } = await db.from('strategy_signals')
    .select('id,created_at,metadata')
    .eq('experiment_id', 'b67513a8-a389-4297-86d0-868a5b8eab1a')
    .eq('token_address', '0xb88113c98d5e33b15925edd635170e80a0fbffff')
    .eq('signal_type', 'BUY').limit(2);
  if (error) throw new Error(error.message);
  for (const s of data) {
    console.log('==', s.created_at, '顶层键:', Object.keys(s.metadata || {}).join(','));
    const sg = (s.metadata || {}).signalGate || {};
    console.log('  signalGate:', JSON.stringify(sg).slice(0, 300));
  }
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
