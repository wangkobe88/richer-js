// T028 探针：拉持械入宋 0xfb09ffea 信号链 metadata+cheat 行（182 跑）
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager.js');

(async () => {
  const c = await dbManager.getClient();
  const probe = await c.from('strategy_signals')
    .select('id,created_at,signal_type,token_address,metadata')
    .eq('experiment_id', 'c6efed13-ce9d-41b0-89a5-8ca8b029a609')
    .gte('created_at', '2026-11-05T07:30:00Z')
    .lte('created_at', '2026-11-05T07:40:00Z')
    .order('id', { ascending: true })
    .limit(400);
  const hits = (probe.data || []).filter((r) => r.token_address === '0xfb09ffea6b945a4f086d3e49fd42c77cd92fffff');
  console.log('hits:', hits.length);
  hits.forEach((r) => {
    const m = r.metadata || {};
    console.log('---', r.id.slice(0, 8), r.created_at, r.signal_type,
      'exec=' + (m.execution_status || '') + (m.execution_reason ? '/' + m.execution_reason : ''));
    if (m.signalGate) console.log('  signalGate:', JSON.stringify(m.signalGate));
    if (m.cheatCheck) console.log('  cheat:', JSON.stringify({ s: (m.cheatCheck || {}).status, g: (m.cheatCheck || {}).grade, atc: (m.cheatCheck || {}).anchorTickCount }));
    if (m.buyPoint) { const b = m.buyPoint; console.log('  bp:', b.status, 'passed=' + b.passed, JSON.stringify(b.assessment || {})); }
  });
  const cd = await c.from('cheat_detection')
    .select('verdict,question_version,analyzed_at,snapshot_digest')
    .eq('token_address', '0xfb09ffea6b945a4f086d3e49fd42c77cd92fffff')
    .order('analyzed_at', { ascending: false }).limit(3);
  (cd.data || []).forEach((r) => {
    const g = r.snapshot_digest || {};
    console.log('== cheat ==', r.analyzed_at, r.verdict, r.question_version, 'grade=' + (g.grade || null), JSON.stringify(g.gradeReasons || []));
  });
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
