// 一次性查询：d8d3f246 实验 0xc84a...7777 token 信号行被拦原因（本地小查询）
const { dbManager } = require('../src/services/dbManager.js');

const EXP = 'd8d3f246-6767-4192-804c-3dabdeb15baa';
const TOKEN = '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777';

async function main() {
  const client = await dbManager.getClient();

  // 1) 实验基本信息 + config
  const { data: exp, error: e1 } = await client.from('experiments')
    .select('id,experiment_name,status,trading_mode,config,created_at')
    .eq('id', EXP).limit(1);
  if (e1) throw e1;
  const e = exp && exp[0];
  if (e) {
    console.log('=== 实验 ===');
    console.log(`name=${e.experiment_name} status=${e.status} mode=${e.trading_mode} created=${e.created_at}`);
    const cfg = typeof e.config === 'string' ? JSON.parse(e.config) : (e.config || {});
    console.log(`config keys: ${Object.keys(cfg).join(',')}`);
    // 打印 fourmemeWs 段关键开关
    const fw = cfg.fourmemeWs || {};
    console.log('fourmemeWs keys:', Object.keys(fw).join(','));
    if (fw.cheatCheck) console.log('cheatCheck:', JSON.stringify(fw.cheatCheck));
    if (fw.buyPointCheck) console.log('buyPointCheck:', JSON.stringify(fw.buyPointCheck));
  }

  // 2) 该 token 的信号行
  const { data: sigs, error: e2 } = await client.from('strategy_signals')
    .select('id,signal_type,action,status,reason,rejection_reason,strategy_id,created_at,metadata,token_address')
    .eq('experiment_id', EXP)
    .eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(20);
  if (e2) throw e2;
  console.log(`\n=== 信号行（${(sigs || []).length} 条）===`);
  for (const s of sigs || []) {
    console.log(`\n--- [${s.id}] ${s.created_at} type=${s.signal_type} action=${s.action} status=${s.status}`);
    if (s.reason) console.log(`reason: ${s.reason}`);
    if (s.rejection_reason) console.log(`rejection_reason: ${s.rejection_reason}`);
    const md = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : (s.metadata || {});
    if (md.signalGate) console.log(`signalGate: ${JSON.stringify(md.signalGate)}`);
    if (md.cheatCheck) console.log(`cheatCheck: ${JSON.stringify(md.cheatCheck)}`);
    if (md.buyPoint) console.log(`buyPoint: ${JSON.stringify(md.buyPoint)}`);
    if (md.gmgnCheck) console.log(`gmgnCheck: ${JSON.stringify(md.gmgnCheck)}`);
    const extra = Object.keys(md).filter(k => !['signalGate','cheatCheck','buyPoint','gmgnCheck'].includes(k));
    if (extra.length) console.log(`other md keys: ${extra.join(',')}`);
  }

  // 3) cheat_detection 该 token 的判定（若有）
  const { data: cds, error: e3 } = await client.from('cheat_detection')
    .select('analyzed_at,question_version,anchor_tick_count,grade,grade_reasons,snapshot_digest')
    .eq('token_address', TOKEN)
    .order('analyzed_at', { ascending: true }).limit(10);
  if (e3) console.log('cheat_detection query err:', e3.message);
  else if (cds && cds.length) {
    console.log(`\n=== cheat_detection（${cds.length} 行）===`);
    for (const r of cds) {
      const d = typeof r.snapshot_digest === 'string' ? JSON.parse(r.snapshot_digest) : (r.snapshot_digest || {});
      console.log(`${r.analyzed_at} qv=${r.question_version} 锚=${r.anchor_tick_count} grade=${d.grade || r.grade} reasons=${JSON.stringify(d.gradeReasons || r.grade_reasons)}`);
    }
  } else {
    console.log('\ncheat_detection: 无行');
  }

  process.exit(0);
}
main().catch((err) => { console.error(err); process.exit(1); });
