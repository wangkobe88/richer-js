// SB(0x92aac04f) BP 门拒细节 + 無為 cheat 拉黑细节
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const EXP = 'ff1c8725-e6dd-46fb-a877-43fb6f463098';
(async () => {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();
  const { data } = await db.from('strategy_signals')
    .select('token_address,token_symbol,created_at,metadata')
    .eq('experiment_id', EXP).eq('token_address', '0x92aac04f03278ce7ac82ba0367dbaf9686437777')
    .eq('signal_type', 'BUY').order('created_at');
  for (const r of data) {
    const m = r.metadata || {};
    const bp = m.buyPoint;
    console.log('==', r.created_at, 'bpGate:', JSON.stringify(m.signalGate || {}).slice(0, 200));
    if (bp) {
      console.log('   buyPoint.status=' + bp.status, 'bucket=' + bp.bucket, 'prob=' + bp.prob, 'rule=' + bp.rule);
      if (bp.assessments) for (const a of bp.assessments) console.log('   -', a.question, a.bucket, a.prob);
      if (bp.gates) console.log('   gates:', JSON.stringify(bp.gates));
    } else {
      console.log('   buyPoint 段无，全 metadata keys:', Object.keys(m).join(','));
    }
  }
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
