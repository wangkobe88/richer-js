// 一次性（182 跑）：v100 ba5ed45b (M4GA) 信号行全量——为什么被拒。
const { dbManager } = require('../../src/services/dbManager.js');
const V100 = 'ed113d10-8d0b-495d-b1f1-9b597f564c21';
const T = '0xba5ed45b42479e0a75316de7bf990ec90a3e4444';
async function main() {
  const sb = await dbManager.getClient();
  const { data: rows } = await sb.from('strategy_signals')
    .select('id,created_at,signal_type,status,action,metadata')
    .eq('experiment_id', V100).eq('token_address', T).order('created_at');
  if (!rows || !rows.length) { console.log('v100 无信号行——查全部实验该票最近 BUY');
    const { data: any } = await sb.from('strategy_signals').select('experiment_id,created_at,status').eq('token_address', T).eq('signal_type','BUY').order('created_at',{ascending:false}).limit(5);
    (any||[]).forEach(r=>console.log(`${r.experiment_id.slice(0,8)} ${r.created_at} ${r.status}`));
    process.exit(0);
  }
  for (const r of rows) {
    const m = r.metadata || {};
    const sg = m.signalGate || {}, cc = m.cheatCheck || {}, bp = m.buyPoint || {};
    console.log(`\n===== ${r.created_at.slice(5,19)} type=${r.signal_type} status=${r.status} =====`);
    if (sg.legId !== undefined) {
      console.log(`signalGate: leg=${sg.legId} passed=${sg.passed ?? sg.conditionPassed} triggerNo=${sg.triggerNo}`);
      if (sg.failedReason || sg.reason) console.log(`  拒因=${sg.failedReason || sg.reason}`);
    }
    if (Object.keys(cc).length) {
      console.log(`cheatCheck: status=${cc.status} grade=${cc.grade} act=${cc.activityLevel || cc.act || '-'}`);
      if (cc.exempt) console.log(`  豁免=${JSON.stringify(cc.exempt)}`);
      if (cc.exemptDenied) console.log(`  豁免拒=${JSON.stringify(cc.exemptDenied)}`);
      console.log(`  reasons=${(cc.reasons||[]).join(';')||'-'}`);
      if (cc.rule) console.log(`  rule=${cc.rule}`);
    }
    if (Object.keys(bp).length) {
      console.log(`buyPoint: status=${bp.status} 综=${(bp.assessment||{}).bucket}(${(bp.assessment||{}).rule})`);
      const d = bp.dimensions || {};
      for (const k of Object.keys(d)) console.log(`  ${k}=${(d[k]||{}).bucket}(${(d[k]||{}).prob})`);
      if (bp.info && bp.info.rule) console.log(`  info.rule=${bp.info.rule}`);
      if (bp.failedReason) console.log(`  failedReason=${bp.failedReason}`);
    }
    // 顶层 status/failed_reason 字段
    if (m.failedReason || m.failed_reason) console.log(`metadata.failedReason=${m.failedReason || m.failed_reason}`);
    if (m.reason && !sg.legId) console.log(`metadata.reason=${JSON.stringify(m.reason).slice(0,200)}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
