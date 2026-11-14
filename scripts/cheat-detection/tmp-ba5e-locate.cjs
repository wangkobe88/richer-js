// 一次性（182 跑）：ba5e 行定位——v100 内 like 匹配+全史 BUY/OBSERVE 分布。
const { dbManager } = require('../../src/services/dbManager.js');
const V100 = 'ed113d10-8d0b-495d-b1f1-9b597f564c21';
const T = '0xba5ed45b42479e0a75316de7bf990ec90a3e4444';
async function main() {
  const sb = await dbManager.getClient();
  const { data: v100rows } = await sb.from('strategy_signals')
    .select('created_at,signal_type,status,token_address,metadata')
    .eq('experiment_id', V100).ilike('token_address', '%ba5ed45b%').order('created_at');
  console.log(`v100 ba5e like 匹配 ${(v100rows||[]).length} 行`);
  for (const r of v100rows || []) {
    const m = r.metadata || {};
    const sg = m.signalGate || {}, cc = m.cheatCheck || {}, bp = m.buyPoint || {};
    console.log(`  ${r.created_at.slice(5,19)} ${r.signal_type} ${r.status} token=${r.token_address}`);
    if (Object.keys(sg).length) console.log(`    sg: leg=${sg.legId} passed=${sg.passed ?? sg.conditionPassed} triggerNo=${sg.triggerNo} rej=${sg.failedReason||sg.reason||'-'}`);
    if (Object.keys(cc).length) console.log(`    cheat: ${cc.status}/${cc.grade} act=${cc.activityLevel||'-'} ex=${cc.exempt?JSON.stringify(cc.exempt):'-'} den=${cc.exemptDenied?JSON.stringify(cc.exemptDenied):'-'} r=${(cc.reasons||[]).join(';')||'-'}`);
    if (Object.keys(bp).length) {
      const a = bp.assessment||{}, d = bp.dimensions||{};
      console.log(`    bp: ${bp.status} 综=${a.bucket}(${a.rule}) dims=` + Object.keys(d).map(k=>`${k}:${(d[k]||{}).bucket}(${(d[k]||{}).prob})`).join(' '));
    }
  }
  const { data: hist } = await sb.from('strategy_signals')
    .select('experiment_id,created_at,signal_type,status')
    .eq('token_address', T).order('created_at',{ascending:false}).limit(10);
  console.log(`\n全史该票（精确地址）${(hist||[]).length} 行：`);
  for (const r of hist || []) console.log(`  ${r.experiment_id.slice(0,8)} ${r.created_at.slice(5,19)} ${r.signal_type} ${r.status}`);
  // cheat_detection 与 buy_point_analyses 观测行（无信号行也可能有观测）
  const { data: cdt } = await sb.from('cheat_detection')
    .select('analyzed_at,grade,verdict,question_version').eq('token_address', T).order('analyzed_at',{ascending:false}).limit(5);
  console.log(`\ncheat_detection 观测 ${(cdt||[]).length} 行：`);
  for (const r of cdt || []) console.log(`  ${String(r.analyzed_at).slice(5,19)} ${r.grade} ${r.verdict} v=${r.question_version}`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
