// bt-v77 五个被拒锚 token 的门链拒因（metadata 挖掘）
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const EXP = 'ff1c8725-e6dd-46fb-a877-43fb6f463098';
const REJECTED = [
  '0x92aac04f03278ce7ac82ba0367dbaf9686437777',
  '0xb97d5772bf70814161d29243b0e39ec62f734444',
  '0x24436292ae46bb4f0bdc4389d7180eaa82747777',
  '0xc88bf78562ad5b5212dc31750a694c1cf5d17777',
  '0xbcb27c14a0faec17461cb6101810aee9fb554444',
];
(async () => {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();
  for (const a of REJECTED) {
    const { data } = await db.from('strategy_signals')
      .select('token_symbol,reason,executed,created_at,metadata')
      .eq('experiment_id', EXP).eq('token_address', a)
      .eq('signal_type', 'BUY').order('created_at');
    console.log('==', a.slice(0, 10), (data[0] || {}).token_symbol, 'BUY', data.length);
    for (const r of data) {
      const m = r.metadata || {};
      const sg = m.signalGate || {};
      const cc = m.cheatCheck || {};
      const bp = m.buyPoint || {};
      const ccInfo = cc.status ? `cheat=${cc.status}/${cc.grade}` + (cc.reasons && cc.reasons.length ? `[${cc.reasons.map(x => x.code || x).join(',')}]` : '') : 'cheat=未到/无段';
      const bpInfo = bp.bucket ? `BP=${bp.bucket}/${bp.status||''}` + (bp.rule ? `(${bp.rule})` : '') : (sg.bpGate || 'BP=未到');
      const rej = m.execution_reason || sg.rejection || m.rejectionReason || '';
      console.log(`  ${r.created_at} ${r.reason} ${ccInfo} ${bpInfo}${rej ? ' REJ=' + rej : ''}`);
    }
  }
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
