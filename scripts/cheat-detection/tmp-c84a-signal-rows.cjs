// 一次性（182 跑）：v100 里 c84a（BP62 不误伤正票）未买入归因。
const { dbManager } = require('../../src/services/dbManager.js');
const V100 = 'ed113d10-8d0b-495d-b1f1-9b597f564c21';
const T = '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777';
async function main() {
  const sb = await dbManager.getClient();
  const { data, error } = await sb.from('strategy_signals')
    .select('signal_type,action,reason,created_at,metadata')
    .eq('experiment_id', V100).eq('token_address', T).order('created_at');
  if (error) throw error;
  console.log('c84a 信号行数:', (data || []).length);
  for (const r of data || []) {
    const m = r.metadata || {};
    const sg = m.signalGate || {}, cc = m.cheatCheck || {}, bp = m.buyPoint || {};
    const ex = cc.exempt || {};
    console.log(`${r.created_at.slice(5, 19)} ${r.signal_type} act=${r.action} 腿=${sg.legId || '-'} trig=${sg.triggerNo ?? '-'} cheat=${cc.grade || '-'}@${cc.status || '-'}${ex.code ? ' 豁免=' + ex.code + '(原判' + ex.originalGrade + ')' : ''} bp=${bp.bucket || bp.status || '-'} rule=${bp.rule || '-'} pumpExempt=${sg.pumpExempt ?? cc.pumpExempt ?? '-'}`);
  }
  // 成交核对
  const { data: tr } = await sb.from('trades').select('trade_direction,created_at,input_amount')
    .eq('experiment_id', V100).eq('token_address', T).limit(5);
  console.log('c84a 成交:', (tr || []).map((x) => `${x.trade_direction}@${x.created_at.slice(5, 19)}`).join(' | ') || '无');
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
