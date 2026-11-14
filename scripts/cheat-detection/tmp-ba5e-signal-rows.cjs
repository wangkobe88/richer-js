// 一次性（182 跑）：v100 里 ba5e 全部信号行（不限 type/status）核对日志 4+ 次评估。
const { dbManager } = require('../../src/services/dbManager.js');
const V100 = 'ed113d10-8d0b-495d-b1f1-9b597f564c21';
const T = '0xba5ed45b42479e0a75316de7bf990ec90a3e4444';
async function main() {
  const sb = await dbManager.getClient();
  const { data, error } = await sb.from('strategy_signals')
    .select('id,signal_type,action,reason,created_at,metadata')
    .eq('experiment_id', V100).eq('token_address', T).order('created_at');
  if (error) throw error;
  console.log('信号行数:', (data || []).length);
  for (const r of data || []) {
    const m = r.metadata || {};
    const sg = m.signalGate || {}, cc = m.cheatCheck || {}, bp = m.buyPoint || {};
    console.log(`${r.created_at.slice(5, 19)} ${r.signal_type} act=${r.action} 腿=${sg.legId || '-'} trig=${sg.triggerNo ?? '-'} cheat=${cc.grade || '-'}@${cc.status || '-'} bp=${bp.bucket || bp.status || '-'} rule=${bp.rule || cc.reason || '-'} reason=${(r.reason || '').slice(0, 60)}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
