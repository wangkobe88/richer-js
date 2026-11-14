// T031 FIGHT 探针：bp-run 53 点重跑的 BP-T031 评级 + 生产信号行 metadata（182 跑）
const fs = require('fs');
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager.js');

(async () => {
  const run = JSON.parse(fs.readFileSync('/home/ubuntu/richer-js/scripts/buy-point/data/bp-run-2026-11-06T02-49-20-787Z.json', 'utf8'));
  const hit = (run.results || []).find((r) => r.pointId === 'BP-T031');
  if (hit && hit.assessment) {
    console.log('BP15 重跑:', JSON.stringify({ bucket: hit.assessment.bucket, prob: hit.assessment.prob, rule: hit.assessment.rule,
      qualities: Object.fromEntries(Object.entries(hit.qualities || {}).map(([k, v]) => [k, v.bucket + '(' + (v.prob == null ? '-' : v.prob.toFixed(2)) + ']'])),
      dims: Object.fromEntries(Object.entries(hit.dimensions || {}).map(([k, v]) => [k, v ? v.bucket : 'null'])) }));
  } else console.log('BP15 重跑: 未命中', hit && hit.error);

  const c = await dbManager.getClient();
  const probe = await c.from('strategy_signals')
    .select('id,created_at,signal_type,token_address,metadata')
    .eq('experiment_id', 'c6efed13-ce9d-41b0-89a5-8ca8b029a609')
    .gte('created_at', '2026-11-05T07:54:00Z')
    .lte('created_at', '2026-11-05T08:01:00Z')
    .order('id', { ascending: true })
    .limit(400);
  const hits = (probe.data || []).filter((r) => r.token_address === '0x490da05a44bd886391d48f6cbfb1d7bbc7584444');
  console.log('生产信号行:', hits.length);
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
    .eq('token_address', '0x490da05a44bd886391d48f6cbfb1d7bbc7584444')
    .order('analyzed_at', { ascending: false }).limit(3);
  (cd.data || []).forEach((r) => {
    const g = r.snapshot_digest || {};
    console.log('== cheat ==', r.analyzed_at, r.verdict, r.question_version, 'grade=' + (g.grade || null), JSON.stringify(g.gradeReasons || []));
  });
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
