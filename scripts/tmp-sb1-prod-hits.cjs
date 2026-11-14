const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
(async () => {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();
  const res = await db.from('strategy_signals')
    .select('token_address,token_symbol,created_at,executed,metadata')
    .eq('experiment_id', 'c6efed13-ce9d-41b0-89a5-8ca8b029a609')
    .eq('signal_type', 'BUY')
    .eq('metadata->cheatCheck->>strongbackerLike', '1')
    .order('created_at');
  if (res.error) { console.error('DBERR', JSON.stringify(res.error).slice(0, 300)); process.exit(1); }
  for (const r of res.data) {
    const m = r.metadata || {}, cc = m.cheatCheck || {};
    console.log(r.created_at, (r.token_symbol || '').slice(0, 14).padEnd(14), r.token_address.slice(0, 10),
      'status=' + cc.status, 'grade=' + cc.grade, 'exec=' + r.executed, 'reason=' + (m.execution_reason || '-'));
    if (Array.isArray(cc.reasons)) console.log('    reasons:', cc.reasons.map(x => x.code).join('+'));
  }
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
