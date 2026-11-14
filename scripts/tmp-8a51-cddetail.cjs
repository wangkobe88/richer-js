// 看生产 cheat_detection snapshot_digest 里的 grade 四键 + answers 摘要
const { dbManager } = require('../src/services/dbManager');
const TOKS = ['0x7e4468d4cd89b5ca97f504b526c592fd37297777', '0xf5e642bc79bd3dff16bb02794c6854933bb57777'];
(async () => {
  const c = dbManager.getClient();
  const { data: rows } = await c.from('cheat_detection')
    .select('token_address,question_version,verdict,anchor_tick_count,analyzed_at,snapshot_digest,fail_reason,is_valid')
    .in('token_address', TOKS).order('analyzed_at', { ascending: true }).limit(20);
  for (const r of (rows || [])) {
    const d = typeof r.snapshot_digest === 'string' ? JSON.parse(r.snapshot_digest) : (r.snapshot_digest || {});
    console.log(`[cd] ${r.token_address.slice(0, 10)} ${String(r.analyzed_at).slice(11, 19)} qv=${r.question_version} verdict=${r.verdict} anchor=${r.anchor_tick_count} fail=${r.fail_reason ?? '-'} valid=${r.is_valid}`);
    console.log(`     grade=${d.grade} reasons=${JSON.stringify(d.gradeReasons ?? []).slice(0, 140)}`);
    const lv = d.levels ?? d.observation?.levels ?? null;
    if (lv) console.log('     levels:', JSON.stringify(lv).slice(0, 200));
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
