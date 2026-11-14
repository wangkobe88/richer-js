// T029/T030 探针：无税人生 0xfba95a4e 信号链 metadata+cheat 行（182 跑）
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager.js');

(async () => {
  const c = await dbManager.getClient();
  const probe = await c.from('strategy_signals')
    .select('id,created_at,signal_type,token_address,metadata')
    .eq('experiment_id', 'c6efed13-ce9d-41b0-89a5-8ca8b029a609')
    .gte('created_at', '2026-11-05T07:51:00Z')
    .lte('created_at', '2026-11-05T08:00:00Z')
    .order('id', { ascending: true })
    .limit(400);
  const hits = (probe.data || []).filter((r) => r.token_address === '0xfba95a4e00883f82f04a459b107bd4788e2c4444');
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
    .eq('token_address', '0xfba95a4e00883f82f04a459b107bd4788e2c4444')
    .order('analyzed_at', { ascending: false }).limit(4);
  (cd.data || []).forEach((r) => {
    const g = r.snapshot_digest || {};
    console.log('== cheat ==', r.analyzed_at, r.verdict, r.question_version, 'grade=' + (g.grade || null), JSON.stringify(g.gradeReasons || []));
  });
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
