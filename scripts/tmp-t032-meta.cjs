// T032 FFFF 探针：生产信号行 metadata+cheat 行（182 跑）
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager.js');

(async () => {
  const c = await dbManager.getClient();
  const probe = await c.from('strategy_signals')
    .select('id,created_at,signal_type,token_address,metadata')
    .eq('experiment_id', 'c6efed13-ce9d-41b0-89a5-8ca8b029a609')
    .gte('created_at', '2026-11-05T08:03:00Z')
    .lte('created_at', '2026-11-05T08:10:00Z')
    .order('id', { ascending: true })
    .limit(400);
  const hits = (probe.data || []).filter((r) => r.token_address === '0x6af6cd7f35c1c1aa2392956938019a57c633ffff' && r.signal_type === 'BUY');
  console.log('生产 BUY 信号行:', hits.length);
  hits.forEach((r) => {
    const m = r.metadata || {};
    const sg = m.signalGate || {};
    console.log('---', r.created_at, sg.legId || sg.legName,
      'exec=' + (m.execution_status || '') + (m.execution_reason ? '/' + m.execution_reason : ''));
    if (m.cheatCheck) console.log('  cheat:', JSON.stringify({ s: m.cheatCheck.status, g: m.cheatCheck.grade, atc: m.cheatCheck.anchorTickCount, r: m.cheatCheck.reasons || m.cheatCheck.gradeReasons }));
    if (m.buyPoint) console.log('  bp:', m.buyPoint.status, 'passed=' + m.buyPoint.passed, m.buyPoint.assessment ? JSON.stringify({ bucket: m.buyPoint.assessment.bucket, prob: m.buyPoint.assessment.prob, rule: m.buyPoint.assessment.rule }) : '');
  });
  const cd = await c.from('cheat_detection')
    .select('verdict,question_version,analyzed_at,snapshot_digest')
    .eq('token_address', '0x6af6cd7f35c1c1aa2392956938019a57c633ffff')
    .order('analyzed_at', { ascending: false }).limit(3);
  (cd.data || []).forEach((r) => {
    const g = r.snapshot_digest || {};
    console.log('== cheat ==', r.analyzed_at, r.verdict, r.question_version, 'grade=' + (g.grade || null), JSON.stringify(g.gradeReasons || []));
  });
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
