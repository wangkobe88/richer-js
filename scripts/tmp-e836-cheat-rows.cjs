#!/usr/bin/env node
// e836 案：为何 sbw != burst —— 拉取 cheat_detection 观测行 + burst 锚族 + levels
const { dbManager } = require('../src/services/dbManager');

const TOKEN = '0xe83626c404ee63b68ae2a7cdb17fd7d4d2c77777';

(async () => {
  const sb = dbManager.getClient();
  // 1) cheat_detection 观测行
  const { data: rows, error } = await sb.from('cheat_detection')
    .select('*').eq('token_address', TOKEN).order('analyzed_at', { ascending: true }).limit(20);
  if (error) throw error;
  console.log('cheat_detection rows:', rows.length);
  for (const r of rows) {
    const dig = r.snapshot_digest || {};
    const anchors = dig.anchors || {};
    const levels = dig.levels || {};
    const burstKeys = {};
    for (const k of Object.keys(anchors)) if (/burst|stall/i.test(k)) burstKeys[k] = anchors[k];
    console.log('---');
    console.log('analyzed_at:', r.analyzed_at, 'verdict:', r.verdict, 'grade:', r.grade);
    console.log('question_version:', r.question_version);
    console.log('levels:', JSON.stringify(levels));
    console.log('anchors.burst族:', JSON.stringify(burstKeys, null, 1));
    if (dig.extLevels) console.log('extLevels:', JSON.stringify(dig.extLevels));
    if (dig.activityLevel) console.log('activityLevel:', dig.activityLevel);
    console.log('gradeReasons:', JSON.stringify(r.grade_reasons || dig.gradeReasons));
  }
  // 2) 信号行（锚时刻）——先探列
  const probe = await sb.from('strategy_signals').select('*')
    .eq('experiment_id', '7d60bc05-8c4e-4f0d-993c-6f2d02428ea7')
    .eq('token_address', TOKEN).limit(1);
  if (probe.error) throw probe.error;
  const cols = probe.data && probe.data[0] ? Object.keys(probe.data[0]) : [];
  const stCol = cols.includes('status') ? 'status' : (cols.includes('signal_status') ? 'signal_status' : null);
  const want = ['id', 'signal_type', 'action', 'created_at', stCol, 'metadata'].filter(Boolean).join(',');
  const { data: sigs, error: e2 } = await sb.from('strategy_signals')
    .select(want)
    .eq('experiment_id', '7d60bc05-8c4e-4f0d-993c-6f2d02428ea7')
    .eq('token_address', TOKEN).order('created_at', { ascending: true }).limit(30);
  if (e2) throw e2;
  console.log('\nsignals:', sigs.length);
  for (const s of sigs) {
    const m = s.metadata || {};
    const cc = m.cheatCheck || {};
    const af = m.actFrontGate || {};
    console.log('-', s.created_at, s.signal_type, s[stCol],
      '| cheat:', JSON.stringify(cc.status || cc.grade || cc.reason || ''),
      '| sbw:', JSON.stringify((cc.levels && cc.levels.stallBurstWave) ?? ''),
      '| actFront:', JSON.stringify(af.path || af.level || ''));
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
